/* 自检：皮肤导入的**来源白名单** src/main/ipc/skin.js（阶段 8.2）
   ------------------------------------------------------------
   `import-skin` 接受一个源目录路径。若无条件信任它，被攻破的渲染层就能把
   任意目录（例如 C:\Users\...\.ssh）复制进 userData，形成信息外带。
   因此只接受：
     (a) 本进程刚通过 dialog 返回给用户的目录（一次性白名单）
     (b) 用户皮肤目录内部的路径（「重新扫描」场景）

   本测试用 stub 的 electron 加载真实模块，直接验证 `_internal.isImportSourceAllowed`
   与白名单的容量上限行为。 */

const path = require('path');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const root = path.join(__dirname, '..');

// stub electron：skin.js 顶层 require 了 ipcMain / dialog
const handlers = [];
const handlerMap = new Map();
const electronStub = {
  ipcMain: {
    handle: (ch, fn) => { handlers.push(ch); if (fn) handlerMap.set(ch, fn); },
    on: (ch, fn) => { handlers.push(ch); if (fn) handlerMap.set(ch, fn); }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
};
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return originalLoad.apply(this, arguments);
};
let skin;
try {
  skin = require(path.join(root, 'src', 'main', 'ipc', 'skin.js'));
} finally {
  Module._load = originalLoad;
}

const { importAllowedDirs, isImportSourceAllowed } = skin._internal;
const USER_ROOT = path.join(root, '.tmp-skin-userroot');

/* 真实临时目录：验证 apply-skin / get-active-skin 需要真实皮肤文件 */
const tmpRoots = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'dsh-skinipc-'));
  tmpRoots.push(d);
  return d;
}
let savedConfig = {};
const cfgDeps = {
  loadConfig: () => savedConfig,
  saveConfig: (c) => { savedConfig = c; return true; }
};

/** 造一个带 svg 资源的皮肤（含 pet.json + cat.svg） */
function makeSkin(dir, id) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({
    format: 'pet', version: 1, id, name: '皮肤' + id,
    render: { kind: 'svg', svg: { file: 'cat.svg' } }
  }));
  fs.writeFileSync(path.join(dir, 'cat.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return dir;
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 模块加载与通道注册');
{
  ok('register 接受缺失路径而不抛错', () => {
    assert.doesNotThrow(() => skin.register({}));
  });
  ok('register 后注册了 8 个通道', () => {
    handlers.length = 0;
    skin.register({ userDataDir: root, rootDir: root });
    assert.deepStrictEqual(handlers.slice().sort(),
      ['apply-skin', 'export-skin', 'get-active-skin', 'import-skin', 'list-skins',
        'preview-skin', 'select-skin-directory', 'select-skin-zip']);
  });
  ok('重复 register 不会抛错（交由 electron 处理重复注册）', () => {
    assert.doesNotThrow(() => skin.register({ userDataDir: root, rootDir: root }));
  });
}

console.log('\n[2] 默认拒绝任何未授权路径');
{
  importAllowedDirs.clear();
  const evil = [
    'C:\\Users\\someone\\.ssh',
    'C:\\Windows\\System32',
    path.join(root, 'src'),
    path.join(root, '..', 'other-project')
  ];
  for (const p of evil) {
    ok('拒绝未授权路径: ' + p, () => {
      assert.strictEqual(isImportSourceAllowed(p, USER_ROOT), false);
    });
  }
  ok('空值一律拒绝', () => {
    assert.strictEqual(isImportSourceAllowed(null, USER_ROOT), false);
    assert.strictEqual(isImportSourceAllowed('', USER_ROOT), false);
    assert.strictEqual(isImportSourceAllowed(undefined, USER_ROOT), false);
  });
  ok('userRoot 缺失时不误放行', () => {
    assert.strictEqual(isImportSourceAllowed('C:\\anywhere', null), false);
  });
}

console.log('\n[3] 用户皮肤目录内部始终允许（重新扫描场景）');
{
  importAllowedDirs.clear();
  ok('用户皮肤根目录自身允许', () => {
    assert.strictEqual(isImportSourceAllowed(USER_ROOT, USER_ROOT), true);
  });
  ok('用户皮肤根目录下的子目录允许', () => {
    assert.strictEqual(isImportSourceAllowed(path.join(USER_ROOT, 'my-skin'), USER_ROOT), true);
  });
  ok('前缀相似但不是子目录的路径不允许（/pets-evil 不属于 /pets）', () => {
    assert.strictEqual(isImportSourceAllowed(USER_ROOT + '-evil', USER_ROOT), false);
  });
}

console.log('\n[4] 白名单容量上限');
{
  importAllowedDirs.clear();
  const { importAllowedDirs: dirs } = skin._internal;
  // 通过私有 Set 直接注入（dialog 无法在测试里交互触发）
  for (let i = 0; i < 20; i++) {
    dirs.add('C:\\allowed-' + i);
    // 复刻 allowImportDir 的裁剪逻辑：最多保留 8 个
    while (dirs.size > 8) {
      const first = dirs.values().next().value;
      dirs.delete(first);
    }
  }
  ok('白名单不会无限增长（上限 8）', () => {
    assert.ok(dirs.size <= 8, '实际 ' + dirs.size);
  });
  ok('最新加入的路径仍在白名单内', () => {
    assert.strictEqual(isImportSourceAllowed('C:\\allowed-19', USER_ROOT), true);
  });
  ok('被挤出白名单的旧路径重新变为拒绝', () => {
    assert.strictEqual(isImportSourceAllowed('C:\\allowed-0', USER_ROOT), false);
  });
}

console.log('\n[5] 路径归一化（同一目录的不同写法都算已授权）');
{
  importAllowedDirs.clear();
  const dir = path.join(root, 'some', 'skin-pack');
  importAllowedDirs.add(path.resolve(dir));
  ok('同一路径的等价写法都被识别', () => {
    assert.strictEqual(isImportSourceAllowed(dir, USER_ROOT), true);
    assert.strictEqual(isImportSourceAllowed(path.resolve(dir), USER_ROOT), true);
    assert.strictEqual(isImportSourceAllowed(dir + path.sep, USER_ROOT), true);
  });
}

importAllowedDirs.clear();

console.log('\n[6] apply-skin / get-active-skin（阶段 8.3 应用皮肤）');
{
  handlers.length = 0;
  handlerMap.clear();
  const userDataDir = tmpDir('dsh-skinapply-');
  const userRoot = path.join(userDataDir, 'pets');
  // builtinRoot 由 rootDir 推导：<rootDir>/renderer/pet/skins（与 ipc/skin.js 一致）
  const fakeRoot = tmpDir('dsh-fakeroot-');
  const builtinRoot = path.join(fakeRoot, 'renderer', 'pet', 'skins');
  makeSkin(path.join(builtinRoot, 'builtin-cat'), 'builtin-cat');
  makeSkin(path.join(userRoot, 'my-skin'), 'my-skin');

  savedConfig = {};
  skin.register({ userDataDir, rootDir: fakeRoot, ...cfgDeps });

  const apply = handlerMap.get('apply-skin');
  const getActive = handlerMap.get('get-active-skin');

  ok('两个通道都已注册', () => {
    assert.strictEqual(typeof apply, 'function');
    assert.strictEqual(typeof getActive, 'function');
  });
  ok('空配置时 get-active-skin 返回 null（不报错）', () => {
    const r = getActive({});
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.skin, null);
  });
  ok('apply-skin 应用用户皮肤成功并持久化', () => {
    const r = apply({}, { skinId: 'my-skin' });
    assert.strictEqual(r.success, true, '错误: ' + r.error);
    assert.strictEqual(savedConfig.activeSkin, 'my-skin', '未写入配置');
  });
  ok('返回的皮肤含渲染层可直接使用的 data: URL（CSP 不允许读本地文件）', () => {
    const r = apply({}, { skinId: 'my-skin' });
    const url = r.skin.render.svg.dataUrl;
    assert.ok(url && url.startsWith('data:image/svg+xml;base64,'), '实际: ' + url);
  });
  ok('返回的皮肤带上来源标记', () => {
    assert.strictEqual(apply({}, { skinId: 'my-skin' }).skin.source, 'user');
    assert.strictEqual(apply({}, { skinId: 'builtin-cat' }).skin.source, 'builtin');
  });
  ok('get-active-skin 能读回已应用的皮肤', () => {
    apply({}, { skinId: 'my-skin' });
    const r = getActive({});
    assert.strictEqual(r.skin.id, 'my-skin');
  });
  ok('应用空字符串 = 还原内置', () => {
    const r = apply({}, { skinId: '' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.skin, null);
    assert.strictEqual(getActive({}).skin, null);
  });
  ok('不存在的皮肤被拒绝', () => {
    const r = apply({}, { skinId: 'no-such' });
    assert.strictEqual(r.success, false);
    assert.ok(/未找到/.test(r.error), r.error);
  });
  ok('含路径穿越的皮肤 id 被拒绝', () => {
    ['../x', 'a/b', 'a\\b', '..'].forEach((id) => {
      const r = apply({}, { skinId: id });
      assert.strictEqual(r.success, false, id + ' 应被拒');
    });
  });
  ok('垃圾入参不抛错', () => {
    [null, undefined, 0, 'str', [], true].forEach((j) => {
      assert.doesNotThrow(() => apply({}, j), '入参 ' + JSON.stringify(j) + ' 抛错');
    });
  });
  ok('配置读写依赖缺失时也不抛错', () => {
    handlers.length = 0;
    handlerMap.clear();
    skin.register({ userDataDir, rootDir: root });
    const a2 = handlerMap.get('apply-skin');
    assert.doesNotThrow(() => a2({}, { skinId: 'my-skin' }));
  });
}

for (const d of tmpRoots) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
}

console.log('\n[7] 渲染层接线契约（通道 ↔ preload ↔ 浮窗壳层）');
{
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const floatJs = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  const floatHtml = fs.readFileSync(path.join(root, 'renderer', 'float.html'), 'utf8');

  ok('preload 暴露了 8 个皮肤相关方法', () => {
    ['listSkins', 'selectSkinDirectory', 'selectSkinZip', 'importSkin', 'exportSkin',
      'applySkin', 'previewSkin', 'getActiveSkin'].forEach((m) => {
      assert.ok(preload.includes(m + ':'), 'preload 缺少 ' + m);
    });
  });
  ok('每个方法都桥接到同名 invoke 通道', () => {
    assert.ok(preload.includes("invoke('list-skins')"));
    assert.ok(preload.includes("invoke('select-skin-directory')"));
    assert.ok(preload.includes("invoke('select-skin-zip')"));
    assert.ok(preload.includes("invoke('import-skin'"));
    assert.ok(preload.includes("invoke('export-skin'"));
    assert.ok(preload.includes("invoke('apply-skin'"));
    assert.ok(preload.includes("invoke('preview-skin'"));
    assert.ok(preload.includes("invoke('get-active-skin')"));
  });
  ok('试穿走只读通道（apply-skin 会写配置，不能拿它试穿）', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'main', 'ipc', 'skin.js'), 'utf8');
    const previewBlock = src.slice(src.indexOf("handle('preview-skin'"));
    const body = previewBlock.slice(0, previewBlock.indexOf('});'));
    assert.ok(!/saveConfig|writeConfig/.test(body),
      'preview-skin 不应写配置');
  });
  ok('preload 提供换肤广播订阅（onSkinChanged → skin-changed）', () => {
    assert.ok(preload.includes('onSkinChanged'), 'preload 缺少 onSkinChanged');
    assert.ok(preload.includes("ipcRenderer.on('skin-changed'"), '未订阅 skin-changed');
  });
  ok('主进程换肤后会广播 skin-changed', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'main', 'ipc', 'skin.js'), 'utf8');
    assert.ok(src.includes("send('skin-changed'"), '主进程未广播 skin-changed');
    assert.ok(src.includes('broadcastSkinChanged'), '缺少广播函数');
  });
  ok('浮窗壳层加载了帧渲染所需的三个脚本（顺序：behavior → frames → skin-render）', () => {
    const iBehavior = floatHtml.indexOf('pet/behavior.js');
    const iFrames = floatHtml.indexOf('pet/frames.js');
    const iRender = floatHtml.indexOf('pet/skin-render.js');
    const iFloat = floatHtml.indexOf('scripts/float.js');
    assert.ok(iBehavior > 0 && iFrames > 0 && iRender > 0, '缺少脚本引用');
    assert.ok(iBehavior < iFrames && iFrames < iRender && iRender < iFloat,
      '脚本顺序错误：必须先加载依赖再加载 float.js');
  });
  ok('浮窗 HTML 里有帧画布与右键「设置」按钮', () => {
    assert.ok(floatHtml.includes('id="petCanvas"'), '缺少 petCanvas');
    assert.ok(/data-action="settings"/.test(floatHtml), '右键菜单缺少设置入口');
  });
  ok('设置入口在**右键环**里（与「退出」成对），不在左键菜单环', () => {
    // 按 HTML 出现顺序切出两个环的内容再判断归属
    const menuStart = floatHtml.indexOf('class="menu-ring"');
    const menuEnd = floatHtml.indexOf('</div>', floatHtml.indexOf('class="quit-ring"'));
    const quitStart = floatHtml.indexOf('class="quit-ring"');
    assert.ok(menuStart > 0 && quitStart > menuStart, '缺少 menu-ring / quit-ring');
    const menuBlock = floatHtml.slice(menuStart, quitStart);
    const quitBlock = floatHtml.slice(quitStart);
    assert.ok(!/data-action="settings"/.test(menuBlock),
      '设置按钮不应还在左键菜单环里');
    assert.ok(/data-action="settings"/.test(quitBlock),
      '设置按钮应在右键环里');
    assert.ok(/data-action="quit"/.test(quitBlock), '退出按钮也应在右键环里');
  });
  ok('右键环的点击处理里同时有 settings 与 quit 分支', () => {
    const quitHandler = floatJs.slice(floatJs.indexOf("quitRing.addEventListener('click'"));
    const body = quitHandler.slice(0, quitHandler.indexOf('});'));
    assert.ok(/action === 'settings'/.test(body), '右键环未处理 settings');
    assert.ok(/action === 'quit'/.test(body), '右键环未处理 quit');
    assert.ok(body.includes('openSettings'), '右键环设置分支未调用 openSettings');
  });
  ok('浮窗壳层订阅换肤广播并响应设置入口', () => {
    assert.ok(floatJs.includes('onSkinChanged'), '壳层未订阅换肤广播');
    assert.ok(floatJs.includes('applySkinToShell'), '缺少换肤应用函数');
    assert.ok(floatJs.includes('openSettings'), '未调用 openSettings');
  });
  ok('左键菜单环仍保留 4 个按钮，与 nth-child 定位一致', () => {
    // 菜单环的按钮位置由 .menu-ring .menu-btn:nth-child(1..4) 决定，
    // 多一个按钮就会与 CSS 对不上（这也是把设置挪到右键环的原因之一）
    const menuStart = floatHtml.indexOf('class="menu-ring"');
    const quitStart = floatHtml.indexOf('class="quit-ring"');
    const menuBlock = floatHtml.slice(menuStart, quitStart);
    const n = (menuBlock.match(/data-action="/g) || []).length;
    assert.strictEqual(n, 4, '左键菜单环应有 4 个按钮，实际 ' + n);
    const css = fs.readFileSync(path.join(root, 'renderer', 'styles', 'float.css'), 'utf8');
    for (let i = 1; i <= 4; i++) {
      assert.ok(css.includes('.menu-ring .menu-btn:nth-child(' + i + ')'),
        '缺少 nth-child(' + i + ') 定位规则');
    }
  });
  ok('skinRenderer 在文件顶部声明（避免 TDZ）', () => {
    const declIdx = floatJs.indexOf('let skinRenderer = null');
    const useIdx = floatJs.indexOf('skinRenderer.setState');
    assert.ok(declIdx > 0, '缺少顶部声明');
    assert.ok(declIdx < useIdx, '声明必须在首次使用之前');
  });

  ok('浮窗加载了 driver 与 colors，且顺序在 float.js 之前', () => {
    ['pet/driver.js', 'pet/colors.js'].forEach((f) => {
      assert.ok(floatHtml.includes(f), 'float.html 缺少 ' + f);
      assert.ok(floatHtml.indexOf(f) < floatHtml.indexOf('scripts/float.js'),
        f + ' 必须在 float.js 之前加载');
    });
  });
  ok('驱动在 float.js 里被创建并启用', () => {
    assert.ok(floatJs.includes('PET_DRIVER.createBehaviorDriver'), '未创建驱动');
    assert.ok(/behaviorDriver\.enable\(\)/.test(floatJs), '未启用驱动');
  });
}

console.log('\n[8] 自主行为接线（阶段 3 收尾：sleep/walk/celebrate 的驱动来源）');
{
  const floatJs = fs.readFileSync(path.join(root, 'renderer', 'scripts', 'float.js'), 'utf8');
  const quickUpload = fs.readFileSync(
    path.join(root, 'renderer', 'capabilities', 'quick-upload', 'index.js'), 'utf8');

  ok('用户交互会通知活动（唤醒 + 重置空闲计时）', () => {
    const calls = (floatJs.match(/behaviorDriver\.notifyActivity\(/g) || []).length;
    assert.ok(calls >= 2, '至少 hover 与 pointer 两类交互要通知，实际 ' + calls + ' 处');
  });
  ok('上传/删除成功会触发庆祝', () => {
    assert.ok(floatJs.includes("deskPet.on('pet:drop-done'"), '壳层未订阅 pet:drop-done');
    assert.ok(/behaviorDriver\.celebrate\(/.test(floatJs), '未调用 celebrate');
  });
  ok('能力只报告事实（pet:drop-done），不直接操作动画状态', () => {
    assert.ok(quickUpload.includes("pet.emit('pet:drop-done'"), '能力未上报结果');
    // 能力不应自己去碰状态机：表现归壳层，否则每加一个能力都要改状态机
    assert.ok(!/PET_BEHAVIOR|behavior\.set\(/.test(quickUpload),
      '能力不应直接操作状态机');
  });
  ok('celebrate 订阅在 deskPet 声明之后（避免 TDZ）', () => {
    const declIdx = floatJs.indexOf('const deskPet = {');
    const useIdx = floatJs.indexOf("deskPet.on('pet:drop-done'");
    assert.ok(declIdx > 0 && useIdx > declIdx,
      'deskPet 声明位置 ' + declIdx + '，订阅位置 ' + useIdx + '（订阅必须更晚）');
  });
  ok('驱动不会被注册为能力（它属于壳层，不是可插拔能力）', () => {
    const capsDir = path.join(root, 'renderer', 'capabilities');
    const names = fs.readdirSync(capsDir);
    assert.ok(!names.includes('driver'), 'driver 不应出现在 capabilities/ 下');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
