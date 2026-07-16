const { app, screen } = require('electron');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('shortcut link')) return;
  if (err.message && err.message.includes('NOTREACHED')) return;
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  const { loadConfig, saveConfig } = require('./config');
  const windows = require('./windows');
  const { iconCache, loadIconCache, saveIconCache, scheduleSaveIconCache } = require('./services/icon-cache');
  const iconExtractor = require('./services/icon-extractor');
  const ipcConfig = require('./ipc/config');
  const ipcFiles = require('./ipc/files');
  const ipcIcons = require('./ipc/icons');
  const ipcWindow = require('./ipc/window');
  const ipcDialog = require('./ipc/dialog');

  app.on('second-instance', () => {
    const floatWindow = windows.getFloatWindow();
    if (floatWindow) {
      if (floatWindow.isMinimized()) floatWindow.restore();
      floatWindow.focus();
    }
  });

  let crashCount = 0;
  app.on('gpu-process-crashed', () => {
    crashCount++;
    if (crashCount >= 2) {
      console.log('GPU 进程连续崩溃，重启并禁用 GPU');
      app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu'] });
      app.exit(0);
    }
  });

  app.on('render-process-gone', (event, webContents, details) => {
    if (details.reason === 'crashed') {
      crashCount++;
      if (crashCount >= 2) {
        console.log('渲染进程连续崩溃，重启并禁用 GPU');
        app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu'] });
        app.exit(0);
      }
    }
  });

  app.whenReady().then(() => {
    const config = loadConfig();
    if (!fs.existsSync(config.savePath)) {
      fs.mkdirSync(config.savePath, { recursive: true });
    }
    loadIconCache();
    windows.createIconHelperWindow();
    windows.createFloatWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      saveIconCache();
      const iconHelperWindow = windows.getIconHelperWindow();
      if (iconHelperWindow && !iconHelperWindow.isDestroyed()) {
        iconHelperWindow.destroy();
      }
      app.quit();
    }
  });

  app.on('will-quit', () => {
    saveIconCache();
  });

  // 注册 IPC handlers
  ipcConfig.register({ loadConfig, saveConfig });
  ipcFiles.register({ loadConfig, getFileManagerWindow: windows.getFileManagerWindow });
  ipcIcons.register({ iconCache, scheduleSaveIconCache, iconExtractor });
  ipcWindow.register({
    loadConfig,
    saveConfig,
    screen,
    app,
    getFloatWindow: windows.getFloatWindow,
    getFileManagerWindow: windows.getFileManagerWindow,
    getAlwaysOnTopEnabled: windows.getAlwaysOnTopEnabled,
    setAlwaysOnTopEnabled: windows.setAlwaysOnTopEnabled
  });
  ipcDialog.register({
    createFileManagerWindow: windows.createFileManagerWindow,
    getFileManagerWindow: windows.getFileManagerWindow,
    iconExtractor
  });
}
