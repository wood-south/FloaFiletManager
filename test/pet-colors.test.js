/* 自检：桌宠内置配色与 colorMap 应用 renderer/pet/colors.js（阶段 3.4）
   ------------------------------------------------------------
   换色要真正做到「装皮肤就变色、卸皮肤就还原」，靠的是三件事一致：
     1. float.html 里 SVG 用 var(--cat-*, 兜底) 引用
     2. colors.js 的 CAT_PALETTE 列出可覆盖变量与默认值
     3. 卸皮肤时把变量清干净（且不能误删 --pet-cursor 等运行时变量）
   任一不一致都表现为「换了色没效果」或「换回内置后颜色不对」，很难肉眼定位，
   因此这里把三者的一致性也纳入断言。

   另外 colorMap 来自第三方皮肤包，必须只允许改白名单内的变量 ——
   否则皮肤可以往桌宠根元素塞任意 CSS 变量影响整个界面。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const colors = require(path.join(root, 'renderer', 'pet', 'colors.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 假 style 对象，记录 setProperty/removeProperty */
function makeStyleEl() {
  const props = {};
  return {
    props,
    style: {
      setProperty: (k, v) => { props[k] = v; },
      removeProperty: (k) => { delete props[k]; },
      getPropertyValue: (k) => (k in props ? props[k] : '')
    }
  };
}

console.log('\n[1] float.html 与 CAT_PALETTE 一致（换色的前提）');
{
  const html = fs.readFileSync(path.join(root, 'renderer', 'float.html'), 'utf8');
  const found = {};
  const re = /var\((--cat-[a-z-]+),\s*([^)]+)\)/g;
  let m;
  while ((m = re.exec(html)) !== null) found[m[1]] = m[2].trim();

  ok('SVG 已改用 var(--cat-*) 而不是硬编码颜色', () => {
    assert.ok(Object.keys(found).length > 0, '未找到任何 var(--cat-*) 引用');
  });
  ok('SVG 里不再有硬编码的 fill/stroke 十六进制色', () => {
    const hard = html.match(/(fill|stroke)="#[0-9a-fA-F]{3,6}"/g) || [];
    assert.deepStrictEqual(hard, [], '仍有硬编码颜色: ' + hard.join(', '));
  });
  ok('SVG 用到的变量都在 CAT_PALETTE 白名单里', () => {
    const missing = Object.keys(found).filter((k) => !(k in colors.CAT_PALETTE));
    assert.deepStrictEqual(missing, [], '未列入白名单（皮肤无法覆盖）: ' + missing.join(', '));
  });
  ok('CAT_PALETTE 里每个变量都真的被 SVG 用到（无死条目）', () => {
    const unused = Object.keys(colors.CAT_PALETTE).filter((k) => !(k in found));
    assert.deepStrictEqual(unused, [], '清单有但 HTML 未使用: ' + unused.join(', '));
  });
  ok('每个变量的兜底值与 CAT_PALETTE 默认值一致', () => {
    const bad = [];
    for (const [k, v] of Object.entries(found)) {
      if (colors.CAT_PALETTE[k] !== v) bad.push(k + ' html=' + v + ' js=' + colors.CAT_PALETTE[k]);
    }
    assert.deepStrictEqual(bad, [], '不一致会导致"卸皮肤后颜色不对": ' + bad.join('; '));
  });
  ok('PET_SPEC.md 第 7 节的变量名在内置清单里', () => {
    // 规范里举的例子必须真的可用，否则皮肤作者按文档写会静默无效
    assert.ok('--cat-fur' in colors.CAT_PALETTE, '缺少 --cat-fur');
    assert.ok('--cat-ear' in colors.CAT_PALETTE, '缺少 --cat-ear');
  });
}

console.log('\n[2] applyColorMap：只允许白名单变量');
{
  const el = makeStyleEl();
  ok('白名单内的变量被写入', () => {
    const r = colors.applyColorMap(el, { '--cat-fur': '#000000' });
    assert.deepStrictEqual(r.applied, ['--cat-fur']);
    assert.strictEqual(el.props['--cat-fur'], '#000000');
  });
  ok('多个变量一起写入', () => {
    const r = colors.applyColorMap(el, { '--cat-ear': '#111', '--cat-nose': '#222' });
    assert.strictEqual(r.applied.length, 2);
    assert.strictEqual(el.props['--cat-ear'], '#111');
  });
  ok('白名单外的变量被忽略（皮肤不能塞任意 CSS 变量）', () => {
    const r = colors.applyColorMap(el, { '--evil-var': 'red', 'position': 'fixed' });
    assert.deepStrictEqual(r.applied, []);
    assert.deepStrictEqual(r.ignored.sort(), ['--evil-var', 'position']);
    assert.strictEqual(el.props['--evil-var'], undefined);
    assert.strictEqual(el.props.position, undefined);
  });
  ok('混合输入时只应用合法的、并报告被忽略的', () => {
    const r = colors.applyColorMap(el, { '--cat-fur': '#abc', '--nope': '1' });
    assert.deepStrictEqual(r.applied, ['--cat-fur']);
    assert.deepStrictEqual(r.ignored, ['--nope']);
  });
  ok('空值/非字符串被忽略而不是写成空', () => {
    const r = colors.applyColorMap(el, { '--cat-fur': '', '--cat-ear': null, '--cat-nose': 123 });
    assert.deepStrictEqual(r.applied, []);
    assert.strictEqual(r.ignored.length, 3);
  });
  ok('值两端空白被去掉', () => {
    colors.applyColorMap(el, { '--cat-fur': '  #123456  ' });
    assert.strictEqual(el.props['--cat-fur'], '#123456');
  });
  ok('无元素/无 colorMap 时安全返回', () => {
    assert.deepStrictEqual(colors.applyColorMap(null, { '--cat-fur': '#000' }), { applied: [], ignored: [] });
    assert.deepStrictEqual(colors.applyColorMap(el, null), { applied: [], ignored: [] });
    assert.deepStrictEqual(colors.applyColorMap(el, undefined), { applied: [], ignored: [] });
    assert.deepStrictEqual(colors.applyColorMap(el, 'nope'), { applied: [], ignored: [] });
  });
}

console.log('\n[3] clearColorMap：卸皮肤还原，且不误删运行时变量');
{
  const el = makeStyleEl();
  colors.applyColorMap(el, { '--cat-fur': '#000', '--cat-ear': '#111' });
  // 桌宠根元素上还挂着运行时变量，绝不能被一起清掉
  el.style.setProperty('--pet-cursor', 'pointer');
  el.style.setProperty('--dock-radius', '24px');

  ok('皮肤写入的颜色被清掉', () => {
    colors.clearColorMap(el);
    assert.strictEqual(el.props['--cat-fur'], undefined);
    assert.strictEqual(el.props['--cat-ear'], undefined);
  });
  ok('运行时变量（--pet-cursor）保留', () => {
    assert.strictEqual(el.props['--pet-cursor'], 'pointer',
      '整体清 style 会把光标变量一起弄没');
  });
  ok('与桌宠无关的变量（--dock-radius）不受影响', () => {
    assert.strictEqual(el.props['--dock-radius'], '24px');
  });
  ok('清掉后 SVG 会回落到兜底值（等价于内置配色）', () => {
    // 兜底值已由第 1 组断言与 CAT_PALETTE 校验过，这里确认确实没有残留
    Object.keys(colors.CAT_PALETTE).forEach((k) => {
      assert.strictEqual(el.props[k], undefined, k + ' 残留');
    });
  });
  ok('重复清理安全', () => {
    assert.doesNotThrow(() => { colors.clearColorMap(el); colors.clearColorMap(el); });
  });
  ok('无元素时安全返回 false', () => {
    assert.strictEqual(colors.clearColorMap(null), false);
  });
}

console.log('\n[4] isKnownVar');
{
  ok('已知变量返回 true', () => {
    Object.keys(colors.CAT_PALETTE).forEach((k) => assert.strictEqual(colors.isKnownVar(k), true, k));
  });
  ok('未知变量返回 false（含原型链上的名字）', () => {
    ['--nope', 'toString', 'constructor', '__proto__', ''].forEach((k) => {
      assert.strictEqual(colors.isKnownVar(k), false, k + ' 不应被当作已知');
    });
  });
}

console.log('\n[5] 与皮肤校验器的衔接');
{
  const skin = require(path.join(root, 'renderer', 'pet', 'skin.js'));
  ok('校验通过的皮肤 colorMap 只含合法变量与颜色', () => {
    const res = skin.validatePetSkin({
      format: 'pet', version: 1, id: 'c', name: 'C',
      render: { kind: 'svg', svg: { file: 'a.svg', colorMap: { '--cat-fur': '#123456' } } }
    }, { states: skin.FALLBACK_STATES });
    assert.strictEqual(res.ok, true, res.errors.join('；'));
    const cm = res.skin.render.svg.colorMap;
    assert.deepStrictEqual(Object.keys(cm), ['--cat-fur']);
    // 校验器产出的变量名必须能通过白名单，否则"校验通过但换色无效"
    Object.keys(cm).forEach((k) => {
      assert.strictEqual(colors.isKnownVar(k), true, k + ' 不在内置白名单里，换了也没效果');
    });
  });
  ok('非法变量名在校验阶段就被剔除', () => {
    const res = skin.validatePetSkin({
      format: 'pet', version: 1, id: 'c', name: 'C',
      render: { kind: 'svg', svg: { file: 'a.svg', colorMap: { 'not-a-var': '#fff' } } }
    }, { states: skin.FALLBACK_STATES });
    assert.ok(!('not-a-var' in res.skin.render.svg.colorMap));
    assert.ok(res.warnings.some((w) => w.includes('colorMap')), '应记 warning');
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
