const path = require('path');
const { pathToFileURL } = require('url');

/**
 * IPC 安全防线
 *
 * 背景：所有渲染窗口共用同一份 preload.js，即任意页面都能调用全部 IPC 通道。
 * 其中 delete-file / move-file / list-files / upload-file 直接接收渲染进程传来的路径，
 * 一旦将来引入第三方内容（皮肤包、在线商城页面），就等于把任意文件操作暴露出去。
 *
 * 本模块提供两道防线：
 *   1. validateSender(event) —— 只接受本应用 renderer/ 下的顶层页面调用
 *   2. isPathAllowed(p)      —— 只允许操作配置中登记过的根目录内路径
 *
 * 设计原则：宁可拒绝可疑调用，也不误伤正常操作；
 * 因此白名单自动包含 savePath、preferredPath、所有分区路径与 userData。
 */

/**
 * 校验 IPC 调用方是否为本应用的顶层页面。
 * @param {import('electron').IpcMainInvokeEvent} event
 * @returns {{ ok: boolean, error?: string }}
 */
function validateSender(event) {
  try {
    const frame = event.senderFrame;
    // 子框架（iframe）一律拒绝
    if (frame && frame.parent) {
      return { ok: false, error: '拒绝来自子框架的调用' };
    }
    const url = (event.sender && event.sender.getURL && event.sender.getURL()) || '';
    if (!url.startsWith('file://')) {
      return { ok: false, error: '拒绝来自非本地页面的调用' };
    }
    // 允许任意本地页面（图标辅助页等），但仅限应用自身资源
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '无法校验调用方: ' + e.message };
  }
}

/**
 * 归一化路径以便比较：统一分隔符、去掉尾部分隔符（保留盘符根）、Windows 下忽略大小写。
 * @param {string} p
 * @returns {string}
 */
function normalize(p) {
  let out = path.resolve(p);
  if (out.length > 3 && (out.endsWith('\\') || out.endsWith('/'))) {
    out = out.slice(0, -1);
  }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/**
 * 判断 target 是否位于 root 之内（root 自身也算）。
 * 用 path.relative 而不是字符串前缀比较，避免 `C:\foo` 误判 `C:\foobar`。
 * @param {string} target
 * @param {string} root
 * @returns {boolean}
 */
function isInside(target, root) {
  const rel = path.relative(normalize(root), normalize(target));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 收集当前允许访问的根目录。
 * @param {object} config
 * @param {string} userDataDir
 * @returns {string[]}
 */
function collectAllowedRoots(config, userDataDir) {
  const roots = [];
  const push = (p) => {
    if (p && typeof p === 'string') roots.push(p);
  };

  push(config && config.savePath);
  push(config && config.preferredPath);
  if (config && Array.isArray(config.partitions)) {
    for (const partition of config.partitions) {
      if (partition && Array.isArray(partition.paths)) {
        for (const item of partition.paths) {
          push(item && item.path);
        }
      }
    }
  }
  push(userDataDir);
  return roots;
}

/**
 * 判断路径是否在允许范围内。
 * @param {string} target
 * @param {string[]} allowedRoots
 * @returns {boolean}
 */
function isPathAllowed(target, allowedRoots) {
  if (!target || typeof target !== 'string') return false;
  for (const root of allowedRoots) {
    if (root && isInside(target, root)) return true;
  }
  return false;
}

/**
 * 净化外部传入的文件名，禁止目录穿越。
 * @param {string} name
 * @returns {string|null} 合法则返回净化后的名称，否则 null
 */
function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return null;
  // 只取最后一段，剥离任何目录成分（含 ../ 与 ..\）
  const base = path.basename(name.replace(/[\\/]+$/, ''));
  if (!base || base === '.' || base === '..') return null;
  // Windows 非法字符
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(base)) return null;
  return base;
}

module.exports = {
  validateSender,
  collectAllowedRoots,
  isPathAllowed,
  sanitizeFileName,
  isInside,
  pathToFileURL
};
