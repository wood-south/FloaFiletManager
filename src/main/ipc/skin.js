/* ============================================================
   皮肤包 IPC（阶段 8.2）
   ------------------------------------------------------------
   把 skin-store 的文件系统能力暴露给渲染层。三件事：
   - `list-skins`    列出内置 + 用户皮肤（含各自的错误信息，便于 UI 提示）
   - `import-skin`   把用户选中的皮肤包目录导入 userData/pets
   - `export-skin`   把一个已安装皮肤导出到用户选定目录

   安全取舍：`import-skin` 接受一个**源目录路径**，因此不能无条件信任它 ——
   否则被攻破的渲染层可以把任意目录（例如 C:\Users\...\.ssh）复制进
   userData，形成信息外带。这里的做法是：只接受（a）本进程刚通过
   `select-directory` 弹窗返回给用户的路径，或（b）用户皮肤目录内部路径。
   白名单一次使用即失效，避免长期停留。

   返回值统一为 `{ success, ... }`，与既有 IPC 约定一致；绝不抛错。
   ============================================================ */

'use strict';

const { ipcMain, dialog } = require('electron');
const path = require('path');
const store = require('../services/skin-store');

/** 本进程刚由 dialog 返回、允许作为导入源的目录（一次性） */
const importAllowedDirs = new Set();

const MAX_ALLOWED_DIRS = 8;

function allowImportDir(dir) {
  if (!dir) return;
  importAllowedDirs.add(path.resolve(dir));
  // 只保留最近若干个，避免无限增长
  while (importAllowedDirs.size > MAX_ALLOWED_DIRS) {
    const first = importAllowedDirs.values().next().value;
    importAllowedDirs.delete(first);
  }
}

/** 渲染层是否被允许以该路径为导入源 */
function isImportSourceAllowed(srcDir, userRoot) {
  if (!srcDir) return false;
  const resolved = path.resolve(srcDir);
  if (importAllowedDirs.has(resolved)) return true;
  // 也允许直接导入用户皮肤目录内部的包（例如「重新扫描」场景）
  if (!userRoot) return false;
  return store.isInside(userRoot, resolved);
}

function register({ userDataDir, rootDir, loadConfig, saveConfig }) {
  // 路径缺失时退化为「没有皮肤目录」而不是抛错：能力层应按能力隔离失败，
  // 一个能力注册不上不应拖垮主进程启动。
  const userRoot = userDataDir ? path.join(userDataDir, 'pets') : null;
  const builtinRoot = rootDir ? path.join(rootDir, 'renderer', 'pet', 'skins') : null;

  /** 先查用户皮肤，再查内置皮肤；返回 { dir, source } 或 null */
  function findSkinById(skinId, user, builtin) {
    if (user) {
      const d = path.join(user, skinId);
      if (store.isInside(user, d) && store.inspectSkinDir(d).ok) {
        return { dir: d, source: 'user' };
      }
    }
    if (builtin) {
      const d = path.join(builtin, skinId);
      if (store.isInside(builtin, d) && store.inspectSkinDir(d).ok) {
        return { dir: d, source: 'builtin' };
      }
    }
    return null;
  }

  ipcMain.handle('list-skins', () => {
    try {
      const builtin = builtinRoot ? store.listSkins(builtinRoot) : { skins: [], errors: [] };
      const user = userRoot ? store.listSkins(userRoot) : { skins: [], errors: [] };
      return {
        success: true,
        builtin: builtin.skins,
        user: user.skins,
        // 坏包/不可读目录在这里透出，UI 可提示用户
        errors: [...builtin.errors, ...user.errors],
        userRoot,
        builtinRoot
      };
    } catch (e) {
      console.error('列出皮肤失败:', e);
      return { success: false, error: e.message, builtin: [], user: [], errors: [] };
    }
  });

  /* 注意：这里**不能**在参数位置解构（`(event, { sourceDir } = {})`）。
     默认值只在 `undefined` 时生效，当渲染层传来 `null` 时会抛出
     "Cannot destructure property ... of null"，而那个异常发生在 try 之外，
     于是渲染层拿到的是一个 reject（不是我们约定的 { success:false }），
     主进程还会打一条无用的堆栈。改为在 try 内部安全取值。 */
  ipcMain.handle('import-skin', (event, payload) => {
    try {
      const sourceDir = payload && typeof payload === 'object' ? payload.sourceDir : null;
      if (!sourceDir || typeof sourceDir !== 'string') {
        return { success: false, error: '缺少源目录' };
      }
      if (!userRoot) {
        return { success: false, error: '用户皮肤目录不可用' };
      }
      if (!isImportSourceAllowed(sourceDir, userRoot)) {
        return {
          success: false,
          error: '该路径不是通过「选择文件夹」得到的，已拒绝导入'
        };
      }
      // 阶段 8.5：目录与 zip 两条路径共用同一套校验与落地流程
      const isZip = /\.zip$/i.test(sourceDir);
      const res = isZip
        ? store.importSkinFromZip(sourceDir, userRoot)
        : store.importSkinFromDir(sourceDir, userRoot);
      if (!res.ok) {
        return { success: false, error: res.errors.join('；'), errors: res.errors, warnings: res.warnings };
      }
      return {
        success: true,
        skin: { id: res.skin.id, name: res.skin.name, author: res.skin.author },
        dir: res.dir,
        warnings: res.warnings
      };
    } catch (e) {
      console.error('导入皮肤失败:', e);
      return { success: false, error: e.message };
    }
  });

  // 同上：不在参数位置解构，避免 payload 为 null 时在 try 之外抛错
  ipcMain.handle('export-skin', async (event, payload) => {
    try {
      const skinId = payload && typeof payload === 'object' ? payload.skinId : null;
      if (!skinId || typeof skinId !== 'string') {
        return { success: false, error: '缺少皮肤 id' };
      }
      if (!userRoot) {
        return { success: false, error: '用户皮肤目录不可用' };
      }
      // 皮肤 id 已在导入时校验过（^[a-z0-9][a-z0-9-]{0,47}$），这里只防目录穿越
      if (skinId.includes('/') || skinId.includes('\\') || skinId.includes('..')) {
        return { success: false, error: '非法的皮肤 id' };
      }
      const skinDir = path.join(userRoot, skinId);
      if (!store.isInside(userRoot, skinDir) || !store.inspectSkinDir(skinDir).ok) {
        return { success: false, error: '未找到该皮肤或皮肤不可用: ' + skinId };
      }

      const picked = await dialog.showOpenDialog({
        title: '选择导出位置',
        properties: ['openDirectory', 'createDirectory']
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const res = store.exportSkin(skinDir, picked.filePaths[0]);
      if (!res.ok) return { success: false, error: res.errors.join('；') };
      return { success: true, dir: res.dir };
    } catch (e) {
      console.error('导出皮肤失败:', e);
      return { success: false, error: e.message };
    }
  });

  /* 选择皮肤包：既可以是**文件夹**，也可以是 **.zip**（阶段 8.5）。
     两个按钮比一个「既能选目录又能选文件」的框更清楚 ——
     Windows 原生对话框不能同时以可理解的方式支持两者。 */
  ipcMain.handle('select-skin-directory', async () => {
    try {
      const picked = await dialog.showOpenDialog({
        title: '选择皮肤包文件夹（或点「选择 zip」）',
        properties: ['openDirectory']
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const dir = picked.filePaths[0];
      allowImportDir(dir);
      return dir;
    } catch (e) {
      console.error('选择皮肤目录失败:', e);
      return null;
    }
  });

  ipcMain.handle('select-skin-zip', async () => {
    try {
      const picked = await dialog.showOpenDialog({
        title: '选择皮肤包 zip',
        properties: ['openFile'],
        filters: [{ name: '皮肤包', extensions: ['zip'] }]
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const file = picked.filePaths[0];
      allowImportDir(file);
      return file;
    } catch (e) {
      console.error('选择皮肤 zip 失败:', e);
      return null;
    }
  });

  /** 读取配置（依赖缺失时退化为空对象，绝不抛错） */
  function readConfig() {
    try {
      return (typeof loadConfig === 'function' ? loadConfig() : null) || {};
    } catch (_) {
      return {};
    }
  }

  /** 写配置；依赖缺失时视为失败而不是静默丢数据 */
  function writeConfig(cfg) {
    try {
      return typeof saveConfig === 'function' ? saveConfig(cfg) : false;
    } catch (e) {
      console.error('保存皮肤配置失败:', e);
      return false;
    }
  }

  /** 把皮肤描述里用到的图片内联成 data: URL（渲染层受 CSP 限制，不能直读本地文件） */
  function materialize(skin, dir, source) {
    const withAssets = store.withInlineAssets(skin, dir);
    withAssets.source = source;
    return withAssets;
  }

  /* 换肤后广播给所有窗口，使「设置里换了皮肤 → 已开着的浮窗立刻换装」。
     BrowserWindow 在测试环境不存在，因此整体包在 try 里：
     广播失败不应让换肤本身失败。 */
  function broadcastSkinChanged(skin) {
    try {
      const { BrowserWindow } = require('electron');
      if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return;
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send('skin-changed', skin);
          }
        } catch (_) { /* 单个窗口失败不影响其它窗口 */ }
      }
    } catch (_) { /* 环境不支持广播（测试） */ }
  }

  /* 应用皮肤：持久化到配置并返回该皮肤的完整描述，
     由渲染层负责立即换装（不广播给所有窗口 ——
     「浮窗启动时主动查询」更简单，也不会在窗口尚未创建时丢事件）。 */
  ipcMain.handle('apply-skin', (event, payload) => {
    try {
      const skinId = payload && typeof payload === 'object' ? payload.skinId : null;
      if (typeof skinId !== 'string') {
        return { success: false, error: '缺少皮肤 id' };
      }
      // 空字符串表示「还原内置」
      if (skinId === '') {
        const cfg = readConfig();
        cfg.activeSkin = '';
        writeConfig(cfg);
        return { success: true, skin: null };
      }
      if (skinId.includes('/') || skinId.includes('\\') || skinId.includes('..')) {
        return { success: false, error: '非法的皮肤 id' };
      }

      const found = findSkinById(skinId, userRoot, builtinRoot);
      if (!found) return { success: false, error: '未找到该皮肤: ' + skinId };
      const info = store.inspectSkinDir(found.dir);
      if (!info.ok) {
        return { success: false, error: '该皮肤不可用：' + info.errors.join('；') };
      }

      const cfg = readConfig();
      cfg.activeSkin = skinId;
      writeConfig(cfg);
      // 变量名不能叫 payload：本处理器的入参就叫 payload，同作用域内
      // 再 const payload 会形成暂时性死区（Cannot access before initialization）
      const skinPayload = materialize(info.skin, found.dir, found.source);
      broadcastSkinChanged(skinPayload);
      return { success: true, skin: skinPayload };
    } catch (e) {
      console.error('应用皮肤失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-active-skin', () => {
    try {
      const cfg = readConfig();
      const skinId = typeof cfg.activeSkin === 'string' ? cfg.activeSkin : '';
      if (!skinId) return { success: true, skin: null };
      const found = findSkinById(skinId, userRoot, builtinRoot);
      if (!found) return { success: true, skin: null, missing: skinId };
      const info = store.inspectSkinDir(found.dir);
      if (!info.ok) return { success: true, skin: null, invalid: skinId, errors: info.errors };
      return { success: true, skin: materialize(info.skin, found.dir, found.source) };
    } catch (e) {
      console.error('读取当前皮肤失败:', e);
      return { success: false, error: e.message, skin: null };
    }
  });
}

module.exports = { register, _internal: { importAllowedDirs, isImportSourceAllowed } };
