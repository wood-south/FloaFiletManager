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
  // 决策统一交给 snap.js 的 decide()（mode: 'maintain' 只沿已有 side 重算）；
  // 关键是不能在 maintain 路径里调用 computeDockSnap（那会重新挑方向）
  assert.ok(/mode:\s*'maintain'/.test(body), '未以 maintain 模式调用 decide');
  assert.ok(!/computeDockSnap\(/.test(body), 'maintain 中重新挑方向，Dock 移动时可能把浮窗吸到另一侧');
});
ok('maintain 有静止容差，避免 1px 级反复微调', () => {
  assert.ok(/SNAP_SETTLE_TOLERANCE/.test(windowSrc), '缺少静止容差');
  assert.ok(/SNAP_SETTLE_TOLERANCE/.test(extractFunction(windowSrc, 'maintainDockSnap')),
    'maintain 未使用静止容差');
});
ok('非吸附轴按关系偏移跟随面板（修复「不跟随移动」）', () => {
  const snapSrc = fs.readFileSync(path.join(root, 'src', 'main', 'snap.js'), 'utf8');
  const start = snapSrc.indexOf('function positionForSide(');
  const end = snapSrc.indexOf('\n}\n', start);
  const body = snapSrc.slice(start, end);
  assert.ok(/relation\.offsetX/.test(body) && /relation\.offsetY/.test(body),
    'positionForSide 未用关系偏移更新非吸附轴，Dock 横向移动时贴在上/下方的桌宠不会跟随');
});
ok('move-dock 触发浮窗跟随，且不再残留 resetDockSnap', () => {
  assert.ok(/win\.setPosition\(newX, newY\)[\s\S]{0,400}maintainDockSnap\(\)/.test(moveHandler),
    'move-dock 未触发浮窗跟随');
  assert.ok(!/resetDockSnap/.test(windowSrc), '仍残留 resetDockSnap 调用');
});
ok('search 与 maintain 统一走 decide()，避免公式分叉', () => {
  assert.ok(/decide\(/.test(extractFunction(windowSrc, 'searchDockSnap')),
    'searchDockSnap 未走 decide()');
  assert.ok(/decide\(/.test(extractFunction(windowSrc, 'maintainDockSnap')),
    'maintainDockSnap 未走 decide()');
});
ok('search 未命中时不移动窗口（先判定后移动）', () => {
  const body = extractFunction(windowSrc, 'searchDockSnap');
  // setPosition 必须出现在 action === 'snap' 判断之后
  const guardIdx = body.indexOf("decision.action === 'snap'");
  const setPosIdx = body.indexOf('setPosition');
  assert.ok(guardIdx >= 0, '缺少 action 判断');
  assert.ok(setPosIdx > guardIdx, 'setPosition 出现在判定之前，搜索失败时窗口会被移动');
});

console.log('\n[3] 锚点缺失时不做错误吸附');
ok('petVisualAnchor 为空时 searchDockSnap 直接返回', () => {
  const body = extractFunction(windowSrc, 'searchDockSnap');
  assert.ok(/if\s*\(!petVisualAnchor\)\s*return false/.test(body),
    '锚点缺失仍会吸附 —— 会按整个窗口吸附产生约 40px 偏差');
  assert.ok(!/petVisualAnchor \|\|/.test(body),
    '仍存在「锚点缺失时回退为窗口边界」的旧写法');
});

console.log('\n[4] 可诊断性与视觉框测量');
ok('提供 DSH_DEBUG_SNAP 调试日志开关', () => {
  assert.ok(/DSH_DEBUG_SNAP/.test(windowSrc), '缺少吸附调试日志开关');
  assert.ok(/function debugSnap\(/.test(windowSrc), '缺少 debugSnap');
});
ok('视觉框用 SVG getBBox + getScreenCTM 测量真实画面（而非容器 90×90）', () => {
  const floatSrc = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  const start = floatSrc.indexOf('function readPetAnchor(');
  const unionStart = floatSrc.indexOf('function readVisibleUnion(');
  const unionEnd = floatSrc.indexOf('\n}\n', unionStart);
  const body = floatSrc.slice(start, unionEnd);
  assert.ok(/getBBox\(\)/.test(body), '未使用 getBBox 测量真实绘制内容');
  assert.ok(/getScreenCTM\(\)/.test(body), '未做用户单位 → 客户端坐标转换');
  assert.ok(/\.pet-svg/.test(floatSrc), '未定位到 .pet-svg');
  // 必须仍保留回退，避免 getBBox 抛错时完全没有锚点
  assert.ok(/getBoundingClientRect\(\)/.test(floatSrc), '缺少回退路径');
});
ok('锚点直接量猫本体：遍历可见子元素取并集并跳过阴影', () => {
  const floatSrc = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  const start = floatSrc.indexOf('function readVisibleUnion(');
  const end = floatSrc.indexOf('\n}\n', start);
  const body = floatSrc.slice(start, end);
  assert.ok(/petSvg\.children/.test(body), '未遍历 SVG 可见子元素');
  assert.ok(/pet-shadow/.test(floatSrc), '未定义阴影选择器');
  assert.ok(/SHADOW_SELECTOR/.test(body), '遍历时未跳过地面阴影元素');
  assert.ok(/left/.test(body) && /right/.test(body) && /top/.test(body) && /bottom/.test(body),
    '并集未覆盖四条边');
  // 不应再依赖「整体包围盒 + 阴影补偿」的近似
  const anchor = floatSrc.slice(floatSrc.indexOf('function readPetAnchor('), start);
  assert.ok(!/readShadowClientBox|sideSlack/.test(anchor),
    '仍在使用整体包围盒 + 阴影扣除的近似（会导致四边偏差不一致）');
});

console.log('\n[5] 拖动窗口移动合并到每帧一次（修复拖动闪动）');
[['float.js', 'moveWindow'], ['dock.js', 'moveDock']].forEach(([file, api]) => {
  ok(file + ' 的拖动逻辑使用 requestAnimationFrame 合并', () => {
    const src = fs.readFileSync(path.join(root, 'renderer', 'scripts', file), 'utf8');
    assert.ok(/requestAnimationFrame/.test(src), file + ' 未使用 rAF');
    // 直接调用点应受 rAF 保护：出现 rafPending/raf 标记
    assert.ok(/rafPending|dragRafPending/.test(src),
      file + ' 缺少「本帧已排程」标记，可能一帧内多次移动窗口');
    assert.ok(new RegExp(api).test(src), '未找到 ' + api);
  });
});

console.log('\n[6] 拖动抑制（修复「吸附后拖不动、会弹回」）');
ok('存在 set-pet-dragging 通道与 petDragging 标记', () => {
  assert.ok(/set-pet-dragging/.test(windowSrc), '缺少 set-pet-dragging 通道');
  assert.ok(/let petDragging/.test(windowSrc), '缺少 petDragging 标记');
});
ok('搜索与保持路径都受拖动抑制', () => {
  assert.ok(/if \(petDragging\) return false/.test(extractFunction(windowSrc, 'searchDockSnap')),
    'searchDockSnap 未抑制');
  assert.ok(/if \(petDragging\) return false/.test(extractFunction(windowSrc, 'maintainDockSnap')),
    'maintainDockSnap 未抑制 —— 拖动期间会被逐帧拉回吸附位置');
});
ok('松手路径先清除抑制再搜索', () => {
  const start = windowSrc.indexOf("ipcMain.handle('save-window-position'");
  const end = windowSrc.indexOf('\n  });', start);
  const body = windowSrc.slice(start, end);
  const clearIdx = body.indexOf('petDragging = false');
  const searchIdx = body.indexOf('searchDockSnap');
  assert.ok(clearIdx >= 0, 'save-window-position 未清除拖动抑制');
  assert.ok(searchIdx > clearIdx, '先搜索后清除抑制，搜索会被自己挡掉');
});
ok('吸附触发距离已收紧（脱离比贴上更容易）', () => {
  const m = windowSrc.match(/const SNAP_DISTANCE = (\d+)/);
  assert.ok(m, '未找到 SNAP_DISTANCE');
  const value = Number(m[1]);
  assert.ok(value <= 30, 'SNAP_DISTANCE = ' + value + ' 偏大，松手时容易被重新吸回');
});
ok('浮窗在 mousedown/mouseup 通知拖动状态', () => {
  const floatSrc = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  assert.ok(/setPetDragging\(true\)/.test(floatSrc), '未在开始拖动时通知主进程');
  assert.ok(/setPetDragging\(false\)/.test(floatSrc), '未在结束拖动时通知主进程');
  assert.ok(/addEventListener\('blur'/.test(floatSrc), '缺少失焦兜底，拖动抑制可能永久生效');
});

console.log('\n[7] 脱离吸附时必须复位宠物朝向（修复姿态卡住）');
ok('浮窗提供 clearDockOrientation 并在开始拖动时调用', () => {
  const floatSrc = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  assert.ok(/function clearDockOrientation\(/.test(floatSrc), '缺少 clearDockOrientation');
  const dragStart = floatSrc.indexOf("petBody.addEventListener('mousedown'");
  const dragEnd = floatSrc.indexOf('});', dragStart);
  const body = floatSrc.slice(dragStart, dragEnd);
  assert.ok(/clearDockOrientation\(\)/.test(body),
    '开始拖动时未清除 Dock 朝向 —— 宠物会以侧躺/倒立姿态被拖走');
});
ok('onDockSnapChanged 先清除再设置朝向', () => {
  const floatSrc = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  const start = floatSrc.indexOf('onDockSnapChanged');
  const end = floatSrc.indexOf('});', start);
  const body = floatSrc.slice(start, end);
  assert.ok(/clearDockOrientation\(\)/.test(body), '未先清除旧朝向');
  assert.ok(/if \(side\)/.test(body), '未处理 side 为空（脱离吸附）的情况');
});
ok('脱离吸附时主进程主动下发 null 朝向', () => {
  const start = windowSrc.indexOf("ipcMain.handle('save-window-position'");
  const end = windowSrc.indexOf('\n  });', start);
  const body = windowSrc.slice(start, end);
  assert.ok(/hadRelation/.test(body) && /dock-snap-changed', null/.test(body),
    '松手脱离吸附时未下发 null，朝向会残留');
});

console.log('\n[8] Dock 朝向旋转值');
ok('dock-top / dock-bottom 旋转对应关系正确（由截图核对确定）', () => {
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles', 'float.css'), 'utf8');
  const topDeg = (css.match(/\.pet-body\.dock-top\s+\.pet-avatar\s*\{\s*transform:\s*rotate\((-?\d+)deg\)/) || [])[1];
  const bottomDeg = (css.match(/\.pet-body\.dock-bottom\s+\.pet-avatar\s*\{\s*transform:\s*rotate\((-?\d+)deg\)/) || [])[1];
  assert.ok(topDeg !== undefined, '未找到 .dock-top 旋转规则');
  assert.ok(bottomDeg !== undefined, '未找到 .dock-bottom 旋转规则');
  // dock-* 命名指「面板相对宠物的位置」：
  //   .dock-top    → 面板在宠物下方 → 正立 0°
  //   .dock-bottom → 面板在宠物上方 → 倒立 180°
  assert.strictEqual(Number(topDeg), 0, '.dock-top 应为 0deg');
  assert.strictEqual(Number(bottomDeg), 180, '.dock-bottom 应为 180deg');
});
ok('左右旋转方向保持 ±90 且互为反向', () => {
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles', 'float.css'), 'utf8');
  const leftDeg = Number((css.match(/\.pet-body\.dock-left\s+\.pet-avatar\s*\{\s*transform:\s*rotate\((-?\d+)deg\)/) || [])[1]);
  const rightDeg = Number((css.match(/\.pet-body\.dock-right\s+\.pet-avatar\s*\{\s*transform:\s*rotate\((-?\d+)deg\)/) || [])[1]);
  assert.strictEqual(leftDeg, -90);
  assert.strictEqual(rightDeg, 90);
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
