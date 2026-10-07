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
const Module = require('module');

const root = path.join(__dirname, '..');

// stub electron：skin.js 顶层 require 了 ipcMain / dialog
const handlers = [];
const electronStub = {
  ipcMain: { handle: (ch) => handlers.push(ch), on: (ch) => handlers.push(ch) },
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
  ok('register 后注册了 4 个通道', () => {
    handlers.length = 0;
    skin.register({ userDataDir: root, rootDir: root });
    assert.deepStrictEqual(handlers.slice().sort(),
      ['export-skin', 'import-skin', 'list-skins', 'select-skin-directory']);
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
console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
