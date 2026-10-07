/* 自检：IPC 处理器的参数健壮性（阶段 9.1）
   ------------------------------------------------------------
   背景（真实缺陷）：处理器写成

       ipcMain.handle('x', (event, { foo } = {}) => { ... })

   时，默认值 `{}` **只对 undefined 生效**。渲染层若传 `null`
   （例如 `invoke('x', null)`，或某个上游把对象变成了 null），
   就会抛 "Cannot destructure property 'foo' of null" ——
   而且异常发生在参数求值阶段，**在函数体的 try 之外**，因此：
     - 渲染层拿到的是 reject（而不是约定的 { success:false }）
     - 主进程日志里出现一条对排查无用的堆栈
     - 无法被单个处理器内部的 try/catch 兜住

   这是在一次行为测试里真实被触发的（import-skin / export-skin），
   随后在 config.js 里又查到 3 处同样的写法。

   本测试做两件事：
   1. **静态扫描**全部主进程源码，禁止再出现该写法（防回归）；
   2. 动态确认代表性处理器在 null / undefined / 垃圾入参下都不抛错。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const root = path.join(__dirname, '..');

/** 递归收集需要扫描的源文件 */
function collectSources(dir, acc) {
  const out = acc || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectSources(full, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 匹配 ipcMain.handle('...', (event, { a, b } = {}) =>  这类写法 */
const BAD = /ipcMain\.handle\(\s*[^,]+,\s*(?:async\s*)?\([^)]*\{[^}]*\}\s*=[^)]*\)\s*=>/;

console.log('\n[1] 静态扫描：禁止「参数位置解构 + 默认值」的 ipcMain.handle');
{
  const sources = collectSources(path.join(root, 'src', 'main'));
  const offenders = [];
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (BAD.test(line)) {
        offenders.push(path.relative(root, f) + ':' + (i + 1) + '  ' + line.trim());
      }
    });
  }
  ok('主进程 ' + sources.length + ' 个源文件里没有该写法', () => {
    assert.deepStrictEqual(offenders, [],
      '以下位置在渲染层传 null 时会抛错，请在函数体内安全取值:\n  ' + offenders.join('\n  '));
  });
  ok('扫描器本身能识别该写法（避免正则写错导致永远通过）', () => {
    const sample = "  ipcMain.handle('demo', (event, { foo, bar } = {}) => {";
    assert.ok(BAD.test(sample), '正则未命中样例，说明这道防线是空的');
    const good = "  ipcMain.handle('demo', (event, payload) => {";
    assert.ok(!BAD.test(good), '正则误报了正确写法');
  });
  ok('preload.js 也不出现该写法', () => {
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    assert.ok(preload.includes('invoke('), 'preload 应使用 invoke');
    assert.ok(!BAD.test(preload), 'preload 不应出现该写法');
  });
}

(async function main() {
  console.log('\n[2] 动态确认：代表性处理器在垃圾入参下不抛错');
  const handlers = new Map();
  const electronStub = {
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => handlers.set(ch, fn) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    app: { isPackaged: false, getPath: () => path.join(root, '.tmp-guard'), setPath: () => {}, on: () => {} },
    shell: { openPath: async () => '' }
  };
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return electronStub;
    return originalLoad.apply(this, arguments);
  };
  const userDataDir = path.join(root, '.tmp-guard');
  try {
    require(path.join(root, 'src', 'main', 'ipc', 'skin.js')).register({ userDataDir, rootDir: root });
    require(path.join(root, 'src', 'main', 'ipc', 'config.js')).register({
      loadConfig: () => ({ capabilities: {} }),
      saveConfig: () => true,
      app: electronStub.app,
      rootDir: root
    });
  } finally {
    Module._load = originalLoad;
  }

  const junk = [null, undefined, 0, '', 'str', [], true, { unexpected: 1 }];
  const syncChannels = ['list-skins', 'capability-get', 'capability-set', 'capability-enable'];
  const asyncChannels = ['import-skin', 'export-skin'];

  for (const ch of syncChannels) {
    const fn = handlers.get(ch);
    if (!fn) continue;
    ok(ch + ' 对 ' + junk.length + ' 种垃圾入参都不抛错', () => {
      for (const j of junk) {
        assert.doesNotThrow(() => fn({}, j), ch + ' 在入参 ' + JSON.stringify(j) + ' 时抛错');
      }
    });
  }
  for (const ch of asyncChannels) {
    const fn = handlers.get(ch);
    if (!fn) continue;
    await okAsync(ch + ' 对 ' + junk.length + ' 种垃圾入参都不 reject', async () => {
      for (const j of junk) {
        await assert.doesNotReject(async () => fn({}, j),
          ch + ' 在入参 ' + JSON.stringify(j) + ' 时 reject');
      }
    });
  }

  console.log('\n[3] 垃圾入参下的返回值形态');
  {
    ok('capability-get 返回 undefined 而不是抛错', () => {
      const get = handlers.get('capability-get');
      if (!get) return;
      assert.strictEqual(get({}, null), undefined);
      assert.strictEqual(get({}, { capabilityId: 'system', key: 'nope' }), undefined);
    });
    ok('capability-enable 返回 { success:false } 并给出原因', () => {
      const en = handlers.get('capability-enable');
      if (!en) return;
      const r = en({}, null);
      assert.strictEqual(r.success, false);
      assert.ok(r.error, '应给出原因');
    });
    ok('list-skins 在最坏情况下仍返回可用的结构', () => {
      const ls = handlers.get('list-skins');
      if (!ls) return;
      const r = ls({}, null);
      assert.ok(Array.isArray(r.builtin) && Array.isArray(r.user),
        'builtin/user 必须是数组，否则 UI 会崩');
    });
  }

  try { fs.rmSync(path.join(root, '.tmp-guard'), { recursive: true, force: true }); } catch (_) { /* 忽略 */ }

  console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
})();
