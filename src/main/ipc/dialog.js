const { ipcMain, dialog } = require('electron');
const path = require('path');
const guard = require('../security/guard');

function register({ createFileManagerWindow, getFileManagerWindow, iconExtractor, getDockWindow }) {
  const { parseUrlFile } = iconExtractor;

  ipcMain.handle('select-directory', async (event) => {
    const sender = guard.validateSender(event);
    if (!sender.ok) return null;
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('open-file-manager', () => {
    createFileManagerWindow();
    return true;
  });

  ipcMain.handle('close-file-manager', () => {
    const fileManagerWindow = getFileManagerWindow();
    if (fileManagerWindow) {
      fileManagerWindow.close();
    }
    return true;
  });

  ipcMain.handle('open-this-computer', () => {
    const { shell } = require('electron');
    shell.openPath('::{20D04FE0-3AEA-1069-A2D8-08002B30309D}');
    return true;
  });

  ipcMain.handle('show-message-box', async (event, options) => {
    const sender = guard.validateSender(event);
    if (!sender.ok) return { response: 0 };
    // 尽量以调用方所在窗口为父窗口：Dock 等置顶无边框窗口若不指定父窗口，
    // 弹出的原生对话框可能被自身置顶窗口遮挡。
    let parent = null;
    try {
      const { BrowserWindow } = require('electron');
      const callerWin = BrowserWindow.fromWebContents(event.sender);
      if (callerWin && !callerWin.isDestroyed()) parent = callerWin;
      else if (typeof getDockWindow === 'function') {
        const dockWin = getDockWindow();
        if (dockWin && !dockWin.isDestroyed()) parent = dockWin;
      }
    } catch (_) {
      parent = null;
    }
    const result = await dialog.showMessageBox(parent, options);
    return result;
  });

  ipcMain.handle('open-file-location', async (event, filePath) => {
    const sender = guard.validateSender(event);
    if (!sender.ok) return { success: false, error: sender.error };
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('open-file', async (event, filePath) => {
    const sender = guard.validateSender(event);
    if (!sender.ok) return { success: false, error: sender.error };
    const { shell } = require('electron');
    try {
      // 对于快捷方式(.lnk)和可执行文件，用 shell.openPath 可能失败
      // 改用 Windows 原生 start 命令，兼容性更好
      const ext = path.extname(filePath).toLowerCase();
      const isUrl = ext === '.url';

      if (isUrl) {
        // .url 文件：读取 URL 内容，用 shell.openExternal 打开
        try {
          const urlInfo = parseUrlFile(filePath);
          if (urlInfo.url) {
            await shell.openExternal(urlInfo.url);
            console.log('打开URL:', urlInfo.url);
            return { success: true };
          }
        } catch (e) {
          console.error('解析URL失败:', e.message);
        }
      }

      // .lnk 直接用 shell.openPath，Windows 会自动解析快捷方式
      const result = await shell.openPath(filePath);
      if (result) {
        console.error('打开文件失败:', result);
        return { success: false, error: result };
      }
      console.log('打开文件:', filePath);
      return { success: true };
    } catch (e) {
      console.error('打开文件异常:', e.message);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
