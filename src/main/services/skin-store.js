/* ============================================================
   皮肤包仓库（阶段 8）
   ------------------------------------------------------------
   负责皮肤包的**文件系统侧**：扫描内置/用户皮肤、导入、导出。
   校验与合并复用阶段 3 的 `renderer/pet/skin.js`（同一份实现，不复制），
   主进程没有渲染侧状态表，因此调用时显式传入 `states`。

   为什么导入校验必须在主进程做：第三方皮肤包是**不可信输入**。
   渲染进程不拿文件系统权限，导入/导出全部经主进程 IPC（阶段 9 再补 UI）。

   安全约束（对应 ROADMAP 阶段 8 的「主进程校验 + 大小/格式白名单」）：
   1. **路径穿越**：逐个资源路径校验 —— 必须是安全相对路径（`isSafeRelPath`），
      且解析后的绝对路径必须仍在包目录内；符号链接一类逃逸也在此拦下。
   2. **大小上限**：单文件 4MB、整包 32MB、文件数 256。
   3. **扩展名白名单**：图片/音频/字体/JSON/CSS，其余一律拒绝。
   4. **绝不抛错**：任何异常都转成 `{ ok:false, errors:[...] }`，不炸调用方。
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { validatePetSkin, isSafeRelPath } = require('../../../renderer/pet/skin');
const { STATES } = require('../../../renderer/pet/behavior');

/** 状态名清单来自渲染侧状态表 —— 单一事实来源，不在这里复制一份 */
const VALID_STATES = Object.keys(STATES);

const SKIN_FILE = 'pet.json';

const LIMITS = {
  fileBytes: 4 * 1024 * 1024,       // 单文件 4MB
  totalBytes: 32 * 1024 * 1024,     // 整包 32MB
  fileCount: 256                    // 文件数上限
};

const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.svg',
  '.ogg', '.mp3', '.wav', '.m4a',
  '.ttf', '.otf', '.woff', '.woff2',
  '.json', '.css'
]);

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 目录是否存在且为目录 */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

/** 路径是否在 root 之内（含 root 自身）；用 path.relative 判断，避免前缀误判 */
function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 递归列出目录下所有文件（不含目录本身），返回相对路径 */
function listFilesRecursive(dir, base, out, depth) {
  const root = base || dir;
  const acc = out || [];
  const d = depth || 0;
  if (d > 8) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listFilesRecursive(full, root, acc, d + 1);
    } else if (e.isFile()) {
      acc.push(path.relative(root, full));
    }
  }
  return acc;
}

/**
 * 校验一个已经落盘的皮肤目录。
 * @returns {{ok:boolean, errors:string[], warnings:string[], skin:object|null, dir:string}}
 */
function inspectSkinDir(dir) {
  const errors = [];
  const warnings = [];

  if (!isDir(dir)) {
    return { ok: false, errors: ['目录不存在: ' + dir], warnings, skin: null, dir };
  }

  const petJsonPath = path.join(dir, SKIN_FILE);
  if (!fs.existsSync(petJsonPath)) {
    return { ok: false, errors: ['缺少 ' + SKIN_FILE], warnings, skin: null, dir };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(petJsonPath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: ['pet.json 解析失败: ' + e.message], warnings, skin: null, dir };
  }

  const res = validatePetSkin(raw, { states: VALID_STATES });
  if (!res.ok) {
    return { ok: false, errors: res.errors, warnings: res.warnings, skin: null, dir };
  }

  const skin = res.skin;
  const allWarnings = res.warnings.slice();

  // ---- 体积与数量 ----
  const files = listFilesRecursive(dir);
  if (files.length > LIMITS.fileCount) {
    errors.push('文件数超限：' + files.length + ' > ' + LIMITS.fileCount);
  }
  let total = 0;
  for (const rel of files) {
    const full = path.join(dir, rel);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (st.size > LIMITS.fileBytes) {
      errors.push('单文件超限：' + rel + '（' + st.size + ' > ' + LIMITS.fileBytes + '）');
    }
    total += st.size;
  }
  if (total > LIMITS.totalBytes) {
    errors.push('整包超限：' + total + ' > ' + LIMITS.totalBytes);
  }

  // ---- 逐个资源：路径安全 + 白名单 + 真实存在 ----
  // 注意：结构校验器（renderer/pet/skin.js）对**不安全路径**的处理是
  // 「记 warning + 丢弃该字段」（对内置皮肤是合理的优雅降级），
  // 但对**第三方导入**这是安全边界：不安全路径意味着包在试图越出自身目录，
  // 必须整包拒绝，而不是静默改用内置画面。因此这里回读原始声明再判一次。
  const rawRender = isPlainObject(raw.render) ? raw.render : {};
  const rawSvgFile = isPlainObject(rawRender.svg) ? rawRender.svg.file : null;
  const rawAtlasFile = isPlainObject(rawRender.atlas) ? rawRender.atlas.file : null;
  const rawSounds = isPlainObject(raw.sounds) ? Object.values(raw.sounds) : [];
  const rawDeclared = [rawSvgFile, rawAtlasFile, ...rawSounds].filter(Boolean);
  for (const rel of rawDeclared) {
    if (!isSafeRelPath(rel)) {
      errors.push('资源路径不安全（试图越出皮肤目录）: ' + rel);
    }
  }

  const declared = [];
  if (skin.render.svg && skin.render.svg.file) declared.push(skin.render.svg.file);
  if (skin.render.atlas && skin.render.atlas.file) declared.push(skin.render.atlas.file);
  for (const f of Object.values(skin.sounds || {})) declared.push(f);

  for (const rel of declared) {
    // isSafeRelPath 已由 validatePetSkin 校验过，这里再挡一次真实路径逃逸
    const full = path.resolve(dir, rel);
    if (!isInside(dir, full)) {
      errors.push('资源路径越出皮肤目录: ' + rel);
      continue;
    }
    if (!fs.existsSync(full)) {
      errors.push('资源文件不存在: ' + rel);
      continue;
    }
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      errors.push('不允许的资源类型: ' + rel);
    }
  }

  // ---- 包内不应出现可执行/脚本文件（即使没被引用）----
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.js' || ext === '.exe' || ext === '.dll' || ext === '.bat' ||
        ext === '.cmd' || ext === '.ps1' || ext === '.vbs' || ext === '.scr') {
      errors.push('皮肤包内不允许出现可执行/脚本文件: ' + rel);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: allWarnings,
    skin,
    dir
  };
}

/**
 * 扫描一个根目录下的全部皮肤（每个子目录一个包）。
 * @returns {{ok:boolean, skins:Array, errors:string[]}}
 */
function listSkins(root) {
  const skins = [];
  const errors = [];
  if (!isDir(root)) {
    return { ok: true, skins, errors };
  }
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return { ok: false, skins, errors: ['无法读取皮肤目录: ' + e.message] };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const info = inspectSkinDir(dir);
    if (info.ok) {
      skins.push({
        id: info.skin.id,
        name: info.skin.name,
        author: info.skin.author,
        dirName: e.name,
        dir,
        warnings: info.warnings
      });
    } else {
      // 坏的包不阻断其它包，但要能被 UI 看见
      errors.push('目录 ' + e.name + ' 不是可用皮肤：' + info.errors.join('；'));
    }
  }
  return { ok: true, skins, errors };
}

/** 递归复制目录（只复制文件与子目录） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** 复制前先算总大小，避免把超大目录整份拷进去才发现超限 */
function measureDir(dir) {
  let total = 0;
  let count = 0;
  for (const rel of listFilesRecursive(dir)) {
    try {
      total += fs.statSync(path.join(dir, rel)).size;
      count++;
    } catch (_) { /* 忽略统计不到的文件 */ }
  }
  return { total, count };
}

/**
 * 导入一个皮肤包（源目录 → 用户皮肤目录）。
 * 采用「先复制到临时目录并校验，通过后再改名落地」，
 * 避免半成品包留在皮肤目录里被扫描到。
 * @param {string} srcDir 源目录（已解压/已是目录）
 * @param {string} userRoot 用户皮肤根目录
 * @returns {{ok:boolean, errors:string[], warnings:string[], skin:object|null, dir:string|null}}
 */
function importSkinFromDir(srcDir, userRoot) {
  const fail = (msg) => ({ ok: false, errors: [].concat(msg), warnings: [], skin: null, dir: null });

  if (!isDir(srcDir)) return fail('源目录不存在: ' + srcDir);

  // 复制前先按上限粗筛，避免超大目录被整份拷贝
  const size = measureDir(srcDir);
  if (size.count > LIMITS.fileCount) return fail('文件数超限：' + size.count);
  if (size.total > LIMITS.totalBytes) return fail('整包超限：' + size.total);

  // 先校验源目录（早失败，不做无谓复制）
  const pre = inspectSkinDir(srcDir);
  if (!pre.ok) return { ok: false, errors: pre.errors, warnings: pre.warnings, skin: null, dir: null };

  const staging = path.join(userRoot, '.importing-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const finalDir = path.join(userRoot, pre.skin.id);

  try {
    fs.mkdirSync(userRoot, { recursive: true });
    copyDir(srcDir, staging);

    // 复制后再校验一次：防止复制过程中被替换（TOCTOU）
    const post = inspectSkinDir(staging);
    if (!post.ok) {
      fs.rmSync(staging, { recursive: true, force: true });
      return { ok: false, errors: post.errors, warnings: post.warnings, skin: null, dir: null };
    }

    // 落地：目标已存在则先移除（视为覆盖安装）
    if (fs.existsSync(finalDir)) {
      fs.rmSync(finalDir, { recursive: true, force: true });
    }
    fs.renameSync(staging, finalDir);
    return { ok: true, errors: [], warnings: post.warnings, skin: post.skin, dir: finalDir };
  } catch (e) {
    try {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    } catch (_) { /* 清理失败不掩盖原始错误 */ }
    return fail('导入失败: ' + e.message);
  }
}

/**
 * 导出皮肤到目标目录（用户皮肤目录 → 外部目录）。
 * @returns {{ok:boolean, errors:string[], dir:string|null}}
 */
function exportSkin(skinDir, destDir) {
  if (!isDir(skinDir)) return { ok: false, errors: ['皮肤目录不存在'], dir: null };
  const info = inspectSkinDir(skinDir);
  if (!info.ok) return { ok: false, errors: info.errors, dir: null };

  const target = path.join(destDir, info.skin.id);
  try {
    if (fs.existsSync(target)) {
      return { ok: false, errors: ['目标已存在: ' + target], dir: null };
    }
    copyDir(skinDir, target);
    return { ok: true, errors: [], dir: target };
  } catch (e) {
    return { ok: false, errors: ['导出失败: ' + e.message], dir: null };
  }
}

module.exports = {
  SKIN_FILE,
  LIMITS,
  ALLOWED_EXT,
  VALID_STATES,
  isInside,
  listFilesRecursive,
  inspectSkinDir,
  listSkins,
  importSkinFromDir,
  exportSkin,
  measureDir
};
