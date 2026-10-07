/* 自检：ZIP 读取器 src/main/services/zip-reader.js（阶段 8.5）
   ------------------------------------------------------------
   为什么自建 ZIP 而不是用工具打包：ZIP 只依赖内置 zlib，
   而 PowerShell 的 Compress-Archive 会掺入 BOM/换行差异，
   让「解出来的字节是否正确」这种断言变得不可靠。
   自己按规范拼字节，就能精确制造：
   - 存储(0) / Deflate(8) 两种压缩方式
   - 目录条目
   - 路径穿越条目（../、绝对路径、盘符）
   - **CRC 故意写错**的损坏包
   - 体积/数量超限

   为什么不用 extract-zip：它只是 electron-builder 的传递依赖，
   打包后的 app.asar 仅 0.3MB、node_modules 不在其中，
   运行时 require 会直接失败（详见该模块头部注释）。 */

const path = require('path');
const assert = require('assert');
const zlib = require('zlib');

const zip = require(path.join(__dirname, '..', 'src', 'main', 'services', 'zip-reader.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

function crc32(buf) {
  return (typeof zlib.crc32 === 'function' ? zlib.crc32(buf) : 0) >>> 0;
}

/**
 * 手工拼一个 ZIP。
 * @param {Array<{name, data:Buffer, method?:0|8, badCrc?:boolean, isDir?:boolean}>} entries
 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const isDir = !!e.isDir;
    const raw = isDir ? Buffer.alloc(0) : e.data;
    const method = isDir ? zip.METHOD_STORE : (e.method === undefined ? zip.METHOD_DEFLATE : e.method);
    const stored = method === zip.METHOD_DEFLATE ? zlib.deflateRawSync(raw) : raw;
    const crc = e.badCrc ? (crc32(raw) ^ 0xffffffff) >>> 0 : crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(zip.LOC_SIG, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);            // time
    local.writeUInt16LE(0, 12);            // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    chunks.push(local, nameBuf, stored);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(zip.CEN_SIG, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(stored.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);              // extra
    cen.writeUInt16LE(0, 32);              // comment
    cen.writeUInt16LE(0, 34);              // disk
    cen.writeUInt16LE(0, 36);              // internal attrs
    cen.writeUInt32LE(0, 38);              // external attrs
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(zip.EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

console.log('\n[1] 列出条目');
{
  const buf = buildZip([
    { name: 'pet.json', data: Buffer.from('{"a":1}') },
    { name: 'img/atlas.png', data: Buffer.from([1, 2, 3, 4, 5]) },
    { name: 'img/', isDir: true }
  ]);
  const entries = zip.listEntries(buf);
  ok('解析出全部条目（含目录条目）', () => {
    assert.strictEqual(entries.length, 3);
    assert.deepStrictEqual(entries.map((e) => e.name), ['pet.json', 'img/atlas.png', 'img/']);
  });
  ok('记录压缩方式与大小', () => {
    const pet = entries[0];
    assert.strictEqual(pet.method, zip.METHOD_DEFLATE);
    assert.strictEqual(pet.uncompressedSize, 7);
  });
  ok('能识别目录条目', () => {
    assert.strictEqual(zip.isDirectoryEntry(entries[2]), true);
    assert.strictEqual(zip.isDirectoryEntry(entries[0]), false);
  });
}

console.log('\n[2] 解压内容正确（两种压缩方式）');
{
  const text = Buffer.from('{"format":"pet","version":1}');
  const big = Buffer.alloc(5000, 65); // 便于压缩的重复内容
  const buf = buildZip([
    { name: 'deflated.bin', data: big, method: zip.METHOD_DEFLATE },
    { name: 'stored.bin', data: text, method: zip.METHOD_STORE }
  ]);
  const { files } = zip.extractAll(buf);
  ok('Deflate 条目解压后字节完全一致', () => {
    const f = files.find((x) => x.name === 'deflated.bin');
    assert.ok(f, '缺少 deflated.bin');
    assert.strictEqual(f.data.length, 5000);
    assert.ok(f.data.equals(big), '内容不一致');
  });
  ok('存储(未压缩)条目原样返回', () => {
    const f = files.find((x) => x.name === 'stored.bin');
    assert.ok(f && f.data.equals(text));
  });
  ok('解压条目时会做 CRC 校验且通过', () => {
    assert.doesNotThrow(() => zip.extractAll(buf));
  });
}

console.log('\n[3] 安全：路径穿越');
{
  const bad = [
    '../escape.txt',
    '..\\escape.txt',
    '/abs.txt',
    'C:/win.txt',
    'a/../../b.txt',
    'sub/../../../x.txt'
  ];
  for (const name of bad) {
    ok('拒绝不安全条目名: ' + name, () => {
      assert.strictEqual(zip.isSafeEntryName(name), false);
      const buf = buildZip([{ name, data: Buffer.from('x') }]);
      assert.throws(() => zip.extractAll(buf), /不安全/);
    });
  }
  ok('允许普通子目录路径', () => {
    ['pet.json', 'img/atlas.png', 'a/b/c.png'].forEach((n) => {
      assert.strictEqual(zip.isSafeEntryName(n), true, n + ' 应被允许');
    });
  });
  ok('反斜杠路径被规范化', () => {
    assert.strictEqual(zip.isSafeEntryName('img\\atlas.png'), true);
  });
}

console.log('\n[4] 损坏与异常输入');
{
  ok('CRC 不匹配时报「文件已损坏」', () => {
    const buf = buildZip([{ name: 'bad.bin', data: Buffer.from('hello'), badCrc: true }]);
    assert.throws(() => zip.extractAll(buf), /损坏|CRC/);
  });
  ok('完全不是 ZIP 时给出明确错误', () => {
    assert.throws(() => zip.listEntries(Buffer.from('这不是 zip')), /不是有效的 ZIP/);
  });
  ok('截断的 ZIP 不崩（抛可读错误）', () => {
    const buf = buildZip([{ name: 'a.bin', data: Buffer.from('x'.repeat(100)) }]);
    const cut = buf.subarray(0, Math.floor(buf.length / 2));
    assert.throws(() => zip.extractAll(cut));
  });
  ok('不支持的压缩方式被拒绝', () => {
    const buf = buildZip([{ name: 'a.bin', data: Buffer.from('x'), method: 12 }]);
    assert.throws(() => zip.extractAll(buf), /不支持的压缩方式/);
  });
  ok('ZIP64 标记被明确拒绝（而不是给出错误结果）', () => {
    const buf = buildZip([{ name: 'a.bin', data: Buffer.from('x') }]);
    // 把 EOCD 的条目数改成 0xffff 触发 ZIP64 判定
    const eocd = zip.findEocd(buf);
    buf.writeUInt16LE(0xffff, eocd + 10);
    assert.throws(() => zip.listEntries(buf), /ZIP64/);
  });
}

console.log('\n[5] 上限保护');
{
  const big = Buffer.alloc(2000, 66);
  const buf = buildZip([{ name: 'big.bin', data: big }]);
  ok('单文件超限被拒', () => {
    assert.throws(() => zip.extractAll(buf, { maxFileBytes: 1000 }), /单文件超限/);
  });
  ok('总大小超限被拒', () => {
    const two = buildZip([
      { name: 'a.bin', data: big },
      { name: 'b.bin', data: big }
    ]);
    assert.throws(() => zip.extractAll(two, { maxTotalBytes: 3000 }), /总大小超过上限/);
  });
  ok('文件数超限被拒', () => {
    const many = buildZip([
      { name: 'a.bin', data: Buffer.from('a') },
      { name: 'b.bin', data: Buffer.from('b') },
      { name: 'c.bin', data: Buffer.from('c') }
    ]);
    assert.throws(() => zip.extractAll(many, { maxEntries: 2 }), /文件数超过上限/);
  });
  ok('未超限时给出全部文件', () => {
    const buf2 = buildZip([
      { name: 'pet.json', data: Buffer.from('{}') },
      { name: 'x.png', data: Buffer.from([0]) }
    ]);
    const { files } = zip.extractAll(buf2, { maxEntries: 10, maxFileBytes: 100, maxTotalBytes: 200 });
    assert.strictEqual(files.length, 2);
  });
  ok('目录条目不计入文件列表', () => {
    const buf3 = buildZip([
      { name: 'img/', isDir: true },
      { name: 'img/a.png', data: Buffer.from([1]) }
    ]);
    const { files } = zip.extractAll(buf3);
    assert.deepStrictEqual(files.map((f) => f.name), ['img/a.png']);
  });
}

console.log('\n[6] findEocd 的前置条件');
{
  ok('过短的缓冲区返回 -1', () => {
    assert.strictEqual(zip.findEocd(Buffer.alloc(10)), -1);
  });
  ok('合法 ZIP 能定位到 EOCD', () => {
    const buf = buildZip([{ name: 'a', data: Buffer.from('x') }]);
    assert.ok(zip.findEocd(buf) > 0);
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
