/* 自检：Dock 右键菜单扩展路径的几何契约
   回归背景：expandForMenu 曾用「面板宽度」直接 resizeDockWindow(panelW, 380)，
   而 autoFitDockWindow 用的是 panelW + 4（winBuffer），导致窗口宽在 704↔700
   之间来回跳、面板水平抖动 2px（用户反馈的「Dock 闪动」），
   并且固定 setTimeout(100) 的猜测等待会让菜单/浮层定位用到中间态矩形。

   本测试以源码级断言锁住契约（纯函数式校验，无需 Electron）：
   1. 菜单扩展只能走 expandDockWindow（保持宽度、底边固定），不得调用 resizeDockWindow
   2. 菜单还原只能走 restoreDockWindow（精确回到扩展前边界）
   3. 不得再出现固定时长的猜测等待
   4. 扩展/还原后必须重新上报 dock-panel 几何（否则浮窗吸附用到旧数据）
   5. 主进程 resize-dock-window 支持 preserveSavedBounds 以免覆盖 savedDockBounds */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const dockSrc = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'dock.js'), 'utf8');
const windowSrc = fs.readFileSync(path.join(root, 'src', 'main', 'ipc', 'window.js'), 'utf8');

/** 截取具名函数体（从 `function name(` 到下一个顶层 `}` 换行） */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, '函数 ' + name + ' 未正常结束');
  return src.slice(start, end + 3);
}

const expandBody = extractFunction(dockSrc, 'expandForMenu');
const restoreBody = extractFunction(dockSrc, 'restoreAfterMenu');
const positionBody = extractFunction(dockSrc, 'positionMenuAtMouse');
const popupBody = extractFunction(dockSrc, 'showPopup');

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] expandForMenu 不得改变窗口宽度');
ok('使用 expandDockWindow（底边固定、宽度不变）', () => {
  assert.ok(expandBody.includes('expandDockWindow'), '未使用 expandDockWindow');
});
ok('不再调用 resizeDockWindow', () => {
  assert.ok(!expandBody.includes('resizeDockWindow'),
    'expandForMenu 又出现了 resizeDockWindow —— 会重新引入宽度抖动');
});
ok('不再读取面板宽度用于 resize', () => {
  assert.ok(!/getBoundingClientRect\(\)\.width/.test(expandBody),
    'expandForMenu 读取面板宽度作为窗口宽度，二者语义不同（autoFit 会 +4 winBuffer）');
});

console.log('\n[2] restoreAfterMenu 必须精确还原');
ok('使用 restoreDockWindow', () => {
  assert.ok(restoreBody.includes('restoreDockWindow'), '未使用 restoreDockWindow');
});
ok('不再用 resizeDockWindow 重算', () => {
  assert.ok(!restoreBody.includes('resizeDockWindow'),
    '还原走重算会与 autoFit 的取整产生偏差，出现二次抖动');
});

console.log('\n[3] 不得使用固定时长猜测等待');
ok('positionMenuAtMouse 无 setTimeout 猜测', () => {
  assert.ok(!/setTimeout\(\s*r\s*=>\s*setTimeout/.test(positionBody) &&
    !/setTimeout\([^)]*,\s*100\s*\)/.test(positionBody),
    '仍存在固定时长等待，慢机器上等不够会导致菜单错位');
});
ok('showPopup 不再先定位后扩展（顺序反转）', () => {
  const expandIdx = popupBody.indexOf('expandForMenu');
  const positionIdx = popupBody.indexOf('positionPopup');
  assert.ok(expandIdx >= 0 && positionIdx >= 0, 'showPopup 缺少扩展或定位调用');
  assert.ok(expandIdx < positionIdx, '定位发生在窗口扩展之前，浮层会先出现在错误位置');
});

console.log('\n[4] 几何变化后必须重新上报 dock-panel 偏移');
ok('expandForMenu 中调用了 reportPanelOffset', () => {
  assert.ok(expandBody.includes('reportPanelOffset'), '扩展后未上报几何，浮窗吸附会用到旧数据');
});
ok('restoreAfterMenu 中调用了 reportPanelOffset', () => {
  assert.ok(restoreBody.includes('reportPanelOffset'), '还原后未上报几何');
});

console.log('\n[5] 主进程保护 savedDockBounds');
ok('resize-dock-window 支持 preserveSavedBounds 参数', () => {
  assert.ok(/resize-dock-window',\s*\(event,\s*width,\s*height,\s*preserveSavedBounds\)/.test(windowSrc),
    '缺少 preserveSavedBounds 形参');
});
ok('preserveSavedBounds 为真时不覆盖 savedDockBounds', () => {
  assert.ok(/if\s*\(!preserveSavedBounds\)\s*\{[\s\S]{0,160}savedDockBounds\s*=/.test(windowSrc),
    'savedDockBounds 仍会被无条件覆盖，菜单扩展期间的 resize 会破坏还原基准');
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
