/* 自检：吸附与 Dock 移动的源码级契约（无需 Electron）
   回归背景（用户反馈）：
   1) 「dock 栏移动不到桌面最上方」—— move-dock 用窗口边界做垂直钳制，
      而窗口为预留菜单/浮层空间（DOCK_RESERVED_HEIGHT）远高于面板，
      导致面板最低只能到 workArea.y + (窗口高 - 面板高)，永远拖不到屏幕上方；
   2) 「吸附位置差一点有空隙」—— report-pet-anchor 过去只调用 resetDockSnap()，
      而它在吸附关系为空时直接 return，于是「锚点缺失时按整个窗口吸附」产生的
      (windowH - petH)/2 ≈ 40px 偏差永远得不到纠正；
   3) 「不跟随移动」—— 同一原因：首次吸附后从未建立跟随关系。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const windowSrc = fs.readFileSync(path.join(root, 'src', 'main', 'ipc', 'window.js'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > start, '函数 ' + name + ' 未正常结束');
  return src.slice(start, end + 5);
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] Dock 可拖到屏幕最上方（按面板边界钳制）');
const moveHandler = (() => {
  const start = windowSrc.indexOf("ipcMain.handle('move-dock'");
  assert.ok(start >= 0, '未找到 move-dock');
  const end = windowSrc.indexOf('});', start);
  return windowSrc.slice(start, end);
})();

ok('计算了 panelHeight（而非直接用窗口高度）', () => {
  assert.ok(/panelHeight/.test(moveHandler), 'move-dock 未使用面板高度');
  assert.ok(/dockPanelOffset/.test(moveHandler), 'move-dock 未读取 dockPanelOffset');
});
ok('垂直下界允许窗口上移出工作区（minY 可为负）', () => {
  assert.ok(/workArea\.y\s*-\s*Math\.max\(0,\s*bounds\.height\s*-\s*panelHeight\)/.test(moveHandler),
    '未按「窗口高 - 面板高」放宽上界，面板无法到达屏幕顶部');
});
ok('不再用窗口高度直接钳制 Y', () => {
  assert.ok(!/newY\s*=\s*Math\.max\(workArea\.y,\s*Math\.min\(newY,\s*workArea\.y \+ workArea\.height - bounds\.height\)\)/.test(moveHandler),
    '仍按窗口边界钳制 Y，Dock 拖不到顶部');
});

console.log('\n[2] 吸附搜索与跟随');
ok('存在 searchDockSnap 且支持 requireExistingRelation', () => {
  assert.ok(/function searchDockSnap\(opts\)/.test(windowSrc), '缺少 searchDockSnap');
  assert.ok(/requireExistingRelation/.test(windowSrc), '缺少 requireExistingRelation 开关');
});
ok('锚点上报后：有则 maintain，无则 search（不再被空关系挡住）', () => {
  const start = windowSrc.indexOf("ipcMain.handle('report-pet-anchor'");
  const end = windowSrc.indexOf('\n  });', start);
  const body = windowSrc.slice(start, end);
  assert.ok(/if\s*\(floatSnapToDock\)/.test(body), '锚点上报后未判断是否已有关系');
  assert.ok(/maintainDockSnap\(\)/.test(body), '锚点上报后未在已有关系时保持');
  assert.ok(/searchDockSnap\(\{/.test(body) && /requireExistingRelation:\s*false/.test(body),
    '锚点上报后未在无关系时发起吸附搜索 —— 偏差将无法纠正且无法建立跟随关系');
  assert.ok(!/resetDockSnap/.test(body), '仍在调用已被移除的 resetDockSnap');
});
ok('maintainDockSnap 沿当前边重算，不重新挑方向', () => {
  const body = extractFunction(windowSrc, 'maintainDockSnap');
  assert.ok(/floatSnapToDock\.side/.test(body), '未使用已有吸附方向');
  assert.ok(!/computeDockSnap\(/.test(body), 'maintain 中重新挑方向，Dock 移动时可能把浮窗吸到另一侧');
  ['top', 'bottom', 'left', 'right'].forEach((side) => {
    assert.ok(body.includes("case '" + side + "'"), '缺少 ' + side + ' 分支');
  });
});
ok('maintain 有静止容差，避免 1px 级反复微调', () => {
  assert.ok(/SNAP_SETTLE_TOLERANCE/.test(windowSrc), '缺少静止容差');
  assert.ok(/SNAP_SETTLE_TOLERANCE/.test(extractFunction(windowSrc, 'maintainDockSnap')),
    'maintain 未使用静止容差');
});
ok('Dock 移动与窗口缩放后调用 maintainDockSnap', () => {
  assert.ok(/win\.setPosition\(newX, newY\);\s*[\s\S]{0,400}maintainDockSnap\(\)/.test(moveHandler),
    'move-dock 未触发浮窗跟随');
  assert.ok(!/resetDockSnap/.test(windowSrc), '仍残留 resetDockSnap 调用');
});

console.log('\n[3] 锚点缺失时不做错误吸附');
ok('petVisualAnchor 为空时 searchDockSnap 直接返回', () => {
  const body = extractFunction(windowSrc, 'searchDockSnap');
  assert.ok(/if\s*\(!petVisualAnchor\)\s*return false/.test(body),
    '锚点缺失仍会吸附 —— 会按整个窗口吸附产生约 40px 偏差');
  assert.ok(!/petVisualAnchor \|\|/.test(body),
    '仍存在「锚点缺失时回退为窗口边界」的旧写法');
});

console.log('\n[4] 可诊断性');
ok('提供 DSH_DEBUG_SNAP 调试日志开关', () => {
  assert.ok(/DSH_DEBUG_SNAP/.test(windowSrc), '缺少吸附调试日志开关');
  assert.ok(/function debugSnap\(/.test(windowSrc), '缺少 debugSnap');
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
