const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { loadConfig, rootDir } = require('./config');

let floatWindow = null;
let fileManagerWindow = null;
let dockWindow = null;
let settingsWindow = null;
let alwaysOnTopEnabled = true;
let dockAlwaysOnTopEnabled = true;
let dockVisible = true;

function getFloatWindow() { return floatWindow; }
function getFileManagerWindow() { return fileManagerWindow; }
function getDockWindow() { return dockWindow; }
function getSettingsWindow() { return settingsWindow; }
function getAlwaysOnTopEnabled() { return alwaysOnTopEnabled; }
function setAlwaysOnTopEnabled(val) { alwaysOnTopEnabled = val; }
function getDockAlwaysOnTopEnabled() { return dockAlwaysOnTopEnabled; }
function setDockAlwaysOnTopEnabled(val) {
  dockAlwaysOnTopEnabled = val;
  if (dockWindow && !dockWindow.isDestroyed()) {
    if (val) {
      dockWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      dockWindow.setAlwaysOnTop(false);
    }
  }
}
function getDockVisible() { return dockVisible; }

// 从配置加载持久化状态
function loadPersistedState() {
  const config = loadConfig();
  alwaysOnTopEnabled = config.floatAlwaysOnTop !== false;
  dockAlwaysOnTopEnabled = config.dockAlwaysOnTop !== false;
  dockVisible = config.dockVisible !== false;
}

function createFloatWindow() {
  const config = loadConfig();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  const size = 160;
  let x = config.floatPosition?.x ?? (workArea.width - size - 50);
  let y = config.floatPosition?.y ?? (workArea.height - size - 100);

  const minVisible = 45;
  x = Math.max(0 - size + minVisible, Math.min(x, workArea.width - minVisible));
  y = Math.max(0 - size + minVisible, Math.min(y, workArea.height - minVisible));

  floatWindow = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(rootDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatWindow.setAlwaysOnTop(alwaysOnTopEnabled, 'screen-saver');
  floatWindow.setVisibleOnAllWorkspaces(true);
  floatWindow.loadFile(path.join(rootDir, 'renderer', 'float.html'));

  // 启动时恢复贴边状态
  floatWindow.webContents.on('did-finish-load', () => {
    const snapEdges = config.snapEdges || null;
    floatWindow.webContents.send('snap-edge-changed', snapEdges);
  });
}

function createFileManagerWindow() {
  if (fileManagerWindow) {
    fileManagerWindow.focus();
    return;
  }

  const floatBounds = floatWindow.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const fmWidth = 900;
  const fmHeight = 600;

  let fmX = floatBounds.x + floatBounds.width + 10;
  let fmY = floatBounds.y;

  if (fmX + fmWidth > workArea.width) {
    fmX = floatBounds.x - fmWidth - 10;
  }
  if (fmX < 0) {
    fmX = Math.max(0, Math.min(floatBounds.x, workArea.width - fmWidth));
  }
  if (fmY + fmHeight > workArea.height) {
    fmY = Math.max(0, workArea.height - fmHeight - 10);
  }

  fileManagerWindow = new BrowserWindow({
    width: fmWidth,
    height: fmHeight,
    x: fmX,
    y: fmY,
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(rootDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  fileManagerWindow.setAlwaysOnTop(true, 'screen-saver');
  fileManagerWindow.loadFile(path.join(rootDir, 'renderer', 'file-manager.html'));

  fileManagerWindow.on('closed', () => {
    fileManagerWindow = null;
  });
}

function createDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.focus();
    return dockWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const dockWidth = 800;
  // 初始窗口足够大，内容加载后自动适配
  const dockHeight = 200;
  // 读取持久化的位置（基于底部锚点），如果没有则底部居中
  const cfg = loadConfig();
  let dockX, dockY;
  const hasSaved = cfg.dockX !== null && cfg.dockX !== undefined &&
    cfg.dockBottom !== null && cfg.dockBottom !== undefined;
  if (hasSaved) {
    dockX = cfg.dockX;
    dockY = cfg.dockBottom - dockHeight;
    // 边界保护：保存的位置超出屏幕则回退到底部居中
    if (dockX + dockWidth < workArea.x || dockX > workArea.x + workArea.width ||
        dockY < workArea.y || dockY + dockHeight > workArea.y + workArea.height + 60) {
      dockX = Math.round(workArea.x + (workArea.width - dockWidth) / 2);
      dockY = workArea.height - dockHeight + 20;
    }
  } else {
    dockX = Math.round(workArea.x + (workArea.width - dockWidth) / 2);
    dockY = workArea.height - dockHeight + 20;
  }

  dockWindow = new BrowserWindow({
    width: dockWidth,
    height: dockHeight,
    x: dockX,
    y: dockY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(rootDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dockWindow.setAlwaysOnTop(dockAlwaysOnTopEnabled, 'screen-saver');
  dockWindow.setVisibleOnAllWorkspaces(true);
  dockWindow.loadFile(path.join(rootDir, 'renderer', 'dock.html'));

  // DWM 桌面模糊：CSS backdrop-filter 无法在透明窗口中模糊桌面，
  // 必须用 OS 级 setBackgroundMaterial 实现。acrylic 提供 Win10+ 亚克力桌面模糊。
  const applyDwmBlur = () => {
    if (process.platform !== 'win32' || !dockWindow || dockWindow.isDestroyed()) return;
    try { dockWindow.setBackgroundMaterial('acrylic'); } catch (_) {}
  };
  dockWindow.webContents.on('did-finish-load', applyDwmBlur);
  dockWindow.on('show', applyDwmBlur);

  dockWindow.on('closed', () => {
    dockWindow = null;
  });

  return dockWindow;
}

function showDockWindow() {
  if (!dockWindow || dockWindow.isDestroyed()) {
    createDockWindow();
  } else {
    dockWindow.show();
    dockWindow.focus();
  }
}

function hideDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.hide();
  }
}

function toggleDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed() && dockWindow.isVisible()) {
    hideDockWindow();
    dockVisible = false;
    savePersistedState();
    return false;
  } else {
    showDockWindow();
    dockVisible = true;
    savePersistedState();
    return true;
  }
}

function savePersistedState() {
  try {
    const { saveConfig } = require('./config');
    const config = loadConfig();
    config.dockVisible = dockVisible;
    config.floatAlwaysOnTop = alwaysOnTopEnabled;
    config.dockAlwaysOnTop = dockAlwaysOnTopEnabled;
    saveConfig(config);
  } catch (e) {
    console.error('保存窗口状态失败:', e);
  }
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const w = 440;
  const h = 560;

  settingsWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + (workArea.height - h) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(rootDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.setAlwaysOnTop(true, 'screen-saver');
  settingsWindow.loadFile(path.join(rootDir, 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

module.exports = {
  createFloatWindow,
  createFileManagerWindow,
  createDockWindow,
  showDockWindow,
  hideDockWindow,
  toggleDockWindow,
  createSettingsWindow,
  getFloatWindow,
  getFileManagerWindow,
  getDockWindow,
  getSettingsWindow,
  getAlwaysOnTopEnabled,
  setAlwaysOnTopEnabled,
  getDockAlwaysOnTopEnabled,
  setDockAlwaysOnTopEnabled,
  getDockVisible,
  loadPersistedState
};
