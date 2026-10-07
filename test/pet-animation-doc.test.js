/* 自检：docs/PET_ANIMATION_SPEC.md 与实现一致（帧动画制作标准）
   ------------------------------------------------------------
   这份文档是给皮肤作者看的**契约**：里面写的帧尺寸规则、状态表、
   体积上限、变量清单、错误信息，全都必须与代码一致。
   文档一旦过期，作者会照着做却导入失败 —— 这类问题比代码 bug 更难排查，
   所以把文档里引用的常量全部纳入断言。

   做法：从文档里抽取它声称的值，再与真实模块导出的值逐一比对。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'PET_ANIMATION_SPEC.md'), 'utf8');

const skin = require(path.join(root, 'renderer', 'pet', 'skin.js'));
const frames = require(path.join(root, 'renderer', 'pet', 'frames.js'));
const behavior = require(path.join(root, 'renderer', 'pet', 'behavior.js'));
const colors = require(path.join(root, 'renderer', 'pet', 'colors.js'));
const store = require(path.join(root, 'src', 'main', 'services', 'skin-store.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 体积与数量上限');
{
  ok('单文件上限与文档一致（4MB）', () => {
    assert.strictEqual(store.LIMITS.fileBytes, 4 * 1024 * 1024);
    assert.ok(/单文件大小 \| ≤ \*\*4 MB\*\*/.test(doc), '文档未写 4MB');
  });
  ok('整包上限与文档一致（32MB）', () => {
    assert.strictEqual(store.LIMITS.totalBytes, 32 * 1024 * 1024);
    assert.ok(/整包总大小 \| ≤ \*\*32 MB\*\*/.test(doc), '文档未写 32MB');
  });
  ok('文件数上限与文档一致（256）', () => {
    assert.strictEqual(store.LIMITS.fileCount, 256);
    assert.ok(/文件数 \| ≤ \*\*256\*\*/.test(doc), '文档未写 256');
  });
  ok('zip 上限与文档一致（64MB）', () => {
    assert.strictEqual(store.LIMITS.zipBytes, 64 * 1024 * 1024);
    assert.ok(/zip 包本身 \| ≤ \*\*64 MB\*\*/.test(doc), '文档未写 64MB');
  });
}

console.log('\n[2] 状态表：七个状态、优先级、循环、时长');
{
  const names = Object.keys(behavior.STATES);
  ok('文档列出的状态名与状态表完全一致', () => {
    // 文档 §6.1 表格里每行以 | `状态名` | 开头
    const inTable = [];
    const re = /^\| `([a-z]+)` \| [^|]+ \| ([✔✘]) [^|]+ \| (\d+) \|/gm;
    let m;
    while ((m = re.exec(doc)) !== null) inTable.push(m[1]);
    assert.deepStrictEqual(inTable.slice().sort(), names.slice().sort(),
      '文档状态表: ' + inTable.join(',') + ' / 代码: ' + names.join(','));
  });
  ok('每个状态的优先级与文档一致', () => {
    const re = /^\| `([a-z]+)` \| [^|]+ \| [✔✘] [^|]+ \| (\d+) \|/gm;
    let m;
    let checked = 0;
    while ((m = re.exec(doc)) !== null) {
      const [, name, prio] = m;
      assert.strictEqual(Number(prio), behavior.STATES[name].priority,
        name + ' 优先级文档=' + prio + ' 代码=' + behavior.STATES[name].priority);
      checked++;
    }
    assert.strictEqual(checked, names.length);
  });
  ok('每个状态的 loop 与文档一致', () => {
    const re = /^\| `([a-z]+)` \| [^|]+ \| ([✔✘]) [^|]+ \| \d+ \|/gm;
    let m;
    while ((m = re.exec(doc)) !== null) {
      const [, name, mark] = m;
      const codeLoop = behavior.STATES[name].loop !== false;
      assert.strictEqual(mark === '✔', codeLoop, name + ' 的 loop 标记不符');
    }
  });
}

console.log('\n[3] 配色变量清单');
{
  ok('文档列出的 7 个变量与 CAT_PALETTE 完全一致', () => {
    const inDoc = [];
    const re = /^\| `(--cat-[a-z-]+)` \| `([^`]+)` \|/gm;
    let m;
    while ((m = re.exec(doc)) !== null) inDoc.push({ name: m[1], def: m[2] });
    assert.strictEqual(inDoc.length, Object.keys(colors.CAT_PALETTE).length,
      '数量不符：文档 ' + inDoc.length + ' vs 代码 ' + Object.keys(colors.CAT_PALETTE).length);
    for (const row of inDoc) {
      assert.ok(row.name in colors.CAT_PALETTE, row.name + ' 不在 CAT_PALETTE 里');
      assert.strictEqual(row.def, colors.CAT_PALETTE[row.name],
        row.name + ' 默认值不符：文档 ' + row.def + ' vs 代码 ' + colors.CAT_PALETTE[row.name]);
    }
  });
  ok('文档未遗漏任何可覆盖变量', () => {
    const missing = Object.keys(colors.CAT_PALETTE).filter((k) => !doc.includes('`' + k + '`'));
    assert.deepStrictEqual(missing, [], '文档缺少: ' + missing.join(', '));
  });
}

console.log('\n[4] 帧尺寸与默认值');
{
  ok('默认 fps 与文档一致（8）', () => {
    assert.strictEqual(frames.DEFAULT_FPS, 8);
    assert.strictEqual(skin.DEFAULTS.fps, 8);
    assert.ok(/默认 \*\*8\*\*/.test(doc), '文档未写默认 fps 8');
  });
  ok('内置设计尺寸与文档一致（90×90）', () => {
    assert.deepStrictEqual(skin.DEFAULTS.size, { width: 90, height: 90 });
    assert.ok(doc.includes('90×90'), '文档未写 90×90');
  });
  ok('文档示例里的 frameWidth/Height 是正整数', () => {
    assert.strictEqual(skin.validatePetSkin({
      format: 'pet', version: 1, id: 'x', name: 'X',
      render: { kind: 'sprite', atlas: { file: 'a.png', frameWidth: 64, frameHeight: 64 } }
    }).ok, true);
    assert.ok(doc.includes('"frameWidth": 64') && doc.includes('"frameHeight": 64'),
      '文档示例未用 64×64');
  });
  ok('文档「图集寻址」的列数算法与实现一致', () => {
    // 文档说：列数 = floor(图集宽度 ÷ frameWidth)
    const atlas = { frameWidth: 64, frameHeight: 64 };
    assert.strictEqual(frames.columnsOf(atlas, 256), 4);
    assert.ok(/floor\(图集宽度 ÷ frameWidth\)/.test(doc), '文档未写列数算法');
    // 并验证第 N 帧坐标
    assert.deepStrictEqual(frames.frameRect(atlas, 5, 4), { x: 64, y: 64, width: 64, height: 64 });
  });
}

console.log('\n[5] 白名单（扩展名 / id 规则 / 音效）');
{
  ok('文档列出的资源扩展名与代码白名单一致', () => {
    const inDoc = new Set((doc.match(/\.[a-z0-9]{2,4}\b/g) || [])
      .filter((e) => store.ALLOWED_EXT.has(e)));
    // 文档必须覆盖全部白名单扩展名（可以多写，不能少写）
    const missing = [...store.ALLOWED_EXT].filter((e) => !doc.includes(e));
    assert.deepStrictEqual(missing, [], '文档缺少扩展名: ' + missing.join(', '));
    assert.ok(inDoc.size > 0);
  });
  ok('音效扩展名与代码一致', () => {
    assert.deepStrictEqual(skin.DEFAULTS.soundExt, ['.ogg', '.mp3', '.wav', '.m4a']);
    ['.ogg', '.mp3', '.wav', '.m4a'].forEach((e) => {
      assert.ok(doc.includes(e), '文档缺少音效扩展名 ' + e);
    });
  });
  ok('id 命名规则与代码正则一致', () => {
    const re = /`(\^\[a-z0-9\]\[a-z0-9-\]\{0,47\}\$)`/;
    assert.ok(re.test(doc), '文档未写出 id 正则原文');
    // 正例反例都要与实现一致
    assert.strictEqual(skin.validatePetSkin({
      format: 'pet', version: 1, id: 'my-cat', name: 'N', render: { kind: 'svg' }
    }).ok, true);
    ['My-Cat', '-cat', 'my cat', '我的猫'].forEach((bad) => {
      assert.strictEqual(skin.validatePetSkin({
        format: 'pet', version: 1, id: bad, name: 'N', render: { kind: 'svg' }
      }).ok, false, bad + ' 应被拒绝（文档把它列为反例）');
    });
  });
  ok('包内可执行文件扩展名清单与实现一致', () => {
    const store_src = fs.readFileSync(
      path.join(root, 'src', 'main', 'services', 'skin-store.js'), 'utf8');
    ['.js', '.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.scr'].forEach((e) => {
      assert.ok(store_src.includes("'" + e + "'"), '实现未拦截 ' + e);
      assert.ok(doc.includes(e), '文档未列 ' + e);
    });
  });
}

console.log('\n[6] 文档示例可直接通过校验（最重要的一条）');
{
  // 把文档 §12 的 pet.json 示例抽出来，实际喂给校验器
  const start = doc.indexOf('"format": "pet"', doc.indexOf('## 12'));
  const end = doc.indexOf('```', start);
  const jsonc = doc.slice(doc.lastIndexOf('{', start), end);
  ok('能取到 §12 的示例 JSON', () => {
    assert.ok(jsonc.length > 100, '未取到示例');
  });
  ok('去掉注释后是合法 JSON', () => {
    const stripped = jsonc.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped);
    assert.strictEqual(parsed.format, 'pet');
    assert.strictEqual(parsed.render.kind, 'sprite');
  });
  ok('示例能通过皮肤校验（作者照抄即可用）', () => {
    const stripped = jsonc.replace(/^\s*\/\/.*$/gm, '');
    const res = skin.validatePetSkin(JSON.parse(stripped));
    assert.strictEqual(res.ok, true, '示例被拒: ' + res.errors.join('；'));
    assert.deepStrictEqual(res.warnings, [], '示例产生 warning: ' + res.warnings.join('；'));
  });
  ok('示例里每个 frames 的帧号都在图集格数内（4 列 × 2 行 = 8）', () => {
    const stripped = jsonc.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped);
    const cols = 4;
    const rows = 2;
    const total = cols * rows;
    for (const [name, clip] of Object.entries(parsed.clips)) {
      clip.frames.forEach((f) => {
        assert.ok(f >= 0 && f < total,
          name + ' 的帧号 ' + f + ' 超出图集格数 ' + total + '（作者照抄会画出空白）');
      });
    }
  });
  ok('示例声明的动作能产出完整 clip 表（未声明的回落静帧）', () => {
    const stripped = jsonc.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped);
    const res = skin.validatePetSkin(parsed);
    const clips = frames.resolveClips(behavior.STATES, res.skin.clips);
    Object.keys(behavior.STATES).forEach((n) => {
      assert.ok(clips[n] && clips[n].frames.length > 0, n + ' 缺少可用 clip');
    });
  });
}

console.log('\n[7] 文档结构与必备章节');
{
  const sections = [
    '帧动画是怎么跑起来的', '快速开始', '文件与目录布局', '`pet.json` 字段规范',
    '`render`：怎么画', '`clips`：帧序列', '`sounds`：可选音效',
    '换色（`colorMap`）', '校验规则与错误信息', '制作流程与自查清单',
    '已知限制', '完整参考示例'
  ];
  sections.forEach((s) => {
    ok('包含章节：' + s, () => assert.ok(doc.includes('## ') && doc.includes(s), '缺少 ' + s));
  });
  ok('明确写了「帧序号越界不报错」这一坑', () => {
    assert.ok(/越界不会报错|越界不报错/.test(doc), '未提示越界静默');
  });
  ok('明确写了 loop/duration 不可被皮肤覆盖', () => {
    assert.ok(/由状态表决定/.test(doc), '未说明语义归状态表');
  });
  ok('明确写了不支持动图格式', () => {
    assert.ok(/不支持 GIF|GIF\/APNG/.test(doc), '未说明不支持动图');
  });
  ok('列出了已知限制（sounds 未播放等）', () => {
    assert.ok(/音效未播放|sounds.*只做校验/.test(doc), '未说明音效未播放');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
