/* 自检：点击穿透仲裁 renderer/pet/penetration.js
   用真实源码验证「原因集合」仲裁的行为契约。

   重点守住阶段 2 修掉的缺陷：原实现是四条布尔的组合
     if (!menuOpen && !quitOpen && !modalActive && !isDragging) enableClickThrough();
   与调用顺序相关 —— 菜单开着时拖放结束，拖动分支会顺手恢复穿透，把菜单的可点击性
   一起关掉。下面 [4] 组就是这四个来源的两两/三三叠加用例。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'pet', 'penetration.js'), 'utf8'
);
const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('window', 'globalThis', src)(sandbox, sandbox);
const createPenetration = sandbox.createPenetration;
assert.ok(typeof createPenetration === 'function', 'penetration.js 未导出 createPenetration');

/** 记录每次下发的穿透状态 */
function makeHarness() {
  const calls = [];
  const pen = createPenetration({
    setIgnore: (ignore, opts) => calls.push({ ignore, opts })
  });
  return {
    pen,
    calls,
    /** 最后一次下发的穿透状态（true = 穿透到桌面） */
    last: () => (calls.length ? calls[calls.length - 1].ignore : null),
    /** 实际下发的次数（用于验证去重） */
    count: () => calls.length
  };
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 初始化与兜底');
{
  const h = makeHarness();
  ok('init 后处于穿透状态', () => {
    h.pen.init();
    assert.strictEqual(h.last(), true);
  });
  ok('穿透时带 forward: true（保留 mousemove 才能判断进入内容区）', () => {
    assert.deepStrictEqual(h.calls[h.calls.length - 1].opts, { forward: true });
  });
  ok('isIgnoring 反映当前状态', () => assert.strictEqual(h.pen.isIgnoring(), true));
}

console.log('\n[2] 单一原因：acquire / release');
{
  const h = makeHarness();
  h.pen.init();
  ok('acquire 后捕获鼠标', () => {
    h.pen.acquire('menu');
    assert.strictEqual(h.last(), false);
  });
  ok('捕获时不传 forward', () => {
    assert.strictEqual(h.calls[h.calls.length - 1].opts, undefined);
  });
  ok('release 后恢复穿透', () => {
    h.pen.release('menu');
    assert.strictEqual(h.last(), true);
  });
  ok('acquire 返回值表示是否新增', () => {
    assert.strictEqual(h.pen.acquire('menu'), true);
    assert.strictEqual(h.pen.acquire('menu'), false);
  });
  ok('release 返回值表示是否真的移除', () => {
    assert.strictEqual(h.pen.release('menu'), true);
    assert.strictEqual(h.pen.release('menu'), false);
  });
}

console.log('\n[3] 幂等与去重');
{
  const h = makeHarness();
  h.pen.init();
  const before = h.count();
  ok('同一状态不重复下发 IPC', () => {
    h.pen.acquire('menu');
    h.pen.acquire('menu');
    h.pen.acquire('menu');
    assert.strictEqual(h.count(), before + 1, '应只下发一次');
  });
  ok('重复 release 不会把状态带成负值（不会误开穿透）', () => {
    h.pen.release('menu');
    h.pen.release('menu');
    h.pen.release('menu');
    assert.strictEqual(h.last(), true);
    assert.strictEqual(h.pen.list().length, 0);
  });
}

console.log('\n[4] 多原因叠加（旧布尔链出错的场景）');
{
  const h = makeHarness();
  h.pen.init();
  // 场景：菜单打开 → 用户拖动（拖放/拖动结束）→ 误开穿透
  h.pen.acquire('menu');
  h.pen.acquire('drag');
  ok('菜单 + 拖动同时存在时保持捕获', () => assert.strictEqual(h.last(), false));
  ok('拖动结束（仅 release drag）后菜单仍受保护，不得恢复穿透', () => {
    h.pen.release('drag');
    assert.strictEqual(h.last(), false, '菜单还开着就恢复穿透 = 菜单点不到');
    assert.deepStrictEqual(h.pen.list(), ['menu']);
  });
  ok('菜单关闭后才恢复穿透', () => {
    h.pen.release('menu');
    assert.strictEqual(h.last(), true);
  });

  // 场景：模态框与菜单同时存在
  const h2 = makeHarness();
  h2.pen.init();
  h2.pen.acquire('modal');
  h2.pen.acquire('menu');
  h2.pen.acquire('quit');
  ok('模态 + 菜单 + 退出三重重叠时保持捕获', () => assert.strictEqual(h2.last(), false));
  ok('先关模态：仍有三者之外的原因，保持捕获', () => {
    h2.pen.release('modal');
    assert.strictEqual(h2.last(), false);
  });
  ok('再关菜单：退出按钮仍开着，保持捕获', () => {
    h2.pen.release('menu');
    assert.strictEqual(h2.last(), false);
  });
  ok('全部关闭后恢复穿透', () => {
    h2.pen.release('quit');
    assert.strictEqual(h2.last(), true);
  });

  // 顺序无关性：与「菜单先关、拖动后结束」的相反顺序结果一致
  const h3 = makeHarness();
  h3.pen.init();
  h3.pen.acquire('drag');
  h3.pen.acquire('menu');
  h3.pen.release('menu'); // 先关菜单
  h3.pen.release('drag'); // 后结束拖动
  ok('相反释放顺序的最终状态一致（顺序无关）', () => assert.strictEqual(h3.last(), true));
}

console.log('\n[5] 鼠标进入/离开内容区（pointer-inside 原因）');
{
  const h = makeHarness();
  h.pen.init();
  ok('进入内容区：捕获', () => {
    h.pen.acquire('pointer-inside');
    assert.strictEqual(h.last(), false);
  });
  ok('离开内容区且无其它原因：恢复穿透', () => {
    h.pen.release('pointer-inside');
    assert.strictEqual(h.last(), true);
  });
  ok('离开内容区但拖动中：不得恢复穿透（否则 mousemove 丢失、拖动断连）', () => {
    h.pen.acquire('drag');
    h.pen.acquire('pointer-inside');
    h.pen.release('pointer-inside');
    assert.strictEqual(h.last(), false);
    h.pen.release('drag');
  });
}

console.log('\n[6] releaseAll：兜底复位');
{
  const h = makeHarness();
  h.pen.init();
  h.pen.acquire('menu');
  h.pen.acquire('drag');
  h.pen.acquire('modal');
  ok('releaseAll 清空全部原因并恢复穿透', () => {
    h.pen.releaseAll();
    assert.strictEqual(h.last(), true);
    assert.deepStrictEqual(h.pen.list(), []);
  });
  ok('releaseAll 在状态未变时也会强制重新下发（避免被去重挡掉）', () => {
    const h2 = makeHarness();
    h2.pen.init();
    const before = h2.count();
    h2.pen.releaseAll();
    assert.strictEqual(h2.count(), before + 1, '兜底复位应真的下发一次');
  });
  ok('releaseAll 返回是否曾经有原因', () => {
    const h3 = makeHarness();
    h3.pen.init();
    assert.strictEqual(h3.pen.releaseAll(), false);
    h3.pen.acquire('menu');
    assert.strictEqual(h3.pen.releaseAll(), true);
  });
}

console.log('\n[7] 空原因不产生副作用');
{
  const h = makeHarness();
  h.pen.init();
  const before = h.count();
  ok('acquire(null) 被忽略', () => {
    assert.strictEqual(h.pen.acquire(null), false);
    assert.strictEqual(h.pen.acquire(''), false);
    assert.strictEqual(h.count(), before);
  });
  ok('release(undefined) 被忽略', () => {
    h.pen.release(undefined);
    assert.strictEqual(h.count(), before);
  });
  ok('has 可查询单个原因', () => {
    h.pen.acquire('menu');
    assert.strictEqual(h.pen.has('menu'), true);
    assert.strictEqual(h.pen.has('drag'), false);
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
