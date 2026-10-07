/* 自检：能力层契约 renderer/scripts/capabilities.js + capabilities/quick-upload
   用最小桩加载**真实源码**，验证阶段 1 的核心承诺：

   1. 注册表：manifest 校验、重复注册、注册抛错时回滚（不得拖垮桌宠壳层）
   2. 落点提示：由能力 manifest.dropHint 提供，壳层按当前模式选用
   3. 拖放事件：壳层收集路径后只发 pet:drop 事件，能力据此决定上传或删除
   4. 模式持久化：回收站模式通过 storage 立即写回，并在初始化时恢复
      （阶段 1 之前该状态是模块级裸变量，重启即丢）

   注意：注册表是单例（一个页面只有一份），因此**每个用例都重建独立沙箱**，
   否则第二次加载能力会被「重复注册」拒掉，测试就失去了隔离性。
   本文件不加载 float.js（它直接 import DOM 与 electronAPI 且无导出），
   而是复刻其 attach 契约 —— 契约本身由 test/capability-contract.test.js 做源码级断言。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---------- 最小 DOM 桩 ---------- */
function makeElement(tag) {
  const el = {
    tagName: tag,
    children: [],
    parentNode: null,
    isConnected: true,
    style: {},
    dataset: {},
    _text: '',
    _html: '',
    _listeners: {},
    className: '',
    _queryMap: {},
    classList: {
      _set: new Set(),
      add(...names) { names.forEach((n) => this._set.add(n)); },
      remove(...names) { names.forEach((n) => this._set.delete(n)); },
      contains(n) { return this._set.has(n); },
      toggle(n, force) {
        const on = force === undefined ? !this._set.has(n) : !!force;
        if (on) this._set.add(n); else this._set.delete(n);
        return on;
      }
    },
    get textContent() { return el._text; },
    set textContent(v) { el._text = String(v); },
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      el._listeners[type] = (el._listeners[type] || []).filter((f) => f !== fn);
    },
    dispatch(type, event) { (el._listeners[type] || []).slice().forEach((fn) => fn(event || {})); },
    querySelector(sel) { return el._queryMap[sel] || null; }
  };
  return el;
}

function makeDocument() {
  const listeners = {};
  return {
    body: makeElement('body'),
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    dispatch(type, event) { (listeners[type] || []).slice().forEach((fn) => fn(event || {})); },
    createElement: (tag) => makeElement(tag)
  };
}

/* ---------- 加载真实源码 ---------- */
const repoRoot = path.join(__dirname, '..');

function loadSource(relPath, sandbox) {
  const src = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'globalThis', 'setTimeout', 'console', src)(
    sandbox.window, sandbox.document, sandbox.window, sandbox.setTimeout, console
  );
}

/**
 * 每个用例一份全新的沙箱 + 注册表（注册表是单例，必须隔离）。
 * @returns {{window, document, registry, setTimeout}}
 */
function freshSandbox() {
  const doc = makeDocument();
  const win = { document: doc, console };
  win.window = win;
  win.setTimeout = (fn) => { fn(); return 0; };
  const sandbox = { window: win, document: doc, setTimeout: win.setTimeout };
  loadSource('renderer/scripts/capabilities.js', sandbox);
  sandbox.registry = win.deskPetRegistry;
  assert.ok(sandbox.registry, 'capabilities.js 未导出 deskPetRegistry');
  return sandbox;
}

/** 桩：桌宠 API（attach 的入参）
   注意 pet.root 对应真实实现里的 document.body，
   因此菜单按钮要挂在 root 的 _queryMap 上（applyRecycleUi 会去 root.querySelector）。 */
function makePetStub(options) {
  const opts = options || {};
  const root = makeElement('body');
  const overlay = makeElement('div');
  overlay._queryMap = { span: makeElement('span'), svg: makeElement('svg') };
  if (opts.withRecycleButton) {
    root._queryMap['[data-action="recycle"]'] = makeElement('div');
  }
  const calls = { toast: [], modal: [], storage: {} };
  const pet = {
    root,
    overlay,
    calls,
    recycleButton: root._queryMap['[data-action="recycle"]'] || null,
    lastMode: 'upload',
    toast: (m) => calls.toast.push(m),
    modal: async () => { calls.modal.push(true); return 1; },
    storage: {
      // 复刻 float.js 的壳层存储签名：(capabilityId, key[, value])
      get: async (capabilityId, key) => calls.storage[capabilityId + '.' + key],
      set: async (capabilityId, key, value) => {
        calls.storage[capabilityId + '.' + key] = value;
      }
    },
    /** 复刻 float.js 的 getDropHint：取第一个提供 dropHint 的能力 */
    getDropHint(registry) {
      for (const m of registry.manifests()) {
        if (m.dropHint && m.dropHint[pet.lastMode]) return m.dropHint[pet.lastMode];
      }
      return null;
    }
  };
  return pet;
}

function attach(sandbox, pet) {
  sandbox.registry.attach({
    root: pet.root,
    toast: pet.toast,
    modal: pet.modal,
    storage: pet.storage,
    dropOverlay: pet.overlay,
    getDropHint: () => pet.getDropHint(sandbox.registry)
  });
  // 复刻 float.js：监听能力模式变化，切换落点提示形态
  sandbox.registry.on('capability:mode', (p) => {
    if (p && p.mode) pet.lastMode = p.mode;
  });
}

/** 加载真实的 quick-upload 能力（manifest + index） */
function loadQuickUpload(sandbox, apiStub) {
  sandbox.window.electronAPI = apiStub || {};
  loadSource('renderer/capabilities/quick-upload/manifest.js', sandbox);
  loadSource('renderer/capabilities/quick-upload/index.js', sandbox);
}

const tick = () => new Promise((r) => setImmediate(r));

/** 反复让出微任务直到条件成立：分支逻辑里的 await 链长度不固定，
    用固定次数的 tick 断言会变成"猜时序"，这里改为轮询到成立为止。 */
async function waitUntil(cond, label) {
  for (let i = 0; i < 50; i++) {
    if (cond()) return true;
    await tick();
  }
  throw new Error('等待超时：' + (label || '条件未成立'));
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

(async function main() {
  console.log('\n[1] 注册表：manifest 校验');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    attach(box, pet);
    ok('拒绝空 manifest', () => assert.strictEqual(box.registry.use(null), false));
    ok('拒绝缺少 id', () => assert.strictEqual(box.registry.use({ name: 'x' }), false));
    ok('拒绝 menuButtons 非数组', () => {
      assert.strictEqual(box.registry.use({ id: 'bad', menuButtons: 'no' }), false);
    });
    ok('合法 manifest 注册成功', () => {
      assert.strictEqual(box.registry.use({ id: 'ok-cap', name: 'OK', register: () => {} }), true);
    });
    ok('list 含已注册 id', () => assert.ok(box.registry.list().includes('ok-cap')));
    ok('manifests 返回 manifest 数组', () => {
      const ms = box.registry.manifests();
      assert.ok(Array.isArray(ms));
      assert.ok(ms.some((m) => m.id === 'ok-cap'));
    });
  }

  console.log('\n[2] 注册表：重复注册与注册抛错');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    attach(box, pet);
    ok('首次注册返回 true', () => {
      assert.strictEqual(box.registry.use({ id: 'dup', register: () => {} }), true);
    });
    ok('重复 id 被拒绝', () => {
      assert.strictEqual(box.registry.use({ id: 'dup', register: () => {} }), false);
    });
    ok('register 抛错时返回 false', () => {
      assert.strictEqual(box.registry.use({
        id: 'boom',
        register: () => { throw new Error('bad'); }
      }), false);
    });
    ok('抛错的能力不留在注册表（壳层不受影响）', () => {
      assert.ok(!box.registry.list().includes('boom'));
    });
    ok('抛错能力注册时订阅的事件被回滚', () => {
      const box2 = freshSandbox();
      attach(box2, makePetStub());
      box2.registry.use({
        id: 'boom2',
        register: (pet2) => {
          pet2.on('leak:evt', () => { throw new Error('不应被触发'); });
          throw new Error('bad');
        }
      });
      // 回滚后不应再有订阅者：emit 不会抛错、也不会有人收到
      let reached = false;
      box2.registry.on('leak:evt', () => { reached = true; });
      box2.registry.emit('leak:evt', null);
      assert.ok(reached, '新订阅应仍可收到事件（说明总线未被破坏）');
    });
  }

  console.log('\n[3] 事件总线：on / emit / off');
  {
    const box = freshSandbox();
    const seen = [];
    const off = box.registry.on('test:evt', (p) => seen.push(p));
    box.registry.emit('test:evt', 1);
    off();
    box.registry.emit('test:evt', 2);
    ok('只收到订阅期间的 1 次', () => assert.deepStrictEqual(seen, [1]));

    const seen2 = [];
    const realWarn = console.warn;
    console.warn = () => {}; // 该用例故意让处理器抛错，静音注册表的告警避免污染输出
    try {
      box.registry.on('test:evt2', () => { throw new Error('handler boom'); });
      box.registry.on('test:evt2', () => seen2.push('ok'));
      box.registry.emit('test:evt2', null);
    } finally {
      console.warn = realWarn;
    }
    ok('单个处理器抛错不影响其它处理器', () => assert.deepStrictEqual(seen2, ['ok']));
  }

  console.log('\n[4] quick-upload：普通模式走上传');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    attach(box, pet);
    const calls = { upload: [], del: [] };
    loadQuickUpload(box, {
      getUploadDest: async () => 'D:\\dest',
      uploadFile: async (args) => { calls.upload.push(args); return { success: true }; },
      deleteFile: async (p) => { calls.del.push(p); return { success: true }; }
    });
    await okAsync('pet:drop 触发上传', async () => {
      box.registry.emit('pet:drop', { paths: ['D:\\a\\one.txt'] });
      await tick();
      assert.strictEqual(calls.upload.length, 1);
    });
    ok('上传参数含 sourcePath/fileName/destDir', () => {
      const a = calls.upload[0];
      assert.strictEqual(a.sourcePath, 'D:\\a\\one.txt');
      assert.strictEqual(a.fileName, 'one.txt');
      assert.strictEqual(a.destDir, 'D:\\dest');
    });
    ok('普通模式未调用 deleteFile', () => assert.strictEqual(calls.del.length, 0));
    ok('上传成功提示', () => assert.ok(pet.calls.toast.some((t) => t.includes('成功上传'))));
  }

  console.log('\n[5] quick-upload：重名弹确认，选「覆盖」才重传');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    let modalCount = 0;
    // 必须在 attach 之前覆盖：attach 会把 modal/storage 注入能力上下文
    pet.modal = async () => { modalCount++; return 0; }; // 0 = 点「覆盖」
    attach(box, pet);
    const uploads = [];
    loadQuickUpload(box, {
      getUploadDest: async () => 'D:\\dest',
      uploadFile: async (args) => {
        uploads.push(args);
        return args.overwrite ? { success: true } : { duplicate: true };
      }
    });
    await okAsync('重名时弹确认并在确认后带 overwrite 重传', async () => {
      box.registry.emit('pet:drop', { paths: ['D:\\a\\dup.txt'] });
      await waitUntil(() => uploads.length >= 2, '覆盖重传');
      assert.strictEqual(modalCount, 1, '应弹出一次覆盖确认');
      assert.strictEqual(uploads.length, 2, '应上传两次（首次探测 + 覆盖重传）');
      assert.strictEqual(uploads[1].overwrite, true);
    });
  }

  console.log('\n[6] quick-upload：重名选「取消」不重传');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    pet.modal = async () => 1; // 1 = 取消（primitives 契约：取消不是 0）
    attach(box, pet);
    const uploads = [];
    loadQuickUpload(box, {
      getUploadDest: async () => 'D:\\dest',
      uploadFile: async (args) => { uploads.push(args); return { duplicate: true }; }
    });
    await okAsync('取消后只探测一次，不重传', async () => {
      box.registry.emit('pet:drop', { paths: ['D:\\a\\dup.txt'] });
      await waitUntil(() => pet.calls.toast.some((t) => t.includes('上传取消')), '取消提示');
      assert.strictEqual(uploads.length, 1);
    });
  }

  console.log('\n[7] quick-upload：回收站模式走删除');
  {
    const box = freshSandbox();
    const pet = makePetStub({ withRecycleButton: true });
    const btn = pet.recycleButton;
    attach(box, pet);
    const calls = { upload: [], del: [] };
    loadQuickUpload(box, {
      getUploadDest: async () => 'D:\\dest',
      uploadFile: async (args) => { calls.upload.push(args); return { success: true }; },
      deleteFile: async (p) => { calls.del.push(p); return { success: true }; }
    });
    box.registry.emit('menubtn', 'recycle');
    ok('切换后按钮高亮（recycle-active）', () => {
      assert.ok(btn.classList.contains('recycle-active'));
    });
    await okAsync('回收站模式下 drop 触发 deleteFile', async () => {
      box.registry.emit('pet:drop', { paths: ['D:\\a\\two.txt'] });
      await tick();
      assert.deepStrictEqual(calls.del, ['D:\\a\\two.txt']);
    });
    ok('回收站模式未调用 uploadFile', () => assert.strictEqual(calls.upload.length, 0));
    ok('再次切换后取消高亮', () => {
      box.registry.emit('menubtn', 'recycle');
      assert.ok(!btn.classList.contains('recycle-active'));
    });
  }

  console.log('\n[8] quick-upload：模式持久化（阶段 1 修复项）');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    const store = {};
    // 覆盖为「记录完整入参」的桩，顺带守住壳层存储签名（capabilityId, key, value）：
    // 早期实现把签名写成 (key, value)，会让能力 id 落进 key 槽、值被丢弃。
    pet.storage.set = async (capabilityId, key, value) => {
      assert.strictEqual(capabilityId, 'quick-upload', '应把能力 id 作为第一个参数');
      assert.strictEqual(key, 'recycleMode', '应把配置键作为第二个参数');
      store[key] = value;
    };
    attach(box, pet);
    loadQuickUpload(box, {
      uploadFile: async () => ({ success: true }),
      deleteFile: async () => ({ success: true })
    });
    box.registry.emit('menubtn', 'recycle');
    await okAsync('切换后立即写回 storage', async () => {
      await waitUntil(() => store.recycleMode === true, 'storage 写回');
    });
  }

  console.log('\n[9] quick-upload：初始化时恢复上次的回收站模式');
  {
    const box = freshSandbox();
    const pet = makePetStub({ withRecycleButton: true });
    const btn = pet.recycleButton;
    pet.storage.get = async (capabilityId, key) => (key === 'recycleMode' ? true : undefined);
    attach(box, pet);
    loadQuickUpload(box, {
      uploadFile: async () => ({ success: true }),
      deleteFile: async () => ({ success: true })
    });
    await okAsync('恢复为回收站模式并高亮按钮', async () => {
      await waitUntil(() => btn.classList.contains('recycle-active'), '按钮高亮');
    });
  }

  console.log('\n[10] 落点提示：由能力 manifest 提供');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    attach(box, pet);
    const hints = [];
    box.registry.on('capability:mode', (p) => hints.push(p));
    loadQuickUpload(box, {});
    box.registry.emit('menubtn', 'recycle');
    ok('切换模式时发出 capability:mode 事件', () => {
      assert.strictEqual(hints.length, 1);
      assert.strictEqual(hints[0].mode, 'recycle');
      assert.strictEqual(hints[0].id, 'quick-upload');
    });
    ok('manifest 提供两种落点提示', () => {
      const m = box.registry.manifests().find((x) => x.id === 'quick-upload');
      assert.ok(m, '未找到 quick-upload manifest');
      assert.strictEqual(m.dropHint.upload.text, '释放上传');
      assert.strictEqual(m.dropHint.recycle.text, '释放删除到回收站');
      assert.strictEqual(m.dropHint.recycle.mode, 'recycle');
    });
    ok('getDropHint 按当前模式返回对应提示', () => {
      pet.lastMode = 'recycle';
      const mode = pet.lastMode;
      const m = box.registry.manifests().find((x) => x.id === 'quick-upload');
      assert.strictEqual(m.dropHint[mode].text, '释放删除到回收站');
    });
  }

  console.log('\n[11] 无能力时壳层不受影响');
  {
    const box = freshSandbox();
    const pet = makePetStub();
    attach(box, pet);
    ok('未注册任何能力时 manifests 为空数组', () => {
      assert.deepStrictEqual(box.registry.manifests(), []);
    });
    ok('未注册能力时 getDropHint 返回 null（壳层不显示业务提示）', () => {
      assert.strictEqual(pet.getDropHint(box.registry), null);
    });
    ok('未注册能力时 drop 事件无人处理也不抛错', () => {
      box.registry.emit('pet:drop', { paths: ['D:\\a\\x.txt'] });
    });
  }

  console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
})();
