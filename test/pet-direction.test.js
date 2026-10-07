/* 自检：动画方向变体 renderer/pet/direction.js（阶段 8.7）
   ------------------------------------------------------------
   需求：拖拽分上下左右、走路分左右、贴边按边选姿势。

   重点守住「回退链」：方向变体 → 不带方向的同名 clip → 静帧兜底。
   这条链决定了**旧皮肤包能不能继续用** —— 只声明 drag 的包在
   任意拖动方向下都必须正常播，而不是报"未知状态名"或播不出来。

   以及方向判定：取主轴、阈值、上/下与 top/bottom 的别名等价。 */

const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const dir = require(path.join(root, 'renderer', 'pet', 'direction.js'));
const frames = require(path.join(root, 'renderer', 'pet', 'frames.js'));
const behavior = require(path.join(root, 'renderer', 'pet', 'behavior.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const clip = (framesArr, fps) => ({ frames: framesArr, fps: fps || 8 });

console.log('\n[1] 方向名归一化：up/top、down/bottom 等价');
{
  ok('up 与 top 归一化到同一变体', () => {
    assert.strictEqual(dir.normalizeDirection('up'), 'up');
    assert.strictEqual(dir.normalizeDirection('top'), 'up');
    assert.strictEqual(dir.variantName('snap', 'top'), 'snap-up');
    assert.strictEqual(dir.variantName('snap', 'up'), 'snap-up');
  });
  ok('down 与 bottom 归一化到同一变体', () => {
    assert.strictEqual(dir.normalizeDirection('bottom'), 'down');
    assert.strictEqual(dir.variantName('snap', 'bottom'), 'snap-down');
  });
  ok('大小写与空白容错', () => {
    assert.strictEqual(dir.normalizeDirection('  LEFT '), 'left');
    assert.strictEqual(dir.normalizeDirection('Down'), 'down');
  });
  ok('非法方向返回 null；不带方向时变体名就是状态名', () => {
    ['', '  ', 'nope', null, undefined, 42].forEach((bad) => {
      assert.strictEqual(dir.normalizeDirection(bad), null, JSON.stringify(bad));
    });
    assert.strictEqual(dir.variantName('drag', null), 'drag');
    assert.strictEqual(dir.variantName('drag', 'nope'), 'drag');
  });
}

console.log('\n[2] 回退链：方向变体 → 基础 clip → null（静帧兜底）');
{
  const withVariants = {
    drag: clip([0]),
    'drag-up': clip([10, 11]),
    'drag-left': clip([20, 21])
  };
  ok('有方向变体时优先用它', () => {
    assert.strictEqual(dir.pickClipName(withVariants, 'drag', 'up'), 'drag-up');
    assert.strictEqual(dir.pickClipName(withVariants, 'drag', 'left'), 'drag-left');
  });
  ok('没有该方向的变体时回退到基础 clip', () => {
    assert.strictEqual(dir.pickClipName(withVariants, 'drag', 'down'), 'drag');
    assert.strictEqual(dir.pickClipName(withVariants, 'drag', 'right'), 'drag');
  });
  ok('没有方向时直接用基础 clip', () => {
    assert.strictEqual(dir.pickClipName(withVariants, 'drag', null), 'drag');
  });
  ok('基础 clip 也没有时返回 null（交由静帧兜底）', () => {
    assert.strictEqual(dir.pickClipName(withVariants, 'walk', 'left'), null);
  });
  ok('空帧序列的变体视为不可用（继续回退）', () => {
    const c = { drag: clip([0]), 'drag-up': { frames: [] } };
    assert.strictEqual(dir.pickClipName(c, 'drag', 'up'), 'drag');
  });
  ok('非法 clips 输入不抛错', () => {
    [null, undefined, {}, 'x'].forEach((bad) => {
      assert.doesNotThrow(() => dir.pickClipName(bad, 'drag', 'up'));
    });
  });
}

console.log('\n[3] 旧皮肤包兼容：只有基础 clip 也要能播任意方向');
{
  // 这是最关键的一条 —— 旧包只声明 drag/walk/snap
  const legacy = { idle: clip([0, 1]), walk: clip([2, 3]), drag: clip([4]), snap: clip([5]) };
  ok('四个拖动方向都能落到 drag', () => {
    ['up', 'down', 'left', 'right'].forEach((d) => {
      assert.strictEqual(dir.pickClipName(legacy, 'drag', d), 'drag', d);
    });
  });
  ok('左右走路都能落到 walk', () => {
    ['left', 'right'].forEach((d) => {
      assert.strictEqual(dir.pickClipName(legacy, 'walk', d), 'walk', d);
    });
  });
  ok('四个贴边方向都能落到 snap', () => {
    ['top', 'bottom', 'left', 'right'].forEach((d) => {
      assert.strictEqual(dir.pickClipName(legacy, 'snap', d), 'snap', d);
    });
  });
  ok('applyDirections 后仍是完整可播放的一组 clips', () => {
    const applied = dir.applyDirections(legacy, { drag: 'up', walk: 'left', snap: 'top' });
    const merged = frames.resolveClips(behavior.STATES, applied);
    Object.keys(behavior.STATES).forEach((n) => {
      assert.ok(merged[n] && merged[n].frames.length > 0, n + ' 不可播');
    });
    assert.deepStrictEqual(merged.drag.frames, [4], 'drag 应取基础 clip');
  });
}

console.log('\n[4] applyDirections：按方向重写成「状态名 → 帧」');
{
  const clips = {
    idle: clip([0]),
    walk: clip([1]),
    'walk-left': clip([10, 11]),
    'walk-right': clip([20, 21]),
    drag: clip([2]),
    'drag-up': clip([30])
  };
  ok('选了方向就取变体', () => {
    const a = dir.applyDirections(clips, { walk: 'left' });
    assert.deepStrictEqual(a.walk.frames, [10, 11]);
  });
  ok('方向不同结果不同', () => {
    assert.deepStrictEqual(dir.applyDirections(clips, { walk: 'right' }).walk.frames, [20, 21]);
  });
  ok('未指定方向的状态保持基础 clip', () => {
    const a = dir.applyDirections(clips, { walk: 'left' });
    assert.deepStrictEqual(a.idle.frames, [0]);
    assert.deepStrictEqual(a.drag.frames, [2]);
  });
  ok('结果里不残留方向变体名（否则会被当成未知状态）', () => {
    const a = dir.applyDirections(clips, { walk: 'left', drag: 'up' });
    Object.keys(a).forEach((k) => {
      assert.ok(!/-up$|-down$|-left$|-right$/.test(k), '残留变体名: ' + k);
    });
  });
  ok('变体存在但没选方向时，基础 clip 仍可用', () => {
    const a = dir.applyDirections(clips, {});
    assert.deepStrictEqual(a.walk.frames, [1]);
  });
  ok('空输入安全', () => {
    assert.deepStrictEqual(dir.applyDirections(null, null), {});
    assert.deepStrictEqual(dir.applyDirections({}, {}), {});
  });
  ok('方向变体缺基础 clip 时也能用（皮肤只画了方向版）', () => {
    const only = { 'walk-left': clip([7, 8]), 'walk-right': clip([9]) };
    const a = dir.applyDirections(only, { walk: 'left' });
    assert.deepStrictEqual(a.walk.frames, [7, 8]);
  });
}

console.log('\n[5] directionFromDelta：位移 → 方向');
{
  ok('水平为主 → left/right', () => {
    assert.strictEqual(dir.directionFromDelta(-20, 3), 'left');
    assert.strictEqual(dir.directionFromDelta(20, 3), 'right');
  });
  ok('竖直为主 → up/down', () => {
    assert.strictEqual(dir.directionFromDelta(3, -20), 'up');
    assert.strictEqual(dir.directionFromDelta(3, 20), 'down');
  });
  ok('两者相等时算竖直（拖起来更常见）', () => {
    assert.strictEqual(dir.directionFromDelta(10, 10), 'down');
    assert.strictEqual(dir.directionFromDelta(10, -10), 'up');
  });
  ok('位移过小视为未移动 → 返回 fallback', () => {
    assert.strictEqual(dir.directionFromDelta(1, 1), null);
    assert.strictEqual(dir.directionFromDelta(1, 1, 3, 'left'), 'left');
    assert.strictEqual(dir.directionFromDelta(0, 0), null);
  });
  ok('阈值可调', () => {
    assert.strictEqual(dir.directionFromDelta(5, 0, 10), null);
    assert.strictEqual(dir.directionFromDelta(5, 0, 1), 'right');
  });
  ok('非法输入不抛错', () => {
    [null, undefined, NaN, 'x'].forEach((bad) => {
      assert.doesNotThrow(() => dir.directionFromDelta(bad, bad));
    });
    assert.strictEqual(dir.directionFromDelta(NaN, NaN), null);
  });
}

console.log('\n[6] 与 frames.js 的衔接（端到端）');
{
  const clips = {
    idle: clip([0, 1]),
    walk: clip([2]),
    'walk-left': clip([10, 11], 5),
    'walk-right': clip([20, 21], 5),
    drag: clip([3]),
    'drag-up': clip([30], 1)
  };
  ok('按方向重写后再交给 resolveClips，取到的是方向帧', () => {
    const applied = dir.applyDirections(clips, { walk: 'left', drag: 'up' });
    const merged = frames.resolveClips(behavior.STATES, applied);
    assert.deepStrictEqual(merged.walk.frames, [10, 11]);
    assert.deepStrictEqual(merged.drag.frames, [30]);
    assert.strictEqual(merged.walk.fps, 5, '方向变体的 fps 应一并生效');
  });
  ok('状态数不变（方向没有扩成新状态）', () => {
    const applied = dir.applyDirections(clips, { walk: 'left' });
    const merged = frames.resolveClips(behavior.STATES, applied);
    assert.strictEqual(Object.keys(merged).length, Object.keys(behavior.STATES).length);
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
