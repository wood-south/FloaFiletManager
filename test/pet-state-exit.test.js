/* 自检：高优先级状态必须能「回到常态」（防桌宠卡在 drag/snap）
   ------------------------------------------------------------
   真实缺陷（由用户提供的 main.log 定位）：
   日志里出现 `interact → drag` 之后，**再无任何状态变化** —— 桌宠永久卡在 drag。

   根因：松手时写的是 behavior.set('idle')，而 idle 优先级 0、
   drag 优先级 100，状态机不允许低优先级打断高优先级，于是**正确拒绝**了这次切换。
   卡在 drag 之后，walk(40)/sleep(20) 优先级更低也全被拒 ——
   用户看到的就是"只有一种动画播放"。

   这个坑在项目里出现了四次，所以本测试专门守住：
   从任何高优先级状态都必须能回到 idle，且必须走 reset() 语义。 */

const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const behaviorApi = require(path.join(root, 'renderer', 'pet', 'behavior.js'));
const driverApi = require(path.join(root, 'renderer', 'pet', 'driver.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 复刻 float.js 里的 leaveToIdle（当前实现） */
function makeLeaveToIdle(behavior) {
  return function leaveToIdle() {
    const cur = behavior.get();
    if (cur === 'idle') return false;
    return behavior.reset();
  };
}

const HIGH = ['drag', 'snap', 'interact', 'celebrate', 'walk', 'sleep'];

console.log('\n[1] 复现缺陷：set("idle") 从高优先级状态会被拒绝');
{
  for (const state of HIGH) {
    const b = behaviorApi.createBehavior({});
    ok('从 ' + state + ' 用 set("idle") 回不去（这就是 bug 本身）', () => {
      assert.strictEqual(b.set(state), true, '切到 ' + state + ' 失败');
      assert.strictEqual(b.get(), state);
      const changed = b.set('idle');
      assert.strictEqual(changed, false,
        state + ' → idle 竟然被允许了？那说明优先级表变了，需重新审视本测试');
      assert.strictEqual(b.get(), state, '状态不应变化');
    });
  }
}

console.log('\n[2] leaveToIdle：从任何高优先级状态都能回到 idle');
{
  for (const state of HIGH) {
    const b = behaviorApi.createBehavior({});
    const leaveToIdle = makeLeaveToIdle(b);
    ok('从 ' + state + ' 能回到 idle', () => {
      b.set(state);
      assert.strictEqual(b.get(), state);
      assert.strictEqual(leaveToIdle(), true, state + ' → idle 失败（会卡住）');
      assert.strictEqual(b.get(), 'idle');
    });
  }
  ok('已在 idle 时是 no-op（不会反复触发通知）', () => {
    const b = behaviorApi.createBehavior({});
    const leaveToIdle = makeLeaveToIdle(b);
    assert.strictEqual(leaveToIdle(), false);
    assert.strictEqual(b.get(), 'idle');
  });
}

console.log('\n[3] 卡在 drag 之后，自主行为会被全部拒绝（解释"只有一种动画"）');
{
  const b = behaviorApi.createBehavior({});
  b.set('drag');
  ok('drag 期间 walk / sleep 都被拒绝', () => {
    assert.strictEqual(b.set('walk'), false, 'drag 中竟能切 walk');
    assert.strictEqual(b.set('sleep'), false, 'drag 中竟能切 sleep');
    assert.strictEqual(b.get(), 'drag');
  });
  ok('松手（leaveToIdle）之后才恢复正常', () => {
    makeLeaveToIdle(b)();
    assert.strictEqual(b.get(), 'idle');
    assert.strictEqual(b.set('walk'), true, '回到 idle 后应能切 walk');
  });
}

console.log('\n[4] 端到端：拖动 → 松手 → 能自己走动/睡觉');
{
  let clock = 0;
  const b = behaviorApi.createBehavior({});
  b.set('drag');
  // 模拟松手
  makeLeaveToIdle(b)();
  assert.strictEqual(b.get(), 'idle', '松手后应回到 idle');

  const d = driverApi.createBehaviorDriver({
    behavior: b,
    schedule: (fn, ms) => { pendingPush(clock + ms, fn); return 1; },
    cancel: () => {},
    now: () => clock,
    random: () => 0,
    sleepAfterMs: 3000,
    walkMinDelayMs: 1000,
    walkMaxDelayMs: 1000,
    walkDurationMs: 500
  });
  const timers = [];
  function pendingPush(at, fn) { timers.push({ at, fn }); }
  d.enable();

  function advance(ms) {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, c) => a.at - c.at);
      const due = timers.filter((t) => t.at <= target);
      if (due.length === 0) break;
      const job = timers.shift();
      clock = job.at;
      job.fn();
    }
    clock = target;
  }

  let sawWalk = false;
  let sawSleep = false;
  // 推进 5 秒，记录状态轨迹
  const trace = [];
  let last = b.get();
  for (let i = 0; i < 50; i++) {
    advance(100);
    const cur = b.get();
    if (cur !== last) { trace.push(last + '→' + cur); last = cur; }
    if (cur === 'walk') sawWalk = true;
    if (cur === 'sleep') sawSleep = true;
  }
  ok('松手后能自己走动（walk）', () => assert.ok(sawWalk, '没出现 walk，轨迹: ' + trace.join(', ')));
  ok('松手后能自己睡觉（sleep）', () => assert.ok(sawSleep, '没出现 sleep，轨迹: ' + trace.join(', ')));
  ok('状态轨迹非空（确实在切换）', () => assert.ok(trace.length >= 2, '轨迹: ' + trace.join(', ')));
  d.disable();
}

console.log('\n[5] 源码契约：float.js 里不得再用 set("idle") 收尾');
{
  const fs = require('fs');
  const floatJs = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  ok('存在统一的 leaveToIdle 助手', () => {
    assert.ok(/function leaveToIdle\(/.test(floatJs), '缺少 leaveToIdle');
  });
  ok('没有任何 behavior.set("idle") 的调用（注释除外）', () => {
    const code = floatJs.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = (code.match(/behavior\.set\(\s*'idle'\s*\)/g) || []).length;
    assert.strictEqual(hits, 0,
      '仍有 ' + hits + ' 处 set(\'idle\')，会卡在 drag/snap');
  });
  ok('拖动松手与取消吸附都走 leaveToIdle', () => {
    const dragRelease = floatJs.slice(floatJs.indexOf('onDragStateChange'));
    const body = dragRelease.slice(0, dragRelease.indexOf('},'));
    assert.ok(/leaveToIdle\(\)/.test(body), '拖动松手未走 leaveToIdle');
    const snapFn = floatJs.slice(floatJs.indexOf('function syncSnapState('));
    const snapBody = snapFn.slice(0, snapFn.indexOf('\n}'));
    assert.ok(/leaveToIdle\(\)/.test(snapBody), '取消吸附未走 leaveToIdle');
  });
  ok('leaveToIdle 用 reset() 而不是 set()', () => {
    const start = floatJs.indexOf('function leaveToIdle(');
    const body = floatJs.slice(start, floatJs.indexOf('\n}', start));
    assert.ok(/behavior\.reset\(\)/.test(body), '未调用 reset()');
    assert.ok(!/behavior\.set\(/.test(body.replace(/\/\/[^\n]*/g, '')),
      'leaveToIdle 内不应使用 set()');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
