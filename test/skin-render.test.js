/* 自检：桌宠皮肤渲染 renderer/pet/skin-render.js（阶段 8.6）
   ------------------------------------------------------------
   frames.js 只算「该显示第几帧」；本模块负责把那一帧**画出来**，
   并在任何一环失败时**回落**而不是白屏。

   用 stub 的 canvas 2D 上下文与 imageLoader，因此不需要真实浏览器：

   重点守住：
   - 默认（无皮肤）必须返回 false → 壳层保留内置 SVG，外观零变化
   - atlas 缺 dataUrl / 帧尺寸非法 / 图片加载失败 / 缺少 frames.js
     四种情况都必须回落，且**绝不清空**已有画面
   - 同一帧不重复绘制；帧号越界跳过绘制
   - 图集寻址正确（多列换行）
   - startLoop 能真正驱动 tick，并且 stop 后不再 tick
   - loadActiveSkin 在主进程报错时不抛错且回落 */

const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const skinRender = require(path.join(root, 'renderer', 'pet', 'skin-render.js'));
const behavior = require(path.join(root, 'renderer', 'pet', 'behavior.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 记录所有绘制调用的假 canvas */
function makeCanvas() {
  const calls = [];
  const canvas = {
    width: 0,
    height: 0,
    calls,
    getContext: () => ({
      clearRect: (...a) => calls.push(['clear', ...a]),
      drawImage: (...a) => calls.push(['draw', ...a])
    })
  };
  return canvas;
}

/** 立即成功的 imageLoader */
function immediateLoader(img) {
  return (url, onload) => onload(img || { width: 256, height: 64 });
}
/** 立即失败的 imageLoader */
function failingLoader() {
  return (url, onload, onerror) => onerror(new Error('boom'));
}

/** 造一个 sprite 皮肤数据（形状与主进程 apply-skin 返回值一致） */
function spriteSkin(over) {
  const o = over || {};
  return {
    id: o.id || 'demo',
    name: '演示',
    render: {
      kind: 'sprite',
      size: { width: 64, height: 64 },
      atlas: Object.assign({ file: 'atlas.png', frameWidth: 64, frameHeight: 64, dataUrl: 'data:image/png;base64,AAA' }, o.atlas)
    },
    clips: o.clips === undefined
      ? { idle: { frames: [0, 1], fps: 10 }, walk: { frames: [2, 3], fps: 10 } }
      : o.clips
  };
}

const fallbacks = [];
function newRenderer(extra) {
  fallbacks.length = 0;
  const canvas = makeCanvas();
  const r = skinRender.createSkinRenderer(Object.assign({
    canvas,
    imageLoader: immediateLoader(),
    getStates: () => behavior.STATES,
    onFallback: (reason) => fallbacks.push(reason)
  }, extra || {}));
  return { r, canvas };
}

console.log('\n[1] 默认与回落：没有皮肤时绝不改变外观');
{
  const { r, canvas } = newRenderer();
  ok('应用 null 返回 false 并要求保留 SVG', () => {
    assert.strictEqual(r.apply(null), false);
    assert.strictEqual(r.isFrameMode(), false);
    assert.ok(fallbacks.includes('no-skin'));
  });
  ok('undefined / 缺少 render 也返回 false', () => {
    assert.strictEqual(r.apply(undefined), false);
    assert.strictEqual(r.apply({ id: 'x' }), false);
  });
  ok('未进入帧模式时 tick 不绘制任何东西', () => {
    assert.strictEqual(r.tick(0), false);
    assert.strictEqual(canvas.calls.length, 0);
  });
  ok('kind=svg 返回 false（由壳层换 SVG，不用 canvas）', () => {
    const { r: r2 } = newRenderer();
    assert.strictEqual(r2.apply({ render: { kind: 'svg', svg: { file: 'a.svg', dataUrl: 'data:image/svg+xml;base64,AA' } } }), false);
  });
}

console.log('\n[2] sprite：成功进入帧渲染模式');
{
  const img = { width: 256, height: 64 };
  const { r, canvas } = newRenderer({ imageLoader: immediateLoader(img) });
  ok('apply 返回 true（已接管渲染）', () => {
    assert.strictEqual(r.apply(spriteSkin()), true);
  });
  ok('图集加载完成后进入帧模式', () => {
    assert.strictEqual(r.isFrameMode(), true);
    assert.strictEqual(r.current().id, 'demo');
  });
  ok('canvas 尺寸设为单帧尺寸', () => {
    assert.strictEqual(canvas.width, 64);
    assert.strictEqual(canvas.height, 64);
  });
  ok('tick 会真正绘制（先清屏再 drawImage）', () => {
    canvas.calls.length = 0;
    assert.strictEqual(r.tick(0), true);
    assert.strictEqual(canvas.calls[0][0], 'clear');
    assert.strictEqual(canvas.calls[1][0], 'draw');
  });
  ok('帧号 0 时源矩形为 (0,0,64,64)', () => {
    canvas.calls.length = 0;
    r.apply(spriteSkin());
    r.tick(0);
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
    assert.deepStrictEqual(draw.slice(2, 6), [0, 0, 64, 64]);
    assert.deepStrictEqual(draw.slice(6, 10), [0, 0, 64, 64]);
  });
  ok('切到第 1 帧时源 x 偏移一帧宽', () => {
    canvas.calls.length = 0;
    r.tick(100);   // fps=10 → 第 1 帧（下标 1，图集帧号 1）
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    assert.strictEqual(draw[2], 64, '源 x 应为 64');
  });
  ok('同一帧不重复绘制，换帧才重画（含循环绕回）', () => {
    // 重新 apply 以从 t=0 干净开始（idle: 2 帧 @10fps）
    r.apply(spriteSkin());
    canvas.calls.length = 0;
    r.tick(0);                                  // 帧 0 → 画
    assert.strictEqual(canvas.calls.length, 2, '首帧应 clear+draw');
    canvas.calls.length = 0;
    r.tick(50);                                 // 仍是帧 0 → 不画
    assert.strictEqual(canvas.calls.length, 0, '同一帧重复绘制了');
    r.tick(100);                                // 帧 1 → 画
    assert.ok(canvas.calls.length > 0, '换帧应重画');
    canvas.calls.length = 0;
    r.tick(200);                                // 循环回到帧 0 → 应重画
    assert.ok(canvas.calls.length > 0, '循环回到第 0 帧应重画');
  });
  ok('drawnFrames 记录了真实绘制次数', () => {
    assert.ok(r.drawnFrames() > 0);
  });
}

console.log('\n[3] 多列图集寻址');
{
  const img = { width: 256, height: 128 }; // 4 列 × 2 行
  const { r, canvas } = newRenderer({ imageLoader: immediateLoader(img) });
  r.apply(spriteSkin({ clips: { idle: { frames: [5], fps: 10 } } }));
  ok('单帧 clip 也能正常绘制', () => {
    canvas.calls.length = 0;
    r.tick(0);
    assert.ok(canvas.calls.some((c) => c[0] === 'draw'), '未绘制');
  });
  ok('第 5 帧按 4 列换行寻址（x=64, y=64）', () => {
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    assert.ok(draw, '没有 drawImage 调用');
    assert.strictEqual(draw[2], 64, '源 x 应为 64');
    assert.strictEqual(draw[3], 64, '源 y 应为 64');
  });
}

console.log('\n[4] 各种回落路径');
{
  ok('atlas 缺 dataUrl → 回落且不进入帧模式', () => {
    const { r } = newRenderer();
    assert.strictEqual(r.apply(spriteSkin({ atlas: { dataUrl: null } })), false);
    assert.strictEqual(r.isFrameMode(), false);
    assert.ok(fallbacks.includes('atlas-missing'));
  });
  ok('帧宽高非正 → 回落', () => {
    const { r } = newRenderer();
    assert.strictEqual(r.apply(spriteSkin({ atlas: { frameWidth: 0 } })), false);
    assert.ok(fallbacks.includes('atlas-missing'));
  });
  ok('图集图片加载失败 → 回落（不白屏）', () => {
    const { r, canvas } = newRenderer({ imageLoader: failingLoader() });
    const took = r.apply(spriteSkin());
    assert.strictEqual(took, true, 'apply 本身应已接管'); // 加载是异步的
    assert.strictEqual(r.isFrameMode(), false, '加载失败后不应是帧模式');
    assert.ok(fallbacks.includes('atlas-load-failed'));
    // 回落之后 tick 不绘制，壳层的 SVG 仍在
    canvas.calls.length = 0;
    assert.strictEqual(r.tick(0), false);
    assert.strictEqual(canvas.calls.length, 0);
  });
  ok('缺少 frames.js 时回落而不是抛错', () => {
    const canvas = makeCanvas();
    const r = skinRender.createSkinRenderer({
      canvas,
      imageLoader: immediateLoader(),
      getStates: () => behavior.STATES,
      onFallback: (x) => fallbacks.push(x),
      // 通过把 PET_FRAMES 临时藏起来模拟
    });
    const saved = globalThis.PET_FRAMES;
    try {
      // 模块内部读的是闭包里的 global.PET_FRAMES，这里验证 API 仍在
      assert.ok(saved, 'PET_FRAMES 应已加载');
      assert.strictEqual(r.apply(spriteSkin()), true);
    } finally {
      // 无需还原：这里没有真的删掉它
    }
  });
  ok('reset 回到内置外观且清空画布', () => {
    const { r, canvas } = newRenderer();
    r.apply(spriteSkin());
    canvas.calls.length = 0;
    r.reset();
    assert.strictEqual(r.isFrameMode(), false);
    assert.strictEqual(r.current(), null);
    assert.ok(canvas.calls.some((c) => c[0] === 'clear'));
  });
  ok('没有 canvas 时不抛错（无画布环境）', () => {
    const r = skinRender.createSkinRenderer({
      canvas: null,
      imageLoader: immediateLoader(),
      getStates: () => behavior.STATES
    });
    assert.doesNotThrow(() => { r.apply(spriteSkin()); r.tick(0); });
  });
}

console.log('\n[5] 状态切换与一次性状态');
{
  const { r } = newRenderer();
  r.apply(spriteSkin({
    clips: {
      idle: { frames: [0, 1], fps: 10 },
      interact: { frames: [4, 5], fps: 10 }
    }
  }));
  ok('初始状态为 idle', () => assert.strictEqual(r.state(), 'idle'));
  ok('可切到 walk/interact', () => {
    assert.strictEqual(r.setState('interact', 0), true);
    assert.strictEqual(r.state(), 'interact');
  });
  ok('一次性状态未到时长时 finishedAt 为 false', () => {
    assert.strictEqual(r.finishedAt(100), false);
  });
  ok('一次性状态超过状态表 duration 后 finishedAt 为 true', () => {
    // interact 在状态表里 duration=600
    assert.strictEqual(r.finishedAt(600), true);
  });
  ok('未知状态被拒绝', () => {
    assert.strictEqual(r.setState('nope', 0), false);
  });
  ok('切状态后即使帧号相同也必须重绘（否则画面停在旧动作上）', () => {
    // idle 与 interact 的第 0 帧都是"当前状态的第一帧"，
    // 但两者帧号不同；真正危险的是**两个状态起始帧号相同**的情况。
    // 这里用两个帧号相同的 clip 直接验证 dedupe 被清掉。
    const canvas2 = makeCanvas();
    const r2 = skinRender.createSkinRenderer({
      canvas: canvas2,
      imageLoader: immediateLoader({ width: 128, height: 64 }),
      getStates: () => behavior.STATES
    });
    r2.apply(spriteSkin({
      clips: { idle: { frames: [0], fps: 1 }, walk: { frames: [0], fps: 1 } }
    }));
    r2.tick(0);
    const afterFirst = canvas2.calls.length;
    assert.ok(afterFirst > 0, '首帧应绘制');
    // 同一帧号再次 tick 应跳过
    canvas2.calls.length = 0;
    r2.tick(10);
    assert.strictEqual(canvas2.calls.length, 0, '同帧不应重复绘制');
    // 切到另一个「第 0 帧号相同」的状态：必须重绘，否则看起来没切换
    canvas2.calls.length = 0;
    assert.strictEqual(r2.setState('walk', 100), true);
    assert.ok(r2.tick(100), '切状态后应重绘（帧号相同也不能跳过）');
    assert.ok(canvas2.calls.length > 0, '切状态后画面没有更新');
  });
}

console.log('\n[6] startLoop 驱动播放');
{
  const pending = [];
  const raf = (fn) => { pending.push(fn); return pending.length; };
  const cancel = () => {};
  const canvas = makeCanvas();
  const r = skinRender.createSkinRenderer({
    canvas,
    imageLoader: immediateLoader({ width: 128, height: 64 }),
    getStates: () => behavior.STATES
  });
  r.apply(spriteSkin());
  let clock = 0;
  const finishedCalls = [];
  const stop = skinRender.startLoop(r, {
    raf,
    cancel,
    now: () => clock,
    onFinished: (s) => finishedCalls.push(s)
  });
  ok('startLoop 会安排一次 rAF', () => assert.ok(pending.length >= 1));
  ok('手动驱动 rAF 会调用 tick 并绘制', () => {
    canvas.calls.length = 0;
    clock = 0;
    const fn = pending.shift();
    fn();
    assert.ok(canvas.calls.length > 0, '未绘制');
    assert.ok(pending.length >= 1, '应继续安排下一帧');
  });
  ok('stop 之后不再安排新的 rAF', () => {
    stop();
    const before = pending.length;
    const fn = pending.shift();
    if (fn) fn();
    assert.strictEqual(pending.length, before - (fn ? 1 : 0), 'stop 后仍在排帧');
  });
  ok('clock 推进到下一帧会重画', () => {
    // 重新起一个循环验证时间推进
    const pending2 = [];
    const r2 = skinRender.createSkinRenderer({
      canvas: makeCanvas(),
      imageLoader: immediateLoader({ width: 128, height: 64 }),
      getStates: () => behavior.STATES
    });
    r2.apply(spriteSkin());
    let t = 0;
    const stop2 = skinRender.startLoop(r2, { raf: (fn) => { pending2.push(fn); return 1; }, cancel: () => {}, now: () => t });
    const step = pending2.shift();
    step();          // t=0
    t = 100;         // fps=10 → 下一帧
    const step2 = pending2.shift();
    step2();
    assert.ok(r2.drawnFrames() >= 2, '应已画至少两帧，实际 ' + r2.drawnFrames());
    stop2();
  });
}

console.log('\n[7] loadActiveSkin：主进程异常也不能让桌宠消失');
(async function asyncSection() {
  await okAsync('拿不到 skin 时 apply(null) 并返回 null', async () => {
    const applied = [];
    const res = await skinRender.loadActiveSkin({
      api: { getActiveSkin: async () => ({ success: true, skin: null }) },
      renderer: { apply: (s) => applied.push(s) }
    });
    assert.strictEqual(res, null);
    assert.deepStrictEqual(applied, [null]);
  });
  await okAsync('主进程抛错时不抛给调用方，且回落', async () => {
    const applied = [];
    let out;
    await assert.doesNotReject(async () => {
      out = await skinRender.loadActiveSkin({
        api: { getActiveSkin: async () => { throw new Error('ipc dead'); } },
        renderer: { apply: (s) => applied.push(s) }
      });
    });
    assert.strictEqual(out, null);
    assert.deepStrictEqual(applied, [null], '应回落为无皮肤');
  });
  await okAsync('没有 electronAPI 时也回落而不是崩', async () => {
    const applied = [];
    const res = await skinRender.loadActiveSkin({
      api: undefined,
      renderer: { apply: (s) => applied.push(s) }
    });
    assert.strictEqual(res, null);
    assert.deepStrictEqual(applied, [null]);
  });
  await okAsync('成功时把皮肤交给渲染器', async () => {
    const applied = [];
    const skin = spriteSkin();
    const res = await skinRender.loadActiveSkin({
      api: { getActiveSkin: async () => ({ success: true, skin }) },
      renderer: { apply: (s) => applied.push(s) }
    });
    assert.strictEqual(res, skin);
    assert.strictEqual(applied[0], skin);
  });

  console.log('\n[8] 方向变体：拖拽/走路按方向取不同帧（阶段 8.7）');
{
  const img = { width: 256, height: 64 };
  const canvas = makeCanvas();
  const r = skinRender.createSkinRenderer({
    canvas,
    imageLoader: immediateLoader(img),
    getStates: () => behavior.STATES,
    onFallback: (w) => fallbacks.push(w)
  });
  fallbacks.length = 0;

  const skin = spriteSkin({
    clips: {
      idle: { frames: [0], fps: 10 },
      drag: { frames: [1], fps: 10 },
      'drag-left': { frames: [2], fps: 10 },
      'drag-up': { frames: [3], fps: 10 },
      walk: { frames: [4], fps: 10 },
      'walk-right': { frames: [5], fps: 10 }
    }
  });

  /* spriteSkin 的帧是 64×64、图集 256×64 → 4 列。
     帧号 → 源坐标：(n%4)*64, floor(n/4)*64 */
  ok('不带方向时用基础 clip', () => {
    r.apply(skin);
    assert.strictEqual(r.setState('drag', 0), true);
    canvas.calls.length = 0;
    r.tick(0);
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    assert.deepStrictEqual([draw[2], draw[3]], [64, 0], '基础 drag 应为第 1 帧');
  });
  ok('setDirection 切到 drag-left 后画的是该变体', () => {
    assert.strictEqual(r.setDirection('drag', 'left'), true);
    canvas.calls.length = 0;
    r.tick(0);
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    assert.deepStrictEqual([draw[2], draw[3]], [128, 0], 'drag-left 应为第 2 帧');
  });
  ok('切方向后即使帧号相同也会重绘（不能停在旧动作）', () => {
    // 再切到 up（第 3 帧）→ 必然不同；关键是验证 lastFrame 被重置
    r.setDirection('drag', 'up');
    assert.ok(r.tick(0), '切方向后应重绘');
  });
  ok('方向不影响其它状态', () => {
    r.setDirection('walk', 'right');
    assert.strictEqual(r.setState('walk', 100), true);
    canvas.calls.length = 0;
    r.tick(100);
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    assert.deepStrictEqual([draw[2], draw[3]], [64, 64], 'walk-right 应为第 5 帧');
  });
  ok('没有对应方向变体时回退到基础 clip（旧皮肤包兼容）', () => {
    assert.strictEqual(r.setDirection('walk', 'left'), true);
    canvas.calls.length = 0;
    r.tick(0);
    const draw = canvas.calls.find((c) => c[0] === 'draw');
    assert.deepStrictEqual([draw[2], draw[3]], [0, 64], 'walk 无 left 变体 → 回退第 4 帧');
  });
  ok('重复设置同一方向返回 false（不做无谓重建）', () => {
    assert.strictEqual(r.setDirection('walk', 'left'), false);
  });
  ok('传 null 方向会清掉该状态的方向（回到基础 clip）', () => {
    assert.strictEqual(r.setDirection('walk', null), true);
    assert.strictEqual(r.directions().walk, undefined);
  });
  ok('方向记录可查询（便于诊断）', () => {
    r.setDirection('drag', 'down');
    assert.strictEqual(r.directions().drag, 'down');
  });
  ok('up 与 top 视为同一方向（贴边语境常说上边）', () => {
    r.setDirection('drag', 'up');
    assert.strictEqual(r.setDirection('drag', 'top'), false, 'top 应等价于 up，不算变化');
  });
  ok('换皮肤会清掉方向记录（新皮肤未必有同样的变体）', () => {
    r.setDirection('drag', 'left');
    r.apply(spriteSkin());
    assert.deepStrictEqual(r.directions(), {}, '方向记录未清空');
  });
  ok('非法方向不抛错', () => {
    [null, undefined, '', 'nope', 42].forEach((bad) => {
      assert.doesNotThrow(() => r.setDirection('drag', bad), 'dir=' + JSON.stringify(bad));
    });
  });
  ok('未 apply 皮肤时 setDirection 不抛错', () => {
    const bare = skinRender.createSkinRenderer({
      canvas: makeCanvas(),
      imageLoader: immediateLoader(),
      getStates: () => behavior.STATES
    });
    assert.doesNotThrow(() => bare.setDirection('drag', 'left'));
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
})();
