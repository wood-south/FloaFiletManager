/* ============================================================
   桌宠动画状态机（阶段 3 · A 层「视觉状态」）
   ------------------------------------------------------------
   目标：把「宠物现在在做什么」收敛成**一张状态表 + 一个状态机**，
   由它决定该挂哪个 CSS 状态类；而不是像现在这样把 4 个无限动画
   （呼吸 / 阴影脉动 / 眨眼 / 瞳孔移动）直接写死在元素上、永远在跑。

   为什么必须先做 A 层：
   - 现状是「默认全都在播」，新增动作（走路、睡觉、点击反馈）之间会互相打架，
     例如「睡觉 + 呼吸」同时缩放同一个元素。
   - 状态表是阶段 8 皮肤包的契约基础：`pet.json` 里的 clips 就是对这张表的覆盖。

   设计要点：
   1. **优先级**：高优先级状态可打断低优先级；低优先级不能打断高优先级。
      drag(100) > snap(90) > interact(70) > celebrate(60) > walk(40) > sleep(20) > idle(0)
   2. **默认值等于现状**：未收到任何指令时是 idle，而 idle 对应的 CSS 状态类
      与现有动画完全一致 —— 因此接入本状态机不改变默认外观。
   3. **优雅降级**：未知状态名回落到 idle，不抛错也不白屏（阶段 3 检测项）。
   4. **一次性状态**（interact / celebrate）：指定 duration，到点自动回落到 fallback。
   5. 本文件不直接碰 DOM：只产出「当前状态」，由壳层把状态类贴到元素上，
      并留出 `onChange` 通知。因此可以在 Node 里完整测试（见 test/behavior.test.js）。
   ============================================================ */

(function (global) {
  'use strict';

  /** 状态表：顺序无关，优先级决定能否互相打断 */
  const STATES = {
    idle: {
      priority: 0,
      loop: true,
      class: 'state-idle',
      label: '待机'
    },
    sleep: {
      priority: 20,
      loop: true,
      class: 'state-sleep',
      label: '睡觉'
    },
    walk: {
      priority: 40,
      loop: true,
      class: 'state-walk',
      label: '走动'
    },
    celebrate: {
      priority: 60,
      loop: false,
      duration: 1200,
      fallback: 'idle',
      class: 'state-celebrate',
      label: '庆祝'
    },
    interact: {
      priority: 70,
      loop: false,
      duration: 600,
      fallback: 'idle',
      class: 'state-interact',
      label: '被点击'
    },
    snap: {
      priority: 90,
      loop: true,
      class: 'state-snap',
      label: '贴边/吸附'
    },
    drag: {
      priority: 100,
      loop: true,
      class: 'state-drag',
      label: '被拖动'
    }
  };

  const DEFAULT_STATE = 'idle';

  /** 状态名是否合法 */
  function hasState(name) {
    return Object.prototype.hasOwnProperty.call(STATES, name);
  }

  /** 未知状态名回落到 idle（优雅降级，而不是抛错/白屏） */
  function normalize(name) {
    return hasState(name) ? name : DEFAULT_STATE;
  }

  function priorityOf(name) {
    const s = STATES[normalize(name)];
    return s ? s.priority : 0;
  }

  /** 目标状态能否打断当前状态 */
  function canTransition(from, to) {
    if (!hasState(to)) return false;
    if (from === null || from === undefined) return true;
    return priorityOf(to) >= priorityOf(from);
  }

  /**
   * 创建状态机。
   * @param {object} options
   *  - initial   初始状态（默认 idle）
   *  - onChange({ from, to, duration, fallback, loop, class })  状态变化回调
   *  - schedule / cancel  可注入的定时器（默认 setTimeout / clearTimeout）
   */
  function createBehavior(options) {
    const opts = options || {};
    const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = opts.cancel || ((h) => clearTimeout(h));

    let current = normalize(opts.initial || DEFAULT_STATE);
    let timer = null;
    const listeners = [];

    function notify(prev) {
      const info = describe();
      const payload = Object.assign({ from: prev }, info);
      if (typeof opts.onChange === 'function') {
        try {
          opts.onChange(payload);
        } catch (err) {
          console.warn('[behavior] onChange 抛错:', err);
        }
      }
      for (const fn of listeners.slice()) {
        try {
          fn(payload);
        } catch (err) {
          console.warn('[behavior] 订阅者抛错:', err);
        }
      }
    }

    function clearTimer() {
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    }

    /** 当前状态的完整描述（供壳层贴 class 与测试断言） */
    function describe() {
      const s = STATES[current] || STATES[DEFAULT_STATE];
      return {
        state: current,
        class: s.class,
        priority: s.priority,
        loop: s.loop,
        duration: s.duration || null,
        fallback: s.fallback || null,
        label: s.label
      };
    }

    function get() {
      return current;
    }

    /**
     * 请求切换到目标状态。
     * @param {string} next 目标状态名
     * @returns {boolean} 是否发生了切换
     *
     * 未知状态名一律**拒绝**（返回 false、状态不变），而不是静默回落到 idle：
     * 若回落，配合优先级规则会出现「写错状态名反而没反应/切到别的状态」的迷惑行为，
     * 调用方拿不到任何反馈。需要回落语义的场景（fallback、initial）用 normalize()。
     */
    function set(next) {
      if (!hasState(next)) return false;
      const target = next;
      if (target === current) return false;
      if (!canTransition(current, target)) return false;

      const prev = current;
      current = target;
      clearTimer();

      const s = STATES[target];
      // 一次性状态：到点回落到 fallback（默认 idle）
      if (!s.loop && s.duration) {
        const back = normalize(s.fallback || DEFAULT_STATE);
        timer = schedule(() => {
          timer = null;
          current = back;
          notify(target);
        }, s.duration);
      }

      notify(prev);
      return true;
    }

    /** 强制回到 idle 并清掉计时器（例如窗口失焦兜底） */
    function reset() {
      clearTimer();
      if (current === DEFAULT_STATE) return false;
      const prev = current;
      current = DEFAULT_STATE;
      notify(prev);
      return true;
    }

    /** 订阅状态变化；返回取消订阅函数 */
    function subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }

    /** 停止计时器（卸载时调用） */
    function dispose() {
      clearTimer();
      listeners.length = 0;
    }

    return { get, set, reset, describe, subscribe, dispose };
  }

  const API = {
    STATES,
    DEFAULT_STATE,
    hasState,
    normalize,
    priorityOf,
    canTransition,
    createBehavior
  };

  // 浏览器：挂到 window，供渲染脚本直接使用
  global.PET_BEHAVIOR = API;

  /* Node（主进程）：阶段 8 的皮肤导入校验需要「合法状态名清单」，
     让主进程 require 状态表本身，而不是在别处复制一份状态名列表 ——
     否则新增状态时两处会分叉。
     本文件在浏览器里以 <script> 加载（没有 module），因此先判断存在性；
     这里的 module/require 是给 Node 用的，不是浏览器代码。 */
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
