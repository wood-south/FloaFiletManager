/* ============================================================
   多显示器支持（阶段 7）
   ------------------------------------------------------------
   背景：此前所有几何钳制都基于 `screen.getPrimaryDisplay().workArea`，
   在双屏/多屏下就是错的 —— 把 Dock 拖到副屏后，钳制仍按主屏工作区计算，
   于是位置会被拉回主屏；副屏插拔后已保存的位置也可能落在屏幕之外。

   本模块只做一件事：**把"用哪个显示器"这件事收敛到一处**，并提供
   可注入 screen 的纯逻辑，便于在 Node 里测试（见 test/display.test.js）。

   选屏规则（按优先级）：
   1. 已有窗口/矩形 → 取与其交叠面积最大的显示器（getDisplayMatching）
      —— 对"浮动窗口跟随它所在的屏"来说这是最符合直觉的行为；
   2. 没有矩形 → 取鼠标所在显示器（用户在哪儿操作就作用于哪块屏）；
   3. 都不行 → 主显示器（兜底，保证永远有返回值）。

   注意：WorkArea 已排除任务栏，因此钳制一律用 workArea 而不是 bounds。
   ============================================================ */

'use strict';

function isRect(v) {
  return !!v && typeof v === 'object' &&
    typeof v.x === 'number' && typeof v.y === 'number' &&
    typeof v.width === 'number' && typeof v.height === 'number';
}

/**
 * @param {object} screen electron 的 screen 模块（可注入假实现）
 */
function createDisplayOps(screen) {
  function safeDisplays() {
    try {
      const list = screen.getAllDisplays();
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function primary() {
    try {
      return screen.getPrimaryDisplay();
    } catch (_) {
      return null;
    }
  }

  /**
   * 为给定矩形挑选显示器；无矩形时按鼠标位置，再兜底主屏。
   * @param {{x,y,width,height}|null} bounds
   */
  function forBounds(bounds) {
    if (isRect(bounds)) {
      // 优先交给 Electron 的匹配算法（按交叠面积）
      try {
        const d = screen.getDisplayMatching(bounds);
        if (d) return d;
      } catch (_) { /* 落到下面的兜底 */ }

      // 退化实现：自己算交叠面积，取最大者（保证可测且行为可预期）
      const displays = safeDisplays();
      let best = null;
      let bestArea = -1;
      for (const d of displays) {
        const wa = d.workArea;
        const ox = Math.max(0, Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x));
        const oy = Math.max(0, Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y));
        const area = ox * oy;
        if (area > bestArea) {
          bestArea = area;
          best = d;
        }
      }
      if (best) return best;
    }

    try {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      if (d) return d;
    } catch (_) { /* 落到主屏 */ }

    return primary() || { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  }

  /** 给定矩形的 workArea；无矩形时按鼠标/主屏 */
  function workAreaFor(bounds) {
    const d = forBounds(bounds);
    return (d && d.workArea) || { x: 0, y: 0, width: 1920, height: 1080 };
  }

  /** 窗口当前所在显示器的 workArea（窗口不存在时退化为按鼠标/主屏） */
  function workAreaOf(win) {
    let bounds = null;
    try {
      if (win && !win.isDestroyed()) bounds = win.getBounds();
    } catch (_) { /* 用兜底 */ }
    return workAreaFor(bounds);
  }

  /**
   * 把位置钳制进指定 workArea。
   * @param {object} pos {x, y, width, height}
   * @param {object} wa  目标 workArea
   * @param {object} opts
   *   - allowAbove: 允许窗口向上越出 workArea 上沿（Dock 窗口很高时，
   *     透明预留区需要能移出工作区上沿，见 move-dock 的既有修复）。
   *     注意：**没有** allowLeft/allowRight 之类 —— Dock 只需要向上越界，
   *     其余方向一律钳死，避免留下没人用且语义模糊的开关。
   */
  function clampTo(pos, wa, opts) {
    const o = opts || {};
    const area = wa || workAreaFor(pos);
    const width = pos.width || 0;
    const height = pos.height || 0;

    let newX = pos.x;
    let newY = pos.y;

    newX = Math.max(area.x, Math.min(newX, area.x + area.width - width));
    newY = Math.max(area.y, Math.min(newY, area.y + area.height - height));

    if (o.allowAbove) {
      // 只放开上沿：下沿与左右仍不得超出
      newY = Math.min(pos.y, area.y + area.height - height);
      newY = Math.max(newY, area.y - height);
    }
    return { x: newX, y: newY };
  }

  /** 全部显示器的 workArea 列表 */
  function workAreas() {
    const list = safeDisplays();
    if (list.length > 0) {
      return list.map((d) => d.workArea).filter(Boolean);
    }
    const p = primary();
    return p && p.workArea ? [p.workArea] : [];
  }

  return { forBounds, workAreaFor, workAreaOf, workAreas, clampTo, isRect };
}

/* ---------- 进程级：显示器变化时把窗口拉回可视区 ----------
   副屏被拔掉后，原本在副屏上的 Dock/浮窗会落在不存在的坐标上（看不见也点不到），
   因此监听变化事件并把越界的窗口收回主屏。 */

/**
 * @param {object} deps { screen, getFloatableWindows(): BrowserWindow[] }
 * @returns {{dispose:Function}}
 */
function watchDisplayChanges(deps) {
  const screen = deps.screen;
  const ops = createDisplayOps(screen);

  function bringBackWindows() {
    let wins = [];
    try {
      wins = deps.getFloatableWindows() || [];
    } catch (_) {
      return;
    }
    // 用**全部**显示器的 workArea 判断可见性：
    // 若只用单个 workArea，位于副屏的窗口会被误判为"完全不可见"并被拉走。
    const areas = ops.workAreas();
    for (const win of wins) {
      if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) continue;
      let b;
      try {
        b = win.getBounds();
      } catch (_) {
        continue;
      }
      if (!isFullyOutside(b, areas)) continue;
      // 完全落在所有屏幕之外（典型场景：副屏被拔掉）→ 收回它原屏幕的 workArea
      const wa = ops.workAreaFor(b);
      const pos = ops.clampTo({ x: b.x, y: b.y, width: b.width, height: b.height }, wa);
      try {
        win.setPosition(pos.x, pos.y);
      } catch (_) { /* 窗口可能正在销毁 */ }
    }
  }

  const onChange = () => {
    // 稍等一拍：显示器变化时 workArea 可能尚未稳定
    setTimeout(bringBackWindows, 300);
  };

  try {
    screen.on('display-metrics-changed', onChange);
    screen.on('display-removed', onChange);
    screen.on('display-added', onChange);
  } catch (_) { /* 某些平台不支持这些事件 */ }

  return {
    bringBackWindows,
    dispose() {
      try {
        screen.removeListener('display-metrics-changed', onChange);
        screen.removeListener('display-removed', onChange);
        screen.removeListener('display-added', onChange);
      } catch (_) { /* 忽略 */ }
    }
  };
}

/** 窗口矩形是否与任何显示器都没有交叠（即完全不可见） */
function isFullyOutside(bounds, areas) {
  if (!isRect(bounds)) return false;
  if (!Array.isArray(areas) || areas.length === 0) return false;
  return !areas.some((wa) => {
    if (!wa) return false;
    const ox = Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x);
    const oy = Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y);
    return ox > 0 && oy > 0;
  });
}

module.exports = { createDisplayOps, watchDisplayChanges, isFullyOutside, isRect };
