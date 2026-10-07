/* 自检：试穿预览的播放计划（阶段 8.4 修复）
   ------------------------------------------------------------
   用户反馈「设置页预览显示的是整个动画图集，应该显示动画」。
   根因：预览直接 <img src=图集>，把整张网格图当一张图显示。

   修法是按 clips 逐动作逐帧裁切播放。本测试验证**计划本身正确**：
   - 真的会跨多个帧推进（而不是始终第 0 帧 = 等于静态图集）
   - 逐帧不跳号（每个声明帧都至少出现一次）
   - 循环动作播满时长；一次性动作按帧数播完
   - 越界/缺图的皮肤安全降级，不抛错
   - frameAtTime 在任意时刻都能取到帧，且时间取模不越界 */

const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ui = require(path.join(root, 'renderer', 'scripts', 'settings-ui.js'));
const behavior = require(path.join(root, 'renderer', 'pet', 'behavior.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 造一个 sprite 皮肤（图集 8 列 × 4 行，96×96/帧，与 demo-cat 同构） */
function spriteSkin(clips, over) {
  return Object.assign({
    id: 'x', name: 'X',
    render: {
      kind: 'sprite',
      atlas: { file: 'atlas.png', frameWidth: 96, frameHeight: 96, dataUrl: 'data:image/png;base64,AA' }
    },
    clips: clips || {
      idle: { frames: [0, 1, 2, 3, 4, 5], fps: 6 },
      walk: { frames: [6, 7, 8, 9, 10, 11], fps: 10 },
      interact: { frames: [16, 17, 18, 19], fps: 12 }
    }
  }, over || {});
}

console.log('\n[1] 不再把整张图集当一张图显示');
{
  const plan = ui.buildPreviewPlan(spriteSkin(), behavior.STATES, 1400);
  ok('kind 为 sprite（走画布逐帧播放，而不是 <img>）', () => {
    assert.strictEqual(plan.kind, 'sprite', '实际 ' + plan.kind);
  });
  ok('带出了帧尺寸，供裁切使用', () => {
    assert.strictEqual(plan.frameWidth, 96);
    assert.strictEqual(plan.frameHeight, 96);
  });
  ok('时间轴覆盖多个不同帧（静态图集只会有一个帧号）', () => {
    const uniq = new Set(plan.timeline.map((t) => t.frame));
    assert.ok(uniq.size >= 10,
      '时间轴只出现了 ' + uniq.size + ' 个不同帧，等于没在播动画');
  });
  ok('时间轴长度合理（不是空表，也不至于爆炸）', () => {
    assert.ok(plan.timeline.length > 10 && plan.timeline.length < 1000,
      'timeline 长度 ' + plan.timeline.length);
  });
  ok('时间轴单调不减（播放顺序正确）', () => {
    for (let i = 1; i < plan.timeline.length; i++) {
      assert.ok(plan.timeline[i].at >= plan.timeline[i - 1].at, '第 ' + i + ' 项时间倒流');
    }
  });
}

console.log('\n[2] 每个声明的帧都会出现（不跳号）');
{
  const plan = ui.buildPreviewPlan(spriteSkin(), behavior.STATES, 1400);
  ok('idle 的 6 帧全部出现', () => {
    const used = new Set(plan.timeline.filter((t) => t.state === 'idle').map((t) => t.frame));
    [0, 1, 2, 3, 4, 5].forEach((f) => assert.ok(used.has(f), '缺少帧 ' + f));
  });
  ok('walk 的 6 帧全部出现', () => {
    const used = new Set(plan.timeline.filter((t) => t.state === 'walk').map((t) => t.frame));
    [6, 7, 8, 9, 10, 11].forEach((f) => assert.ok(used.has(f), '缺少帧 ' + f));
  });
  ok('interact 的 4 帧全部出现', () => {
    const used = new Set(plan.timeline.filter((t) => t.state === 'interact').map((t) => t.frame));
    [16, 17, 18, 19].forEach((f) => assert.ok(used.has(f), '缺少帧 ' + f));
  });
  ok('只播放皮肤声明过的动作（不把七个状态都硬塞进去）', () => {
    const states = new Set(plan.timeline.map((t) => t.state));
    assert.deepStrictEqual([...states].sort(), ['idle', 'interact', 'walk']);
  });
}

console.log('\n[3] 循环 / 一次性动作的时长处理');
{
  ok('循环动作至少播满 perStateMs', () => {
    const plan = ui.buildPreviewPlan(spriteSkin(), behavior.STATES, 1400);
    // idle 每段至少覆盖 1400ms
    const idleLast = plan.timeline.filter((t) => t.state === 'idle').pop();
    assert.ok(idleLast.at >= 1000, 'idle 只播到 ' + idleLast.at + 'ms');
  });
  ok('一次性动作（interact）按帧数播完即可，不硬凑时长', () => {
    const plan = ui.buildPreviewPlan(spriteSkin(), behavior.STATES, 1400);
    const items = plan.timeline.filter((t) => t.state === 'interact');
    // 时间轴是全局单调的，所以要算「首尾跨度」而不是取最后一个绝对时间
    const span = items[items.length - 1].at - items[0].at;
    // interact 4 帧 @12fps ≈ 250~333ms，应明显短于 1400
    assert.ok(span < 600, 'interact 跨度 ' + span + 'ms，应约 250~333ms');
  });
  ok('动作顺序与状态表一致（idle → walk → interact）', () => {
    const plan = ui.buildPreviewPlan(spriteSkin(), behavior.STATES, 1400);
    const order = [];
    for (const t of plan.timeline) if (order[order.length - 1] !== t.state) order.push(t.state);
    assert.deepStrictEqual(order, ['idle', 'walk', 'interact']);
  });
}

console.log('\n[4] frameAtTime：任意时刻都能取到帧');
{
  const plan = ui.buildPreviewPlan(spriteSkin(), behavior.STATES, 1400);
  ok('t=0 取到第一帧', () => {
    const f = ui.frameAtTime(plan, 0);
    assert.ok(f && typeof f.frame === 'number');
  });
  ok('时间推进会取到不同帧', () => {
    const seen = new Set();
    for (let t = 0; t < plan.durationMs; t += 20) seen.add(ui.frameAtTime(plan, t).frame);
    assert.ok(seen.size >= 10, '整轮只看到 ' + seen.size + ' 个不同帧');
  });
  ok('超过总时长会取模循环（预览是循环播放的）', () => {
    const a = ui.frameAtTime(plan, 100);
    const b = ui.frameAtTime(plan, 100 + plan.durationMs);
    assert.strictEqual(a.frame, b.frame, '未按 total 取模');
  });
  ok('负数时间也安全', () => {
    const f = ui.frameAtTime(plan, -50);
    assert.ok(f && typeof f.frame === 'number');
  });
  ok('非法计划返回 null 而不是抛错', () => {
    assert.strictEqual(ui.frameAtTime(null, 0), null);
    assert.strictEqual(ui.frameAtTime({ kind: 'img' }, 0), null);
    assert.strictEqual(ui.frameAtTime({ kind: 'sprite', timeline: [] }, 0), null);
  });
}

console.log('\n[5] 降级与边界');
{
  ok('SVG 皮肤仍走静态图（本来就没有帧）', () => {
    const plan = ui.buildPreviewPlan({
      render: { kind: 'svg', svg: { dataUrl: 'data:image/svg+xml;base64,AA' } }
    }, behavior.STATES);
    assert.strictEqual(plan.kind, 'img');
  });
  ok('缺图集 dataUrl → 给出原因', () => {
    const plan = ui.buildPreviewPlan({
      render: { kind: 'sprite', atlas: { frameWidth: 64, frameHeight: 64 } }
    }, behavior.STATES);
    assert.strictEqual(plan.kind, 'none');
    assert.ok(plan.reason.includes('图集'), plan.reason);
  });
  ok('帧尺寸非法 → 给出原因', () => {
    const plan = ui.buildPreviewPlan({
      render: { kind: 'sprite', atlas: { frameWidth: 0, frameHeight: 0, dataUrl: 'data:,x' } }
    }, behavior.STATES);
    assert.strictEqual(plan.kind, 'none');
  });
  ok('没有 clips 时退回单帧静态预览（至少看得到第一帧）', () => {
    const plan = ui.buildPreviewPlan(spriteSkin({}), behavior.STATES, 1400);
    assert.strictEqual(plan.kind, 'sprite');
    assert.strictEqual(plan.timeline.length, 1);
    assert.strictEqual(plan.staticOnly, true);
  });
  ok('clips 里有非法 frames 时不会崩', () => {
    const plan = ui.buildPreviewPlan(spriteSkin({
      idle: { frames: [], fps: 6 },
      walk: { frames: 'nope' }
    }), behavior.STATES, 1400);
    assert.ok(plan.kind === 'sprite');
  });
  ok('fps 非法时用默认值而不是死循环', () => {
    const plan = ui.buildPreviewPlan(spriteSkin({
      idle: { frames: [0, 1, 2], fps: 0 }
    }), behavior.STATES, 1400);
    assert.ok(plan.timeline.length > 0 && plan.timeline.length < 1000,
      'timeline 长度 ' + plan.timeline.length);
  });
  ok('皮肤声明了状态表里没有的动作名时也会播（便于发现写错）', () => {
    const plan = ui.buildPreviewPlan(spriteSkin({
      idle: { frames: [0], fps: 6 },
      bogusstate: { frames: [5], fps: 6 }
    }), behavior.STATES, 1400);
    const states = new Set(plan.timeline.map((t) => t.state));
    assert.ok(states.has('bogusstate'), '未播放未知动作名');
  });
  ok('null 皮肤返回 none', () => {
    assert.strictEqual(ui.buildPreviewPlan(null, behavior.STATES).kind, 'none');
  });
}

console.log('\n[6] 真实 demo-cat（端到端：计划能覆盖 32 帧）');
{
  const fs = require('fs');
  const skinDir = path.join(root, 'renderer', 'pet', 'skins', 'demo-cat');
  if (!fs.existsSync(skinDir)) {
    console.log('  SKIP  内置示例皮肤不存在');
  } else {
    const skinStore = require(path.join(root, 'src', 'main', 'services', 'skin-store.js'));
    const info = skinStore.inspectSkinDir(skinDir);
    const skin = info.skin;
    skin.render.atlas.dataUrl = 'data:image/png;base64,AA'; // 计划阶段不真的解码
    const plan = ui.buildPreviewPlan(skin, behavior.STATES, 1400);
    ok('真实皮肤的预览计划覆盖全部 32 帧', () => {
      const used = new Set(plan.timeline.map((t) => t.frame));
      assert.strictEqual(used.size, 32, '只覆盖 ' + used.size + ' 帧');
    });
    ok('真实皮肤覆盖七个动作', () => {
      const states = new Set(plan.timeline.map((t) => t.state));
      assert.strictEqual(states.size, 7, '只覆盖 ' + states.size + ' 个动作');
    });
  }
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
