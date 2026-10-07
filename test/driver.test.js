/* 自检：桌宠自主行为驱动 renderer/pet/driver.js（阶段 3 收尾）
   ------------------------------------------------------------
   状态机只回答「能不能切」，本模块回答「什么时候切」，把此前没有驱动源的
   sleep / walk / celebrate 接上。

   为什么必须注入时钟与定时器：默认的 sleepAfterMs 是 60 秒，
   真等一分钟的测试没人会跑，因此这里用「假时钟 + 假定时器」
   精确推进时间，把「等 60 秒后入睡」变成确定性断言。

   重点守住（这些都是"桌宠会不会变得不听话"的关键）：
   - 用户操作中（drag / snap / interact）自主行为一律让路，绝不抢占
   - disable() 后完全停止自主变化
   - walk / celebrate 结束都要收回 idle，不能卡住
   - 用户活动能把 sleep 唤醒
   - 定时器不叠加（单一定时器策略），否则恢复后行为频率会翻倍 */

const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const driver = require(path.join(root, 'renderer', 'pet', 'driver.js'));
const behaviorApi = require(path.join(root, 'renderer', 'pet', 'behavior.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 假时钟 + 假定时器：可精确推进时间并触发到期的回调 */
function makeClock() {
  let t = 0;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { fn, at: t + Math.max(0, ms) });
      return id;
    },
    cancel: (id) => { pending.delete(id); },
    /** 推进到指定时刻并触发所有到期回调（按到期顺序） */
    advance(ms) {
      const target = t + ms;
      let guard = 0;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, v]) => v.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        if (++guard > 5000) throw new Error('定时器可能自我循环');
        const [id, job] = due[0];
        pending.delete(id);
        t = job.at;
        job.fn();
      }
      t = target;
    },
    pendingCount: () => pending.size
  };
}

/** 真实状态机 + 记录所有变化，便于断言 */
function makeBehavior() {
  const changes = [];
  const b = behaviorApi.createBehavior({
    onChange: (info) => changes.push(info.state)
  });
  return { b, changes };
}

console.log('\n[1] 默认配置与开关');
{
  const clock = makeClock();
  const { b } = makeBehavior();
  const d = driver.createBehaviorDriver({
    behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now
  });
  ok('默认不启用（不接入就不改变任何行为）', () => {
    assert.strictEqual(d.isEnabled(), false);
    assert.strictEqual(clock.pendingCount(), 0, '未启用时不应排定定时器');
  });
  ok('默认时长参数符合设计（60s 入睡、20~45s 漫游）', () => {
    const c = d.config();
    assert.strictEqual(c.sleepAfterMs, 60000);
    assert.strictEqual(c.walkMinDelayMs, 20000);
    assert.strictEqual(c.walkMaxDelayMs, 45000);
  });
  ok('enable 后开始排定定时器', () => {
    assert.strictEqual(d.enable(), true);
    assert.ok(clock.pendingCount() >= 1, '应排定下一次检查');
  });
  ok('重复 enable 返回 false 且不重复排定', () => {
    const before = clock.pendingCount();
    assert.strictEqual(d.enable(), false);
    assert.strictEqual(clock.pendingCount(), before, '定时器不应叠加');
  });
  ok('disable 后清掉定时器', () => {
    assert.strictEqual(d.disable(), true);
    assert.strictEqual(clock.pendingCount(), 0);
    assert.strictEqual(d.disable(), false);
  });
}

console.log('\n[2] 长时间空闲 → 入睡');
{
  const clock = makeClock();
  const { b, changes } = makeBehavior();
  const d = driver.createBehaviorDriver({
    behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
    random: () => 0
  });
  d.enable();
  ok('空闲 59 秒还没睡', () => {
    clock.advance(59000);
    assert.notStrictEqual(b.get(), 'sleep', '实际 ' + b.get());
  });
  ok('空闲超过 60 秒后入睡', () => {
    clock.advance(2000);
    assert.strictEqual(b.get(), 'sleep');
    assert.ok(changes.includes('sleep'));
  });
  ok('睡后不再排定定时器（等用户唤醒，不做无谓轮询）', () => {
    assert.strictEqual(clock.pendingCount(), 0);
  });
}

console.log('\n[3] 用户活动唤醒并重置计时');
{
  const clock = makeClock();
  const { b } = makeBehavior();
  const d = driver.createBehaviorDriver({
    behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
    random: () => 0
  });
  d.enable();
  clock.advance(61000);
  ok('前提：已入睡', () => assert.strictEqual(b.get(), 'sleep'));
  ok('notifyActivity 把桌宠唤醒', () => {
    d.notifyActivity('user');
    assert.strictEqual(b.get(), 'idle');
    assert.ok(clock.pendingCount() >= 1, '唤醒后应重新排定');
  });
  ok('唤醒后空闲计时被重置（不会立刻又睡）', () => {
    clock.advance(30000);
    assert.strictEqual(b.get(), 'idle', '刚醒 30 秒不应再睡，实际 ' + b.get());
  });
}

console.log('\n[4] 随机漫游 → walk → 自动收回 idle');
{
  const clock = makeClock();
  const { b, changes } = makeBehavior();
  // random 固定为 0 → 漫游目标 = walkMinDelayMs = 20s
  const d = driver.createBehaviorDriver({
    behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
    random: () => 0,
    walkMinDelayMs: 20000, walkMaxDelayMs: 45000, walkDurationMs: 4000
  });
  d.enable();
  ok('空闲 19 秒还在 idle（未到漫游间隔）', () => {
    clock.advance(19000);
    assert.strictEqual(b.get(), 'idle');
  });
  ok('到达漫游间隔后进入 walk', () => {
    clock.advance(1500);
    assert.strictEqual(b.get(), 'walk');
    assert.ok(changes.includes('walk'));
  });
  ok('漫游持续 4 秒后自动收回 idle', () => {
    clock.advance(4000);
    assert.strictEqual(b.get(), 'idle', '实际 ' + b.get());
  });
  ok('收回后继续排定下一次检查（行为是循环的）', () => {
    assert.ok(clock.pendingCount() >= 1);
  });
}

console.log('\n[5] 绝不抢占用户操作');
{
  const cases = ['drag', 'snap', 'interact'];
  for (const userState of cases) {
    const clock = makeClock();
    const { b } = makeBehavior();
    const d = driver.createBehaviorDriver({
      behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
      random: () => 0
    });
    d.enable();
    b.set(userState);
    clock.advance(120000); // 远超入睡与漫游阈值
    ok('用户处于 ' + userState + ' 时自主行为让路（状态不被改）', () => {
      assert.strictEqual(b.get(), userState, '被改成了 ' + b.get());
    });
  }
}

console.log('\n[6] celebrate：外部事件触发并收回');
{
  const clock = makeClock();
  const { b, changes } = makeBehavior();
  const d = driver.createBehaviorDriver({
    behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
    random: () => 0, celebrateDurationMs: 1500
  });
  ok('未启用时 celebrate 不生效', () => {
    assert.strictEqual(d.celebrate('upload'), false);
    assert.strictEqual(b.get(), 'idle');
  });
  d.enable();
  ok('启用后 celebrate 切到庆祝状态', () => {
    assert.strictEqual(d.celebrate('upload-ok'), true);
    assert.strictEqual(b.get(), 'celebrate');
    assert.ok(changes.includes('celebrate'));
  });
  ok('庆祝时长结束后收回 idle', () => {
    clock.advance(1500);
    assert.strictEqual(b.get(), 'idle', '实际 ' + b.get());
  });
  ok('庆祝期间不会被打断成 walk', () => {
    d.celebrate('again');
    clock.advance(500);
    assert.strictEqual(b.get(), 'celebrate');
  });
}

console.log('\n[7] 与真实状态表的优先级配合');
{
  const clock = makeClock();
  const { b } = makeBehavior();
  const d = driver.createBehaviorDriver({
    behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
    random: () => 0, sleepAfterMs: 1000, walkMinDelayMs: 100, walkMaxDelayMs: 100
  });
  d.enable();
  // 先让它走起来，然后在 walk 期间用户开始拖 → drag 优先级 100 应能打断
  clock.advance(150);
  const during = b.get();
  b.set('drag');
  ok('walk 进行中用户拖动可以打断（drag 优先级最高）', () => {
    assert.strictEqual(b.get(), 'drag');
    assert.ok(['walk', 'idle'].includes(during), '漫游期间状态应为 walk/idle，实际 ' + during);
  });
  ok('拖动期间自主行为不抢回', () => {
    clock.advance(5000);
    assert.strictEqual(b.get(), 'drag');
  });
}

console.log('\n[8] 稳健性');
{
  const clock = makeClock();
  const { b } = makeBehavior();
  ok('behavior 缺失时所有方法都不抛错', () => {
    const d = driver.createBehaviorDriver({
      behavior: null, schedule: clock.schedule, cancel: clock.cancel, now: clock.now
    });
    assert.doesNotThrow(() => {
      d.enable(); d.notifyActivity(); d.celebrate(); d.disable(); d._wake();
    });
    assert.strictEqual(d.celebrate(), false);
  });
  ok('订阅者抛错不影响驱动', () => {
    const d = driver.createBehaviorDriver({
      behavior: b, schedule: clock.schedule, cancel: clock.cancel, now: clock.now,
      random: () => 0, onStateChange: () => { throw new Error('boom'); }
    });
    d.enable();
    assert.doesNotThrow(() => clock.advance(100));
  });
  ok('定时器不叠加：连续多次唤醒后排定数不增长', () => {
    const c2 = makeClock();
    const { b: b2 } = makeBehavior();
    const d2 = driver.createBehaviorDriver({
      behavior: b2, schedule: c2.schedule, cancel: c2.cancel, now: c2.now, random: () => 0
    });
    d2.enable();
    for (let i = 0; i < 20; i++) d2.notifyActivity();
    assert.ok(c2.pendingCount() <= 1, '排定了 ' + c2.pendingCount() + ' 个定时器（应 ≤1）');
  });
  ok('cancel 抛错时不崩', () => {
    const c3 = makeClock();
    const { b: b3 } = makeBehavior();
    const d3 = driver.createBehaviorDriver({
      behavior: b3, schedule: c3.schedule, cancel: () => { throw new Error('bad cancel'); },
      now: c3.now, random: () => 0
    });
    d3.enable();
    assert.doesNotThrow(() => d3.disable());
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
