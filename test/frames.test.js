/* 自检：桌宠动画帧播放器 renderer/pet/frames.js（阶段 8.6）
   ------------------------------------------------------------
   规范见 docs/PET_SPEC.md §5。本模块是「状态机」与「皮肤画面」之间的桥：
   状态机决定播哪个动作，皮肤决定该动作的帧序列，这里负责按时间推进帧号。

   重点守住的三条契约：
   1. **loop / duration 一律以状态表为准**，皮肤不能改 ——
      否则皮肤能把一次性状态（celebrate/interact）改成循环，
      状态机就永远回落不到 idle，桌宠会卡在庆祝动作上。
   2. 一次性状态播完**停在最后一帧**，不回到第 0 帧（避免视觉跳变）。
   3. 皮肤没声明的状态也要有画面（静帧），不能出现"这个状态没东西可画"。

   纯逻辑（帧推进 / 帧矩形）与 DOM 绘制分开，因此这里不需要浏览器。 */

const path = require('path');
const assert = require('assert');

const frames = require(path.join(__dirname, '..', 'renderer', 'pet', 'frames.js'));
const behavior = require(path.join(__dirname, '..', 'renderer', 'pet', 'behavior.js'));
const STATES = behavior.STATES;

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] resolveClips：皮肤只覆盖 frames/fps，语义仍归状态表');
{
  const clips = frames.resolveClips(STATES, {
    idle: { frames: [0, 1, 2, 1], fps: 6 },
    walk: { frames: [3, 4, 5, 4], fps: 10 },
    interact: { frames: [6, 7], fps: 12 }
  });
  ok('皮肤声明的 frames 被采用', () => {
    assert.deepStrictEqual(clips.idle.frames, [0, 1, 2, 1]);
    assert.strictEqual(clips.idle.fps, 6);
  });
  ok('每个状态都有 clip（未声明的用静帧兜底）', () => {
    Object.keys(STATES).forEach((name) => {
      assert.ok(clips[name], name + ' 缺少 clip');
      assert.ok(clips[name].frames.length > 0, name + ' 帧序列为空');
    });
  });
  ok('未声明的状态取状态表的 loop', () => {
    assert.strictEqual(clips.sleep.loop, true);
    assert.strictEqual(clips.celebrate.loop, false);
  });
  ok('皮肤试图把一次性状态改成 loop:true 会被状态表否决', () => {
    const c = frames.resolveClips(STATES, { celebrate: { frames: [0, 1], loop: true } });
    assert.strictEqual(c.celebrate.loop, false, 'loop 不应被皮肤覆盖');
    assert.strictEqual(c.celebrate.duration, STATES.celebrate.duration);
  });
  ok('皮肤试图改 duration 也被否决', () => {
    const c = frames.resolveClips(STATES, { interact: { frames: [0], duration: 999999 } });
    assert.strictEqual(c.interact.duration, STATES.interact.duration);
  });
  ok('非法 frames 被忽略并回落到静帧', () => {
    const bad = [
      { frames: [] },
      { frames: 'nope' },
      { frames: [-1, -2] },
      { frames: [1.5] },
      { frames: null }
    ];
    bad.forEach((b) => {
      const c = frames.resolveClips(STATES, { idle: b });
      assert.ok(c.idle.frames.length > 0, JSON.stringify(b) + ' 应回落到静帧');
      assert.ok(c.idle.frames.every((f) => Number.isInteger(f) && f >= 0));
    });
  });
  ok('非法 fps 回落到默认 8', () => {
    [0, -5, NaN, Infinity, 'x', null].forEach((f) => {
      const c = frames.resolveClips(STATES, { idle: { frames: [0], fps: f } });
      assert.strictEqual(c.idle.fps, 8, 'fps=' + f + ' 应回落');
    });
  });
  ok('clips 为空/undefined 也能产出完整 clip 表', () => {
    [undefined, null, {}].forEach((c) => {
      const r = frames.resolveClips(STATES, c);
      assert.strictEqual(Object.keys(r).length, Object.keys(STATES).length);
    });
  });
  ok('fallbackFrameCount 可指定静帧数量', () => {
    const r = frames.resolveClips(STATES, {}, 3);
    assert.deepStrictEqual(r.idle.frames, [0, 1, 2]);
  });
}

console.log('\n[2] frameIndexAt：按时间推进');
{
  const loopClip = { frames: [0, 1, 2, 3], fps: 10, loop: true };
  ok('t=0 为第 0 帧', () => assert.strictEqual(frames.frameIndexAt(loopClip, 0), 0));
  ok('每 100ms 前进一帧（fps=10）', () => {
    assert.strictEqual(frames.frameIndexAt(loopClip, 100), 1);
    assert.strictEqual(frames.frameIndexAt(loopClip, 200), 2);
    assert.strictEqual(frames.frameIndexAt(loopClip, 299), 2);
    assert.strictEqual(frames.frameIndexAt(loopClip, 300), 3);
  });
  ok('循环 clip 到末尾后回到 0', () => {
    assert.strictEqual(frames.frameIndexAt(loopClip, 400), 0);
    assert.strictEqual(frames.frameIndexAt(loopClip, 450), 0);
    assert.strictEqual(frames.frameIndexAt(loopClip, 500), 1);
  });
  ok('非循环 clip 停在最后一帧（不回第 0 帧）', () => {
    const once = { frames: [5, 6, 7], fps: 10, loop: false };
    assert.strictEqual(frames.frameIndexAt(once, 0), 0);
    assert.strictEqual(frames.frameIndexAt(once, 200), 2);
    // 远超总时长后仍应停在最后一帧，否则会视觉跳变
    assert.strictEqual(frames.frameIndexAt(once, 99999), 2);
  });
  ok('负数/非法时间按 0 处理', () => {
    [-1, NaN, undefined, null, 'x'].forEach((t) => {
      assert.strictEqual(frames.frameIndexAt(loopClip, t), 0, 't=' + t);
    });
  });
  ok('空 frames 返回 -1', () => {
    assert.strictEqual(frames.frameIndexAt({ frames: [], fps: 8, loop: true }, 1000), -1);
    assert.strictEqual(frames.frameIndexAt(null, 1000), -1);
  });
  ok('fps 非法时用默认值而不是卡在第 0 帧', () => {
    const c = { frames: [0, 1, 2], fps: 0, loop: true };
    assert.strictEqual(frames.frameIndexAt(c, 125), 1); // 默认 8fps → 125ms 为第 1 帧
  });
}

console.log('\n[3] isFinished：一次性状态的回落判定');
{
  ok('循环 clip 永不结束', () => {
    assert.strictEqual(frames.isFinished({ frames: [0], fps: 8, loop: true }, 0, 1e9), false);
  });
  ok('有 duration 时按 duration 判定', () => {
    const c = { frames: [0, 1], fps: 8, loop: false, duration: 600 };
    assert.strictEqual(frames.isFinished(c, 1000, 1500), false);
    assert.strictEqual(frames.isFinished(c, 1000, 1600), true);
    assert.strictEqual(frames.isFinished(c, 1000, 2000), true);
  });
  ok('无 duration 时按帧放完判定', () => {
    const c = { frames: [0, 1, 2, 3], fps: 10, loop: false, duration: null };
    // 4 帧 @10fps = 400ms
    assert.strictEqual(frames.isFinished(c, 0, 399), false);
    assert.strictEqual(frames.isFinished(c, 0, 400), true);
  });
  ok('状态表的 celebrate(1200ms) 会真正结束', () => {
    const c = frames.resolveClips(STATES, { celebrate: { frames: [0, 1], fps: 20 } }).celebrate;
    assert.strictEqual(frames.isFinished(c, 0, 1199), false);
    assert.strictEqual(frames.isFinished(c, 0, 1200), true);
  });
}

console.log('\n[4] frameRect / columnsOf：图集寻址');
{
  const atlas = { frameWidth: 64, frameHeight: 64 };
  ok('单行排列时按序号横排', () => {
    assert.deepStrictEqual(frames.frameRect(atlas, 0), { x: 0, y: 0, width: 64, height: 64 });
    assert.deepStrictEqual(frames.frameRect(atlas, 3), { x: 192, y: 0, width: 64, height: 64 });
  });
  ok('给定列数时换行', () => {
    assert.deepStrictEqual(frames.frameRect(atlas, 4, 4), { x: 0, y: 64, width: 64, height: 64 });
    assert.deepStrictEqual(frames.frameRect(atlas, 6, 4), { x: 128, y: 64, width: 64, height: 64 });
  });
  ok('非法输入返回 null（调用方据此跳过绘制）', () => {
    assert.strictEqual(frames.frameRect(null, 0), null);
    assert.strictEqual(frames.frameRect({ frameWidth: 0, frameHeight: 64 }, 0), null);
    assert.strictEqual(frames.frameRect(atlas, -1), null);
    assert.strictEqual(frames.frameRect(atlas, 1.5), null);
  });
  ok('columnsOf 由图集宽度推算列数', () => {
    assert.strictEqual(frames.columnsOf(atlas, 256), 4);
    assert.strictEqual(frames.columnsOf(atlas, 64), 1);
    assert.strictEqual(frames.columnsOf(atlas, 0), 1);
    assert.strictEqual(frames.columnsOf(null, 100), 1);
  });
}

console.log('\n[5] createFramePlayer：状态切换与帧号');
{
  const clips = frames.resolveClips(STATES, {
    idle: { frames: [0, 1], fps: 10 },
    walk: { frames: [3, 4, 5], fps: 10 },
    interact: { frames: [7, 8], fps: 10 }
  });
  const p = frames.createFramePlayer({ clips, initialState: 'idle' });
  ok('初始状态生效', () => assert.strictEqual(p.current(), 'idle'));
  ok('按时间取到图集帧号（不是下标）', () => {
    assert.strictEqual(p.frameAt(0), 0);
    assert.strictEqual(p.frameAt(100), 1);
    assert.strictEqual(p.frameAt(200), 0); // 循环
  });
  ok('切状态后从该状态的第 0 帧开始', () => {
    assert.strictEqual(p.setState('walk', 1000), true);
    assert.strictEqual(p.current(), 'walk');
    assert.strictEqual(p.frameAt(1000), 3); // walk 的第 0 帧是图集第 3 帧
    assert.strictEqual(p.frameAt(1100), 4);
  });
  ok('重复设置同一状态返回 false 且不重置进度', () => {
    p.setState('walk', 1000);
    assert.strictEqual(p.setState('walk', 5000), false);
    assert.strictEqual(p.frameAt(1100), 4, '进度被重置了');
  });
  ok('未知状态被拒绝', () => {
    assert.strictEqual(p.setState('nope', 0), false);
    assert.strictEqual(p.current(), 'walk');
  });
  ok('elapsedAt 不返回负数', () => {
    p.setState('idle', 5000);
    assert.strictEqual(p.elapsedAt(4000), 0);
    assert.strictEqual(p.elapsedAt(5300), 300);
  });
  ok('finishedAt 对一次性状态给出正确结果', () => {
    p.setState('interact', 0);
    // interact 在状态表里 loop:false, duration:600
    assert.strictEqual(p.finishedAt(599), false);
    assert.strictEqual(p.finishedAt(600), true);
  });
  ok('interact 播完后停在最后一帧', () => {
    p.setState('interact', 0);
    assert.strictEqual(p.frameAt(10000), 8); // 最后一帧（图集帧号 8）
  });
  ok('无 clip 可用时 frameAt 返回 -1', () => {
    const empty = frames.createFramePlayer({ clips: {} });
    assert.strictEqual(empty.frameAt(0), -1);
    assert.strictEqual(empty.setState('idle', 0), false);
  });
}

console.log('\n[6] 与皮肤校验的衔接（clips 来自 validatePetSkin）');
{
  const skin = require(path.join(__dirname, '..', 'renderer', 'pet', 'skin.js'));
  const res = skin.validatePetSkin({
    format: 'pet', version: 1, id: 's', name: 'S',
    render: { kind: 'sprite', atlas: { file: 'atlas.png', frameWidth: 64, frameHeight: 64 } },
    clips: { idle: { frames: [0, 1, 2], fps: 8 }, bogus: { frames: [0] } }
  }, { states: skin.FALLBACK_STATES });
  ok('sprite 皮肤校验通过', () => assert.strictEqual(res.ok, true, res.errors.join('；')));
  ok('未知状态名被剔除（不会进入 clips）', () => {
    assert.strictEqual(res.skin.clips.bogus, undefined);
  });
  ok('校验产物可直接喂给 resolveClips 并产出完整 clip 表', () => {
    const clips = frames.resolveClips(STATES, res.skin.clips);
    Object.keys(STATES).forEach((n) => assert.ok(clips[n], n + ' 缺失'));
    assert.deepStrictEqual(clips.idle.frames, [0, 1, 2]);
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
