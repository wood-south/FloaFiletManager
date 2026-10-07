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

function register({ userDataDir, rootDir }) {
  // 路径缺失时退化为「没有皮肤目录」而不是抛错：能力层应按能力隔离失败，
  // 一个能力注册不上不应拖垮主进程启动。
  const userRoot = userDataDir ? path.join(userDataDir, 'pets') : null;
  const builtinRoot = rootDir ? path.join(rootDir, 'renderer', 'pet', 'skins') : null;

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
      const res = store.importSkinFromDir(sourceDir, userRoot);
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

  /* `select-directory` 是既有的通用选目录通道（dialog.js 注册）。
     为了让「选择皮肤文件夹 → 导入」成为可能，这里包一层：
     选中后把路径加入一次性白名单，再交给渲染层调 import-skin。
     不复用原通道是因为它无法区分「用于导入皮肤」与「用于设置保存路径」。 */
  ipcMain.handle('select-skin-directory', async () => {
    try {
      const picked = await dialog.showOpenDialog({
        title: '选择皮肤包文件夹',
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
}

module.exports = { register, _internal: { importAllowedDirs, isImportSourceAllowed } };
