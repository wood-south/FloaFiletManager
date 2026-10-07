/* 自检：浮窗↔Dock 吸附几何 src/main/snap.js
   回归背景：早期在主进程用四个手调常数 snapInset{Top,Bottom,Left,Right} = 52 计算吸附，
   注释自称是「浮窗(160)与宠物视觉(90)差值一半」（应为 35），而宠物视觉框实际是
   姿态相关的 90×80（贴边旋转 90° 后视觉宽变 80），所以固定值只在单一姿态下正确，
   表现为「有时候吸附位置不对」。现改为由上报的真实视觉框推导。

   为保证可读性与可核对性，测试用「视觉框目标位置」构造场景，
   再由辅助函数反推浮窗窗口坐标，避免手算偏移出错。 */

const assert = require('assert');
const path = require('path');
const { computeDockSnap, computeSnapRelation } = require(
  path.join(__dirname, '..', 'src', 'main', 'snap.js')
);

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// 浮窗窗口 160×160；宠物视觉框（含 viewBox 留白）实际 90×80，居中于窗口 → 偏移 (35, 40)
const WIN = 160;
const ANCHOR = { left: 35, top: 40, width: 90, height: 80 };
const ANCHOR_ROTATED = { left: 40, top: 35, width: 80, height: 90 }; // 贴边旋转 90°
const PANEL = { x: 400, y: 900, width: 1000, height: 64 };

/** 由「希望视觉框出现在哪」反推浮窗窗口位置 */
function floatAt(anchor, visual) {
  return {
    x: visual.left - anchor.left,
    y: visual.top - anchor.top,
    width: WIN,
    height: WIN
  };
}
/** 视觉框在屏幕上的实际位置（用于断言） */
function visualOf(floatBounds, anchor) {
  return {
    left: floatBounds.x + anchor.left,
    top: floatBounds.y + anchor.top,
    width: anchor.width,
    height: anchor.height,
    right: floatBounds.x + anchor.left + anchor.width,
    bottom: floatBounds.y + anchor.top + anchor.height
  };
}

console.log('\n[1] 吸附到面板上方：宠物视觉下沿贴面板上沿');
ok('视觉下沿距面板上沿 10px 时吸附，且吸附后正好贴合', () => {
  // 视觉框 x 500..590（与面板 x 重叠 90）、y 810..890（下沿距面板上沿 900 为 10）
  const floatBounds = floatAt(ANCHOR, { left: 500, top: 810 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL });
  assert.ok(r, '应触发吸附');
  assert.strictEqual(r.side, 'top');
  const after = visualOf({ x: r.x, y: r.y, width: WIN, height: WIN }, ANCHOR);
  assert.strictEqual(after.bottom, PANEL.y, '吸附后视觉下沿未贴合面板上沿');
});
ok('仅调整吸附轴，另一轴保持不变', () => {
  const floatBounds = floatAt(ANCHOR, { left: 500, top: 810 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL });
  assert.strictEqual(r.x, floatBounds.x);
});

console.log('\n[2] 旋转姿态：视觉宽由 90 变 80');
ok('吸附到面板左侧后视觉右沿贴面板左沿', () => {
  // 旋转后视觉框 80×90；x 370..450 与面板 y 重叠（900..990 vs 900..964）
  const floatBounds = floatAt(ANCHOR_ROTATED, { left: 370, top: 900 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR_ROTATED, panelBounds: PANEL });
  assert.ok(r, '应触发吸附');
  assert.strictEqual(r.side, 'left');
  const after = visualOf({ x: r.x, y: r.y, width: WIN, height: WIN }, ANCHOR_ROTATED);
  assert.strictEqual(after.right, PANEL.x);
});
ok('若错误地按 90 宽（未旋转）计算，结果会偏 10px', () => {
  const floatBounds = floatAt(ANCHOR_ROTATED, { left: 370, top: 900 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR_ROTATED, panelBounds: PANEL });
  // 按 90 宽硬算（旧 snapInset 思路）：x = panel.x - left - 90
  const naiveX = PANEL.x - ANCHOR_ROTATED.left - 90;
  assert.strictEqual(Math.abs(r.x - naiveX), 10,
    '固定常数与真实视觉框推导必然在旋转姿态下相差正好 10px');
});

console.log('\n[3] 间隙与阈值');
ok('视觉间隙超出 snapDistance 时不吸附', () => {
  const floatBounds = floatAt(ANCHOR, { left: 500, top: 900 - 80 - 200 });
  assert.strictEqual(computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL }), null);
});
ok('visualGap 可配置（吸附后预留间隙）', () => {
  const floatBounds = floatAt(ANCHOR, { left: 500, top: 900 - 80 - 10 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL, visualGap: 6 });
  const after = visualOf({ x: r.x, y: r.y, width: WIN, height: WIN }, ANCHOR);
  assert.strictEqual(after.bottom + 6, PANEL.y);
});
ok('自定义 snapDistance 生效', () => {
  const floatBounds = floatAt(ANCHOR, { left: 500, top: 900 - 80 - 40 });
  assert.strictEqual(
    computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL, snapDistance: 30 }), null);
  assert.ok(computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL, snapDistance: 50 }));
});

console.log('\n[4] 方向判定：该方向需与面板有足够重叠');
ok('x 方向无重叠时不吸附到上/下方', () => {
  // 视觉框 x 0..90，与面板 x 400..1400 无重叠；y 上仍接近面板
  const floatBounds = floatAt(ANCHOR, { left: 0, top: 900 - 80 - 10 });
  assert.strictEqual(computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL }), null);
});
ok('y 方向无重叠时不吸附到左/右侧', () => {
  // 视觉框 y 0..80，与面板 y 900..964 无重叠；x 上接近面板左侧
  const floatBounds = floatAt(ANCHOR, { left: PANEL.x - 90 - 10, top: 0 });
  assert.strictEqual(computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL }), null);
});

console.log('\n[5] 多方向候选时取最近');
ok('上方 gap=50 与左侧 gap=20 同时成立时选 left', () => {
  // 视觉框：x 290..380（左侧 gap=20）、y 850..930（上方 gap=-50，且与面板 y 重叠 30）
  const floatBounds = floatAt(ANCHOR, { left: 290, top: 850 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL });
  assert.ok(r, '应触发吸附');
  assert.strictEqual(r.side, 'left');
});
ok('同样位置若把左侧间隙拉大到超阈值，则改选 top', () => {
  // 视觉框 x 340..430（左侧 gap = 400-430 = -30，|30| ≤ 60 → 仍是候选，
  //   故改为 x 330..420：左侧 gap = -20 仍候选… 用真正超阈值的 x：280..370 → gap=30 候选）
  // 结论：只要与面板 x 重叠，左侧 gap 必然是"负得不多"，因此改用「上方更近」来验证取最近：
  //   视觉框 x 400..490（与面板重叠 90）、y 850..930（上方 gap = -50）
  //   左侧 gap = 400-490 = -90（|90| > 60，不参与）→ 只剩 top
  const floatBounds = floatAt(ANCHOR, { left: 400, top: 850 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL });
  assert.ok(r, '应触发吸附');
  assert.strictEqual(r.side, 'top');
});
ok('面板右侧吸附', () => {
  // 视觉框 x 1440..1530（右侧 gap = 1440-1400 = 40 ✓）、y 900..980 与面板重叠
  const floatBounds = floatAt(ANCHOR, { left: 1440, top: 900 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL });
  assert.ok(r);
  assert.strictEqual(r.side, 'right');
  const after = visualOf({ x: r.x, y: r.y, width: WIN, height: WIN }, ANCHOR);
  assert.strictEqual(after.left, PANEL.x + PANEL.width);
});

console.log('\n[6] 健壮性');
ok('缺少参数返回 null', () => {
  assert.strictEqual(computeDockSnap({}), null);
  assert.strictEqual(computeDockSnap({ floatBounds: { x: 0, y: 0, width: WIN, height: WIN }, anchor: ANCHOR }), null);
  assert.strictEqual(computeDockSnap({ floatBounds: { x: 0, y: 0, width: WIN, height: WIN }, panelBounds: PANEL }), null);
});
ok('视觉框尺寸为 0（未上报/未渲染）时返回 null', () => {
  const floatBounds = floatAt(ANCHOR, { left: 500, top: 810 });
  assert.strictEqual(computeDockSnap({
    floatBounds, anchor: { left: 0, top: 0, width: 0, height: 0 }, panelBounds: PANEL
  }), null);
});
ok('返回整数坐标（避免半像素抖动）', () => {
  const floatBounds = floatAt(ANCHOR, { left: 500.4, top: 810.6 });
  const r = computeDockSnap({ floatBounds, anchor: ANCHOR, panelBounds: PANEL });
  assert.ok(Number.isInteger(r.x) && Number.isInteger(r.y));
});

console.log('\n[7] 吸附关系（供 Dock 移动时跟随）');
ok('关系 = 浮窗相对面板左上角的偏移', () => {
  const rel = computeSnapRelation({
    floatBounds: { x: 640, y: 700, width: WIN, height: WIN },
    panelBounds: PANEL,
    side: 'top'
  });
  assert.strictEqual(rel.offsetX, 240);
  assert.strictEqual(rel.offsetY, -200);
  assert.strictEqual(rel.side, 'top');
});
ok('面板移动后按关系重算可保持一致', () => {
  const rel = computeSnapRelation({
    floatBounds: { x: 640, y: 700, width: WIN, height: WIN },
    panelBounds: PANEL,
    side: 'top'
  });
  const movedPanel = { ...PANEL, x: PANEL.x + 50, y: PANEL.y - 30 };
  assert.deepStrictEqual(
    { x: movedPanel.x + rel.offsetX, y: movedPanel.y + rel.offsetY },
    { x: 690, y: 670 }
  );
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
