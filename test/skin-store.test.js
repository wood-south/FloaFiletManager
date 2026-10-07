/* 自检：皮肤包仓库 src/main/services/skin-store.js（阶段 8）
   用真实临时目录验证「扫描 / 校验 / 导入 / 导出」与安全约束。

   第三方皮肤包是**不可信输入**，因此本测试的重点是安全边界：
   - 路径穿越（../、绝对路径、协议前缀）必须被拦下
   - 资源必须是白名单类型（不允许 exe/js/ps1 等）
   - 体积与文件数上限
   - 包内出现可执行/脚本文件即拒绝（即使没被引用）
   - 任何异常都转成 { ok:false }，绝不抛错

   导入采用「先落地到临时目录再改名」，因此还要验证：
   - 失败时不留下半成品目录
   - 覆盖安装同一 id 能成功
   - 目标是目录时能导出，且已存在则不覆盖 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const store = require(path.join(__dirname, '..', 'src', 'main', 'services', 'skin-store.js'));

const tmpRoots = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'dsh-skin-') ));
  tmpRoots.push(d);
  return d;
}

/** 写一个最小可用的皮肤包，返回其目录 */
function makeSkin(dir, over) {
  const o = over || {};
  const pet = Object.assign({
    format: 'pet',
    version: 1,
    id: o.id || 'test-skin',
    name: o.name || '测试皮肤',
    render: { kind: 'svg', svg: { file: o.svgFile || 'cat.svg' } }
  }, o.pet || {});
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(pet, null, 2));
  if (o.svgFile !== null) {
    const svgRel = o.svgFile || 'cat.svg';
    const svgPath = path.join(dir, svgRel);
    fs.mkdirSync(path.dirname(svgPath), { recursive: true });
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  }
  return dir;
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 合法皮肤：校验通过');
{
  const root = tmpDir();
  const dir = makeSkin(path.join(root, 'good'), { id: 'good-skin', name: '好皮肤' });
  const info = store.inspectSkinDir(dir);
  ok('ok 为 true', () => assert.strictEqual(info.ok, true));
  ok('返回归一化后的皮肤信息', () => {
    assert.strictEqual(info.skin.id, 'good-skin');
    assert.strictEqual(info.skin.name, '好皮肤');
  });
  ok('无 error', () => assert.deepStrictEqual(info.errors, []));
}

console.log('\n[2] 结构问题：拒绝但绝不抛错');
{
  const root = tmpDir();
  const cases = [
    ['目录不存在', path.join(root, 'nope')],
    ['缺少 pet.json', (() => { const d = path.join(root, 'nojson'); fs.mkdirSync(d, { recursive: true }); return d; })()],
    ['pet.json 不是 JSON', (() => {
      const d = path.join(root, 'broken'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'pet.json'), '{ not json');
      return d;
    })()],
    ['format 不对', makeSkin(path.join(root, 'badfmt'), { pet: { format: 'theme' } })],
    ['声明了资源但文件不存在', (() => {
      const d = path.join(root, 'missing-asset');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'pet.json'), JSON.stringify({
        format: 'pet', version: 1, id: 'm', name: 'M',
        render: { kind: 'svg', svg: { file: 'nope.svg' } }
      }));
      return d;
    })()]
  ];
  for (const [label, dir] of cases) {
    ok('拒绝并给出 errors: ' + label, () => {
      let info;
      assert.doesNotThrow(() => { info = store.inspectSkinDir(dir); });
      assert.strictEqual(info.ok, false, label + ' 应被拒绝');
      assert.ok(info.errors.length > 0, label + ' 应有错误信息');
    });
  }
  ok('失败时仍返回已解析的 skin 供诊断（不是 null）', () => {
    const info = store.inspectSkinDir(cases[3][1]); // format 不对的那个
    // format 不合法时连归一化都过不去，skin 为 null；
    // 而「资源缺失」这类后置校验失败会保留 skin，便于 UI 说明问题
    assert.strictEqual(info.skin, null);
    const missing = store.inspectSkinDir(cases[4][1]);
    assert.ok(missing.skin, '资源缺失时应保留归一化结果供诊断');
  });
}

console.log('\n[3] 安全：路径穿越与非法资源');
{
  const root = tmpDir();
  // 在皮肤目录之外放一个文件，尝试用 ../ 引用它
  fs.writeFileSync(path.join(root, 'secret.svg'), '<svg/>');

  const traversal = makeSkin(path.join(root, 'traversal'), {
    svgFile: null,
    pet: { render: { kind: 'svg', svg: { file: '../secret.svg' } } }
  });
  ok('拒绝 ../ 路径穿越', () => {
    const info = store.inspectSkinDir(traversal);
    assert.strictEqual(info.ok, false);
    assert.ok(info.errors.some((e) => /不安全|越出|不存在/.test(e)), '错误信息: ' + info.errors.join('；'));
  });

  const abs = makeSkin(path.join(root, 'abs'), {
    svgFile: null,
    pet: { render: { kind: 'svg', svg: { file: 'C:\\Windows\\win.ini' } } }
  });
  ok('拒绝绝对路径', () => {
    assert.strictEqual(store.inspectSkinDir(abs).ok, false);
  });

  const proto = makeSkin(path.join(root, 'proto'), {
    svgFile: null,
    pet: { render: { kind: 'svg', svg: { file: 'https://evil.example/x.svg' } } }
  });
  ok('拒绝协议前缀', () => {
    assert.strictEqual(store.inspectSkinDir(proto).ok, false);
  });

  const badExt = makeSkin(path.join(root, 'badext'), {
    svgFile: null,
    pet: { render: { kind: 'svg', svg: { file: 'payload.exe' } } }
  });
  fs.writeFileSync(path.join(badExt, 'payload.exe'), 'MZ');
  ok('拒绝白名单外的资源类型', () => {
    const info = store.inspectSkinDir(badExt);
    assert.strictEqual(info.ok, false);
    assert.ok(info.errors.some((e) => /不允许的资源类型/.test(e)), info.errors.join('；'));
  });

  const extraExe = makeSkin(path.join(root, 'extra-exe'), { id: 'extra' });
  fs.writeFileSync(path.join(extraExe, 'run.ps1'), 'echo hi');
  ok('包内出现脚本文件即拒绝（即使没被引用）', () => {
    const info = store.inspectSkinDir(extraExe);
    assert.strictEqual(info.ok, false);
    assert.ok(info.errors.some((e) => /不允许出现可执行/.test(e)), info.errors.join('；'));
  });
}

console.log('\n[4] 安全：体积与数量上限');
{
  const root = tmpDir();
  const big = makeSkin(path.join(root, 'big'), { id: 'big' });
  // 造一个超过单文件上限的资源（用 webp 扩展名走白名单）
  const huge = Buffer.alloc(store.LIMITS.fileBytes + 1024, 1);
  fs.writeFileSync(path.join(big, 'huge.webp'), huge);
  fs.writeFileSync(path.join(big, 'pet.json'), JSON.stringify({
    format: 'pet', version: 1, id: 'big', name: 'BIG',
    render: { kind: 'svg', svg: { file: 'cat.svg' } },
    sounds: { idle: 'huge.webp' }
  }));
  ok('单文件超限被拒绝', () => {
    const info = store.inspectSkinDir(big);
    assert.strictEqual(info.ok, false);
    assert.ok(info.errors.some((e) => /单文件超限/.test(e)), info.errors.join('；'));
  });

  const many = makeSkin(path.join(root, 'many'), { id: 'many' });
  for (let i = 0; i < store.LIMITS.fileCount + 5; i++) {
    fs.writeFileSync(path.join(many, 'a' + i + '.png'), 'x');
  }
  ok('文件数超限被拒绝', () => {
    const info = store.inspectSkinDir(many);
    assert.strictEqual(info.ok, false);
    assert.ok(info.errors.some((e) => /文件数超限/.test(e)), info.errors.join('；'));
  });
}

console.log('\n[5] 扫描皮肤根目录');
{
  const userRoot = tmpDir();
  makeSkin(path.join(userRoot, 'skin-a'), { id: 'skin-a', name: 'A' });
  makeSkin(path.join(userRoot, 'skin-b'), { id: 'skin-b', name: 'B' });
  // 一个坏包不应阻断其它包
  fs.mkdirSync(path.join(userRoot, 'broken-one'), { recursive: true });
  fs.writeFileSync(path.join(userRoot, 'broken-one', 'pet.json'), '{bad');
  fs.writeFileSync(path.join(userRoot, 'loose-file.txt'), 'ignore me');

  const res = store.listSkins(userRoot);
  ok('列出全部可用皮肤（跳过散落文件）', () => {
    assert.strictEqual(res.ok, true);
    const ids = res.skins.map((s) => s.id).sort();
    assert.deepStrictEqual(ids, ['skin-a', 'skin-b']);
  });
  ok('坏包被记录为 error 但不影响其它皮肤', () => {
    assert.ok(res.errors.some((e) => e.includes('broken-one')), res.errors.join('；'));
  });
  ok('目录不存在时返回空列表而不是报错', () => {
    const r = store.listSkins(path.join(userRoot, 'no-such-dir'));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.skins, []);
  });
}

console.log('\n[6] 导入');
{
  const src = tmpDir();
  const userRoot = tmpDir();
  const good = makeSkin(path.join(src, 'pkg'), { id: 'imported', name: '导入的' });

  const res = store.importSkinFromDir(good, userRoot);
  ok('导入成功', () => {
    assert.strictEqual(res.ok, true, res.errors.join('；'));
    assert.strictEqual(res.skin.id, 'imported');
  });
  ok('落地目录名为皮肤 id', () => {
    assert.strictEqual(path.basename(res.dir), 'imported');
    assert.ok(fs.existsSync(path.join(res.dir, 'pet.json')));
  });
  ok('导入后能被扫描到', () => {
    const ids = store.listSkins(userRoot).skins.map((s) => s.id);
    assert.ok(ids.includes('imported'));
  });
  ok('重复导入同一 id 视为覆盖安装（不报错）', () => {
    const again = store.importSkinFromDir(good, userRoot);
    assert.strictEqual(again.ok, true, again.errors.join('；'));
    assert.strictEqual(store.listSkins(userRoot).skins.filter((s) => s.id === 'imported').length, 1);
  });
  ok('导入失败（源非法）不留下半成品目录', () => {
    const badDir = path.join(src, 'bad');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'pet.json'), '{bad');
    const before = fs.readdirSync(userRoot).length;
    const r = store.importSkinFromDir(badDir, userRoot);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(fs.readdirSync(userRoot).length, before, '应无残留文件/目录');
  });
  ok('源目录不存在时安全失败', () => {
    const r = store.importSkinFromDir(path.join(src, 'nope'), userRoot);
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
  ok('超限的源目录在复制前就被拒（不做无谓拷贝）', () => {
    const hugeDir = makeSkin(path.join(src, 'huge-src'), { id: 'huge' });
    for (let i = 0; i < store.LIMITS.fileCount + 2; i++) {
      fs.writeFileSync(path.join(hugeDir, 'f' + i + '.png'), 'x');
    }
    const before = fs.readdirSync(userRoot).length;
    const r = store.importSkinFromDir(hugeDir, userRoot);
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /超限/.test(e)), r.errors.join('；'));
    assert.strictEqual(fs.readdirSync(userRoot).length, before);
  });
}

console.log('\n[7] 导出');
{
  const userRoot = tmpDir();
  const destRoot = tmpDir();
  const dir = makeSkin(path.join(userRoot, 'exp'), { id: 'exported', name: '导出的' });

  const res = store.exportSkin(dir, destRoot);
  ok('导出成功且目标是 dest/<id>', () => {
    assert.strictEqual(res.ok, true, res.errors.join('；'));
    assert.strictEqual(path.basename(res.dir), 'exported');
    assert.ok(fs.existsSync(path.join(res.dir, 'pet.json')));
  });
  ok('导出内容与源一致（pet.json 可解析且 id 相同）', () => {
    const back = JSON.parse(fs.readFileSync(path.join(res.dir, 'pet.json'), 'utf8'));
    assert.strictEqual(back.id, 'exported');
  });
  ok('目标已存在时拒绝覆盖（避免误删用户数据）', () => {
    const again = store.exportSkin(dir, destRoot);
    assert.strictEqual(again.ok, false);
    assert.ok(again.errors.some((e) => /已存在/.test(e)), again.errors.join('；'));
  });
  ok('导出非法皮肤被拒', () => {
    const bad = path.join(userRoot, 'bad');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'pet.json'), '{bad');
    assert.strictEqual(store.exportSkin(bad, destRoot).ok, false);
  });
  ok('源目录不存在时安全失败', () => {
    const r = store.exportSkin(path.join(userRoot, 'nope'), destRoot);
    assert.strictEqual(r.ok, false);
  });
}

console.log('\n[8] isInside 边界（前缀陷阱）');
{
  const inside = store.isInside;
  ok('/a/b 在 /a/b 内', () => assert.strictEqual(inside(path.join('C:', 'a', 'b'), path.join('C:', 'a', 'b')), true));
  ok('/a/b/c 在 /a/b 内', () => assert.strictEqual(inside(path.join('C:', 'a', 'b'), path.join('C:', 'a', 'b', 'c')), true));
  ok('/a/bc 不在 /a/b 内（前缀相似但不是子路径）', () => {
    assert.strictEqual(inside(path.join('C:', 'a', 'b'), path.join('C:', 'a', 'bc')), false);
  });
  ok('/a 不在 /a/b 内', () => assert.strictEqual(inside(path.join('C:', 'a', 'b'), path.join('C:', 'a')), false));
}

// 清理临时目录
for (const d of tmpRoots) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
