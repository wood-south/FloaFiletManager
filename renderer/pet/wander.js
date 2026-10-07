/* ============================================================
   桌宠走动（阶段 8.7）
   ------------------------------------------------------------
   需求：`walk` 不只是原地播帧，而是**真正改变窗口位置**：
   - 自由状态下左右漫游（小步移动）
   - 吸附到屏幕边缘 / Dock 时，**沿那条边**滑动（横向边走左右、
     纵向边走上下），不脱离吸附

   与 driver.js 的分工：
   - driver 决定「什么时候进入 walk、走多久」（状态机节拍）
   - 本模块决定「walk 期间往哪走、走多快、撞到边界怎么办」

   为了能在 Node 里测，移动与位置读取都注入：
     - move(dx, dy)      提交位移（复用既有 move-window 通道）
     - readPos()         读当前位置（用于判断是否真的移动了）
     - orientation()     返回 'left'|'right'|'top'|'bottom'|'dock-left'… | null
     - bounds()          可选，返回 {minX,maxX,minY,maxY} 供预判

   **撞墙处理**：不依赖 bounds（主进程已有钳制），而是「移动后位置没变
   → 判定到边 → 反向」。这样无论主进程怎么钳制都不会卡住，
   也不会因为 renderer 与主进程对边界的理解不一致而抖动。 */

(function (global) {
  'use strict';

  const DEFAULTS = {
    speedX: 1.2,        // 自由漫游每帧水平速度（像素）
    speedY: 1.0,        // 沿竖直边行走的竖直速度
    stepMs: 40,         // 每步间隔（约 25 fps 的移动节拍，避免过于频繁移动窗口）
    minRunMs: 1200,     // 单次走动最短时长
    maxRunMs: 3200,     // 单次走动最长时长
    edgeEpsilon: 1      // 位置变化小于此值视为没动（到边了）
  };

  /** 吸附朝向 → 本模块的行走轴。'left'/'right' 表示贴左右边（沿竖直走） */
  function axisFor(orientation) {
    if (!orientation) return { axis: 'x', sign: null };
    const o = String(orientation);
    // 贴左右边 → 沿竖直方向走；贴上下边 → 沿水平方向走；Dock 同理
    if (o === 'left' || o === 'right') return { axis: 'y', sign: null };
    if (o === 'top' || o === 'bottom') return { axis: 'x', sign: null };
    if (o === 'dock-left' || o === 'dock-right') return { axis: 'y', sign: null };
    if (o === 'dock-top' || o === 'dock-bottom') return { axis: 'x', sign: null };
    return { axis: 'x', sign: null };
  }

  /**
   * @param {object} opts 见文件头；另可覆盖 DEFAULTS 里的数值
   */
  function createWanderer(opts) {
    const o = opts || {};
    const cfg = Object.assign({}, DEFAULTS, o);
    const readPos = o.readPos || (() => null);
    const move = o.move || (() => {});
    const orientation = o.orientation || (() => null);
    const random = o.random || Math.random;

    let running = false;
    let sign = 1;              // 当前方向：+1 / -1
    let axis = 'x';            // 当前行走轴
    let stuckTicks = 0;

    function pickAxis() {
      // orientation 由壳层提供（读 DOM 类名），理论上可能抛错；不能让它把走动打断
      let orient = null;
      try {
        orient = orientation();
      } catch (_) {
        orient = null;
      }
      const info = axisFor(orient);
      axis = info.axis;
      if (sign !== 1 && sign !== -1) sign = 1;
    }

    function reverse() {
      sign = -sign;
      stuckTicks = 0;
    }

    return {
      /** 进入 walk：重置状态并选轴 */
      start() {
        if (running) return false;
        running = true;
        stuckTicks = 0;
        pickAxis();
        // 开始时随机一次方向，避免每次都先往右
        sign = random() < 0.5 ? -1 : 1;
        return true;
      },

      /** 结束 walk；未在走动时返回 false（幂等，便于调用方判断是否有变化） */
      stop() {
        if (!running) return false;
        running = false;
        stuckTicks = 0;
        return true;
      },

      isRunning() { return running; },

      /** 当前方向（供渲染层选 walk-left / walk-right） */
      direction() {
        if (axis === 'y') return sign < 0 ? 'up' : 'down';
        return sign < 0 ? 'left' : 'right';
      },

      /** 当前行走轴（'x' 水平 / 'y' 竖直），供诊断 */
      axis() { return axis; },

      /**
       * 推进一帧。返回本次实际提交的位移 {dx, dy}（便于测试与诊断）。
       * @param {number} dtMs 距上一帧的毫秒数（用于按时间缩放，掉帧时不会突然变慢）
       */
      tick(dtMs) {
        if (!running) return { dx: 0, dy: 0 };
        const scale = typeof dtMs === 'number' && dtMs > 0
          ? Math.min(3, dtMs / cfg.stepMs)   // 上限 3 倍，避免长时间挂起后瞬移
          : 1;

        const before = readPos();
        let dx = 0;
        let dy = 0;
        if (axis === 'y') dy = sign * cfg.speedY * scale;
        else dx = sign * cfg.speedX * scale;
        move(dx, dy);

        // 到边判定：移动后位置没变 → 反向
        const after = readPos();
        if (before && after) {
          const movedX = Math.abs(after.x - before.x);
          const movedY = Math.abs(after.y - before.y);
          const expected = axis === 'y' ? movedY : movedX;
          if (expected < cfg.edgeEpsilon) {
            stuckTicks++;
            if (stuckTicks >= 2) reverse();   // 连续两次没动才反向，避免抖动
          } else {
            stuckTicks = 0;
          }
        }
        return { dx, dy };
      },

      /** 单次走动时长（随机），供 driver 决定 walk 持续多久 */
      pickDuration() {
        const lo = Math.max(200, cfg.minRunMs);
        const hi = Math.max(lo, cfg.maxRunMs);
        return Math.round(lo + random() * (hi - lo));
      },

      config() { return Object.assign({}, cfg); }
    };
  }

  const API = { DEFAULTS, axisFor, createWanderer };

  global.PET_WANDER = API;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
