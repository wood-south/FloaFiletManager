/* 自检：皮肤 IPC 处理器的**行为** src/main/ipc/skin.js（阶段 9.1）
   ------------------------------------------------------------
   既有的 test/skin-ipc.test.js 只验证「注册了哪些通道」；
   本测试验证「调用之后真的做了什么」—— 把 ipcMain.handle 的注册回调抓下来
   直接调用，用真实临时目录与 stub 的 dialog 观察结果。

   重点守住的**安全不变量**：
   - 未授权路径的导入必须在**打开选择框之前**就被拒绝
     （否则等于给了渲染层一个「弹框骗用户点确定」的路径）
   - 被拒绝的导入**不得在磁盘上留下任何东西**
   - 导出同样先校验皮肤存在与合法性，再弹选择框

   以及**成功路径**：选择框授权 → 导入真的落盘 → list-skins 真的能看到。 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const root = path.join(__dirname, '..');

/* ---------- 可控的 electron 桩 ---------- */
const handlers = new Map();
const dialogCalls = [];
let nextDialogResult = { canceled: true, filePaths: [] };

/* 广播用的窗口列表：必须在模块加载前就提供 BrowserWindow，
   因为 skin.js 在模块顶层就解构了它（顶层解构后无法再注入）。 */
const broadcastWindows = [];

const electronStub = {
  ipcMain: {
    handle: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => handlers.set(ch, fn)
  },
  dialog: {
    showOpenDialog: async (opts) => {
      dialogCalls.push(opts);
      return nextDialogResult;
    }
  },
  BrowserWindow: {
    getAllWindows: () => broadcastWindows.map((w) => ({
      isDestroyed: () => false,
      webContents: { send: (ch, payload) => w.sent.push({ ch, payload }) }
    }))
  }
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

/* ---------- 真实临时目录 ---------- */
const tmpRoots = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'dsh-ipc-'));
  tmpRoots.push(d);
  return d;
}

/** 造一个最小可用皮肤包 */
function makeSkin(dir, id, opt) {
  const o = opt || {};
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({
    format: 'pet',
    version: 1,
    id,
    name: o.name || id,
    render: { kind: 'svg', svg: { file: 'cat.svg' } }
  }));
  fs.writeFileSync(path.join(dir, 'cat.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return dir;
}

const userDataDir = tmpDir('dsh-ipc-userdata-');
const userRoot = path.join(userDataDir, 'pets');
skin.register({ userDataDir, rootDir: root });

const listSkins = handlers.get('list-skins');
const importSkin = handlers.get('import-skin');
const exportSkin = handlers.get('export-skin');
const selectDir = handlers.get('select-skin-directory');

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

(async function main() {
  console.log('\n[1] list-skins');
  {
    const res = listSkins({});
    ok('返回 success 与两类皮肤数组（内置目录不存在时为空而非报错）', () => {
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.builtin), 'builtin 应为数组');
      assert.ok(Array.isArray(res.user), 'user 应为数组');
      assert.ok(Array.isArray(res.errors), 'errors 应为数组');
    });
    ok('透出 userRoot / builtinRoot 供 UI 显示', () => {
      assert.strictEqual(res.userRoot, userRoot);
      assert.ok(res.builtinRoot.includes('skins'));
    });
    ok('用户目录尚不存在时返回空列表（不抛错）', () => {
      assert.deepStrictEqual(res.user, []);
    });
  }

  console.log('\n[2] import-skin 的安全不变量');
  {
    dialogCalls.length = 0;
    const outside = makeSkin(tmpDir('dsh-ipc-evil-'), 'evil', { name: '恶意' });

    const res = importSkin({}, { sourceDir: outside });
    ok('未授权路径被拒绝', () => {
      assert.strictEqual(res.success, false);
      assert.ok(/不是通过/.test(res.error), '错误信息: ' + res.error);
    });
    ok('拒绝时**没有**弹出选择框（安全性：不给骗用户点确定的路径）', () => {
      assert.strictEqual(dialogCalls.length, 0, '不应调用 dialog');
    });
    ok('拒绝时磁盘上不留任何东西', () => {
      assert.ok(!fs.existsSync(userRoot) || fs.readdirSync(userRoot).length === 0,
        '用户皮肤目录应仍为空');
    });
    ok('缺少 sourceDir 时安全失败', () => {
      const r1 = importSkin({}, {});
      const r2 = importSkin({}, undefined);
      const r3 = importSkin({}, { sourceDir: 123 });
      [r1, r2, r3].forEach((r) => {
        assert.strictEqual(r.success, false);
        assert.ok(r.error, '应有错误信息');
      });
    });
    ok('指向用户皮肤目录之外但看似合法的路径仍被拒', () => {
      const r = importSkin({}, { sourceDir: path.join(userDataDir, '..') });
      assert.strictEqual(r.success, false);
    });
  }

  console.log('\n[3] 选择目录 → 导入 → 列出（完整成功路径）');
  {
    const src = makeSkin(tmpDir('dsh-ipc-src-'), 'my-cool-skin', { name: '酷皮肤' });

    await okAsync('用户取消选择时返回 null', async () => {
      nextDialogResult = { canceled: true, filePaths: [] };
      const picked = await selectDir({});
      assert.strictEqual(picked, null);
    });

    await okAsync('选择目录会弹出对话框并返回路径', async () => {
      nextDialogResult = { canceled: false, filePaths: [src] };
      const picked = await selectDir({});
      assert.strictEqual(picked, src);
      assert.ok(dialogCalls.length >= 1, '应调用 dialog');
      assert.ok(dialogCalls[dialogCalls.length - 1].properties.includes('openDirectory'));
    });

    await okAsync('经授权的目录可以导入成功', async () => {
      const res = importSkin({}, { sourceDir: src });
      assert.strictEqual(res.success, true, '错误: ' + res.error);
      assert.strictEqual(res.skin.id, 'my-cool-skin');
      assert.strictEqual(res.skin.name, '酷皮肤');
    });

    ok('导入后文件真的落盘到 userData/pets/<id>', () => {
      const dir = path.join(userRoot, 'my-cool-skin');
      assert.ok(fs.existsSync(path.join(dir, 'pet.json')), '缺少 pet.json');
      assert.ok(fs.existsSync(path.join(dir, 'cat.svg')), '缺少资源文件');
    });

    ok('导入后 list-skins 能列出它', () => {
      const res = listSkins({});
      const ids = res.user.map((s) => s.id);
      assert.ok(ids.includes('my-cool-skin'), '实际: ' + JSON.stringify(ids));
    });

    ok('用户皮肤目录内部的路径无需弹框即可再次导入（重新扫描场景）', () => {
      const inner = path.join(userRoot, 'my-cool-skin');
      const res = importSkin({}, { sourceDir: inner });
      assert.strictEqual(res.success, true, '错误: ' + res.error);
    });

    ok('重复导入同一 id 视为覆盖安装，列表不出现重复项', () => {
      const res = listSkins({});
      const n = res.user.filter((s) => s.id === 'my-cool-skin').length;
      assert.strictEqual(n, 1, '出现重复项 ' + n + ' 个');
    });
  }

  console.log('\n[4] import-skin 对非法包的处置');
  {
    const bad = tmpDir('dsh-ipc-bad-');
    fs.mkdirSync(path.join(bad, 'not-a-skin'), { recursive: true });
    fs.writeFileSync(path.join(bad, 'not-a-skin', 'pet.json'), '{ not json');

    await okAsync('先授权该目录', async () => {
      nextDialogResult = { canceled: false, filePaths: [path.join(bad, 'not-a-skin')] };
      const picked = await selectDir({});
      assert.ok(picked);
    });
    ok('非法包被拒绝且给出原因', () => {
      const res = importSkin({}, { sourceDir: path.join(bad, 'not-a-skin') });
      assert.strictEqual(res.success, false);
      assert.ok(res.error && res.error.length > 0, '应有原因');
    });
    ok('被拒的包不落盘', () => {
      assert.ok(!fs.existsSync(path.join(userRoot, 'not-a-skin')));
    });
    ok('目录里没有残留 .importing-* 临时目录', () => {
      if (!fs.existsSync(userRoot)) return;
      const leftovers = fs.readdirSync(userRoot).filter((n) => n.startsWith('.importing-'));
      assert.deepStrictEqual(leftovers, [], '残留: ' + leftovers.join(', '));
    });
  }

  console.log('\n[5] export-skin 在校验之后才弹框');
  {
    dialogCalls.length = 0;
    const destRoot = tmpDir('dsh-ipc-dest-');

    await okAsync('不存在的皮肤 id 被拒，且**没有**弹选择框', async () => {
      const res = await exportSkin({}, { skinId: 'no-such-skin' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(dialogCalls.length, 0, '不应调用 dialog');
    });

    await okAsync('非法皮肤 id（含路径穿越）被拒，且没有弹框', async () => {
      for (const badId of ['../evil', 'a/b', 'a\\b', '..']) {
        const res = await exportSkin({}, { skinId: badId });
        assert.strictEqual(res.success, false, badId + ' 应被拒');
      }
      assert.strictEqual(dialogCalls.length, 0);
    });

    await okAsync('缺少 skinId 被拒', async () => {
      const res = await exportSkin({}, {});
      assert.strictEqual(res.success, false);
      assert.strictEqual(dialogCalls.length, 0);
    });

    await okAsync('用户取消导出时返回 canceled（不报错）', async () => {
      nextDialogResult = { canceled: true, filePaths: [] };
      const res = await exportSkin({}, { skinId: 'my-cool-skin' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.canceled, true);
      assert.ok(dialogCalls.length >= 1, '这一次应已弹框');
    });

    await okAsync('合法皮肤 + 选定目录 → 导出成功且内容可再次导入', async () => {
      nextDialogResult = { canceled: false, filePaths: [destRoot] };
      const res = await exportSkin({}, { skinId: 'my-cool-skin' });
      assert.strictEqual(res.success, true, '错误: ' + res.error);
      const exported = path.join(destRoot, 'my-cool-skin');
      assert.ok(fs.existsSync(path.join(exported, 'pet.json')), '导出目录缺少 pet.json');
      const back = JSON.parse(fs.readFileSync(path.join(exported, 'pet.json'), 'utf8'));
      assert.strictEqual(back.id, 'my-cool-skin');
    });

    await okAsync('目标已存在时再次导出被拒（不覆盖用户数据）', async () => {
      nextDialogResult = { canceled: false, filePaths: [destRoot] };
      const res = await exportSkin({}, { skinId: 'my-cool-skin' });
      assert.strictEqual(res.success, false);
      assert.ok(/已存在/.test(res.error), '错误: ' + res.error);
    });
  }

  console.log('\n[6] handler 永不抛错（渲染层不应因主进程异常而挂起）');
  {
    ok('list-skins 传垃圾参数也不抛错', () => {
      assert.doesNotThrow(() => listSkins(undefined));
    });
    ok('import-skin 传垃圾参数也不抛错', () => {
      assert.doesNotThrow(() => importSkin(undefined, null));
    });
    await okAsync('export-skin 传垃圾参数也不抛错', async () => {
      let r;
      await assert.doesNotReject(async () => { r = await exportSkin(null, null); });
      assert.strictEqual(r.success, false);
    });
  }

  console.log('\n[7] 还原内置：必须广播，否则浮窗不刷新（用户实测缺陷）');
  {
    let savedConfig = {};
    handlers.clear();
    skin.register({
      userDataDir,
      rootDir: root,
      loadConfig: () => savedConfig,
      saveConfig: (c) => { savedConfig = c; return true; }
    });
    const applySkin = handlers.get('apply-skin');
    const getActive = handlers.get('get-active-skin');
    const w = { sent: [] };
    broadcastWindows.length = 0;
    broadcastWindows.push(w);

    ok('先应用一个皮肤，确认会广播', () => {
      w.sent.length = 0;
      const r = applySkin({}, { skinId: 'my-cool-skin' });
      assert.strictEqual(r.success, true, '错误: ' + r.error);
      assert.strictEqual(w.sent.length, 1, '未广播');
      assert.strictEqual(w.sent[0].ch, 'skin-changed');
      assert.ok(w.sent[0].payload && w.sent[0].payload.id === 'my-cool-skin');
    });

    ok('还原内置（skinId = ""）也**必须**广播（此前漏了，浮窗不刷新）', () => {
      w.sent.length = 0;
      const r = applySkin({}, { skinId: '' });
      assert.strictEqual(r.success, true, '错误: ' + r.error);
      assert.strictEqual(r.skin, null, '还原时 skin 应为 null');
      assert.strictEqual(w.sent.length, 1, '还原时没有广播，浮窗不会刷新');
      assert.strictEqual(w.sent[0].ch, 'skin-changed');
      assert.strictEqual(w.sent[0].payload, null, '还原时应广播 null');
    });

    ok('还原后配置里 activeSkin 被清空', () => {
      assert.strictEqual(savedConfig.activeSkin, '');
    });

    ok('还原后 get-active-skin 返回 null（浮窗查询也会得到内置）', () => {
      const r = getActive({});
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.skin, null);
    });

    ok('还原状态可再切回皮肤（来回切换都广播）', () => {
      w.sent.length = 0;
      assert.strictEqual(applySkin({}, { skinId: 'my-cool-skin' }).success, true);
      assert.strictEqual(applySkin({}, { skinId: '' }).success, true);
      assert.strictEqual(w.sent.length, 2, '两次切换应各广播一次');
      assert.strictEqual(w.sent[1].payload, null);
    });

    delete electronStub.BrowserWindow;
  }

  for (const d of tmpRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  }

  console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
})();
