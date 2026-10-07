/* 自检：桌宠走动 renderer/pet/wander.js（阶段 8.7）
   ------------------------------------------------------------
   需求：walk 时要真正改变窗口位置；吸附边缘/Dock 时沿那条边滑动。

   重点守住：
   - 自由状态水平走，方向会由渲染层用来选 walk-left / walk-right
   - 贴左边/右边时改为**竖直**走（否则会横向撞开吸附）
   - 贴上下边 / Dock 四向时行走轴正确
   - 撞到边界（移动后位置没变）会反向，且**不会抖动**
   - 掉帧时按 dt 缩放但有上限（不会瞬移）
   - 未 start 时 tick 不产生位移 */

const path = require('path');
const assert = require('assert');

const wander = require(path.join(__dirname, '..', 'renderer', 'pet', 'wander.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 假位置：把 move 的累积施加到 pos，并可选钳制在 [min,max]（模拟主进程边界） */
function makeStage(opts) {
  const o = opts || {};
  const pos = { x: o.x === undefined ? 500 : o.x, y: o.y === undefined ? 400 : o.y };
  const bounds = o.bounds || null;
  const moves = [];
  return {
    pos,
    moves,
    readPos: () => ({ x: pos.x, y: pos.y }),
    move: (dx, dy) => {
      moves.push({ dx, dy });
      pos.x += dx;
      pos.y += dy;
      if (bounds) {
        pos.x = Math.max(bounds.minX, Math.min(bounds.maxX, pos.x));
        pos.y = Math.max(bounds.minY, Math.min(bounds.maxY, pos.y));
      }
    }
  };
}

console.log('\n[1] 吸附朝向 → 行走轴');
{
  ok('左右贴边 → 沿竖直走（y 轴）', () => {
    assert.strictEqual(wander.axisFor('left').axis, 'y');
    assert.strictEqual(wander.axisFor('right').axis, 'y');
  });
  ok('上下贴边 → 沿水平走（x 轴）', () => {
    assert.strictEqual(wander.axisFor('top').axis, 'x');
    assert.strictEqual(wander.axisFor('bottom').axis, 'x');
  });
  ok('Dock 四向与贴边同理', () => {
    assert.strictEqual(wander.axisFor('dock-left').axis, 'y');
    assert.strictEqual(wander.axisFor('dock-bottom').axis, 'x');
  });
  ok('无朝向（自由）→ 水平走', () => {
    assert.strictEqual(wander.axisFor(null).axis, 'x');
    assert.strictEqual(wander.axisFor('').axis, 'x');
    assert.strictEqual(wander.axisFor('nonsense').axis, 'x');
  });
}

console.log('\n[2] 自由状态：水平走动并上报方向');
{
  const stage = makeStage();
  const w = wander.createWanderer({
    ...stage, orientation: () => null, random: () => 0.9,   // 固定选 +1
    speedX: 2, stepMs: 40
  });
  ok('未 start 时 tick 不产生位移', () => {
    const r = w.tick(40);
    assert.deepStrictEqual(r, { dx: 0, dy: 0 });
    assert.strictEqual(stage.moves.length, 0);
  });
  ok('start 后水平移动', () => {
    w.start();
    stage.moves.length = 0;
    w.tick(40);
    assert.strictEqual(stage.moves.length, 1);
    assert.strictEqual(stage.moves[0].dy, 0, '自由走动不应有竖直位移');
    assert.ok(Math.abs(stage.moves[0].dx) > 0, '应有水平位移');
  });
  ok('方向为 left/right（供 walk-left/right 变体）', () => {
    assert.ok(['left', 'right'].includes(w.direction()), w.direction());
  });
  ok('位置确实改变了', () => {
    const before = stage.pos.x;
    w.tick(40);
    assert.notStrictEqual(stage.pos.x, before);
  });
  ok('stop 后不再移动', () => {
    w.stop();
    stage.moves.length = 0;
    w.tick(40);
    assert.strictEqual(stage.moves.length, 0);
  });
}

console.log('\n[3] 吸附左右边 → 改为竖直走（不会横向撞开吸附）');
{
  const stage = makeStage();
  const w = wander.createWanderer({
    ...stage, orientation: () => 'left', random: () => 0.9, speedY: 2
  });
  w.start();
  stage.moves.length = 0;
  w.tick(40);
  ok('竖直位移非零、水平位移为 0', () => {
    assert.strictEqual(stage.moves[0].dx, 0, '贴左边时不应有水平位移');
    assert.ok(Math.abs(stage.moves[0].dy) > 0, '应有竖直位移');
  });
  ok('方向为 up/down', () => {
    assert.ok(['up', 'down'].includes(w.direction()), w.direction());
  });
}

console.log('\n[4] 撞到边界要反向，且不抖动');
{
  // 舞台宽度极小，走一步就到底
  const stage = makeStage({ x: 10, bounds: { minX: 0, maxX: 10, minY: 0, maxY: 1000 } });
  const w = wander.createWanderer({
    ...stage, orientation: () => null, random: () => 0.9, speedX: 5, edgeEpsilon: 1
  });
  w.start();
  // 先让它往右走到边界
  let guard = 0;
  while (stage.pos.x < 10 && guard++ < 50) w.tick(40);
  const dirAtEdge = w.direction();
  // 连续 tick：第一次没动（stuck=1），第二次没动则反向
  w.tick(40);
  w.tick(40);
  ok('撞边后方向反转', () => {
    assert.notStrictEqual(w.direction(), dirAtEdge,
      '方向未反转（会一直卡在边界）');
  });
  ok('反转后能真的动起来', () => {
    const before = stage.pos.x;
    w.tick(40);
    assert.notStrictEqual(stage.pos.x, before, '反转后仍未移动');
  });
  ok('不会每帧都翻转（stuckTicks 有阈值）', () => {
    // 连续几帧方向应保持稳定
    const d1 = w.direction();
    w.tick(40);
    w.tick(40);
    assert.strictEqual(w.direction(), d1, '方向抖动');
  });
}

console.log('\n[5] 掉帧时按 dt 缩放，但有上限（不瞬移）');
{
  const stage = makeStage();
  const w = wander.createWanderer({
    ...stage, orientation: () => null, random: () => 0.9, speedX: 1, stepMs: 40
  });
  w.start();
  stage.moves.length = 0;
  w.tick(40);
  const normal = Math.abs(stage.moves[0].dx);
  stage.moves.length = 0;
  w.tick(4000);   // 假装卡了 4 秒
  const afterHang = Math.abs(stage.moves[0].dx);
  ok('卡顿后位移变大（按时间补偿）', () => {
    assert.ok(afterHang > normal, '未按 dt 补偿');
  });
  ok('但被限制在 3 倍以内（避免瞬移）', () => {
    assert.ok(afterHang <= normal * 3 + 0.001,
      '位移 ' + afterHang + ' 超过 3 倍上限 ' + normal * 3);
  });
}

console.log('\n[6] 走动时长随机且有界');
{
  const stage = makeStage();
  let i = 0;
  const seq = [0, 0.5, 1];
  const w = wander.createWanderer({
    ...stage, orientation: () => null,
    random: () => seq[(i++) % seq.length],
    minRunMs: 1000, maxRunMs: 2000
  });
  const ds = [w.pickDuration(), w.pickDuration(), w.pickDuration()];
  ok('时长落在 [min, max] 内', () => {
    ds.forEach((d) => {
      assert.ok(d >= 1000 && d <= 2000, '越界: ' + d);
    });
  });
  ok('不同随机值给出不同时长', () => {
    assert.ok(new Set(ds).size > 1, '时长没有变化: ' + ds.join(','));
  });
  ok('min > max 时不会出现空区间', () => {
    const w2 = wander.createWanderer({
      ...stage, orientation: () => null, random: () => 0.5,
      minRunMs: 3000, maxRunMs: 1000
    });
    const d = w2.pickDuration();
    assert.ok(d >= 3000, '应被夹到 min，实际 ' + d);
  });
}

console.log('\n[7] 稳健性');
{
  const stage = makeStage();
  ok('重复 start / stop 是幂等的', () => {
    const w = wander.createWanderer({ ...stage, orientation: () => null });
    assert.strictEqual(w.start(), true);
    assert.strictEqual(w.start(), false);
    assert.strictEqual(w.stop(), true);
    assert.strictEqual(w.stop(), false);
  });
  ok('缺少 move/readPos 也不抛错', () => {
    const w = wander.createWanderer({});
    assert.doesNotThrow(() => { w.start(); w.tick(40); w.stop(); });
    // 没有注入 random 时用 Math.random，方向不固定，只断言是合法的水平方向
    assert.ok(['left', 'right'].includes(w.direction()), w.direction());
  });
  ok('readPos 返回 null 时不做撞墙判定（不抛错）', () => {
    const w = wander.createWanderer({
      readPos: () => null, move: () => {}, orientation: () => null
    });
    assert.doesNotThrow(() => { w.start(); w.tick(40); w.tick(40); });
  });
  ok('非法 dt 不抛错', () => {
    const w = wander.createWanderer({ ...stage, orientation: () => null });
    w.start();
    [undefined, null, NaN, -5, 'x'].forEach((bad) => {
      assert.doesNotThrow(() => w.tick(bad), 'dt=' + JSON.stringify(bad));
    });
  });
  ok('orientation 抛错时不崩', () => {
    const w = wander.createWanderer({
      ...stage, orientation: () => { throw new Error('boom'); }
    });
    assert.doesNotThrow(() => { w.start(); w.tick(40); });
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
