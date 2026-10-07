/* ============================================================
   ZIP 读取器（阶段 8.5）—— 只依赖 Node 内置 zlib
   ------------------------------------------------------------
   为什么不直接用 extract-zip：
   它只是 electron-builder 的**传递依赖**，而本项目的 package.json
   没有 dependencies 段、构建 files 白名单只列了 main/preload/src/renderer
   与 package.json —— 实测打包后的 app.asar 仅 0.3MB，**node_modules 根本不在里面**。
   因此 require('extract-zip') 会在开发时正常、在用户装好的版本里直接崩。
   为了一个「解压自己格式的皮肤包」引入运行时依赖并调整打包配置，
   代价与风险都不划算；ZIP 的存储/Deflate 两种方式用内置 zlib 就能读。

   只实现**读取单个文件到内存**所需的最小集：
     1. 从尾部找 End of Central Directory (EOCD)
     2. 解析 Central Directory 得到条目表
     3. 按 local header 定位数据，Deflate 用 inflateRawSync 解压
   不支持：ZIP64、加密、多卷、目录条目（目录会体现在路径的 '/' 上）。

   安全约束由调用方（skin-store）承担，这里也做基础防护：
   拒绝绝对路径与含 '..' 的条目名，避免「解压炸弹之外的路径穿越」。 */

'use strict';

const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** 在缓冲区末尾附近的注释区里定位 EOCD（注释最长 65535） */
function findEocd(buf) {
  if (buf.length < 22) return -1;
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * 列出 ZIP 内的条目。
 * @returns {Array<{name, method, compressedSize, uncompressedSize, localHeaderOffset, crc32}>}
 */
function listEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 ZIP（未找到 EOCD）');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  // ZIP64 标记：本实现不支持，明确报错而不是给出错误结果
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error('暂不支持 ZIP64 格式的皮肤包');
  }

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) {
      throw new Error('ZIP 中央目录损坏（第 ' + (i + 1) + ' 项）');
    }
    const method = buf.readUInt16LE(offset + 10);
    const crc32 = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    entries.push({ name, method, crc32, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 条目名是否安全（拒绝绝对路径、盘符、向上跳出；反斜杠统一成 /） */
function isSafeEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(n)) return false;
  const parts = n.split('/');
  if (parts.some((p) => p === '..')) return false;
  return true;
}

/** 判断条目是否为目录 */
function isDirectoryEntry(entry) {
  return entry.name.endsWith('/') || entry.name.endsWith('\\');
}

/**
 * 读取单个条目并解压。
 * @returns {Buffer}
 */
function readEntry(buffer, entry) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const off = entry.localHeaderOffset;

  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error('ZIP 本地文件头损坏: ' + entry.name);
  }
  // local header 的 name/extra 长度可能与 central directory 不同，必须按本地的读
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;

  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  let out;
  if (entry.method === METHOD_STORE) {
    out = Buffer.from(raw);
  } else if (entry.method === METHOD_DEFLATE) {
    out = zlib.inflateRawSync(raw);
  } else {
    throw new Error('不支持的压缩方式 ' + entry.method + '（仅支持存储/Deflate）: ' + entry.name);
  }

  /* CRC 校验：用户提供的皮肤包可能损坏（下载中断、U 盘拔出）。
     没有这一步，损坏的 PNG 会一路走到渲染层，表现为「皮肤莫名不显示」，
     比在这里直接报「文件损坏」难排查得多。
     zlib.crc32 需要 Node 20.12+；拿不到时跳过校验而不是报错。 */
  if (typeof zlib.crc32 === 'function') {
    const actual = zlib.crc32(out) >>> 0;
    if (actual !== (entry.crc32 >>> 0)) {
      throw new Error('ZIP 内文件已损坏（CRC 不匹配）: ' + entry.name);
    }
  }
  return out;
}

/**
 * 一次性解出全部**文件**条目（跳过目录）。
 * @param {object} [limits] { maxEntries, maxFileBytes, maxTotalBytes }
 * @returns {{files:Array<{name, data:Buffer}>, skipped:string[]}}
 */
function extractAll(buffer, limits) {
  const lim = limits || {};
  const maxEntries = lim.maxEntries || 256;
  const maxFileBytes = lim.maxFileBytes || 4 * 1024 * 1024;
  const maxTotalBytes = lim.maxTotalBytes || 32 * 1024 * 1024;

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = listEntries(buf);
  const files = [];
  const skipped = [];
  let total = 0;

  for (const entry of entries) {
    if (isDirectoryEntry(entry)) continue;
    if (!isSafeEntryName(entry.name)) {
      throw new Error('ZIP 内含不安全的路径: ' + entry.name);
    }
    if (entry.uncompressedSize > maxFileBytes) {
      throw new Error('ZIP 内单文件超限: ' + entry.name +
        '（' + entry.uncompressedSize + ' > ' + maxFileBytes + '）');
    }
    if (files.length >= maxEntries) {
      throw new Error('ZIP 内文件数超过上限 ' + maxEntries);
    }
    const data = readEntry(buf, entry);
    total += data.length;
    if (total > maxTotalBytes) {
      throw new Error('ZIP 解压后总大小超过上限 ' + maxTotalBytes);
    }
    files.push({ name: entry.name.replace(/\\/g, '/'), data });
  }

  return { files, skipped };
}

module.exports = {
  EOCD_SIG,
  CEN_SIG,
  LOC_SIG,
  METHOD_STORE,
  METHOD_DEFLATE,
  findEocd,
  listEntries,
  isSafeEntryName,
  isDirectoryEntry,
  readEntry,
  extractAll
};
