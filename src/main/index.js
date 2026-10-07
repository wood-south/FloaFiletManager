const { app, screen } = require('electron');
const fs = require('fs');
const { execSync } = require('child_process');

function restoreTaskbar() {
  try {
    const script = `Add-Type -Namespace W -Name T -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
$h = [W.T]::FindWindow("Shell_TrayWnd", $null)
if ($h -ne [IntPtr]::Zero) { [W.T]::ShowWindow($h, 5) }`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 4000 });
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  // 这两个异常来自 Electron 自身的已知噪音（快捷方式解析、NOTREACHED），直接忽略
  if (err.message && err.message.includes('shortcut link')) return;
  if (err.message && err.message.includes('NOTREACHED')) return;
  console.error('未捕获异常:', err);
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  const { loadConfig, saveConfig } = require('./config');
  const windows = require('./windows');
  const { iconCache, loadIconCache, saveIconCache, scheduleSaveIconCache } = require('./services/icon-cache');
  const iconExtractor = require('./services/icon-extractor');
  const capabilities = require('./capabilities');

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
    // 从配置恢复持久化状态
    windows.loadPersistedState();
    windows.createFloatWindow();
    // 如果上次 Dock 可见，启动时恢复显示
    if (windows.getDockVisible()) {
      windows.showDockWindow();
    }
    // 注意：音量控制 dll 改为首次使用时再按需编译（见 system.js），
    // 不在启动时运行 csc.exe，避免触发杀毒软件对「运行时编译代码」的启发式拦截导致启动卡顿/CPU 占满。
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      saveIconCache();
      app.quit();
    }
  });

  app.on('will-quit', () => {
    saveIconCache();
    restoreTaskbar();
  });

  // 注册 IPC handlers：按能力层声明加载（配置里可关闭某个能力 → 其通道不再注册）
  capabilities.loadAll({
    loadConfig,
    saveConfig,
    screen,
    app,
    windows,
    iconCache,
    scheduleSaveIconCache,
    iconExtractor
  });
}
