/* 自检：设置页辅助逻辑 renderer/scripts/settings-ui.js（阶段 8 设置页优化）
   ------------------------------------------------------------
   设置页的皮肤列表、搜索过滤、试穿媒体选择是最容易出细节 bug 的地方，
   但它们本身不需要浏览器就能验证，因此把纯逻辑抽到本模块并在此测试。

   重点守住：
   - 搜索的多关键词「与」语义、大小写不敏感、空词不过滤
   - 过滤以「标题 + 其后的设置项」为一组，标题与内容必须同留同去
     （否则会出现「有标题没内容」的空区块）
   - 无命中时 visible=0，调用方据此显示空态
   - 皮肤名/作者**必须转义**（第三方包内容直接插 DOM 就是 XSS）
   - 试穿媒体选择：sprite 用 atlas，svg 用 svg，缺图给出原因
   - flattenSkins 正确标注来源；内置皮肤不可导出 */

const path = require('path');
const assert = require('assert');

const ui = require(path.join(__dirname, '..', 'renderer', 'scripts', 'settings-ui.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 极简 DOM 桩：只实现本模块用到的那几个能力 */
function el(text, opts) {
  const o = opts || {};
  const node = {
    textContent: text || '',
    children: [],
    classes: new Set(o.classes || []),
    attrs: o.attrs || {},
    classList: {
      contains: (c) => node.classes.has(c),
      toggle: (c, on) => { if (on) node.classes.add(c); else node.classes.delete(c); return node.classes.has(c); },
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c)
    },
    getAttribute: (n) => (n in node.attrs ? node.attrs[n] : null),
    querySelectorAll: () => o.children || []
  };
  return node;
}
function tabOf(children) {
  return { children };
}

console.log('\n[1] matchesQuery');
{
  ok('空词命中一切', () => {
    assert.strictEqual(ui.matchesQuery('', 'abc'), true);
    assert.strictEqual(ui.matchesQuery('   ', 'abc'), true);
    assert.strictEqual(ui.matchesQuery(null, 'abc'), true);
    assert.strictEqual(ui.matchesQuery(undefined, 'abc'), true);
  });
  ok('大小写不敏感', () => {
    assert.strictEqual(ui.matchesQuery('DOCK', 'dock 外观'), true);
    assert.strictEqual(ui.matchesQuery('dock', 'DOCK 外观'), true);
  });
  ok('多关键词为「与」语义', () => {
    assert.strictEqual(ui.matchesQuery('dock 模糊', 'Dock 外观 模糊模式'), true);
    assert.strictEqual(ui.matchesQuery('dock 不存在', 'Dock 外观 模糊模式'), false);
  });
  ok('多个文本片段都会被搜到', () => {
    assert.strictEqual(ui.matchesQuery('重置', 'Dock 外观', '重置为默认图标'), true);
  });
  ok('忽略非字符串参数', () => {
    assert.strictEqual(ui.matchesQuery('a', null, undefined, 'a'), true);
  });
}

console.log('\n[2] filterTab：标题与内容同组');
{
  const t1 = el('Dock 外观', { classes: ['section-title'] });
  const t2 = el('网格大小', { classes: ['setting-row'] });
  const t3 = el('模糊模式', { classes: ['setting-row'] });
  const t4 = el('通用设置', { classes: ['section-title'] });
  const t5 = el('开机自启', { classes: ['setting-row'] });
  const tab = tabOf([t1, t2, t3, t4, t5]);

  ok('空查询时全部可见', () => {
    const r = ui.filterTab(tab, '');
    assert.strictEqual(r.visible, 5);
    [t1, t2, t3, t4, t5].forEach((e) => assert.strictEqual(e.classList.contains('filtered-out'), false));
  });
  ok('命中第二组时第一组（含标题）整体隐藏', () => {
    const r = ui.filterTab(tab, '开机');
    assert.strictEqual(t4.classList.contains('filtered-out'), false, '命中组标题应可见');
    assert.strictEqual(t5.classList.contains('filtered-out'), false, '命中项应可见');
    assert.strictEqual(t1.classList.contains('filtered-out'), true, '未命中组标题应隐藏');
    assert.strictEqual(t2.classList.contains('filtered-out'), true);
    assert.strictEqual(r.visible, 2, '实际 ' + r.visible);
  });
  ok('命中标题同样带出该组内容', () => {
    const r = ui.filterTab(tab, '通用');
    assert.strictEqual(r.visible, 2);
    assert.strictEqual(t5.classList.contains('filtered-out'), false);
  });
  ok('无命中时 visible=0（调用方据此显示空态）', () => {
    const r = ui.filterTab(tab, '完全不存在的东西');
    assert.strictEqual(r.visible, 0);
    [t1, t2, t3, t4, t5].forEach((e) => assert.strictEqual(e.classList.contains('filtered-out'), true));
  });
  ok('恢复空查询后重新全部可见（不会残留隐藏）', () => {
    const r = ui.filterTab(tab, '');
    assert.strictEqual(r.visible, 5);
    [t1, t2, t3, t4, t5].forEach((e) => assert.strictEqual(e.classList.contains('filtered-out'), false));
  });
  ok('无标题开头的设置项也能被过滤', () => {
    const a = el('孤立设置项 A', { classes: ['setting-row'] });
    const b = el('孤立设置项 B', { classes: ['setting-row'] });
    const tab2 = tabOf([a, b]);
    const r = ui.filterTab(tab2, 'B');
    assert.strictEqual(r.visible, 1);
    assert.strictEqual(a.classList.contains('filtered-out'), true);
    assert.strictEqual(b.classList.contains('filtered-out'), false);
  });
  ok('null 页签不抛错', () => {
    assert.deepStrictEqual(ui.filterTab(null, 'x'), { visible: 0 });
  });
  ok('可自定义过滤类名', () => {
    const x = el('设置项', { classes: ['setting-row'] });
    const tab3 = tabOf([x]);
    ui.filterTab(tab3, '不存在', 'my-hidden');
    assert.strictEqual(x.classList.contains('my-hidden'), true);
    assert.strictEqual(x.classList.contains('filtered-out'), false);
  });
}

console.log('\n[3] 皮肤描述与来源');
{
  ok('sprite 皮肤描述含帧尺寸', () => {
    const d = ui.describeSkin({
      render: { kind: 'sprite', atlas: { frameWidth: 64, frameHeight: 64 } },
      author: '某人'
    });
    assert.ok(d.includes('动画帧'), d);
    assert.ok(d.includes('64×64'), d);
    assert.ok(d.includes('某人'), d);
  });
  ok('svg 皮肤描述为 SVG', () => {
    assert.ok(ui.describeSkin({ render: { kind: 'svg' } }).includes('SVG'));
  });
  ok('有 warnings 时提示条数', () => {
    const d = ui.describeSkin({ render: { kind: 'svg' }, warnings: ['a', 'b'] });
    assert.ok(d.includes('2 条提示'), d);
  });
  ok('null 皮肤返回空串而不是抛错', () => {
    assert.strictEqual(ui.describeSkin(null), '');
    assert.strictEqual(ui.describeSkin(undefined), '');
  });
  ok('来源标签', () => {
    assert.strictEqual(ui.sourceLabel('builtin'), '内置');
    assert.strictEqual(ui.sourceLabel('user'), '用户');
    assert.strictEqual(ui.sourceLabel('weird'), '未知');
  });
}

console.log('\n[4] 试穿媒体选择');
{
  ok('sprite 用 atlas 的 dataUrl', () => {
    const m = ui.previewMedia({ render: { kind: 'sprite', atlas: { dataUrl: 'data:image/png;base64,AA' } } });
    assert.deepStrictEqual(m, { kind: 'img', url: 'data:image/png;base64,AA' });
  });
  ok('svg 用 svg 的 dataUrl', () => {
    const m = ui.previewMedia({ render: { kind: 'svg', svg: { dataUrl: 'data:image/svg+xml;base64,BB' } } });
    assert.strictEqual(m.kind, 'img');
    assert.strictEqual(m.url, 'data:image/svg+xml;base64,BB');
  });
  ok('缺图集图片时给出原因（而不是显示破图）', () => {
    const m = ui.previewMedia({ render: { kind: 'sprite', atlas: {} } });
    assert.strictEqual(m.kind, 'none');
    assert.ok(m.reason.includes('图集'), m.reason);
  });
  ok('缺 SVG 图片时给出原因', () => {
    assert.strictEqual(ui.previewMedia({ render: { kind: 'svg' } }).kind, 'none');
  });
  ok('null 皮肤安全返回', () => {
    assert.strictEqual(ui.previewMedia(null).kind, 'none');
  });
}

console.log('\n[5] 卡片 HTML 与转义（安全）');
{
  ok('皮肤名中的 HTML 被转义', () => {
    const html = ui.skinCardHtml({ id: 'x', name: '<img src=x onerror=alert(1)>' }, {});
    assert.ok(!html.includes('<img src=x'), '未转义，存在 XSS: ' + html);
    assert.ok(html.includes('&lt;img'), '应转义为实体');
  });
  ok('id 中的引号被转义（防止属性逃逸）', () => {
    const html = ui.skinCardHtml({ id: 'a" onmouseover="alert(1)', name: 'n' }, {});
    assert.ok(!html.includes('onmouseover="alert(1)"'), '属性逃逸: ' + html);
  });
  ok('作者字段也被转义', () => {
    const html = ui.skinCardHtml({ id: 'x', name: 'n', author: '<script>bad()</script>' }, {});
    assert.ok(!html.includes('<script>'), '未转义作者: ' + html);
  });
  ok('当前皮肤带 active 类', () => {
    const html = ui.skinCardHtml({ id: 'cur', name: 'c' }, { activeId: 'cur' });
    assert.ok(html.includes('skin-card active'), html);
  });
  ok('内置皮肤不显示导出按钮', () => {
    const html = ui.skinCardHtml({ id: 'b', name: 'B', source: 'builtin' }, {});
    assert.ok(!html.includes('data-skin-action="export"'), '内置皮肤不应可导出');
  });
  ok('用户皮肤显示导出按钮', () => {
    const html = ui.skinCardHtml({ id: 'u', name: 'U', source: 'user' }, {});
    assert.ok(html.includes('data-skin-action="export"'));
  });
  ok('卡片带 preview/apply 两个必要动作', () => {
    const html = ui.skinCardHtml({ id: 'x', name: 'X' }, {});
    assert.ok(html.includes('data-skin-action="preview"'));
    assert.ok(html.includes('data-skin-action="apply"'));
  });
  ok('缺 name 时用 id 兜底', () => {
    const html = ui.skinCardHtml({ id: 'onlyid' }, {});
    assert.ok(html.includes('onlyid'));
  });
}

console.log('\n[6] flattenSkins 与错误描述');
{
  ok('内置与用户皮肤被正确标注来源', () => {
    const list = ui.flattenSkins({
      builtin: [{ id: 'b1' }],
      user: [{ id: 'u1' }, { id: 'u2' }]
    });
    assert.strictEqual(list.length, 3);
    assert.strictEqual(list[0].source, 'builtin');
    assert.strictEqual(list[1].source, 'user');
    assert.strictEqual(list[2].source, 'user');
  });
  ok('缺字段时返回空数组而不是抛错', () => {
    assert.deepStrictEqual(ui.flattenSkins(null), []);
    assert.deepStrictEqual(ui.flattenSkins({}), []);
    assert.deepStrictEqual(ui.flattenSkins({ builtin: null, user: null }), []);
  });
  ok('错误描述优先用 error 字段', () => {
    assert.strictEqual(ui.describeErrors({ error: '坏了' }), '坏了');
  });
  ok('多条 errors 用换行连接', () => {
    assert.strictEqual(ui.describeErrors({ errors: ['a', 'b'] }), 'a\nb');
  });
  ok('无信息时给出兜底文案', () => {
    assert.strictEqual(ui.describeErrors(null), '未知错误');
    assert.strictEqual(ui.describeErrors({}), '未知错误');
  });
}

console.log('\n[7] escapeHtml 边界');
{
  ok('五个危险字符都被转义', () => {
    assert.strictEqual(ui.escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });
  ok('null/undefined 转成空串', () => {
    assert.strictEqual(ui.escapeHtml(null), '');
    assert.strictEqual(ui.escapeHtml(undefined), '');
  });
  ok('数字被转成字符串', () => {
    assert.strictEqual(ui.escapeHtml(42), '42');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
