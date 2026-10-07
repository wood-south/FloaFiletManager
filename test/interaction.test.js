/* 自检：桌宠交互手势 renderer/pet/interaction.js
   用真实源码 + 可注入的定时器/RAF 验证拖动与单击/双击判别。

   重点守住：
   - 3px 阈值：没有它单击会被判成拖动，双击打开文件管理就失效
   - 单击延迟 250ms 内出现第二次点击 => 双击；单击不得同时触发
   - 每帧只提交一次窗口位移（同一帧多次 setPosition 会让透明窗口闪动）
   - 拖动状态变化通过回调通知（壳层据此仲裁穿透），不再让外部随意改布尔量
   - 窗口失焦兜底 abortDrag：鼠标在窗口外松开时不会派发 mouseup */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'pet', 'interaction.js'), 'utf8'
);
const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('window', 'globalThis', src)(sandbox, sandbox);
const createInteraction = sandbox.createInteraction;
assert.ok(typeof createInteraction === 'function', 'interaction.js 未导出 createInteraction');

/** 收集回调 + 可控定时器/RAF
    注意 scheduleClick 必须返回「句柄」而不是执行回调：
    模块内部是 `clickTimer = scheduleClick(cb, ms)`，
    若桩把回调存起来不执行，clickTimer 就会变成 undefined，
    单击/双击判定全部失真（这是测试桩的坑，不是模块的问题）。
    scheduleMode='immediate' 时同步执行回调（等价于真实异步），
    'defer' 时存入队列由测试手动触发。 */
function makeHarness(scheduleMode) {
  const h = {
    moves: [],
    saved: 0,
    snapRelease: 0,
    snapRestore: 0,
    clearOrientation: 0,
    clicks: 0,
    doubleClicks: 0,
    dragStates: [],
    cursors: [],
    timers: [],
    cancelled: [],
    rafs: [],
    scheduleMode: scheduleMode || 'immediate',
    nextHandle: 1
  };
  h.interaction = createInteraction({
    setCursor: (c) => h.cursors.push(c),
    moveWindow: (dx, dy) => h.moves.push({ dx, dy }),
    onSavePosition: () => { h.saved++; },
    onSnapRelease: () => { h.snapRelease++; },
    onSnapRestore: () => { h.snapRestore++; },
    onClearOrientation: () => { h.clearOrientation++; },
    // 用箭头包装，避免在 h.interaction 赋值完成前读取该绑定（TDZ）
    onClick: () => { h.clicks++; },
    onDoubleClick: () => { h.doubleClicks++; },
    onDragStateChange: (d) => h.dragStates.push(d),
    scheduleClick: (fn, ms) => {
      const handle = h.nextHandle++;
      if (h.scheduleMode === 'defer') {
        h.timers.push({ handle, fn, ms });
      } else {
        fn();
      }
      return handle;
    },
    cancelClick: (handle) => { h.cancelled.push(handle); },
    raf: (fn) => { h.rafs.push(fn); return h.rafs.length - 1; }
  });
  /** 触发最近一次 RAF（模拟一帧） */
  h.flushFrame = () => {
    const fn = h.rafs.shift();
    if (fn) fn();
    return !!fn;
  };
  /** 触发最近一个挂起的定时器 */
  h.fireClickTimer = () => {
    const t = h.timers.pop();
    if (t) t.fn();
    return !!t;
  };
  return h;
}

const down = (x, y) => ({ button: 0, screenX: x, screenY: y });
const move = (x, y) => ({ screenX: x, screenY: y });
const up = (x, y) => ({ button: 0, screenX: x, screenY: y });

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 拖动阈值');
{
  const h = makeHarness();
  h.interaction.onPointerDown(down(100, 100));
  ok('按下即进入拖动状态并通知壳层', () => {
    assert.strictEqual(h.interaction.isDragging(), true);
    assert.deepStrictEqual(h.dragStates, [true]);
  });
  ok('按下时锁定光标为 grabbing', () => assert.strictEqual(h.cursors[h.cursors.length - 1], 'grabbing'));
  ok('按下时清除 Dock 朝向并抑制自动吸附', () => {
    assert.strictEqual(h.clearOrientation, 1);
    assert.strictEqual(h.snapRelease, 1);
  });
  h.interaction.onPointerMove(move(102, 101));
  ok('位移 2px 不算拖动（否则单击会被判成拖动）', () => {
    assert.strictEqual(h.interaction.hasMoved(), false);
  });
  h.interaction.onPointerMove(move(104, 101));
  ok('累计超过 3px 才算拖动', () => assert.strictEqual(h.interaction.hasMoved(), true));
}

console.log('\n[2] 每帧只提交一次位移');
{
  const h = makeHarness();
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerMove(move(105, 105));
  h.interaction.onPointerMove(move(110, 110));
  h.interaction.onPointerMove(move(115, 115));
  ok('三次 mousemove 只排队一个 RAF', () => assert.strictEqual(h.rafs.length, 1));
  ok('提交前没有发生窗口移动', () => assert.strictEqual(h.moves.length, 0));
  h.flushFrame();
  ok('一帧内合并为一次位移，且是累计值', () => {
    assert.strictEqual(h.moves.length, 1);
    assert.deepStrictEqual(h.moves[0], { dx: 15, dy: 15 });
  });
  ok('提交后计数清零，再次移动从零累计', () => {
    h.interaction.onPointerMove(move(120, 120));
    h.flushFrame();
    assert.deepStrictEqual(h.moves[1], { dx: 5, dy: 5 });
  });
  ok('拖动中不会重复排队 RAF', () => {
    h.interaction.onPointerMove(move(121, 121));
    h.interaction.onPointerMove(move(122, 122));
    assert.strictEqual(h.rafs.length, 1, '应只有一个待执行帧');
  });
}

console.log('\n[3] 松手：拖动结束');
{
  const h = makeHarness();
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerMove(move(120, 120));
  h.interaction.onPointerMove(move(130, 130));
  h.interaction.onPointerUp(up(130, 130));
  h.flushFrame(); // 提交挂起的那一帧
  ok('松手结束拖动状态并通知壳层（壳层据此恢复穿透仲裁）', () => {
    assert.deepStrictEqual(h.dragStates, [true, false]);
    assert.strictEqual(h.interaction.isDragging(), false);
  });
  ok('松手先 flush 最后一帧位移，避免「少走一截」', () => {
    // 累计位移 = 20 + 10（末帧直接提交），松手时第一帧的 20 也已被 flush
    const total = h.moves.reduce((s, m) => s + m.dx, 0);
    assert.strictEqual(total, 30, '实际提交的位移总量应为 30，实得 ' + total);
  });
  ok('拖动结束保存位置', () => assert.strictEqual(h.saved, 1));
  ok('拖动结束不触发单击/双击', () => {
    assert.strictEqual(h.clicks, 0);
    assert.strictEqual(h.doubleClicks, 0);
  });
}

console.log('\n[4] 单击：延迟 250ms 判定');
{
  const h = makeHarness('defer');
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerUp(up(100, 100));
  ok('未移动的点击不保存位置，而是恢复吸附抑制', () => {
    assert.strictEqual(h.saved, 0);
    assert.strictEqual(h.snapRestore, 1);
  });
  ok('点击后挂起定时器而非立刻触发', () => {
    assert.strictEqual(h.clicks, 0);
    assert.strictEqual(h.timers.length, 1);
    assert.strictEqual(h.timers[0].ms, 250);
  });
  ok('定时器到期才触发单击', () => {
    h.fireClickTimer();
    assert.strictEqual(h.clicks, 1);
  });
}

console.log('\n[5] 双击：取消单击判定');
{
  const h = makeHarness('defer');
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerUp(up(100, 100));
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerUp(up(100, 100));
  ok('第二次点击取消挂起的单击定时器', () => {
    assert.ok(h.cancelled.length >= 1, '应调用 cancelClick');
  });
  ok('双击判定被推迟一拍（不依赖同 tick 时序）', () => {
    assert.strictEqual(h.doubleClicks, 0, '不应同步触发');
    h.fireClickTimer(); // 触发那个 0ms 的双击回调
    assert.strictEqual(h.doubleClicks, 1);
  });
  ok('双击不触发单击', () => assert.strictEqual(h.clicks, 0));
}

console.log('\n[6] 松手阈值边界：刚好 3px 不算拖动');
{
  const h = makeHarness('defer');
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerMove(move(103, 100)); // dx=3，不大于阈值
  h.interaction.onPointerUp(up(103, 100));
  ok('dx=3 视为点击（阈值是「大于 3」）', () => {
    assert.strictEqual(h.interaction.hasMoved(), false);
    assert.strictEqual(h.timers.length, 1, '应挂起单击定时器而不是走拖动分支');
  });
  ok('点击挂起的定时器时长是 250ms', () => assert.strictEqual(h.timers[0].ms, 250));
}

console.log('\n[7] 失焦兜底 abortDrag');
{
  const h = makeHarness();
  h.interaction.onPointerDown(down(100, 100));
  h.interaction.onPointerMove(move(120, 120));
  ok('abortDrag 解除拖动并通知壳层', () => {
    assert.strictEqual(h.interaction.abortDrag(), true);
    assert.strictEqual(h.interaction.isDragging(), false);
    assert.deepStrictEqual(h.dragStates, [true, false]);
  });
  ok('abortDrag 也恢复吸附抑制（否则吸附被永久禁用）', () => {
    assert.strictEqual(h.snapRestore, 1);
  });
  ok('未在拖动时 abortDrag 无副作用', () => {
    assert.strictEqual(h.interaction.abortDrag(), false);
    assert.strictEqual(h.dragStates.length, 2);
  });
}

console.log('\n[8] 光标判定（不依赖 CSS :hover）');
{
  const h = makeHarness();
  const rect = { left: 10, top: 10, right: 90, bottom: 90 };
  ok('落在宠物视觉框内 → grab', () => {
    h.interaction.updateCursor({ clientX: 50, clientY: 50, onButton: false }, rect, true);
    assert.strictEqual(h.cursors[h.cursors.length - 1], 'grab');
  });
  ok('框外 → default', () => {
    h.interaction.updateCursor({ clientX: 5, clientY: 5, onButton: false }, rect, true);
    assert.strictEqual(h.cursors[h.cursors.length - 1], 'default');
  });
  ok('在按钮上 → pointer', () => {
    h.interaction.updateCursor({ clientX: 5, clientY: 5, onButton: true }, rect, true);
    assert.strictEqual(h.cursors[h.cursors.length - 1], 'pointer');
  });
  ok('拖动中恒定 grabbing', () => {
    h.interaction.onPointerDown(down(100, 100));
    h.interaction.updateCursor({ clientX: 5, clientY: 5, onButton: true }, rect, true);
    assert.strictEqual(h.cursors[h.cursors.length - 1], 'grabbing');
    h.interaction.onPointerUp(up(100, 100));
  });
  ok('鼠标已离开容器 → default（即使坐标恰好落在框内）', () => {
    h.interaction.updateCursor({ clientX: 50, clientY: 50, onButton: false }, rect, false);
    assert.strictEqual(h.cursors[h.cursors.length - 1], 'default');
  });
  ok('resetCursor 复位为 grab', () => {
    h.interaction.resetCursor();
    assert.strictEqual(h.cursors[h.cursors.length - 1], 'grab');
  });
}

console.log('\n[9] 非左键不参与拖动');
{
  const h = makeHarness();
  h.interaction.onPointerDown({ button: 2, screenX: 100, screenY: 100 });
  ok('右键按下不进入拖动状态', () => assert.strictEqual(h.interaction.isDragging(), false));
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
