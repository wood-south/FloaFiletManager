/* ============================================================
   桌宠动画方向变体（阶段 8.7）
   ------------------------------------------------------------
   需求：拖拽要分上下左右、走路要分左右、贴边要按边选姿势。

   设计取舍：**状态表仍然是 7 个状态**，方向用「clip 变体名」表达：

       状态（状态机）      可用的 clip 名
       drag          →    drag-up / drag-down / drag-left / drag-right / drag
       walk          →    walk-left / walk-right / walk
       snap          →    snap-left / snap-right / snap-top / snap-bottom / snap

   为什么不做成独立状态：
   - 状态表是优先级与回落关系的唯一来源，把 7 个状态扩成 12+ 个会牵动
     优先级表、一次性回落、全部测试与文档；
   - 更实际的是**旧皮肤包**：它们只声明 drag/walk/snap，
     若把这些变成「未知状态名」，旧包会整片报 warning。

   回退规则（关键）：
   1. 有方向变体 → 用方向变体
   2. 没有 → 回退到不带方向的同名 clip
   3. 连不带方向的也没有 → 由 frames.resolveClips 给静帧兜底
   因此皮肤作者可以「只画一个 drag」也可以「画四个方向」，都能用。

   方向名固定为 up/down/left/right/top/bottom 六个别名，
   top/bottom 归一化到 up/down —— 贴边语境下"上边/下边"更自然，
   而拖拽语境下"向上/向下"更自然，两者指向同一组变体。 */

(function (global) {
  'use strict';

  /** 方向的别名归一化：(状态名, 原始方向) → 变体后缀 */
  function normalizeDirection(dir) {
    if (typeof dir !== 'string') return null;
    const d = dir.trim().toLowerCase();
    if (d === 'up' || d === 'top') return 'up';
    if (d === 'down' || d === 'bottom' || d === 'bottom-') return 'down';
    if (d === 'left') return 'left';
    if (d === 'right') return 'right';
    return null;
  }

  /** 某个状态的带方向变体名（不带方向时返回状态名本身） */
  function variantName(state, dir) {
    const d = normalizeDirection(dir);
    if (!state) return null;
    return d ? state + '-' + d : state;
  }

  /** 该状态的 base 是否存在于 clips 里（且帧序列非空） */
  function hasClip(clips, name) {
    if (!clips || !name) return false;
    const c = clips[name];
    return !!(c && Array.isArray(c.frames) && c.frames.length > 0);
  }

  /**
   * 为「状态 + 方向」挑一个可用的 clip 名。
   * @returns {string|null} 选中的 clip 名；都没有时返回 null（交给静帧兜底）
   */
  function pickClipName(clips, state, dir) {
    const variant = variantName(state, dir);
    if (variant && variant !== state && hasClip(clips, variant)) return variant;
    if (hasClip(clips, state)) return state;
    return null;
  }

  /**
   * 拖动位移 → 方向。
   * 取**主轴**：位移大的那个轴决定方向；两者都极小则返回 null（视为没在动）。
   * @param {number} dx 水平位移（正=右）
   * @param {number} dy 垂直位移（正=下）
   * @param {number} [minAbs] 低于此值不算移动，默认 3px
   * @param {string} [fallback] 无法判定时的方向（例如沿用上一次）
   */
  function directionFromDelta(dx, dy, minAbs, fallback) {
    const min = typeof minAbs === 'number' ? minAbs : 3;
    const ax = Math.abs(dx || 0);
    const ay = Math.abs(dy || 0);
    if (ax < min && ay < min) return fallback || null;
    // 竖直为主时用 up/down，否则 left/right；相等时算竖直（拖起来更常见）
    if (ay >= ax) return (dy || 0) < 0 ? 'up' : 'down';
    return (dx || 0) < 0 ? 'left' : 'right';
  }

  /**
   * 让一个「状态名 → clip 名」的映射按方向重写。
   * frames.resolveClips 拿到的是纯状态名，所以需要先把方向变体
   * 合并成「状态名 → 该状态当前该用的帧」再交给它。
   *
   * @param {object} stateClips 皮肤的 clips（可能含方向变体）
   * @param {object} directions { drag:'left', walk:'right', … }
   * @returns {object} 只含状态名、但取的是方向变体的 clips
   */
  function applyDirections(stateClips, directions) {
    const dirs = directions || {};
    const out = {};
    const src = stateClips || {};
    // 先把「基础状态名」收集出来：去掉已知方向后缀
    const SUFFIXES = ['-up', '-down', '-left', '-right'];
    const bases = new Set();
    for (const name of Object.keys(src)) {
      let base = name;
      for (const sfx of SUFFIXES) {
        if (name.endsWith(sfx) && name.length > sfx.length) {
          base = name.slice(0, -sfx.length);
          break;
        }
      }
      bases.add(base);
    }
    for (const base of bases) {
      const chosen = pickClipName(src, base, dirs[base]);
      if (chosen) out[base] = src[chosen];
    }
    return out;
  }

  const API = {
    normalizeDirection,
    variantName,
    hasClip,
    pickClipName,
    directionFromDelta,
    applyDirections
  };

  global.PET_DIRECTION = API;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
