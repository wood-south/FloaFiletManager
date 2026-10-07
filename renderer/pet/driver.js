/* ============================================================
   桌宠自主行为驱动（阶段 3 收尾）
   ------------------------------------------------------------
   状态机（behavior.js）只回答「能不能切」，不回答「什么时候切」。
   本模块补上后者，把三个此前**没有驱动源**的状态接上：

   | 状态 | 触发 |
   | --- | --- |
   | `sleep` | 持续空闲「长时间」后（默认 60s）自动入睡 |
   | `walk`  | 空闲期间随机漫游（默认 20~45s 一次，走一小段后自己回 idle） |
   | `celebrate` | 外部事件 notify('celebrate')，例如上传成功 |

   设计原则（避免"桌宠变得不听话"）：
   1. **绝不高优先级抢占**：只在状态机能接受时才切换。用户正在拖（drag 100）、
      已吸附（snap 90）或正在交互（interact 70）时，自主行为一律让路。
   2. **可整体关闭**：`disable()` 后不再有任何自主状态变化，
      桌宠完全由用户操作驱动（与接入前行为一致）。
   3. **每个动作结束都要收回**：walk/celebrate 结束后主动回 idle，
      不依赖状态机的一次性回落（它只覆盖带 duration 的状态）。
   4. **时间与定时器全部可注入**：因此能在 Node 里精确测试，
      不靠真实等待 —— 否则这类"等 60 秒"的逻辑根本没法验证。

   调度策略用「单一定时器 + 每次重算」而不是多个 setInterval：
   多个定时器会在暂停/恢复时互相叠加，导致恢复后行为频率翻倍。 */

(function (global) {
  'use strict';

  const DEFAULTS = {
    sleepAfterMs: 60 * 1000,   // 空闲多久进入「该睡觉」阶段
    walkMinDelayMs: 20 * 1000, // 漫游间隔下限
    walkMaxDelayMs: 45 * 1000, // 漫游间隔上限
    walkDurationMs: 4000,      // 单次漫游持续
    celebrateDurationMs: 1500, // 庆祝持续（状态表里是 1200，这里略长以便看全）
    /* 待机 ↔ 睡觉的随机循环（阶段 8.7）
       用户要求「待机和睡觉随机循环播放，不要太快」。
       做法：空闲超过 sleepAfterMs 之后进入"小睡循环" ——
       随机睡一会（sleepMinMs~sleepMaxMs）、醒一会（awakeMinMs~awakeMaxMs），
       如此往复；期间用户一操作就整个中断（notifyActivity）。 */
    napLoop: true,
    sleepMinMs: 8 * 1000,      // 单次睡眠下限
    sleepMaxMs: 20 * 1000,     // 单次睡眠上限
    awakeMinMs: 4 * 1000,      // 醒来待机下限
    awakeMaxMs: 10 * 1000      // 醒来待机上限
  };

  /**
   * @param {object} opts
   *   - behavior: behavior.js 的实例（需有 set/current）
   *   - schedule(fn, ms) / cancel(handle): 可注入定时器
   *   - now(): 可注入时钟
   *   - random(): 可注入随机源（测试用）
   *   - ...DEFAULTS 覆盖项
   *   - onStateChange(name, reason): 通知（便于调试/测试）
   */
  function createBehaviorDriver(opts) {
    const o = opts || {};
    const behavior = o.behavior;
    const schedule = o.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = o.cancel || ((h) => clearTimeout(h));
    const now = o.now || (() => Date.now());
    const random = o.random || Math.random;
    const cfg = Object.assign({}, DEFAULTS, o);

    let enabled = false;
    let timer = null;
    /* 两个独立的计时起点（见 scheduleNext 的说明）：
       idleSince     —— 用户最后一次操作的时刻（决定何时入睡）
       walkStartedAt —— 上一次漫游/用户活动之后开始计漫游节拍 */
    let idleSince = now();
    let walkStartedAt = now();

    function clearTimer() {
      if (timer !== null) {
        try { cancel(timer); } catch (_) { /* 忽略 */ }
        timer = null;
      }
    }

    /**
     * 当前是否允许被自主行为改变。
     *
     * 只看**用户直接操作中**的状态。walk / celebrate 不需要额外加时间锁：
     * 状态机本身就不允许低优先级状态打断它们（idle 0 < walk 40 < celebrate 60），
     * 所以「自主动作进行中」已经被状态机挡住了。
     * 早先这里还按 `now() < busyUntil` 判断，方向恰好写反 ——
     * 状态还是 walk 时 busyUntil 在未来 → 判定"没在忙" → 反而允许抢占。
     */
    function canTakeOver() {
      if (!behavior) return false;
      const cur = currentState();
      if (cur === 'drag' || cur === 'snap' || cur === 'interact') return false;
      return true;
    }

    /**
     * 从自主动作回到 idle。
     * **必须用 reset()**：idle 的优先级是 0，用 set('idle') 会被状态机拒绝
     * （低优先级不得打断高优先级），桌宠就会永远卡在 walk / celebrate 上。
     */
    function backToIdle() {
      if (!behavior || typeof behavior.reset !== 'function') return false;
      const cur = currentState();
      if (cur !== 'walk' && cur !== 'celebrate') return false;
      const okReset = behavior.reset();
      if (okReset) emit('idle', 'auto-done');
      return okReset;
    }

    /** 读当前状态。behavior 实例的方法是 get()（不是 current()） */
    function currentState() {
      if (!behavior) return null;
      try {
        return typeof behavior.get === 'function' ? behavior.get() : behavior.current();
      } catch (_) {
        return null;
      }
    }

    function emit(name, reason) {
      if (typeof o.onStateChange === 'function') {
        try { o.onStateChange(name, reason); } catch (_) { /* 订阅者异常不影响驱动 */ }
      }
    }

    /** 尝试切换状态；被状态机拒绝时返回 false */
    function trySet(name, reason) {
      if (!behavior) return false;
      const okSet = behavior.set(name);
      if (okSet) emit(name, reason);
      return okSet;
    }

    /**
     * **唯一**的排定入口：先清掉旧定时器再排新的。
     *
     * 为什么必须这样：`timer` 只保存一个句柄，若某个路径直接 `timer = schedule(...)`
     * 覆盖它，**上一个定时器就变成孤儿** —— 既不会被取消（引用丢了），
     * 又仍会按时触发。表现是两条定时器链各自推进、互相打断：
     * 实测会出现 `sleep → idle → sleep` 每几百毫秒反复横跳。
     * 所以所有排定都必须走这里。
     */
    function scheduleOnce(fn, ms) {
      clearTimer();
      if (!enabled) return null;
      timer = schedule(fn, ms);
      return timer;
    }

    /**
     * 安排下一次「检查」——单一定时器，每次重算，避免定时器叠加。
     *
     * 两个时刻基于**两个不同的计时起点**，这是关键：
     *   - 入睡看「**用户**多久没操作」（idleSince）；
     *   - 漫游看「距离上次漫游多久」（walkStartedAt），属于内部节拍。
     * 早先两者共用 lastActivityAt，而 endWalk 又把它重置 ——
     * 于是每 20~45s 一次的漫游不断把入睡计时推后，
     * **桌宠永远睡不着**（被 driver.test.js 的入睡用例抓出）。
     */
    function scheduleNext() {
      if (!enabled) {
        clearTimer();
        return;
      }
      const userIdle = now() - idleSince;
      const sinceWalk = now() - walkStartedAt;
      const toSleep = Math.max(0, cfg.sleepAfterMs - userIdle);
      const toWalk = Math.max(0, walkTargetIdleMs() - sinceWalk);
      const wait = Math.min(toSleep, toWalk);
      scheduleOnce(onWake, Math.max(50, wait));
    }

    let currentWalkTarget = null;
    function walkTargetIdleMs() {
      if (currentWalkTarget === null) currentWalkTarget = randomWalkDelay();
      return currentWalkTarget;
    }
    function randomWalkDelay() {
      const lo = Math.max(0, cfg.walkMinDelayMs);
      const hi = Math.max(lo, cfg.walkMaxDelayMs);
      return lo + Math.floor(random() * (hi - lo + 1));
    }

    function onWake() {
      timer = null;
      if (!enabled) return;
      if (!canTakeOver()) {
        // 用户正在操作：不打扰，稍后再看
        scheduleNext();
        return;
      }
      const userIdle = now() - idleSince;

      // 睡着之后：进入「小睡循环」——睡一会、醒一会，随机往复。
      // 用户一操作就由 notifyActivity 整个中断（它用 reset 突破 sleep 优先级）。
      if (currentState() === 'sleep') {
        if (cfg.napLoop) {
          scheduleOnce(wakeFromNap, randomBetween(cfg.sleepMinMs, cfg.sleepMaxMs));
        } else {
          scheduleNext();
        }
        return;
      }

      // 入睡优先（用户空闲更久）
      if (userIdle >= cfg.sleepAfterMs) {
        if (trySet('sleep', 'idle-timeout')) {
          // 立刻排定"醒来"的时刻，形成随机循环（scheduleOnce 会清掉旧的检查定时器）
          if (cfg.napLoop) {
            scheduleOnce(wakeFromNap, randomBetween(cfg.sleepMinMs, cfg.sleepMaxMs));
          }
          return;
        }
        scheduleNext();
        return;
      }
      // 漫游：只在用户确实空闲时发生，且不与入睡冲突
      if (now() - walkStartedAt >= walkTargetIdleMs()) {
        currentWalkTarget = null;
        if (trySet('walk', 'wander')) {
          walkStartedAt = now();
          scheduleOnce(endWalk, cfg.walkDurationMs);
          return;
        }
      }
      scheduleNext();
    }

    /** 随机区间取值（含下限不含上限，保证 lo>hi 时也安全） */
    function randomBetween(lo, hi) {
      const a = Math.max(0, lo);
      const b = Math.max(a, hi);
      return Math.round(a + random() * (b - a));
    }

    /** 从小睡里醒来 → 回到 idle 待机一段时间，再看是否继续睡 */
    function wakeFromNap() {
      timer = null;
      if (!enabled) return;
      if (!canTakeOver()) {
        scheduleNext();
        return;
      }
      // sleep 优先级 20 > idle 0，必须用 reset 才能醒来
      if (currentState() === 'sleep') {
        if (typeof behavior.reset === 'function') {
          if (behavior.reset()) emit('idle', 'nap-wake');
        }
      }
      // 醒来待机一会；这段时间**不重置 idleSince**，
      // 否则每次小睡都会把"用户空闲"清零，睡眠循环就永远走不到下一轮
      scheduleOnce(() => {
        timer = null;
        if (!enabled) return;
        onWake();
      }, randomBetween(cfg.awakeMinMs, cfg.awakeMaxMs));
    }

    function endWalk() {
      timer = null;
      if (!enabled) return;
      // **不重置 idleSince**：桌宠自己走一圈不算用户活动，
      // 否则漫游会不断推后入睡，桌宠永远睡不着。
      backToIdle();
      scheduleNext();
    }

    /** 外部事件：例如上传成功 → 庆祝 */
    function celebrate(reason) {
      if (!enabled || !canTakeOver()) return false;
      if (!trySet('celebrate', reason || 'celebrate')) return false;
      scheduleOnce(() => {
        timer = null;
        if (!enabled) return;
        backToIdle();
        scheduleNext();
      }, cfg.celebrateDurationMs);
      return true;
    }

    /** 用户活动：重置空闲计时并唤醒（sleep → idle） */
    function notifyActivity(reason) {
      const t = now();
      idleSince = t;
      walkStartedAt = t;
      currentWalkTarget = null;
      if (!enabled) return;
      // sleep 的优先级是 20，高于 idle 的 0 —— 同样必须用 reset() 才能唤醒，
      // 否则用户怎么动桌宠都醒不过来。
      const cur = currentState();
      if (cur === 'sleep') {
        if (typeof behavior.reset === 'function') {
          if (behavior.reset()) emit('idle', reason || 'user-activity');
        }
      }
      scheduleNext();
    }

    return {
      enable() {
        if (enabled) return false;
        enabled = true;
        const t = now();
        idleSince = t;
        walkStartedAt = t;
        currentWalkTarget = null;
        scheduleNext();
        return true;
      },
      disable() {
        if (!enabled) return false;
        enabled = false;
        clearTimer();
        return true;
      },
      isEnabled() { return enabled; },
      /** 测试/诊断用 */
      config: () => Object.assign({}, cfg),
      notifyActivity,
      celebrate,
      /** 供测试手动触发一次检查（正常由定时器触发） */
      _wake: onWake
    };
  }

  const API = { DEFAULTS, createBehaviorDriver };

  global.PET_DRIVER = API;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
