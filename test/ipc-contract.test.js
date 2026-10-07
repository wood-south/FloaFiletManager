/* 自检：主进程能力层契约（阶段 5）
   锁定三件事，任一处漂移都会失败：

   1. **能力声明 ↔ 真实注册**：每个能力 `channels` 声明的通道集合，必须与它
      实际注册的通道集合完全一致（多一个/少一个都算错）。
      做法：stub 掉 electron 的 ipcMain，把真实模块 require 进来跑一遍，
      收集真正注册了哪些通道。
   2. **能力覆盖全部通道**：能力声明的并集必须等于真实模块注册的并集，
      且各能力之间不得重复声明（一个通道只能属于一个能力）。
   3. **能力层 ↔ preload**：preload 桥接的通道与主进程注册的通道一一对应
      （无孤立、无幽灵）。这是渲染层能正常调用的前提。

   注意：本测试用 require.cache 注入假的 'electron'，因此不依赖真实 Electron。*/

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const root = path.join(__dirname, '..');
const mainDir = path.join(root, 'src', 'main');

/* ---------- 收集「真实注册」的通道：stub electron.ipcMain ---------- */
const registered = [];
const ipcMain = {
  handle: (channel) => { registered.push(channel); },
  on: (channel) => { registered.push(channel); }
};

const electronStub = {
  ipcMain,
  app: {
    isPackaged: false,
    getPath: () => path.join(root, '.tmp-test'),
    setPath: () => {},
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  BrowserWindow: class { },
  dialog: {},
  shell: { openPath: () => Promise.resolve(''), showItemInFolder: () => {} },
  nativeImage: { createFromDataURL: () => ({}), createEmpty: () => ({}) }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.apply(this, arguments);
};

let capsModule;
try {
  // config.js 在 require 时会 mkdir userData，这里给个临时目录并确保可写
  capsModule = require(path.join(mainDir, 'capabilities', 'index.js'));
} finally {
  Module._load = originalLoad;
}

const { CAPABILITIES, allDeclaredChannels, isEnabled, listMeta } = capsModule;

/* 跑一遍真实注册（collect 模式：只收集通道名，不校验依赖齐全） */
const noop = () => {};
const fakeDeps = {
  loadConfig: () => ({ capabilities: {}, savePath: root, partitions: [] }),
  saveConfig: noop,
  screen: electronStub.screen,
  app: electronStub.app,
  userDataDir: path.join(root, '.userdata'),
  rootDir: root,
  windows: {
    getFloatWindow: () => null,
    getFileManagerWindow: () => null,
    getDockWindow: () => null,
    createFileManagerWindow: noop,
    getAlwaysOnTopEnabled: () => true,
    setAlwaysOnTopEnabled: noop,
    getDockAlwaysOnTopEnabled: () => true,
    setDockAlwaysOnTopEnabled: noop
  },
  iconCache: new Map(),
  scheduleSaveIconCache: noop,
  iconExtractor: {}
};

const perCapability = {};
for (const cap of CAPABILITIES) {
  registered.length = 0;
  try {
    const built = typeof cap.build === 'function' ? cap.build(fakeDeps) : fakeDeps;
    cap.register(built);
  } catch (err) {
    console.log('  (注册 ' + cap.id + ' 时抛错，仍继续收集已注册通道): ' + err.message);
  }
  perCapability[cap.id] = registered.slice();
}

const preloadSrc = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const preloadChannels = Array.from(new Set(
  (preloadSrc.match(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g) || [])
    .map((m) => m.match(/'([^']+)'/)[1])
));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const sortJoin = (arr) => arr.slice().sort().join(', ');

console.log('\n[1] 能力声明 ↔ 真实注册（逐个能力）');
for (const cap of CAPABILITIES) {
  const real = Array.from(new Set(perCapability[cap.id])).sort();
  const declared = cap.channels.slice().sort();
  ok(cap.id + '：声明 ' + declared.length + ' 个通道，与真实注册一致', () => {
    assert.strictEqual(declared.length, real.length,
      '数量不符 声明=' + declared.length + ' 真实=' + real.length +
      '\n  仅声明未注册: ' + declared.filter((c) => !real.includes(c)).join(', ') +
      '\n  已注册未声明: ' + real.filter((c) => !declared.includes(c)).join(', '));
    assert.deepStrictEqual(declared, real, '集合不一致');
  });
}

console.log('\n[2] 能力之间不重复声明 + 并集覆盖全部');
{
  const all = allDeclaredChannels();
  ok('无重复声明（一个通道只属于一个能力）', () => {
    const seen = new Set();
    const dup = [];
    for (const ch of all) {
      if (seen.has(ch)) dup.push(ch);
      seen.add(ch);
    }
    assert.deepStrictEqual(dup, [], '重复声明: ' + dup.join(', '));
  });
  ok('声明并集 = 全部真实注册通道', () => {
    const realAll = Array.from(new Set(
      Object.values(perCapability).flat()
    )).sort();
    assert.deepStrictEqual(all.slice().sort(), realAll,
      '差异 —— 仅声明: ' + all.filter((c) => !realAll.includes(c)).join(', ') +
      ' | 仅注册: ' + realAll.filter((c) => !all.includes(c)).join(', '));
  });
  ok('能力总数与元信息一致', () => {
    assert.strictEqual(listMeta().length, CAPABILITIES.length);
    listMeta().forEach((m) => assert.ok(m.channelCount > 0, m.id + ' 声明了 0 个通道'));
  });
}

console.log('\n[3] 能力层 ↔ preload 一一对应');
{
  const declared = allDeclaredChannels().slice().sort();
  const pre = preloadChannels.slice().sort();
  ok('主进程通道数 = preload 桥接通道数', () => {
    assert.strictEqual(declared.length, pre.length,
      '主进程=' + declared.length + ' preload=' + pre.length);
  });
  ok('无孤立（preload 调用了但主进程没注册）', () => {
    const orphan = pre.filter((c) => !declared.includes(c));
    assert.deepStrictEqual(orphan, [], '孤立: ' + orphan.join(', '));
  });
  ok('无幽灵（主进程注册了但 preload 未桥接）', () => {
    const ghost = declared.filter((c) => !pre.includes(c));
    assert.deepStrictEqual(ghost, [], '幽灵: ' + ghost.join(', '));
  });
}

console.log('\n[4] 能力启停语义');
{
  ok('缺省（无配置）时全部启用', () => {
    const cfg = { capabilities: {} };
    CAPABILITIES.forEach((cap) => {
      assert.strictEqual(isEnabled(cfg, cap), true, cap.id + ' 应默认启用');
    });
  });
  ok('显式 false 时关闭', () => {
    const cap = CAPABILITIES[0];
    assert.strictEqual(isEnabled({ capabilities: { [cap.id]: false } }, cap), false);
  });
  ok('显式 true 时启用', () => {
    const cap = CAPABILITIES[0];
    assert.strictEqual(isEnabled({ capabilities: { [cap.id]: true } }, cap), true);
  });
  ok('对象形式 { enabled: false } 也算关闭（配置命名空间与渲染侧能力共用）', () => {
    const cap = CAPABILITIES[0];
    assert.strictEqual(isEnabled({ capabilities: { [cap.id]: { enabled: false } } }, cap), false);
  });
  ok('配置缺失 capabilities 字段时不崩且视为启用', () => {
    const cap = CAPABILITIES[0];
    assert.strictEqual(isEnabled({}, cap), true);
    assert.strictEqual(isEnabled(null, cap), true);
  });
  ok('关闭某能力后其通道不再被声明加载（loadAll 的跳过路径）', () => {
    const target = CAPABILITIES[1];
    const cfg = { capabilities: { [target.id]: false } };
    assert.strictEqual(isEnabled(cfg, target), false);
    // 其余能力不受影响
    CAPABILITIES.filter((c) => c.id !== target.id).forEach((c) => {
      assert.strictEqual(isEnabled(cfg, c), true, c.id + ' 不应被连带关闭');
    });
  });

  ok('loadAll 真的会跳过被关闭的能力（不是只算了个布尔值）', () => {
    const target = CAPABILITIES.find((c) => c.id === 'system');
    const seen = [];
    const spyMain = {
      handle: (ch) => seen.push(ch),
      on: (ch) => seen.push(ch)
    };
    const prevIpcMain = electronStub.ipcMain;
    electronStub.ipcMain = spyMain;
    // 各 ipc 模块在 require 时已捕获 ipcMain 引用，因此这里改用 loadAll 的返回值断言
    let summary;
    const disabledDeps = Object.assign({}, fakeDeps, {
      loadConfig: () => ({
        capabilities: { [target.id]: false },
        savePath: root,
        partitions: []
      })
    });
    try {
      summary = capsModule.loadAll(disabledDeps);
    } finally {
      electronStub.ipcMain = prevIpcMain;
    }
    assert.ok(summary.skipped.includes(target.id), '被关闭的能力应出现在 skipped 里');
    assert.ok(!summary.loaded.includes(target.id), '被关闭的能力不应出现在 loaded 里');
    assert.strictEqual(summary.loaded.length + summary.skipped.length, CAPABILITIES.length,
      'loaded + skipped 应等于能力总数');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
