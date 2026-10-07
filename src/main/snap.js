/**
 * 浮窗 ↔ Dock 吸附几何（纯函数，无 Electron 依赖，便于单测）
 *
 * 背景：早期实现在主进程里用四个手调常数 snapInset{Top,Bottom,Left,Right} = 52 计算吸附位置，
 * 注释自称是「浮窗(160)与宠物视觉(90)差值一半」（实际应为 35），且宠物视觉框其实是
 * **姿态相关**的：SVG 内容在 100×100 viewBox 中约占 90×80，贴边旋转 90° 后视觉宽又变成 80。
 * 因此任何固定像素补偿值都只能在某一种姿态下正确 —— 这是「吸附位置有时候不对」的根因。
 *
 * 本模块改为由渲染进程上报宠物**真实视觉框**（getBoundingClientRect()，含旋转与缩放），
 * 吸附位置一律由视觉框推导，不再使用手调常数。
 */

/**
 * 计算吸附后的窗口位置。
 *
 * @param {object} p
 * @param {{x:number,y:number,width:number,height:number}} p.floatBounds 浮窗窗口在屏幕上的边界
 * @param {{left:number,top:number,width:number,height:number}} p.anchor 宠物视觉框（相对浮窗左上角）
 * @param {{x:number,y:number,width:number,height:number}} p.panelBounds Dock 面板在屏幕上的边界
 * @param {number} [p.snapDistance] 触发吸附的最大像素距离
 * @param {number} [p.visualGap] 吸附后宠物视觉边框与面板之间的间隙（0 = 紧贴）
 * @param {number} [p.minOverlap] x/y 方向至少重叠多少像素才考虑该方向的吸附
 * @returns {{side:string, x:number, y:number, gap:number}|null}
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

  // 宠物视觉框在屏幕上的位置
  const vx = fx + anchor.left;
  const vy = fy + anchor.top;
  const vw = anchor.width;
  const vh = anchor.height;

  // 与面板的重叠量（用于判断该方向是否「对着」面板）
  const xOverlap = Math.min(vx + vw, panelBounds.x + panelBounds.width) - Math.max(vx, panelBounds.x);
  const yOverlap = Math.min(vy + vh, panelBounds.y + panelBounds.height) - Math.max(vy, panelBounds.y);

  const candidates = [];

  // 面板上方：宠物下沿 vs 面板上沿
  if (xOverlap >= minOverlap) {
    const gap = panelBounds.y - (vy + vh);
    candidates.push({ side: 'top', gap, fix: () => ({ x: fx, y: fy + (gap - visualGap) }) });
    // 面板下方：宠物上沿 vs 面板下沿
    const gapBelow = vy - (panelBounds.y + panelBounds.height);
    candidates.push({ side: 'bottom', gap: gapBelow, fix: () => ({ x: fx, y: fy - (gapBelow - visualGap) }) });
  }

  // 面板左侧：宠物右沿 vs 面板左沿
  if (yOverlap >= minOverlap) {
    const gap = panelBounds.x - (vx + vw);
    candidates.push({ side: 'left', gap, fix: () => ({ x: fx + (gap - visualGap), y: fy }) });
    // 面板右侧：宠物左沿 vs 面板右沿
    const gapRight = vx - (panelBounds.x + panelBounds.width);
    candidates.push({ side: 'right', gap: gapRight, fix: () => ({ x: fx - (gapRight - visualGap), y: fy }) });
  }

  // 取绝对距离最近且在阈值内的方向
  let best = null;
  for (const c of candidates) {
    if (!Number.isFinite(c.gap)) continue;
    if (Math.abs(c.gap) > snapDistance) continue;
    if (!best || Math.abs(c.gap) < Math.abs(best.gap)) best = c;
  }
  if (!best) return null;

  const pos = best.fix();
  return {
    side: best.side,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    gap: best.gap
  };
}

/**
 * 计算浮窗相对 Dock 面板的吸附关系（供 Dock 移动时保持相对位置）。
 *
 * @param {{x:number,y:number,width:number,height:number}} p.floatBounds
 * @param {{x:number,y:number,width:number,height:number}} p.panelBounds
 * @param {string} p.side 吸附方向
 * @returns {{side:string, offsetX:number, offsetY:number}}
 */
function computeSnapRelation({ floatBounds, panelBounds, side }) {
  return {
    side,
    offsetX: Math.round(floatBounds.x - panelBounds.x),
    offsetY: Math.round(floatBounds.y - panelBounds.y)
  };
}

module.exports = { computeDockSnap, computeSnapRelation };
