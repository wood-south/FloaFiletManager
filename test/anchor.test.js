/* 自检：宠物视觉框测量与上报 renderer/pet/anchor.js
   用真实源码 + 注入的假 SVG/容器验证「锚点怎么算、什么时候上报」。

   这块是吸附是否准确的根基，重点守住三条来自踩坑结论的约束：
   1. 必须排除地面阴影 .pet-shadow（它是外切椭圆，四边超出量不等，
      任何统一内缩/逐边扣除都会在某个方向偏掉）
   2. 必须把 viewBox 坐标经 getScreenCTM 映射到客户端坐标
   3. 必须「连续稳定 N 帧」才上报（过渡动画期间逐帧上报会让主进程反复重算吸附）
   4. SVG 不可用时回退到容器矩形，而不是返回 null 让吸附失去依据 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'pet', 'anchor.js'), 'utf8'
);
const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('window', 'globalThis', src)(sandbox, sandbox);
const createAnchorWatcher = sandbox.createAnchorWatcher;
const { readVisibleUnion, isSameAnchor } = sandbox.PET_ANCHOR;
assert.ok(typeof createAnchorWatcher === 'function', 'anchor.js 未导出 createAnchorWatcher');
assert.ok(typeof readVisibleUnion === 'function', '未导出 readVisibleUnion');

/* ---------- 假 SVG 元素 ---------- */
function makeShape(cls, box) {
  return {
    classList: { contains: (n) => n === cls },
    getBBox: () => ({ x: box[0], y: box[1], width: box[2], height: box[3] })
  };
}
/** 单位 CTM（viewBox 坐标即客户端坐标），便于手算期望值 */
const IDENTITY_CTM = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function makeSvg(children, opts) {
  const o = opts || {};
  return {
    children,
    getBBox: () => ({ x: 15, y: 10, width: 70, height: 85 }),
    getScreenCTM: () => o.ctm || IDENTITY_CTM,
    _throwOnGetBBox: !!o.throwOnGetBBox
  };
}
function makeContainer(rect) {
  return { getBoundingClientRect: () => rect };
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 取并集并排除地面阴影');
{
  const head = makeShape('pet-head', [20, 10, 60, 70]);
  const paw = makeShape('paw', [30, 75, 10, 10]);
  const shadow = makeShape('pet-shadow', [5, 5, 90, 90]); // 四边都更大的外切椭圆
  const union = readVisibleUnion(makeSvg([shadow, head, paw]), IDENTITY_CTM);
  ok('并集只覆盖猫本体，不含阴影', () => {
    assert.deepStrictEqual(union, { left: 20, top: 10, right: 80, bottom: 85 });
  });
  ok('若未排除阴影，左/上边界会被阴影拉到 5', () => {
    assert.notStrictEqual(union.left, 5);
    assert.notStrictEqual(union.top, 5);
  });
}

console.log('\n[2] 坐标变换');
{
  const head = makeShape('pet-head', [0, 0, 10, 10]);
  // 平移 (100,50) + 2 倍缩放
  const ctm = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
  const union = readVisibleUnion(makeSvg([head]), ctm);
  ok('viewBox 坐标经 CTM 映射到客户端坐标', () => {
    assert.deepStrictEqual(union, { left: 100, top: 50, right: 120, bottom: 70 });
  });
  ok('CTM 为旋转矩阵时按四角映射', () => {
    // 绕原点旋转 90°：x' = c*y + e, y' = d*y + f（a=0,b=1 的顺时针情形）
    const rot = { a: 0, b: 1, c: -1, d: 0, e: 200, f: 0 };
    const u = readVisibleUnion(makeSvg([head]), rot);
    assert.deepStrictEqual(u, { left: 190, top: 0, right: 200, bottom: 10 });
  });
}

console.log('\n[3] 异常与空值');
{
  ok('没有任何可见子元素时返回 null', () => {
    assert.strictEqual(readVisibleUnion(makeSvg([]), IDENTITY_CTM), null);
  });
  ok('全部子元素都是阴影时返回 null', () => {
    assert.strictEqual(
      readVisibleUnion(makeSvg([makeShape('pet-shadow', [0, 0, 10, 10])]), IDENTITY_CTM),
      null
    );
  });
  ok('缺少 svg 或 ctm 时返回 null', () => {
    assert.strictEqual(readVisibleUnion(null, IDENTITY_CTM), null);
    assert.strictEqual(readVisibleUnion(makeSvg([]), null), null);
  });
  ok('单个子元素 getBBox 抛错时跳过它、不影响其它子元素', () => {
    const bad = { classList: { contains: () => false }, getBBox: () => { throw new Error('boom'); } };
    const good = makeShape('pet-head', [1, 2, 3, 4]);
    const u = readVisibleUnion(makeSvg([bad, good]), IDENTITY_CTM);
    assert.deepStrictEqual(u, { left: 1, top: 2, right: 4, bottom: 6 });
  });
  ok('零尺寸子元素被忽略', () => {
    const empty = makeShape('x', [0, 0, 0, 0]);
    assert.strictEqual(readVisibleUnion(makeSvg([empty]), IDENTITY_CTM), null);
  });
}

console.log('\n[4] isSameAnchor');
{
  const a = { left: 1, top: 2, width: 3, height: 4 };
  ok('完全相同为 true', () => assert.strictEqual(isSameAnchor(a, { ...a }), true));
  ok('任一为空为 false', () => {
    assert.strictEqual(isSameAnchor(null, a), false);
    assert.strictEqual(isSameAnchor(a, null), false);
  });
  ok('任一字段不同为 false', () => {
    assert.strictEqual(isSameAnchor(a, { ...a, left: 9 }), false);
    assert.strictEqual(isSameAnchor(a, { ...a, height: 9 }), false);
  });
}

console.log('\n[5] read()：优先量本体，回退量容器');
{
  const children = [makeShape('pet-head', [20, 10, 60, 70])];
  const w = createAnchorWatcher({
    svg: makeSvg(children),
    container: makeContainer({ left: 0, top: 0, width: 90, height: 90 }),
    raf: () => 1,
    cancelRaf: () => {}
  });
  ok('有 SVG 时量猫本体（而不是 90×90 容器）', () => {
    assert.deepStrictEqual(w.read(), { left: 20, top: 10, width: 60, height: 70 });
  });

  const w2 = createAnchorWatcher({
    svg: null,
    container: makeContainer({ left: 5, top: 6, width: 90, height: 80 }),
    raf: () => 1,
    cancelRaf: () => {}
  });
  ok('无 SVG 时回退到容器矩形', () => {
    assert.deepStrictEqual(w2.read(), { left: 5, top: 6, width: 90, height: 80 });
  });

  const w3 = createAnchorWatcher({
    svg: makeSvg([], {}),
    container: makeContainer({ left: 1, top: 1, width: 2, height: 2 }),
    raf: () => 1,
    cancelRaf: () => {}
  });
  ok('SVG 量为空时也回退到容器', () => {
    assert.deepStrictEqual(w3.read(), { left: 1, top: 1, width: 2, height: 2 });
  });

  const w4 = createAnchorWatcher({ svg: null, container: null, raf: () => 1, cancelRaf: () => {} });
  ok('都不可用时返回 null（不抛错）', () => assert.strictEqual(w4.read(), null));
}

console.log('\n[6] 上报节流：连续稳定 N 帧才上报');
{
  const reports = [];
  // 可变的 bbox，用来模拟过渡动画期间视觉框持续变化
  let box = [0, 0, 10, 10];
  const svg = {
    children: [{ classList: { contains: () => false }, getBBox: () => ({ x: box[0], y: box[1], width: box[2], height: box[3] }) }],
    getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    getScreenCTM: () => IDENTITY_CTM
  };
  const w = createAnchorWatcher({
    svg,
    container: null,
    report: (a) => reports.push(a),
    stableFrames: 3,
    raf: () => 1,
    cancelRaf: () => {}
  });

  // 稳定语义沿用原实现：连续 3 次「与上帧相同」才上报。
  // 第 1 帧只建立基准（与上帧无从比较），因此上报落在第 4 帧（约 4 帧 ≈ 67ms）。
  w.sample();
  ok('第 1 帧不上报（建立基准）', () => assert.strictEqual(reports.length, 0));
  w.sample();
  ok('第 2 帧不上报', () => assert.strictEqual(reports.length, 0));
  w.sample();
  ok('第 3 帧仍不上报（累计 2 次相同）', () => assert.strictEqual(reports.length, 0));
  w.sample();
  ok('第 4 帧达到稳定阈值并上报一次', () => assert.strictEqual(reports.length, 1));
  ok('上报内容即当前锚点', () => {
    assert.deepStrictEqual(reports[0], { left: 0, top: 0, width: 10, height: 10 });
  });
  w.sample();
  ok('锚点未变化时不重复上报', () => assert.strictEqual(reports.length, 1));

  box = [5, 5, 10, 10]; // 视觉框变了（模拟动画/旋转）
  w.sample();
  ok('锚点变化后重新累积稳定帧，不立刻上报', () => assert.strictEqual(reports.length, 1));
  w.sample();
  w.sample();
  ok('再积累到稳定阈值前仍不上报', () => assert.strictEqual(reports.length, 1));
  w.sample();
  ok('变化后再次稳定即上报新锚点', () => {
    assert.strictEqual(reports.length, 2);
    assert.deepStrictEqual(reports[1], { left: 5, top: 5, width: 10, height: 10 });
  });
}

console.log('\n[7] 生命周期：start / stop / reset');
{
  const rafs = [];
  const cancelled = [];
  let n = 0;
  const w = createAnchorWatcher({
    svg: makeSvg([makeShape('pet-head', [0, 0, 10, 10])]),
    report: () => { n++; },
    stableFrames: 1,
    raf: (fn) => { rafs.push(fn); return rafs.length; },
    cancelRaf: (h) => cancelled.push(h)
  });
  ok('初始未运行', () => assert.strictEqual(w.isRunning(), false));
  w.start();
  ok('start 后处于运行中', () => assert.strictEqual(w.isRunning(), true));
  ok('start 排了一帧', () => assert.strictEqual(rafs.length, 1));
  // stableFrames=1 仍需「与上帧相同」一次，故第 1 帧只建基准、第 2 帧才上报
  rafs.shift()();
  ok('第 1 帧建基准、无人上报', () => assert.strictEqual(n, 0));
  ok('帧回调会继续排下一帧', () => assert.ok(rafs.length >= 1, '应继续排程下一帧'));
  rafs.shift()();
  ok('第 2 帧上报', () => assert.strictEqual(n, 1));
  w.stop();
  ok('stop 后不再运行且取消排程', () => {
    assert.strictEqual(w.isRunning(), false);
    assert.ok(cancelled.length >= 1, '应调用 cancelRaf');
  });
  ok('重复 start 不会叠加轮询', () => {
    const before = rafs.length;
    w.start();
    w.start();
    assert.strictEqual(rafs.length, before + 1, '重复 start 应被忽略');
    w.stop();
  });
  ok('reset 清空基准，使同一锚点可再次上报', () => {
    const r = [];
    const w2 = createAnchorWatcher({
      svg: makeSvg([makeShape('pet-head', [0, 0, 10, 10])]),
      report: (a) => r.push(a),
      stableFrames: 1,
      raf: () => 1,
      cancelRaf: () => {}
    });
    w2.sample();
    w2.sample();
    assert.strictEqual(r.length, 1, '稳定后只上报一次');
    w2.reset();
    w2.sample();
    w2.sample();
    assert.strictEqual(r.length, 2, 'reset 后应能就同一锚点再上报一次');
  });
}

console.log('\n[8] 调试框默认关闭');
{
  const created = [];
  const host = { appendChild: (el) => created.push(el) };
  const w = createAnchorWatcher({
    svg: makeSvg([makeShape('pet-head', [0, 0, 10, 10])]),
    debug: false,
    debugHost: host,
    raf: () => 1,
    cancelRaf: () => {}
  });
  w.sample();
  ok('未开启调试时不创建任何元素', () => assert.strictEqual(created.length, 0));
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
