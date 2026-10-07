/* 自检：共用 UI 原语 renderer/scripts/primitives.js
   用最小 DOM 桩加载真实源码，验证行为契约。
   重点：原先 float.js 与 file-manager.js 的取消语义不同，合并后若 resolve 值错位
   （例如取消返回 0），所有 `choice !== 0` 判断都会反向 —— 因此必须守住。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---------- 最小 DOM 桩 ---------- */
function makeElement(tag) {
  return {
    tagName: tag,
    children: [],
    parentNode: null,
    isConnected: false,
    style: {},
    dataset: {},
    tabIndex: 0,
    _text: '',
    _html: '',
    _listeners: {},
    className: '',
    classList: {
      _set: new Set(),
      add(...names) { names.forEach((n) => this._set.add(n)); },
      remove(...names) { names.forEach((n) => this._set.delete(n)); },
      contains(n) { return this._set.has(n); }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    appendChild(child) {
      child.parentNode = this;
      child.isConnected = true;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      child.isConnected = false;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
    },
    dispatch(type, event) {
      (this._listeners[type] || []).slice().forEach((fn) => fn(event || {}));
    },
    focus() { this._focused = true; },
    querySelector() { return null; }
  };
}

function makeDocument() {
  const body = makeElement('body');
  body.isConnected = true;
  return {
    body,
    createElement: (tag) => makeElement(tag),
    querySelector: () => null
  };
}

/* ---------- 加载真实 primitives.js ---------- */
const srcPath = path.join(__dirname, '..', 'renderer', 'scripts', 'primitives.js');
const src = fs.readFileSync(srcPath, 'utf8');
const fakeWindow = { document: makeDocument() };
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'globalThis', src)(fakeWindow, fakeWindow.document, fakeWindow);
const createPrimitives = fakeWindow.createPrimitives;
assert.ok(typeof createPrimitives === 'function', 'primitives.js 未导出 createPrimitives');

function buildPage() {
  const doc = makeDocument();
  const els = {
    overlay: makeElement('div'),
    icon: makeElement('div'),
    title: makeElement('div'),
    message: makeElement('div'),
    buttons: makeElement('div'),
    input: makeElement('input'),
    toast: makeElement('div')
  };
  Object.values(els).forEach((e) => doc.body.appendChild(e));
  const ui = createPrimitives({
    overlay: els.overlay,
    icon: els.icon,
    title: els.title,
    message: els.message,
    buttons: els.buttons,
    input: els.input,
    toast: els.toast
  });
  return { doc, els, ui };
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
  console.log('\n[1] modal：按钮下标与取消语义');
  {
    const { els, ui } = buildPage();
    const p = ui.modal({
      type: 'warning', title: 'T', message: 'M',
      buttons: [{ text: '删除', style: 'danger' }, { text: '取消', style: 'secondary' }]
    });
    ok('打开时 overlay 加 active', () => assert.ok(els.overlay.classList.contains('active')));
    ok('图标类名带类型', () => assert.strictEqual(els.icon.className, 'modal-icon warning'));
    ok('按钮数量正确', () => assert.strictEqual(els.buttons.children.length, 2));
    ok('按钮 className 含 style', () => assert.strictEqual(els.buttons.children[0].className, 'modal-btn danger'));
    ok('标题与正文被填充', () => {
      assert.strictEqual(els.title.textContent, 'T');
      assert.strictEqual(els.message.textContent, 'M');
    });
    els.buttons.children[1].dispatch('click');
    await okAsync('点第二个按钮 resolve 1（取消不得为 0）', async () => {
      assert.strictEqual(await p, 1);
    });
    ok('关闭后移除 active', () => assert.ok(!els.overlay.classList.contains('active')));
  }

  console.log('\n[2] modal：第一个按钮 resolve 0（调用方用 !==0 判断取消）');
  {
    const { els, ui } = buildPage();
    const p = ui.modal({ buttons: [{ text: '确定', style: 'primary' }] });
    els.buttons.children[0].dispatch('click');
    await okAsync('resolve 0', async () => assert.strictEqual(await p, 0));
  }

  console.log('\n[3] modal：Esc 视为取消（resolve -1，不是 0）');
  {
    const { els, ui } = buildPage();
    const p = ui.modal({ buttons: [{ text: '删除', style: 'danger' }, { text: '取消', style: 'secondary' }] });
    els.overlay.dispatch('keydown', { key: 'Escape', preventDefault() {} });
    await okAsync('resolve -1', async () => assert.strictEqual(await p, -1));
  }

  console.log('\n[4] modal：重复调用先关闭上一个');
  {
    const { els, ui } = buildPage();
    const first = ui.modal({ buttons: [{ text: 'A' }] });
    const second = ui.modal({ buttons: [{ text: 'B' }] });
    await okAsync('前一个 resolve -1', async () => assert.strictEqual(await first, -1));
    ok('后一个仍在打开', () => assert.ok(els.overlay.classList.contains('active')));
    els.buttons.children[0].dispatch('click');
    await okAsync('后一个 resolve 0', async () => assert.strictEqual(await second, 0));
  }

  console.log('\n[5] inputModal：确认 / 空值 / 取消 / 回车 / Esc');
  {
    const { els, ui } = buildPage();
    const p1 = ui.inputModal({ title: '重命名', defaultValue: '旧名', confirmText: '确定', cancelText: '取消' });
    ok('输入框显示并回填', () => {
      assert.strictEqual(els.input.style.display, 'block');
      assert.strictEqual(els.input.value, '旧名');
    });
    ok('有取消与确认两个按钮', () => assert.strictEqual(els.buttons.children.length, 2));
    els.input.value = '  新名  ';
    els.buttons.children[1].dispatch('click');
    await okAsync('确认返回去除首尾空白', async () => assert.strictEqual(await p1, '新名'));

    const p2 = ui.inputModal({ defaultValue: '' });
    els.input.value = '   ';
    els.buttons.children[1].dispatch('click');
    await okAsync('空白输入返回 null', async () => assert.strictEqual(await p2, null));

    const p3 = ui.inputModal({});
    els.buttons.children[0].dispatch('click');
    await okAsync('取消返回 null', async () => assert.strictEqual(await p3, null));

    const p4 = ui.inputModal({});
    els.input.value = '回车提交';
    els.input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    await okAsync('回车提交', async () => assert.strictEqual(await p4, '回车提交'));

    const p5 = ui.inputModal({});
    els.input.dispatch('keydown', { key: 'Escape', preventDefault() {} });
    await okAsync('Esc 取消', async () => assert.strictEqual(await p5, null));
  }

  console.log('\n[6] inputModal：键盘监听被清理（不泄漏）');
  {
    const { els, ui } = buildPage();
    const p = ui.inputModal({});
    els.input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    await p;
    ok('Enter 后移除 keydown 监听', () => assert.strictEqual((els.input._listeners.keydown || []).length, 0));
  }

  console.log('\n[7] modal：无 input 的页面隐藏输入框');
  {
    const { els, ui } = buildPage();
    els.input.style.display = 'block';
    const p = ui.modal({ buttons: [{ text: 'X' }] });
    ok('普通模态隐藏输入框', () => assert.strictEqual(els.input.style.display, 'none'));
    els.buttons.children[0].dispatch('click');
    await p;
  }

  console.log('\n[8] toast：不传元素时按需创建');
  {
    createPrimitives({
      overlay: makeElement('div'), icon: makeElement('div'),
      title: makeElement('div'), message: makeElement('div'), buttons: makeElement('div')
    }).toast('测试消息');
    const created = fakeWindow.document.body.children.filter((c) => c.className === 'toast');
    ok('延迟创建 toast 元素', () => assert.ok(created.length >= 1));
  }

  console.log('\n[9] 图标表完备性');
  {
    const icons = fakeWindow.PRIMITIVE_ICONS;
    ok('含 success/warning/question/error 四项', () => {
      ['success', 'warning', 'question', 'error'].forEach((k) => assert.ok(icons[k], '缺少图标: ' + k));
    });
    ok('均为 svg 字符串', () => {
      Object.values(icons).forEach((v) => assert.ok(String(v).startsWith('<svg')));
    });
  }

  console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
})();
