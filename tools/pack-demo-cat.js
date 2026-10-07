/* 打包一个可分享的皮肤包 zip：把 demo-cat 的 pet.json + atlas.png 压成 zip。
 * 用法：node tools/pack-demo-cat.js
 * 输出：demo-cat.zip（仓库根目录）
 *
 * 注意只打包 pet.json 与 atlas.png：README.md 是仓库内的说明文档，
 * 不属于皮肤包内容。 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const skinDir = path.join(root, 'renderer', 'pet', 'skins', 'demo-cat');
const outFile = path.join(root, 'demo-cat.zip');

const FILES = ['pet.json', 'atlas.png'];

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const stored = zlib.deflateRawSync(raw, { level: 9 });
    const crc = zlib.crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);        // UTF-8 文件名标志
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, stored);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(stored.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + stored.length;
  }
  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cenBuf, eocd]);
}

const entries = FILES.map((f) => {
  const p = path.join(skinDir, f);
  if (!fs.existsSync(p)) throw new Error('缺少文件: ' + p);
  return { name: f, data: fs.readFileSync(p) };
});
const zip = buildZip(entries);
fs.writeFileSync(outFile, zip);

/* 自检：用项目自己的 zip-reader 读回来，确保浏览器/主进程能解 */
const reader = require(path.join(root, 'src', 'main', 'services', 'zip-reader.js'));
const back = reader.extractAll(fs.readFileSync(outFile));
console.log('已生成: ' + outFile);
console.log('大小  : ' + (zip.length / 1024).toFixed(1) + ' KB');
console.log('条目  : ' + back.files.map((f) => f.name + '(' + f.data.length + 'B)').join(', '));
const pet = back.files.find((f) => f.name === 'pet.json');
const parsed = JSON.parse(pet.data.toString('utf8'));
console.log('id    : ' + parsed.id + '  name: ' + parsed.name);
console.log('自检  : zip 可被项目自身的 zip-reader 解开');
