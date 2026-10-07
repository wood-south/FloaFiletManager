/**
 * 浮窗 ↔ Dock 吸附（纯状态机，无 Electron 依赖）
 *
 * 为什么独立成模块：吸附涉及「搜索方向 / 保持关系 / Dock 移动跟随 / 视觉框变化重算」
 * 多段逻辑，且高度依赖坐标运算。抽成纯函数后可以用 Node 完整模拟
 * 「拖动 → 吸附 → 移动 Dock」全过程（见 test/snap-flow.test.js），
 * 在没有 GUI 的环境里也能验证每一步的坐标是否正确。
 *
 * 坐标系约定：
 *   - floatBounds / panelBounds 为**屏幕坐标**
 *   - anchor 为宠物视觉框，**相对浮窗窗口左上角**（来自渲染进程上报）
 */

/**
 * 计算吸附后的窗口位置（搜索模式）。
 */
function computeDockSnap({
  floatBounds,
  anchor,
  panelBounds,
  snapDistance = 60,
  visualGap = 0,
  minOverlap = 12
}) {
  if (!floatBounds || !panelBounds || !anchor) return null;
  if (!anchor.width || !anchor.height) return null;

  const fx = floatBounds.x;
  const fy = floatBounds.y;
  const vx = fx + anchor.left;
  const vy = fy + anchor.top;
  const vw = anchor.width;
  const vh = anchor.height;

  const xOverlap = Math.min(vx + vw, panelBounds.x + panelBounds.width) - Math.max(vx, panelBounds.x);
  const yOverlap = Math.min(vy + vh, panelBounds.y + panelBounds.height) - Math.max(vy, panelBounds.y);

  const candidates = [];

  if (xOverlap >= minOverlap) {
    const gapTop = panelBounds.y - (vy + vh);
    candidates.push({ side: 'top', gap: gapTop });
    const gapBottom = vy - (panelBounds.y + panelBounds.height);
    candidates.push({ side: 'bottom', gap: gapBottom });
  }
  if (yOverlap >= minOverlap) {
    const gapLeft = panelBounds.x - (vx + vw);
    candidates.push({ side: 'left', gap: gapLeft });
    const gapRight = vx - (panelBounds.x + panelBounds.width);
    candidates.push({ side: 'right', gap: gapRight });
  }

  let best = null;
  for (const c of candidates) {
    if (!Number.isFinite(c.gap)) continue;
    if (Math.abs(c.gap) > snapDistance) continue;
    if (!best || Math.abs(c.gap) < Math.abs(best.gap)) best = c;
  }
  if (!best) return null;

  const target = positionForSide({
    side: best.side,
    floatBounds,
    anchor,
    panelBounds,
    visualGap
  });
  // 统一取整：非吸附轴会原样沿用 floatBounds 的坐标，若不取整会出现半像素抖动，
  // 且与 maintain 路径（positionForSide 内已取整）结果不一致
  return {
    side: best.side,
    x: Math.round(target.x),
    y: Math.round(target.y),
    gap: best.gap
  };
}

/**
 * 按指定方向计算「视觉边框紧贴面板」的目标窗口位置。
 * 吸附位置唯一的计算入口：搜索与保持都走它，避免两处公式分叉
 * （历史上正是分叉导致「搜索」与「保持」结果不一致）。
 *
 * @param {object} p
 * @param {string} p.side
 * @param {object} p.floatBounds 当前浮窗边界
 * @param {object} p.anchor 宠物视觉框（相对窗口）
 * @param {object} p.panelBounds 面板屏幕边界
 * @param {number} [p.visualGap]
 * @param {object|null} [p.relation] 已有吸附关系；传入时**非吸附轴按关系偏移跟随面板**。
 *   这一点很关键：贴在上/下方时若锁死 x，Dock 横向移动后桌宠就不会跟随，
 *   表现为「不跟随移动」。
 */
function positionForSide({ side, floatBounds, anchor, panelBounds, visualGap = 0, relation = null }) {
  let { x, y } = floatBounds;

  switch (side) {
    case 'top':
      // 宠物视觉下沿 = 面板上沿 - visualGap
      y = Math.round(panelBounds.y - visualGap - anchor.top - anchor.height);
      if (relation) x = Math.round(panelBounds.x + relation.offsetX);
      break;
    case 'bottom':
      // 宠物视觉上沿 = 面板下沿 + visualGap
      y = Math.round(panelBounds.y + panelBounds.height + visualGap - anchor.top);
      if (relation) x = Math.round(panelBounds.x + relation.offsetX);
      break;
    case 'left':
      // 宠物视觉右沿 = 面板左沿 - visualGap
      x = Math.round(panelBounds.x - visualGap - anchor.left - anchor.width);
      if (relation) y = Math.round(panelBounds.y + relation.offsetY);
      break;
    case 'right':
      // 宠物视觉左沿 = 面板右沿 + visualGap
      x = Math.round(panelBounds.x + panelBounds.width + visualGap - anchor.left);
      if (relation) y = Math.round(panelBounds.y + relation.offsetY);
      break;
    default:
      return null;
  }
  return { x, y };
}

function computeSnapRelation({ floatBounds, panelBounds, side }) {
  return {
    side,
    offsetX: Math.round(floatBounds.x - panelBounds.x),
    offsetY: Math.round(floatBounds.y - panelBounds.y)
  };
}

/**
 * 吸附状态机。
 *
 * decide() 返回本次应当执行的动作，不直接操作窗口：
 *   { action: 'snap',  side, x, y, relation }  需要移动窗口并建立/更新关系
 *   { action: 'none' }                          无需动作
 *   { action: 'release' }                       解除吸附关系
 *
 * @param {object} input
 * @param {object} input.floatBounds 当前浮窗窗口边界（屏幕坐标）
 * @param {object|null} input.anchor 宠物视觉框（相对窗口），未上报时传 null
 * @param {object|null} input.panelBounds Dock 面板边界（屏幕坐标）；null 表示 Dock 不可用
 * @param {object|null} input.relation 当前吸附关系；null 表示尚未吸附
 * @param {'search'|'maintain'} input.mode
 * @param {number} [input.snapDistance]
 * @param {number} [input.visualGap]
 * @param {number} [input.settleTolerance] maintain 模式下小于该位移不做移动
 */
function decide({
  floatBounds,
  anchor,
  panelBounds,
  relation,
  mode = 'maintain',
  snapDistance = 60,
  visualGap = 0,
  settleTolerance = 2
}) {
  // 面板不可用：仅在保持模式下解除关系（搜索模式下无事可做）
  if (!panelBounds) {
    return mode === 'maintain' && relation ? { action: 'release' } : { action: 'none' };
  }
  // 视觉框未上报：不做任何吸附。早期实现回退为「按整个窗口吸附」，
  // 会引入 (windowH - petH)/2 的固定偏差，且该偏差不会被后续上报纠正。
  if (!anchor || !anchor.width || !anchor.height) return { action: 'none' };
  if (!floatBounds) return { action: 'none' };

  if (mode === 'search') {
    const result = computeDockSnap({
      floatBounds, anchor, panelBounds, snapDistance, visualGap
    });
    if (!result) {
      // 搜索模式找不到吸附：清除已有关系（用户已拖离 Dock）
      return relation ? { action: 'release' } : { action: 'none' };
    }
    return {
      action: 'snap',
      side: result.side,
      x: result.x,
      y: result.y,
      relation: computeSnapRelation({
        floatBounds: { x: result.x, y: result.y, width: floatBounds.width, height: floatBounds.height },
        panelBounds,
        side: result.side
      })
    };
  }

  // maintain：必须已有关系，沿当前边重算（不重新挑方向，避免被吸到另一侧）
  if (!relation) return { action: 'none' };
  const target = positionForSide({
    side: relation.side, floatBounds, anchor, panelBounds, visualGap, relation
  });
  if (!target) return { action: 'none' };

  const moved = Math.abs(target.x - floatBounds.x) > settleTolerance ||
    Math.abs(target.y - floatBounds.y) > settleTolerance;

  return {
    action: moved ? 'snap' : 'none',
    side: relation.side,
    x: target.x,
    y: target.y,
    relation: computeSnapRelation({
      floatBounds: { x: target.x, y: target.y, width: floatBounds.width, height: floatBounds.height },
      panelBounds,
      side: relation.side
    })
  };
}

module.exports = {
  computeDockSnap,
  computeSnapRelation,
  positionForSide,
  decide
};
