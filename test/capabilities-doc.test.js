/* 自检：docs/CAPABILITIES.md 与能力注册表一致（阶段 9）
   ------------------------------------------------------------
   文档的最大风险是**过期**：代码加了能力、文档还写着旧的通道数。
   这类漂移人工很难发现（本项目的 CHANGELOG 就出现过一次）。
   因此这里把文档里的清单表当作**契约**来断言：
   能力 id、名称、通道数必须与 src/main/capabilities 的注册表逐项一致，
   合计通道数也要对得上。

   做法：直接读 Markdown，解析 <!-- CAPABILITIES-TABLE-* --> 之间的表格。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const root = path.join(__dirname, '..');

// stub electron：capabilities/index.js 会 require 各 ipc 模块，后者需要 electron
const electronStub = {
  ipcMain: { handle: () => {}, on: () => {} },
  app: {
    isPackaged: false,
    getPath: () => path.join(root, '.tmp-doc-test'),
    setPath: () => {},
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  BrowserWindow: class {},
  dialog: {},
  shell: { openPath: () => Promise.resolve(''), showItemInFolder: () => {} },
  nativeImage: { createFromDataURL: () => ({}), createEmpty: () => ({}) }
};
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return originalLoad.apply(this, arguments);
};
let caps;
try {
  caps = require(path.join(root, 'src', 'main', 'capabilities'));
} finally {
  Module._load = originalLoad;
}

const docPath = path.join(root, 'docs', 'CAPABILITIES.md');
const doc = fs.readFileSync(docPath, 'utf8');

/** 解析文档里被标记包围的清单表 → [{id, name, channels}] */
function parseDocTable(text) {
  const begin = text.indexOf('CAPABILITIES-TABLE-BEGIN');
  const end = text.indexOf('CAPABILITIES-TABLE-END');
  assert.ok(begin >= 0 && end > begin, '文档缺少 CAPABILITIES-TABLE 标记块');
  const block = text.slice(begin, end);
  const rows = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/);
    if (m) rows.push({ id: m[1], name: m[2].trim(), channels: Number(m[3]) });
  }
  const total = block.match(/\*\*合计\*\*\s*\|\s*\*\*(\d+)\*\*/);
  return { rows, total: total ? Number(total[1]) : null };
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const parsed = parseDocTable(doc);
const real = caps.listMeta();

console.log('\n[1] 文档清单 ↔ 能力注册表');
{
  ok('文档解析出 ' + parsed.rows.length + ' 个能力', () => {
    assert.ok(parsed.rows.length > 0, '表格没解析到内容');
  });
  ok('能力数量与注册表一致', () => {
    assert.strictEqual(parsed.rows.length, real.length,
      '文档 ' + parsed.rows.length + ' 个 vs 注册表 ' + real.length + ' 个');
  });
  ok('每个能力的 id 都在注册表里', () => {
    const ids = real.map((c) => c.id);
    const unknown = parsed.rows.map((r) => r.id).filter((id) => !ids.includes(id));
    assert.deepStrictEqual(unknown, [], '文档里有注册表不存在的 id: ' + unknown.join(', '));
  });
  ok('注册表里的每个能力都写进了文档', () => {
    const docIds = parsed.rows.map((r) => r.id);
    const missing = real.map((c) => c.id).filter((id) => !docIds.includes(id));
    assert.deepStrictEqual(missing, [], '文档缺少能力: ' + missing.join(', '));
  });
  ok('每个能力的通道数与注册表一致', () => {
    const byId = {};
    for (const r of parsed.rows) byId[r.id] = r;
    const bad = [];
    for (const c of real) {
      const row = byId[c.id];
      if (!row) continue;
      if (row.channels !== c.channelCount) {
        bad.push(c.id + '（文档 ' + row.channels + ' vs 实际 ' + c.channelCount + '）');
      }
    }
    assert.deepStrictEqual(bad, [], '通道数不一致: ' + bad.join('；'));
  });
  ok('能力名称与注册表一致', () => {
    const byId = {};
    for (const r of parsed.rows) byId[r.id] = r;
    const bad = [];
    for (const c of real) {
      const row = byId[c.id];
      if (row && row.name !== c.name) bad.push(c.id + '（文档「' + row.name + '」vs 实际「' + c.name + '」）');
    }
    assert.deepStrictEqual(bad, [], '名称不一致: ' + bad.join('；'));
  });
  ok('合计通道数与实际一致', () => {
    const actual = caps.allDeclaredChannels().length;
    assert.strictEqual(parsed.total, actual,
      '文档合计 ' + parsed.total + ' vs 实际 ' + actual);
  });
  ok('合计等于各行之和（文档自身自洽）', () => {
    const sum = parsed.rows.reduce((s, r) => s + r.channels, 0);
    assert.strictEqual(parsed.total, sum, '合计 ' + parsed.total + ' != 逐行之和 ' + sum);
  });
}

console.log('\n[2] 文档内容完整性');
{
  ok('说明了与 preload 的契约（新增通道要改三处）', () => {
    assert.ok(/新增一个通道时，必须同时改三处/.test(doc), '缺少「改三处」的说明');
  });
  ok('说明了关闭能力是重启生效', () => {
    assert.ok(/重启生效/.test(doc), '缺少「重启生效」的说明');
  });
  ok('记录了「未搬迁文件」这一取舍', () => {
    assert.ok(/没有把文件搬进/.test(doc), '缺少搬迁取舍的说明');
  });
  ok('列出了新增能力的具体步骤', () => {
    assert.ok(/如何新增一个能力/.test(doc) && /channels:/.test(doc));
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
