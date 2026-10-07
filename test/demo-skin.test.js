/* 自检：内置示例皮肤 renderer/pet/skins/demo-cat（帧动画可用性的活样例）
   ------------------------------------------------------------
   这个包既是给用户的示例，也是**帧动画这条链路唯一一个真实素材**：
   test/frames.test.js 用的是构造数据，这里用真实图集，
   因此能发现"构造数据通过、真实文件却不行"的问题（例如帧号越界、图层尺寸不符）。

   守住：
   - 通过真实导入校验（inspectSkinDir）且零 error / 零 warning
   - 图集实际尺寸与 frameWidth/frameHeight 整除，且帧号都在容量内
   - 七个状态都有可用 clip（不是静帧兜底）
   - 图集确实是 PNG（签名），且不是空图
   - 每个帧都不是空白（覆盖率下限） */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const skinDir = path.join(root, 'renderer', 'pet', 'skins', 'demo-cat');
const store = require(path.join(root, 'src', 'main', 'services', 'skin-store.js'));
const frames = require(path.join(root, 'renderer', 'pet', 'frames.js'));
const behavior = require(path.join(root, 'renderer', 'pet', 'behavior.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const exists = fs.existsSync(skinDir);
if (!exists) {
  console.log('  SKIP  内置示例皮肤不存在（未生成）');
  console.log('\n通过 0 项断言');
  return;
}

const info = store.inspectSkinDir(skinDir);

console.log('\n[1] 真实导入校验');
{
  ok('通过校验且零 error', () => {
    assert.strictEqual(info.ok, true, 'errors: ' + info.errors.join('；'));
  });
  ok('零 warning（示例应当干净，不该有回落/忽略）', () => {
    assert.deepStrictEqual(info.warnings, [], 'warnings: ' + info.warnings.join('；'));
  });
  ok('id / name 与目录名一致', () => {
    assert.strictEqual(info.skin.id, 'demo-cat');
    assert.strictEqual(path.basename(skinDir), info.skin.id);
    assert.ok(info.skin.name && info.skin.name.trim());
  });
  ok('kind 为 sprite（确实在演示帧动画）', () => {
    assert.strictEqual(info.skin.render.kind, 'sprite');
    assert.ok(info.skin.render.atlas, '缺少 atlas');
  });
}

console.log('\n[2] 图集文件本身');
{
  const png = fs.readFileSync(path.join(skinDir, 'atlas.png'));
  ok('是合法 PNG（签名正确）', () => {
    assert.strictEqual(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  });
  ok('含 IHDR / IDAT / IEND 三个必需块', () => {
    ['IHDR', 'IDAT', 'IEND'].forEach((c) => {
      assert.ok(png.includes(Buffer.from(c)), '缺少 ' + c);
    });
  });
  ok('图集尺寸能被帧宽高整除（否则最后一列会被切半）', () => {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const a = info.skin.render.atlas;
    assert.strictEqual(w % a.frameWidth, 0, '宽 ' + w + ' 不能被 ' + a.frameWidth + ' 整除');
    assert.strictEqual(h % a.frameHeight, 0, '高 ' + h + ' 不能被 ' + a.frameHeight + ' 整除');
  });
  ok('图集规模合理（不超 2048×2048，单文件不超上限）', () => {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    assert.ok(w <= 2048 && h <= 2048, '图集 ' + w + '×' + h + ' 过大');
    assert.ok(png.length <= store.LIMITS.fileBytes, '文件超限');
  });
}

console.log('\n[3] 帧号与图集容量');
{
  const png = fs.readFileSync(path.join(skinDir, 'atlas.png'));
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const a = info.skin.render.atlas;
  const cols = Math.floor(w / a.frameWidth);
  const rows = Math.floor(h / a.frameHeight);
  const capacity = cols * rows;

  ok('图集容量与文件名描述一致（8×6=48）', () => {
    // 阶段 8.7：由 8×4=32 扩到 8×6=48，容纳方向变体帧
    assert.strictEqual(cols, 8);
    assert.strictEqual(rows, 6);
    assert.strictEqual(capacity, 48);
  });
  ok('方向变体帧都落在图集内且被声明', () => {
    const clips = info.skin.clips;
    ['drag-up', 'drag-down', 'drag-left', 'drag-right',
      'walk-left', 'walk-right', 'snap-up', 'snap-down', 'snap-left', 'snap-right']
      .forEach((name) => {
        assert.ok(clips[name], '示例皮肤缺少方向变体: ' + name);
        assert.ok(clips[name].frames.length > 0, name + ' 帧序列为空');
        clips[name].frames.forEach((f) => {
          assert.ok(f >= 0 && f < capacity, name + ' 帧号越界: ' + f);
        });
      });
  });
  ok('所有 clips 的帧号都在容量内（越界不会报错，只会画出空白）', () => {
    const bad = [];
    for (const [name, clip] of Object.entries(info.skin.clips)) {
      clip.frames.forEach((f) => {
        if (!Number.isInteger(f) || f < 0 || f >= capacity) bad.push(name + '→' + f);
      });
    }
    assert.deepStrictEqual(bad, [], '越界帧号: ' + bad.join(', '));
  });
  ok('帧号无重复使用（每个动作有独立画面）', () => {
    const used = new Set();
    for (const clip of Object.values(info.skin.clips)) {
      clip.frames.forEach((f) => used.add(f));
    }
    assert.strictEqual(used.size, capacity, '实际用到 ' + used.size + ' 帧，图集有 ' + capacity + ' 帧');
  });
}

console.log('\n[4] 七个状态都有真实动画（不是静帧兜底）');
{
  const merged = frames.resolveClips(behavior.STATES, info.skin.clips);
  const states = Object.keys(behavior.STATES);
  ok('每个状态都被 clips 显式声明', () => {
    const missing = states.filter((n) => !info.skin.clips[n]);
    assert.deepStrictEqual(missing, [], '未声明（会退化成静帧）: ' + missing.join(', '));
  });
  ok('每个状态的帧数 ≥ 2（单帧等于没有动画）', () => {
    const thin = states.filter((n) => merged[n].frames.length < 2);
    assert.deepStrictEqual(thin, [], '帧数不足: ' + thin.join(', '));
  });
  ok('loop / duration 与状态表一致（皮肤不可覆盖）', () => {
    for (const n of states) {
      const st = behavior.STATES[n];
      assert.strictEqual(merged[n].loop, st.loop !== false, n + ' 的 loop 不符');
      const expected = typeof st.duration === 'number' ? st.duration : null;
      assert.strictEqual(merged[n].duration, expected, n + ' 的 duration 不符');
    }
  });
  ok('一次性状态（celebrate/interact）确实是 loop=false', () => {
    assert.strictEqual(merged.celebrate.loop, false);
    assert.strictEqual(merged.interact.loop, false);
  });
  ok('fps 都是正整数', () => {
    for (const n of states) {
      assert.ok(Number.isInteger(merged[n].fps) && merged[n].fps > 0, n + ' fps=' + merged[n].fps);
    }
  });
}

console.log('\n[5] 图集不是空图（逐帧覆盖率，防"生成了空白帧"）');
{
  // 自己解 PNG：读 IDAT → inflate → 去掉每行 filter 字节
  const zlib = require('zlib');
  const png = fs.readFileSync(path.join(skinDir, 'atlas.png'));
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);

  let pos = 8;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.slice(pos + 4, pos + 8).toString('ascii');
    if (type === 'IDAT') idat.push(png.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  // 只支持 filter=0（本生成器固定写 0）
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.strictEqual(raw[y * (stride + 1)], 0, '出现非 0 filter，本测试的解析不适用');
    raw.copy(px, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }

  const a = info.skin.render.atlas;
  const cols = w / a.frameWidth;
  const rows = h / a.frameHeight;
  const coverages = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let opaque = 0;
      for (let y = 0; y < a.frameHeight; y++) {
        for (let x = 0; x < a.frameWidth; x++) {
          const gx = c * a.frameWidth + x;
          const gy = r * a.frameHeight + y;
          if (px[(gy * w + gx) * 4 + 3] > 8) opaque++;
        }
      }
      coverages.push(opaque / (a.frameWidth * a.frameHeight));
    }
  }

  ok('解析出 ' + coverages.length + ' 帧的覆盖率', () => {
    assert.strictEqual(coverages.length, cols * rows);
  });
  ok('没有空白帧（每帧覆盖率 > 5%，画面确实画出来了）', () => {
    const blank = coverages.map((c, i) => (c <= 0.05 ? i : -1)).filter((i) => i >= 0);
    assert.deepStrictEqual(blank, [], '空白帧: ' + blank.join(', '));
  });
  ok('帧之间画面确实不同（不是同一张图复制 32 份）', () => {
    const uniq = new Set(coverages.map((c) => c.toFixed(4)));
    assert.ok(uniq.size >= 8,
      '覆盖率只有 ' + uniq.size + ' 种不同值，可能大量帧是重复的');
  });
  ok('没有像素被帧边缘裁切（否则姿态会缺角）', () => {
    const clipped = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let edge = 0;
        for (let y = 0; y < a.frameHeight; y++) {
          for (let x = 0; x < a.frameWidth; x++) {
            if (x !== 0 && y !== 0 && x !== a.frameWidth - 1 && y !== a.frameHeight - 1) continue;
            const gx = c * a.frameWidth + x;
            const gy = r * a.frameHeight + y;
            if (px[(gy * w + gx) * 4 + 3] > 8) edge++;
          }
        }
        if (edge > 0) clipped.push((r * cols + c) + '(' + edge + 'px)');
      }
    }
    assert.deepStrictEqual(clipped, [], '贴边被裁切的帧: ' + clipped.join(', '));
  });
}

console.log('\n[6] 随附文档与生成器');
{
  ok('目录里有 README 说明这是什么', () => {
    assert.ok(fs.existsSync(path.join(skinDir, 'README.md')), '缺少 README.md');
  });
  ok('生成器脚本存在（图集可复现，不是无法维护的黑盒）', () => {
    assert.ok(fs.existsSync(path.join(root, 'tools', 'gen-demo-cat.js')), '缺少 tools/gen-demo-cat.js');
    assert.ok(fs.existsSync(path.join(root, 'tools', 'atlas-kit.js')), '缺少 tools/atlas-kit.js');
  });
  ok('生成器输出目录指向内置皮肤目录', () => {
    const src = fs.readFileSync(path.join(root, 'tools', 'gen-demo-cat.js'), 'utf8');
    assert.ok(/renderer'?,?\s*'pet'?,\s*'skins'?/.test(src) || src.includes("'skins', 'demo-cat'"),
      '生成器未输出到 renderer/pet/skins');
  });
  ok('内置皮肤目录会被主进程扫描（路径约定一致）', () => {
    const skinIpc = fs.readFileSync(path.join(root, 'src', 'main', 'ipc', 'skin.js'), 'utf8');
    assert.ok(skinIpc.includes("'renderer', 'pet', 'skins'"),
      'ipc/skin.js 的 builtinRoot 与生成器输出目录不一致，内置皮肤不会被列出');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
