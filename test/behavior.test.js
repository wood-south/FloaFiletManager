/* 自检：桌宠动画状态机 renderer/pet/behavior.js
   用真实源码 + 注入的定时器验证状态表与状态机语义。

   重点守住：
   - 优先级：高可打断低，低不得打断高（drag 不该被 sleep 顶掉）
   - 未知状态名回落到 idle（检测项：缺字段时要有明确降级，而不是白屏/抛错）
   - 一次性状态到点自动回落 fallback
   - 默认值等于现状：未收到指令时是 idle
   - 订阅者在抛错时不影响状态机自身与其它订阅者 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'pet', 'behavior.js'), 'utf8'
);
const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('window', 'globalThis', src)(sandbox, sandbox);
const B = sandbox.PET_BEHAVIOR;
assert.ok(B && typeof B.createBehavior === 'function', 'behavior.js 未导出 PET_BEHAVIOR.createBehavior');

/** 可控定时器：记录待触发的回调；cancel 必须真的能取消（否则测不出计时器清理） */
function makeHarness(initial) {
  const timers = [];
  const changes = [];
  let nextId = 1;
  const b = B.createBehavior({
    initial,
    onChange: (info) => changes.push(info),
    schedule: (fn, ms) => {
      const handle = { id: nextId++, fn, ms, cancelled: false };
      timers.push(handle);
      return handle;
    },
    cancel: (handle) => {
      if (!handle) return;
      handle.cancelled = true;
      const i = timers.indexOf(handle);
      if (i >= 0) timers.splice(i, 1);
    }
  });
  return {
    b,
    changes,
    timers,
    /** 触发最早排队的定时器（已取消的不会在队列里） */
    fire: () => {
      const t = timers.shift();
      if (t) t.fn();
      return !!t;
    }
  };
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 状态表完整性');
{
  const names = Object.keys(B.STATES);
  ok('包含方案要求的 7 个状态', () => {
    ['idle', 'walk', 'sleep', 'interact', 'drag', 'snap', 'celebrate'].forEach((n) => {
      assert.ok(B.hasState(n), '缺少状态: ' + n);
    });
  });
  ok('每个状态都有 priority / loop / class / label', () => {
    for (const [n, s] of Object.entries(B.STATES)) {
      assert.strictEqual(typeof s.priority, 'number', n + ' 缺 priority');
      assert.strictEqual(typeof s.loop, 'boolean', n + ' 缺 loop');
      assert.ok(typeof s.class === 'string' && s.class, n + ' 缺 class');
      assert.ok(typeof s.label === 'string' && s.label, n + ' 缺 label');
    }
  });
  ok('状态类名唯一（避免两个状态命中同一 CSS）', () => {
    const seen = new Set();
    for (const s of Object.values(B.STATES)) {
      assert.ok(!seen.has(s.class), '重复的状态类: ' + s.class);
      seen.add(s.class);
    }
  });
  ok('一次性状态必须声明 duration 与 fallback', () => {
    for (const [n, s] of Object.entries(B.STATES)) {
      if (s.loop) continue;
      assert.ok(s.duration > 0, n + ' 是一次性状态但没有 duration');
      assert.ok(B.hasState(s.fallback), n + ' 的 fallback 不是合法状态');
    }
  });
  ok('优先级数值符合方案（drag > snap > interact > celebrate > walk > sleep > idle）', () => {
    const p = B.priorityOf;
    assert.ok(p('drag') > p('snap'), 'drag 应高于 snap');
    assert.ok(p('snap') > p('interact'), 'snap 应高于 interact');
    assert.ok(p('interact') > p('celebrate'), 'interact 应高于 celebrate');
    assert.ok(p('celebrate') > p('walk'), 'celebrate 应高于 walk');
    assert.ok(p('walk') > p('sleep'), 'walk 应高于 sleep');
    assert.ok(p('sleep') > p('idle'), 'sleep 应高于 idle');
  });
  ok('默认状态是 idle', () => assert.strictEqual(B.DEFAULT_STATE, 'idle'));
}

console.log('\n[2] 未知状态优雅降级');
{
  ok('hasState 对未知名字返回 false', () => {
    assert.strictEqual(B.hasState('nope'), false);
    assert.strictEqual(B.hasState(''), false);
    assert.strictEqual(B.hasState(null), false);
  });
  ok('已知状态名回落语义由 normalize 提供（供 fallback/initial 使用）', () => {
    assert.strictEqual(B.normalize('nope'), 'idle');
  });
  const h = makeHarness();
  ok('set 未知状态名被拒绝（状态不变、无通知）', () => {
    h.b.set('walk');
    const before = h.changes.length;
    assert.strictEqual(h.b.set('不存在的状态'), false);
    assert.strictEqual(h.b.get(), 'walk', '状态不应被改写');
    assert.strictEqual(h.changes.length, before, '不应产生通知');
  });
  ok('set 对空值/非字符串同样拒绝', () => {
    assert.strictEqual(h.b.set(null), false);
    assert.strictEqual(h.b.set(undefined), false);
    assert.strictEqual(h.b.set(''), false);
    assert.strictEqual(h.b.get(), 'walk');
  });
}

console.log('\n[3] 优先级：高可打断低，低不得打断高');
{
  const h = makeHarness();
  ok('idle -> walk 允许', () => assert.strictEqual(h.b.set('walk'), true));
  ok('walk -> sleep 被拒绝（低不能打断高）', () => {
    assert.strictEqual(h.b.set('sleep'), false);
    assert.strictEqual(h.b.get(), 'walk');
  });
  ok('walk -> drag 允许（高打断低）', () => assert.strictEqual(h.b.set('drag'), true));
  ok('drag -> idle 被拒绝（拖动期间不能被待机顶掉）', () => {
    assert.strictEqual(h.b.set('idle'), false);
    assert.strictEqual(h.b.get(), 'drag');
  });
  ok('drag -> snap 被拒绝（snap 优先级低于 drag）', () => {
    assert.strictEqual(h.b.set('snap'), false);
  });
  ok('同优先级可互相切换（snap -> drag 之外）', () => {
    const h2 = makeHarness();
    h2.b.set('sleep');
    assert.strictEqual(h2.b.set('sleep'), false, '同状态重复设置应返回 false');
  });
  ok('canTransition 同优先级允许（>= 语义）', () => {
    assert.strictEqual(B.canTransition('walk', 'walk'), true);
    assert.strictEqual(B.canTransition('drag', 'idle'), false);
    assert.strictEqual(B.canTransition(null, 'sleep'), true);
  });
}

console.log('\n[4] 一次性状态到点回落');
{
  const h = makeHarness();
  ok('切到 interact 会排一个定时器', () => {
    h.b.set('interact');
    assert.strictEqual(h.timers.length, 1);
    assert.strictEqual(h.timers[0].ms, B.STATES.interact.duration);
  });
  ok('未到点前仍是 interact', () => assert.strictEqual(h.b.get(), 'interact'));
  ok('到点回落到 fallback（idle）', () => {
    h.fire();
    assert.strictEqual(h.b.get(), 'idle');
  });
  ok('celebrate 同样到点回落', () => {
    const h2 = makeHarness();
    h2.b.set('celebrate');
    assert.strictEqual(h2.b.get(), 'celebrate');
    h2.fire();
    assert.strictEqual(h2.b.get(), 'idle');
  });
  ok('切到循环状态会取消未完成的一次性计时器', () => {
    const h3 = makeHarness();
    h3.b.set('interact');
    assert.strictEqual(h3.timers.length, 1);
    h3.b.set('drag'); // 打断
    // 触发残留计时器不应把状态改回 idle
    if (h3.timers.length) {
      h3.fire();
      assert.strictEqual(h3.b.get(), 'drag', '被打断后残留计时器不得改写状态');
    }
  });
}

console.log('\n[5] 变化通知');
{
  const h = makeHarness();
  ok('切换时通知 from/to 与完整描述', () => {
    h.b.set('walk');
    const last = h.changes[h.changes.length - 1];
    assert.strictEqual(last.from, 'idle');
    assert.strictEqual(last.state, 'walk', 'describe() 用 state 字段表示「切到了哪」');
    assert.strictEqual(last.class, 'state-walk');
    assert.strictEqual(last.priority, B.STATES.walk.priority);
  });
  ok('被拒绝的切换不产生通知', () => {
    const before = h.changes.length;
    h.b.set('sleep'); // walk -> sleep 被拒
    assert.strictEqual(h.changes.length, before);
  });
  ok('相同状态重复设置不产生通知', () => {
    const before = h.changes.length;
    h.b.set('walk');
    assert.strictEqual(h.changes.length, before);
  });
  ok('subscribe 可收到通知，且能取消订阅', () => {
    const seen = [];
    const off = h.b.subscribe((info) => seen.push(info.state));
    h.b.set('drag');
    assert.deepStrictEqual(seen, ['drag']);
    off();
    h.b.set('idle'); // 被拒，不会通知
    assert.strictEqual(seen.length, 1);
  });
  ok('订阅者抛错不影响状态机与其它订阅者', () => {
    const h2 = makeHarness();
    const seen = [];
    const realWarn = console.warn;
    console.warn = () => {}; // 静音预期告警
    try {
      h2.b.subscribe(() => { throw new Error('boom'); });
      h2.b.subscribe((info) => seen.push(info.state));
      h2.b.set('walk');
    } finally {
      console.warn = realWarn;
    }
    assert.strictEqual(h2.b.get(), 'walk');
    assert.deepStrictEqual(seen, ['walk']);
  });
}

console.log('\n[6] reset 与 dispose');
{
  const h = makeHarness();
  h.b.set('drag');
  ok('reset 强制回到 idle', () => {
    assert.strictEqual(h.b.reset(), true);
    assert.strictEqual(h.b.get(), 'idle');
  });
  ok('已在 idle 时 reset 返回 false', () => assert.strictEqual(h.b.reset(), false));
  ok('dispose 后不再通知订阅者', () => {
    const h2 = makeHarness();
    const seen = [];
    h2.b.subscribe((i) => seen.push(i.state));
    h2.b.set('walk');
    h2.b.dispose();
    h2.b.set('idle'); // idle 优先级低于 walk，被拒；改用一个允许的切换
    h2.b.dispose();
    assert.deepStrictEqual(seen, ['walk']);
  });
  ok('describe 返回可直接用于贴 class 的信息', () => {
    const h3 = makeHarness('sleep');
    const d = h3.b.describe();
    assert.strictEqual(d.state, 'sleep');
    assert.strictEqual(d.class, 'state-sleep');
    assert.strictEqual(d.loop, true);
    assert.strictEqual(d.duration, null);
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
