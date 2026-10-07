/* 自检：皮肤包校验与合并 renderer/pet/skin.js（规范见 docs/PET_SPEC.md）
   用真实源码 + 真实状态表验证「来路不明的 pet.json 不能破坏状态机」。

   重点守住：
   - 缺字段/非法字段一律降级并记 warning，绝不抛错
   - 致命问题（format/version/id/name/render）才 ok:false
   - 路径安全：拒绝绝对路径、..、协议前缀（阶段 8 导入第三方包的第一道闸）
   - 未知状态名忽略（前向兼容：将来新增状态不会让旧皮肤报错）
   - **loop / duration / 优先级不可被皮肤覆盖**：否则皮肤能把一次性状态
     改成循环，状态机就永远回落不到 idle */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
function load(rel, sandbox) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'globalThis', src)(sandbox, sandbox);
}

const sandbox = {};
load('renderer/pet/behavior.js', sandbox); // 先加载状态表（skin 依赖它）
load('renderer/pet/skin.js', sandbox);

const { validatePetSkin, mergeClips, isSafeRelPath } = sandbox.PET_SKIN;
const B = sandbox.PET_BEHAVIOR;
assert.ok(typeof validatePetSkin === 'function', 'skin.js 未导出 validatePetSkin');
assert.ok(B && B.STATES, '状态表未加载（skin.js 依赖 PET_BEHAVIOR.STATES）');

/** 一份最小可用的合法皮肤 */
function baseSkin(over) {
  return Object.assign({
    format: 'pet',
    version: 1,
    id: 'builtin-cat',
    name: '内置小猫',
    render: { kind: 'svg', svg: { file: 'cat.svg' } }
  }, over || {});
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 合法皮肤');
{
  const r = validatePetSkin(baseSkin());
  ok('ok 为 true', () => assert.strictEqual(r.ok, true));
  ok('无 error', () => assert.deepStrictEqual(r.errors, []));
  ok('归一化后保留 id/name', () => {
    assert.strictEqual(r.skin.id, 'builtin-cat');
    assert.strictEqual(r.skin.name, '内置小猫');
  });
  ok('缺失 size 时补内置设计尺寸 90×90', () => {
    assert.deepStrictEqual(r.skin.render.size, { width: 90, height: 90 });
  });
  ok('无 clips/sounds 时给空对象（而不是 undefined）', () => {
    assert.deepStrictEqual(r.skin.clips, {});
    assert.deepStrictEqual(r.skin.sounds, {});
  });
}

console.log('\n[2] 致命问题 → ok:false');
{
  const cases = [
    ['null', null],
    ['数组', []],
    ['字符串', 'pet.json'],
    ['format 错', baseSkin({ format: 'theme' })],
    ['version 错', baseSkin({ version: 2 })],
    ['id 非法（大写）', baseSkin({ id: 'BadId' })],
    ['id 非法（路径穿越）', baseSkin({ id: '../evil' })],
    ['name 为空', baseSkin({ name: '   ' })],
    ['缺 render', baseSkin({ render: undefined })]
  ];
  for (const [label, raw] of cases) {
    ok('拒绝: ' + label, () => {
      const r = validatePetSkin(raw);
      assert.strictEqual(r.ok, false, label + ' 应被拒绝');
      assert.ok(r.errors.length > 0, label + ' 应给出 error');
      assert.strictEqual(r.skin, null);
    });
  }
  ok('校验层绝不抛错（传入循环引用也不崩）', () => {
    const cyc = baseSkin();
    cyc.self = cyc;
    assert.doesNotThrow(() => validatePetSkin(cyc));
  });
}

console.log('\n[3] 可自愈问题 → ok:true + warning');
{
  const r1 = validatePetSkin(baseSkin({ render: { kind: 'nope', svg: { file: 'cat.svg' } } }));
  ok('kind 非法回落 svg 并记 warning', () => {
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.skin.render.kind, 'svg');
    assert.ok(r1.warnings.some((w) => w.includes('kind')));
  });

  const r2 = validatePetSkin(baseSkin({
    render: { kind: 'svg', svg: { file: '../outside.svg' } }
  }));
  ok('svg.file 路径不安全 → 回落内置并 warning', () => {
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.skin.render.svg, null);
    assert.ok(r2.warnings.some((w) => w.includes('不安全')));
  });

  const r3 = validatePetSkin(baseSkin({
    render: { kind: 'sprite', atlas: { file: 'a.png', frameWidth: 0, frameHeight: 64 } }
  }));
  ok('sprite 帧尺寸非正 → 回落 svg 并 warning', () => {
    assert.strictEqual(r3.ok, true);
    assert.strictEqual(r3.skin.render.kind, 'svg');
    assert.ok(r3.warnings.some((w) => w.includes('atlas')));
  });

  const r4 = validatePetSkin(baseSkin({ render: { kind: 'svg', svg: { file: 'cat.svg' }, size: { width: -1, height: 10 } } }));
  ok('size 非正 → 用内置尺寸并 warning', () => {
    assert.deepStrictEqual(r4.skin.render.size, { width: 90, height: 90 });
    assert.ok(r4.warnings.some((w) => w.includes('size')));
  });
}

console.log('\n[4] clips 校验');
{
  const r = validatePetSkin(baseSkin({
    clips: {
      idle: { frames: [0, 1, 2], fps: 6 },
      walk: { frames: [3, 4] },
      'not-a-state': { frames: [0] },
      broken: { frames: [] },
      badframes: { frames: [1, -2] },
      // 键名必须是真实状态名，否则会被「未知状态名」规则先拦掉
      interact: { frames: [0], fps: 0 }
    }
  }));
  ok('合法 clip 被保留', () => {
    assert.deepStrictEqual(r.skin.clips.idle.frames, [0, 1, 2]);
    assert.strictEqual(r.skin.clips.idle.fps, 6);
  });
  ok('缺 fps 时用默认 8', () => assert.strictEqual(r.skin.clips.walk.fps, 8));
  ok('未知状态名被忽略并 warning', () => {
    assert.strictEqual(r.skin.clips['not-a-state'], undefined);
    assert.ok(r.warnings.some((w) => w.includes('not-a-state')));
  });
  ok('空 frames 被忽略', () => assert.strictEqual(r.skin.clips.broken, undefined));
  ok('含负数帧被忽略', () => assert.strictEqual(r.skin.clips.badframes, undefined));
  ok('fps 非正时用默认并 warning', () => {
    assert.strictEqual(r.skin.clips.interact.fps, 8);
    assert.ok(r.warnings.some((w) => w.includes('fps')));
  });
  ok('frames 是拷贝而非引用（防止外部改动污染）', () => {
    const src = [9, 9];
    const s = validatePetSkin(baseSkin({ clips: { idle: { frames: src } } }));
    s.skin.clips.idle.frames.push(1);
    assert.deepStrictEqual(src, [9, 9]);
  });
  ok('clips 不是对象时整体忽略并 warning', () => {
    const s = validatePetSkin(baseSkin({ clips: 'oops' }));
    assert.deepStrictEqual(s.skin.clips, {});
    assert.ok(s.warnings.some((w) => w.includes('clips')));
  });
}

console.log('\n[5] sounds 校验');
{
  const r = validatePetSkin(baseSkin({
    sounds: {
      interact: 'meow.ogg',
      idle: 'bgm.mp3',
      bad: 'evil.exe',
      traversal: '../boom.wav',
      'no-state': 'x.wav'
    }
  }));
  ok('白名单内扩展名保留', () => {
    assert.strictEqual(r.skin.sounds.interact, 'meow.ogg');
    assert.strictEqual(r.skin.sounds.idle, 'bgm.mp3');
  });
  ok('非白名单扩展名忽略并 warning', () => {
    assert.strictEqual(r.skin.sounds.bad, undefined);
    assert.ok(r.warnings.some((w) => w.includes('bad')));
  });
  ok('路径穿越忽略', () => assert.strictEqual(r.skin.sounds.traversal, undefined));
  ok('未知状态名忽略', () => assert.strictEqual(r.skin.sounds['no-state'], undefined));
}

console.log('\n[6] 路径安全函数');
{
  const good = ['cat.svg', 'img/atlas.png', 'a-b_c.1.png'];
  const bad = ['C:\\x\\a.png', '/abs/a.png', '\\abs\\a.png', '../a.png', 'a/../b.png', 'http://x/a.png', '', '   ', null, 42];
  ok('合法相对路径通过', () => good.forEach((p) => assert.strictEqual(isSafeRelPath(p), true, p)));
  ok('绝对/穿越/协议路径被拒', () => bad.forEach((p) => assert.strictEqual(isSafeRelPath(p), false, String(p))));
}

console.log('\n[7] 合并到状态表：皮肤不得改变状态机语义');
{
  const r = validatePetSkin(baseSkin({
    clips: {
      idle: { frames: [0, 1], fps: 6 },
      // 皮肤试图把一次性状态改成循环、并篡改 duration
      interact: { frames: [2, 3], fps: 20, loop: true, duration: 99999 }
    }
  }));
  const merged = mergeClips(r.skin);
  ok('覆盖的状态拿到皮肤的帧序列与帧率', () => {
    assert.deepStrictEqual(merged.idle.frames, [0, 1]);
    assert.strictEqual(merged.idle.fps, 6);
  });
  ok('未覆盖的状态 frames 为 null（表示用内置 SVG 表现）', () => {
    assert.strictEqual(merged.sleep.frames, null);
    assert.strictEqual(merged.walk.frames, null);
  });
  ok('loop 以状态表为准（皮肤不能把 interact 改成循环）', () => {
    assert.strictEqual(merged.interact.loop, B.STATES.interact.loop);
    assert.strictEqual(merged.interact.loop, false);
  });
  ok('duration 以状态表为准（篡改无效）', () => {
    assert.strictEqual(merged.interact.duration, B.STATES.interact.duration);
  });
  ok('循环状态的 duration 为 null', () => {
    assert.strictEqual(merged.idle.duration, null);
    assert.strictEqual(merged.idle.loop, true);
  });
  ok('状态类来自状态表（皮肤不得改 class）', () => {
    assert.strictEqual(merged.idle.class, B.STATES.idle.class);
    assert.strictEqual(merged.drag.class, B.STATES.drag.class);
  });
  ok('合并结果覆盖全部状态', () => {
    assert.deepStrictEqual(Object.keys(merged).sort(), Object.keys(B.STATES).sort());
  });
  ok('无皮肤（null）时合并结果等于状态表默认值', () => {
    const m = mergeClips(null);
    for (const [name, def] of Object.entries(B.STATES)) {
      assert.strictEqual(m[name].loop, def.loop, name);
      assert.strictEqual(m[name].frames, null, name);
    }
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
