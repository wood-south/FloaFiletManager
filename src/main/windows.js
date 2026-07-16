const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { loadConfig, rootDir } = require('./config');

let floatWindow = null;
let fileManagerWindow = null;
let iconHelperWindow = null;
let alwaysOnTopEnabled = true;

let iconHelperReady = false;
let iconHelperPending = [];
const iconRequestMap = new Map();

function getFloatWindow() { return floatWindow; }
function getFileManagerWindow() { return fileManagerWindow; }
function getIconHelperWindow() { return iconHelperWindow; }
function getAlwaysOnTopEnabled() { return alwaysOnTopEnabled; }
function setAlwaysOnTopEnabled(val) { alwaysOnTopEnabled = val; }
function getIconHelperReady() { return iconHelperReady; }
function getIconRequestMap() { return iconRequestMap; }

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

  floatWindow.setAlwaysOnTop(true, 'screen-saver');
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

function createIconHelperWindow() {
  if (iconHelperWindow) return;
  iconHelperWindow = new BrowserWindow({
    show: true,
    width: 100,
    height: 100,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    alwaysOnTop: false,
    focusable: false,
    x: -1000,
    y: -1000,
    webPreferences: {
      preload: path.join(rootDir, 'renderer', 'icon-helper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false
    }
  });
  iconHelperWindow.hide();
  iconHelperWindow.loadFile(path.join(rootDir, 'renderer', 'icon-helper.html'));
  iconHelperWindow.webContents.on('did-finish-load', () => {
    iconHelperReady = true;
    for (const item of iconHelperPending) {
      iconHelperWindow.webContents.send('helper-get-file-icon', item.requestId, item.filePath, item.isDirectory);
    }
    iconHelperPending = [];
  });
  iconHelperWindow.on('closed', () => {
    iconHelperWindow = null;
    iconHelperReady = false;
  });
}

function requestIconFromHelper(filePath, isDirectory) {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      iconRequestMap.delete(requestId);
      resolve(null);
    }, 5000);
    iconRequestMap.set(requestId, (dataUrl) => {
      clearTimeout(timer);
      resolve(dataUrl);
    });
    if (iconHelperReady && iconHelperWindow && !iconHelperWindow.isDestroyed()) {
      iconHelperWindow.webContents.send('helper-get-file-icon', requestId, filePath, isDirectory);
    } else {
      iconHelperPending.push({ requestId, filePath, isDirectory });
      if (!iconHelperWindow) createIconHelperWindow();
    }
  });
}

ipcMain.on('helper-return-file-icon', (event, requestId, dataUrl) => {
  const resolve = iconRequestMap.get(requestId);
  if (resolve) {
    iconRequestMap.delete(requestId);
    resolve(dataUrl);
  }
});

module.exports = {
  createFloatWindow,
  createFileManagerWindow,
  createIconHelperWindow,
  requestIconFromHelper,
  getFloatWindow,
  getFileManagerWindow,
  getIconHelperWindow,
  getAlwaysOnTopEnabled,
  setAlwaysOnTopEnabled,
  getIconHelperReady,
  getIconRequestMap
};
