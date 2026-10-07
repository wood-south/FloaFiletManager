const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');

// 计算图标缓存键：快捷方式(.lnk/.url)按完整路径区分，其余按扩展名复用
// 必须与渲染进程 renderer/scripts/file-manager.js 的 getIconCacheKeyByName 保持一致
function getIconCacheKey(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.lnk' || ext === '.url') {
    return filePath.toLowerCase();
  }
  return ext || 'file';
}

// 图标提取完成后通知各渲染窗口增量更新，避免整批清空缓存后重新拉取
function broadcastIconUpdated(cacheKey, dataUrl) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('icon-updated', { filePath: cacheKey, iconDataUrl: dataUrl });
    }
  }
}

function register({ iconCache, scheduleSaveIconCache, iconExtractor }) {
  const { resolveFileIcon } = iconExtractor;

  ipcMain.handle('get-file-icon', async (event, filePath, isDirectory) => {
    try {
      if (isDirectory) return null;

      const cacheKey = getIconCacheKey(filePath);

      if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
      }

      // resolveFileIcon 内部已包含完整回退链：
      // 快捷方式/.url 解析 → PowerShell + SHGetFileInfo → Electron app.getFileIcon
      const result = await resolveFileIcon(filePath);
      if (result) {
        iconCache.set(cacheKey, result);
        scheduleSaveIconCache();
        broadcastIconUpdated(cacheKey, result);
      }
      return result;
    } catch (e) {
      console.error('获取文件图标失败:', e.message);
      return null;
    }
  });
}

module.exports = { register };
