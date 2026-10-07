/* 自检：Dock 菜单/浮层扩展路径的几何契约
   回归背景（用户反馈「dock 栏右键后闪动」）：
   1) expandForMenu 曾用「面板宽度」直接 resizeDockWindow(panelW, 380)，
      而 autoFitDockWindow 用的是 panelW + 4（winBuffer），导致窗口宽在 704↔700
      之间来回跳、面板水平抖动 2px；
   2) 每次右键/关菜单都 resize 透明窗口，合成层重绘表现为可见闪动；
   3) 固定 setTimeout(100) 的猜测等待会让菜单/浮层定位用到中间态矩形。

   现方案：窗口高度在 autoFitDockWindow 时一次性预留（DOCK_RESERVED_HEIGHT），
   菜单与浮层弹出时**不做任何窗口操作**，只有内容超出预留高度才扩展一次且不回缩。

   本测试以源码级断言锁住契约（无需 Electron）：
   1. 菜单/浮层路径只能走 expandDockWindow，不得调用 resizeDockWindow
   2. 窗口高度必须一次性预留
   3. 还原必须受 dockWindowOverflowed 保护（常态不发生 resize）
   4. 不得再出现固定时长的猜测等待
   5. 扩展/还原后必须重新上报 dock-panel 几何（否则浮窗吸附用到旧数据）
   6. showPopup 必须按浮层实测高度确认空间（避免长列表被裁剪）
   7. 主进程 resize-dock-window 支持 preserveSavedBounds 以免覆盖 savedDockBounds */

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
const autoFitBody = extractFunction(dockSrc, 'autoFitDockWindow');
const syncBody = extractFunction(dockSrc, 'syncPopupWindowHeight');

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 菜单/浮层路径不得改变窗口尺寸（常态）');
ok('expandForMenu 保留 expandDockWindow 兜底', () => {
  assert.ok(expandBody.includes('expandDockWindow'), '缺少 expandDockWindow 兜底');
});
ok('expandForMenu 不调用 resizeDockWindow', () => {
  assert.ok(!expandBody.includes('resizeDockWindow'),
    'expandForMenu 又出现 resizeDockWindow —— 会重新引入窗口尺寸抖动');
});
ok('expandForMenu 在高度足够时直接返回（no-op）', () => {
  assert.ok(/currentHeight\s*>=\s*targetHeight/.test(expandBody) && /return/.test(expandBody),
    '缺少「预留高度已足够则直接返回」的判断');
});
ok('不再读取面板宽度用于 resize', () => {
  assert.ok(!/getBoundingClientRect\(\)\.width/.test(expandBody),
    'expandForMenu 读取面板宽度作为窗口宽度，二者语义不同（autoFit 会 +4 winBuffer）');
});

console.log('\n[2] 窗口高度必须一次性预留');
ok('定义了 DOCK_RESERVED_HEIGHT 常量', () => {
  assert.ok(/const\s+DOCK_RESERVED_HEIGHT\s*=\s*\d+/.test(dockSrc), '缺少 DOCK_RESERVED_HEIGHT');
});
ok('autoFitDockWindow 取 max(baseHeight, DOCK_RESERVED_HEIGHT)', () => {
  assert.ok(/Math\.max\(\s*baseHeight\s*,\s*DOCK_RESERVED_HEIGHT\s*\)/.test(autoFitBody),
    'autoFitDockWindow 未预留菜单/浮层高度，菜单弹出将不得不 resize 窗口');
});

console.log('\n[3] 还原必须受溢出标记保护');
ok('定义了 dockWindowOverflowed 标记', () => {
  assert.ok(/let\s+dockWindowOverflowed\s*=/.test(dockSrc), '缺少 dockWindowOverflowed');
});
ok('restoreAfterMenu 未溢出时直接返回（常态不 resize）', () => {
  assert.ok(/if\s*\(!dockWindowOverflowed\)\s*return/.test(restoreBody),
    'restoreAfterMenu 未受保护，关菜单时会无谓 resize 造成闪动');
});
ok('restoreAfterMenu 使用 restoreDockWindow 精确还原', () => {
  assert.ok(restoreBody.includes('restoreDockWindow') && !restoreBody.includes('resizeDockWindow'),
    '还原应走 restoreDockWindow，而不是重算 resize');
});

console.log('\n[4] 不得使用固定时长猜测等待');
ok('positionMenuAtMouse 无固定 setTimeout 猜测', () => {
  assert.ok(!/setTimeout\(\s*r\s*=>\s*setTimeout/.test(positionBody) &&
    !/setTimeout\([^)]*,\s*100\s*\)/.test(positionBody),
    '仍存在固定时长等待，慢机器上等不够会导致菜单错位');
});
ok('showPopup 先确保空间再定位（顺序正确）', () => {
  const expandIdx = popupBody.indexOf('expandForMenu');
  const positionIdx = popupBody.indexOf('positionPopup');
  assert.ok(expandIdx >= 0 && positionIdx >= 0, 'showPopup 缺少扩展或定位调用');
  assert.ok(expandIdx < positionIdx, '定位发生在窗口扩展之前，浮层会先出现在错误位置');
});
ok('showPopup 按浮层实测高度确认空间（防裁剪）', () => {
  assert.ok(popupBody.includes('syncPopupWindowHeight'),
    'showPopup 未按浮层实际高度确认窗口空间，长列表会被裁剪');
});
ok('syncPopupWindowHeight 使用 offsetHeight 实测', () => {
  assert.ok(/offsetHeight/.test(syncBody), '未按实际渲染高度计算所需窗口高度');
});

console.log('\n[5] 几何变化后必须重新上报 dock-panel 偏移');
ok('expandForMenu 溢出扩展时调用 reportPanelOffset', () => {
  assert.ok(expandBody.includes('reportPanelOffset'), '扩展后未上报几何，浮窗吸附会用到旧数据');
});
ok('restoreAfterMenu 还原后调用 reportPanelOffset', () => {
  assert.ok(restoreBody.includes('reportPanelOffset'), '还原后未上报几何');
});

console.log('\n[6] 主进程保护 savedDockBounds');
ok('resize-dock-window 支持 preserveSavedBounds 参数', () => {
  assert.ok(/resize-dock-window',\s*\(event,\s*width,\s*height,\s*preserveSavedBounds\)/.test(windowSrc),
    '缺少 preserveSavedBounds 形参');
});
ok('preserveSavedBounds 为真时不覆盖 savedDockBounds', () => {
  assert.ok(/if\s*\(!preserveSavedBounds\)\s*\{[\s\S]{0,160}savedDockBounds\s*=/.test(windowSrc),
    'savedDockBounds 仍会被无条件覆盖，扩展期间的 resize 会破坏还原基准');
});

console.log('\n[7] 预留高度不得形成「隐形点击死区」');
const dockCss = fs.readFileSync(path.join(root, 'renderer', 'styles', 'dock.css'), 'utf8');

/** 取出某个选择器块的内容（到配对的第一个 `}`） */
function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = dockCss.match(new RegExp('(^|\\n)' + escaped + '\\s*\\{([\\s\\S]*?)\\}'));
  assert.ok(m, '未找到 CSS 规则 ' + selector);
  return m[2];
}

ok('.dock-container 设为 pointer-events: none（透明预留区不拦截鼠标）', () => {
  assert.ok(/pointer-events:\s*none/.test(cssBlock('.dock-container')),
    '容器未禁用指针事件，预留的 420px 透明区会挡住桌面点击');
});
ok('.dock-panel 恢复 pointer-events: auto', () => {
  assert.ok(/pointer-events:\s*auto/.test(cssBlock('.dock-panel')),
    '面板未恢复交互，Dock 将完全无法点击');
});
ok('.dock-popup.show 恢复 pointer-events: auto', () => {
  assert.ok(/pointer-events:\s*auto/.test(cssBlock('.dock-popup.show')),
    '浮层未恢复交互，音量/网络浮层点不动');
});
ok('.dock-context-menu 恢复 pointer-events: auto（菜单挂在 body 下）', () => {
  assert.ok(/pointer-events:\s*auto/.test(cssBlock('.dock-context-menu')),
    '右键菜单未恢复交互，菜单项点不动');
});

console.log('\n[8] 网络状态文案不得直接暴露系统原始串');
ok('有线名称固定为「有线连接」（不显示适配器名）', () => {
  const body = extractFunction(dockSrc, 'renderNetworkStatus');
  assert.ok(/textContent\s*=\s*'有线连接'/.test(body),
    '有线名称未固定为「有线连接」，适配器名在部分系统语言/编码下会乱码');
  assert.ok(!/status\.wired\.name/.test(body),
    '仍在直接使用 status.wired.name（来自 ipconfig，可能乱码/过长）');
});
ok('无线断开文案不再直接使用 netsh 的 state 串', () => {
  const body = extractFunction(dockSrc, 'renderWifiStatus');
  // 只校验赋值语句，避免误匹配被一并截取进来的 SVG 常量里的 viewBox
  assert.ok(!/textContent\s*=\s*[^;]*\bstatus\.state\b/.test(body),
    '仍在把 status.state（netsh 原始输出，可能是英文/不稳定）直接显示给用户');
});
ok('dock.html 默认文案与渲染文案一致', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'dock.html'), 'utf8');
  assert.ok(/id="wiredStatusName">有线连接</.test(html),
    'dock.html 中 wiredStatusName 的默认文案与「有线连接」不一致');
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
