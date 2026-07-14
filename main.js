const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('shortcut link')) return;
  if (err.message && err.message.includes('NOTREACHED')) return;
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
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

  let floatWindow = null;
let fileManagerWindow = null;
let settingsWindow = null;
let iconHelperWindow = null;
let alwaysOnTopEnabled = true;

// 开发环境下将 userData 放到项目目录，避免沙箱拦截
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(__dirname, '.userdata');
  if (!fs.existsSync(devDataDir)) {
    fs.mkdirSync(devDataDir, { recursive: true });
  }
  app.setPath('userData', devDataDir);
}

const userDataDir = app.getPath('userData');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const configPath = path.join(userDataDir, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  return {
    savePath: path.join(app.getPath('documents'), 'FloatUploads'),
    floatPosition: { x: 100, y: 100 }
  };
}

function saveConfig(config) {
  // 重试机制：频繁写入可能因文件被占用而 EPERM
  const data = JSON.stringify(config, null, 2);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(configPath, data);
      return true;
    } catch (e) {
      console.error(`保存配置失败(第${attempt + 1}次):`, e.message);
      if (attempt < 2) {
        // 短暂等待后重试
        const start = Date.now();
        while (Date.now() - start < 80) { /* busy wait */ }
      }
    }
  }
  // 兜底：写到临时文件再原子替换
  try {
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, configPath);
    return true;
  } catch (e) {
    console.error('保存配置最终失败:', e);
    return false;
  }
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatWindow.setAlwaysOnTop(true, 'screen-saver');
  floatWindow.setVisibleOnAllWorkspaces(true);
  floatWindow.loadFile(path.join(__dirname, 'renderer', 'float.html'));

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  fileManagerWindow.setAlwaysOnTop(true, 'screen-saver');
  fileManagerWindow.loadFile(path.join(__dirname, 'renderer', 'file-manager.html'));

  fileManagerWindow.on('closed', () => {
    fileManagerWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const floatBounds = floatWindow.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const sw = 400;
  const sh = 400;

  let sx = floatBounds.x + floatBounds.width + 10;
  let sy = floatBounds.y;

  if (sx + sw > workArea.width) {
    sx = floatBounds.x - sw - 10;
  }
  if (sx < 0) {
    sx = Math.max(0, Math.min(floatBounds.x, workArea.width - sw));
  }
  if (sy + sh > workArea.height) {
    sy = Math.max(0, workArea.height - sh - 10);
  }

  settingsWindow = new BrowserWindow({
    width: sw,
    height: sh,
    x: sx,
    y: sy,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.setAlwaysOnTop(true, 'screen-saver');
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

let iconHelperReady = false;
let iconHelperPending = [];
const iconRequestMap = new Map();

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
      preload: path.join(__dirname, 'renderer', 'icon-helper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false
    }
  });
  iconHelperWindow.hide();
  iconHelperWindow.loadFile(path.join(__dirname, 'renderer', 'icon-helper.html'));
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

app.whenReady().then(() => {
  const config = loadConfig();
  if (!fs.existsSync(config.savePath)) {
    fs.mkdirSync(config.savePath, { recursive: true });
  }
  loadIconCache();
  createIconHelperWindow();
  createFloatWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    saveIconCache();
    if (iconHelperWindow && !iconHelperWindow.isDestroyed()) {
      iconHelperWindow.destroy();
    }
    app.quit();
  }
});

app.on('will-quit', () => {
  saveIconCache();
});

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('set-save-path', async (event, newPath) => {
  try {
    const config = loadConfig();
    config.savePath = newPath;
    // 保存路径历史，方便下次切换
    if (!config.pathHistory) config.pathHistory = [];
    // 去重并移到最前
    config.pathHistory = config.pathHistory.filter(p => p !== newPath);
    config.pathHistory.unshift(newPath);
    // 最多保留 10 条
    if (config.pathHistory.length > 10) {
      config.pathHistory = config.pathHistory.slice(0, 10);
    }
    saveConfig(config);
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    console.log('保存路径设置成功:', newPath);
    return true;
  } catch (e) {
    console.error('保存路径设置失败:', e);
    return false;
  }
});

ipcMain.handle('select-directory', async () => {
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
  if (fileManagerWindow) {
    fileManagerWindow.close();
  }
  return true;
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
  return true;
});

ipcMain.handle('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
  return true;
});

ipcMain.handle('upload-file', async (event, { sourcePath, fileName, overwrite }) => {
  const config = loadConfig();

  console.log('上传文件:', { sourcePath, fileName, savePath: config.savePath, overwrite });

  try {
    if (!fs.existsSync(config.savePath)) {
      console.log('保存路径不存在，创建:', config.savePath);
      fs.mkdirSync(config.savePath, { recursive: true });
    }

    if (!fs.existsSync(sourcePath)) {
      console.error('源文件不存在:', sourcePath);
      return { success: false, error: '源文件不存在: ' + sourcePath };
    }

    // 检查 sourcePath 是否为文件夹，如果是则拒绝处理
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      console.error('不能使用文件上传接口上传文件夹:', sourcePath);
      return { success: false, error: '请使用上传文件夹功能上传文件夹' };
    }

    const destPath = path.join(config.savePath, fileName);

    // 检查重名：未明确覆盖时，返回重复提示让前端确认
    if (fs.existsSync(destPath) && !overwrite) {
      return { success: false, duplicate: true, destPath };
    }

    let finalDestPath = destPath;
    if (overwrite && fs.existsSync(destPath)) {
      // 覆盖模式：直接覆盖原文件
    } else if (overwrite) {
      // 覆盖模式但文件不存在，正常流程
    }

    // 对于快捷方式(.lnk)等特殊文件，用 Buffer 复制避免 EPERM
    const isLnk = fileName.toLowerCase().endsWith('.lnk');
    if (isLnk) {
      const content = fs.readFileSync(sourcePath);
      fs.writeFileSync(finalDestPath, content);
    } else {
      fs.copyFileSync(sourcePath, finalDestPath);
    }

    console.log('上传成功:', finalDestPath);
    return { success: true, destPath: finalDestPath };
  } catch (error) {
    console.error('上传失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 判断路径是否为文件夹
ipcMain.handle('is-directory', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
});

// 上传文件夹（递归复制整个文件夹）
ipcMain.handle('upload-folder', async (event, sourceFolder) => {
  const config = loadConfig();

  console.log('上传文件夹:', { sourceFolder, savePath: config.savePath });

  try {
    if (!fs.existsSync(config.savePath)) {
      console.log('保存路径不存在，创建:', config.savePath);
      fs.mkdirSync(config.savePath, { recursive: true });
    }

    if (!fs.existsSync(sourceFolder)) {
      console.error('源文件夹不存在:', sourceFolder);
      return { success: false, error: '源文件夹不存在: ' + sourceFolder };
    }

    const folderName = path.basename(sourceFolder);
    const destFolder = path.join(config.savePath, folderName);

    // 检查目标文件夹是否已存在
    if (fs.existsSync(destFolder)) {
      return { success: false, duplicate: true, destPath: destFolder };
    }

    // 递归复制文件夹
    function copyFolderRecursive(src, dest) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }

      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          copyFolderRecursive(srcPath, destPath);
        } else {
          // 处理快捷方式(.lnk)等特殊文件
          const isLnk = entry.name.toLowerCase().endsWith('.lnk');
          if (isLnk) {
            const content = fs.readFileSync(srcPath);
            fs.writeFileSync(destPath, content);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      }
    }

    copyFolderRecursive(sourceFolder, destFolder);
    console.log('文件夹上传成功:', destFolder);
    return { success: true, destPath: destFolder };
  } catch (error) {
    console.error('文件夹上传失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 确认对话框
ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(options);
  return result;
});

ipcMain.handle('list-files', async (event, dirPath) => {
  const config = loadConfig();
  const targetPath = dirPath || config.savePath;

  try {
    const files = fs.readdirSync(targetPath, { withFileTypes: true });
    const result = [];
    
    for (const file of files) {
      const fullPath = path.join(targetPath, file.name);
      result.push({
        name: file.name,
        isDirectory: file.isDirectory(),
        targetIsDirectory: false,
        path: fullPath,
        size: 0,
        mtime: null
      });
    }
    
    return { success: true, files: result, currentPath: targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-files', async (event, keyword) => {
  const config = loadConfig();
  const searchPath = config.savePath;
  const results = [];

  function searchRecursive(dir) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.name.toLowerCase().includes(keyword.toLowerCase())) {
          results.push({
            name: file.name,
            isDirectory: file.isDirectory(),
            targetIsDirectory: false,
            path: fullPath,
            size: 0,
            mtime: null
          });
        }
        if (file.isDirectory()) {
          searchRecursive(fullPath);
        }
      }
    } catch (e) {
      console.error('搜索出错:', e);
    }
  }

  searchRecursive(searchPath);
  return { success: true, files: results };
});

ipcMain.handle('open-file-location', async (event, filePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('open-file', async (event, filePath) => {
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

ipcMain.handle('delete-file', async (event, filePath) => {
  const { shell } = require('electron');
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    // 移到回收站，而不是永久删除，更安全
    shell.trashItem(filePath);
    console.log('删除文件:', filePath);
    return { success: true };
  } catch (e) {
    console.error('删除文件失败:', e.message);
    return { success: false, error: e.message };
  }
});

const iconCache = new Map();
let folderIconDataUrl = null;
let iconCachePath = null;
let iconCacheSaveTimeout = null;

function loadIconCache() {
  if (!iconCachePath) {
    const cacheDir = isDev ? __dirname : path.dirname(app.getPath('exe'));
    iconCachePath = path.join(cacheDir, 'icon-cache.json');
  }
  try {
    if (fs.existsSync(iconCachePath)) {
      const data = JSON.parse(fs.readFileSync(iconCachePath, 'utf8'));
      if (data && typeof data === 'object') {
        for (const [key, val] of Object.entries(data)) {
          iconCache.set(key, val);
        }
      }
      console.log('加载图标缓存:', iconCache.size, '个, 路径:', iconCachePath);
    } else {
      console.log('图标缓存不存在: ' + iconCachePath + ', 将在首次获取图标时自动生成');
    }
  } catch (e) {
    console.error('加载图标缓存失败:', e.message);
    iconCachePath = null;
  }
}

function saveIconCache() {
  if (!iconCachePath) return;
  try {
    const data = {};
    let totalSize = 0;
    for (const [key, val] of iconCache) {
      if (val && typeof val === 'string') {
        const entrySize = key.length + val.length;
        if (totalSize + entrySize > 5 * 1024 * 1024) break;
        data[key] = val;
        totalSize += entrySize;
      }
    }
    const json = JSON.stringify(data, null, 2);
    const tmp = iconCachePath + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, iconCachePath);
    console.log('保存图标缓存:', Object.keys(data).length, '个');
  } catch (e) {
    console.error('保存图标缓存失败:', e.message);
  }
}

function scheduleSaveIconCache() {
  if (iconCacheSaveTimeout) {
    clearTimeout(iconCacheSaveTimeout);
  }
  iconCacheSaveTimeout = setTimeout(saveIconCache, 5000);
}

function cleanPath(rawPath) {
  if (!rawPath) return null;
  // 去除首尾引号和空白
  let p = rawPath.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  // 去除 file:/// 前缀
  if (p.startsWith('file:///')) {
    p = p.slice(8);
  }
  // URL 编码的路径可能需要解码（如 %20 -> 空格）
  try {
    p = decodeURIComponent(p);
  } catch (e) {
    // 解码失败，保持原样
  }
  return p || null;
}

function parseIconPath(iconPath) {
  if (!iconPath) return null;
  // icon 可能是 "path,index" 格式，如 "C:\Windows\System32\shell32.dll,167"
  const parts = iconPath.split(',');
  const pathPart = cleanPath(parts[0]);
  if (pathPart && fs.existsSync(pathPart)) {
    return pathPart;
  }
  return null;
}

function resolveLnkTarget(lnkPath) {
  try {
    const { shell } = require('electron');
    const shortcut = shell.readShortcutLink(lnkPath);
    if (shortcut) {
      const target = cleanPath(shortcut.target);
      if (target && fs.existsSync(target)) {
        return target;
      }
      const iconPath = parseIconPath(shortcut.icon);
      if (iconPath && fs.existsSync(iconPath)) {
        return iconPath;
      }
    }
  } catch (e) {
    console.error('readShortcutLink 失败:', e.message);
  }

  try {
    const { execSync } = require('child_process');
    const cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}').TargetPath"`;
    const target = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
    if (target && fs.existsSync(target)) {
      return cleanPath(target);
    }
  } catch (e) {
    console.error('PowerShell解析lnk失败:', e.message);
  }

  return null;
}

function parseUrlFile(urlPath) {
  // 解析 .url 文件（INI格式），返回 { url, iconFile, iconIndex }
  try {
    const content = fs.readFileSync(urlPath, 'utf-8');
    const result = {};
    for (const line of content.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key === 'URL') result.url = val;
        if (key === 'IconFile') result.iconFile = val;
        if (key === 'IconIndex') result.iconIndex = parseInt(val, 10) || 0;
      }
    }
    return result;
  } catch (e) {
    console.error('解析 .url 文件失败:', e.message);
    return {};
  }
}

function findSteamInstallPath() {
  // 尝试多个常见 Steam 安装位置
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Steam'),
    path.join(process.env['ProgramFiles'] || '', 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function getSteamGameIcon(steamUrl) {
  // steam://rungameid/431960 -> 尝试从 Steam 目录找图标
  const match = steamUrl.match(/rungameid\/(\d+)/);
  if (!match) return null;
  const appId = match[1];
  const steamPath = findSteamInstallPath();
  if (!steamPath) return null;
  // 尝试多个可能的图标位置
  const candidates = [
    path.join(steamPath, 'steam', 'games', `${appId}.ico`),
    path.join(steamPath, 'appcache', 'librarycache', `${appId}_icon.jpg`),
    path.join(steamPath, 'appcache', 'librarycache', `${appId}_icon.png`),
    path.join(steamPath, 'steam', 'games', `${appId}.jpg`),
    path.join(steamPath, 'steam', 'games', `${appId}.png`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getLnkIconLocation(lnkPath) {
  // 返回快捷方式的完整 IconLocation，可能包含索引
  try {
    const { shell } = require('electron');
    const shortcut = shell.readShortcutLink(lnkPath);
    if (shortcut && shortcut.icon) {
      return shortcut.icon;
    }
  } catch (e) {
    console.error('readShortcutLink 失败:', e.message);
  }
  // 备用：PowerShell
  try {
    const { execSync } = require('child_process');
    const cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}').IconLocation"`;
    return execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim() || null;
  } catch (e) {
    console.error('PowerShell 获取图标位置失败:', e.message);
    return null;
  }
}

function getFileIconViaPowerShell(filePath) {
  return new Promise((resolve) => {
    try {
      const os = require('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffm-icon-ext-'));
      const outFile = path.join(tmpDir, 'icon.png');
      
      const psScript = `
Add-Type -AssemblyName System.Drawing
$code = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class IconExtractor {
    [StructLayout(LayoutKind.Sequential)]
    public struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon GetFileIcon(string filePath) {
        SHFILEINFO shfi = new SHFILEINFO();
        const uint SHGFI_ICON = 0x100;
        const uint SHGFI_LARGEICON = 0x0;
        const uint SHGFI_USEFILEATTRIBUTES = 0x10;
        
        IntPtr res = SHGetFileInfo(filePath, 0, ref shfi, (uint)Marshal.SizeOf(shfi), SHGFI_ICON | SHGFI_LARGEICON);
        if (shfi.hIcon != IntPtr.Zero) {
            Icon icon = Icon.FromHandle(shfi.hIcon);
            Icon result = (Icon)icon.Clone();
            DestroyIcon(shfi.hIcon);
            return result;
        }
        return null;
    }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$filePath = '${filePath.replace(/'/g, "''")}'
$icon = [IconExtractor]::GetFileIcon($filePath)

if (-not $icon) {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($filePath)
}

if ($icon) {
    $bmp = New-Object System.Drawing.Bitmap(64, 64)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $rect = New-Object System.Drawing.Rectangle(0, 0, 64, 64)
    $g.DrawIcon($icon, $rect)
    $bmp.Save('${outFile.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $icon.Dispose()
    Write-Output "SUCCESS"
} else {
    Write-Output "NO_ICON"
}
`;
      
      const psPath = path.join(tmpDir, 'extract-icon.ps1');
      fs.writeFileSync(psPath, '\ufeff' + psScript, 'utf8');
      
      const { exec } = require('child_process');
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 8000 }, (err, stdout) => {
        fs.rmSync(psPath, { force: true });
        if (!err && stdout.trim() === 'SUCCESS' && fs.existsSync(outFile)) {
          try {
            const buffer = fs.readFileSync(outFile);
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve('data:image/png;base64,' + buffer.toString('base64'));
            return;
          } catch (e) {
            console.error('读取图标文件失败:', e.message);
          }
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve(null);
      });
    } catch (e) {
      console.error('PowerShell图标提取失败:', e.message);
      resolve(null);
    }
  });
}

function iconToDataUrl(icon) {
  // 用 toPNG 获取实际 buffer，比 toDataURL 更可靠
  if (!icon || icon.isEmpty()) return null;
  const size = icon.getSize();
  if (size.width < 8 || size.height < 8) return null;
  const png = icon.toPNG();
  if (!png || png.length < 50) return null;
  return 'data:image/png;base64,' + png.toString('base64');
}

function readIcoToDataUrl(icoPath) {
  // .ico 文件直接读 base64，浏览器支持直接显示
  try {
    const buf = fs.readFileSync(icoPath);
    if (buf.length < 10) return null;
    return 'data:image/x-icon;base64,' + buf.toString('base64');
  } catch (e) {
    console.error('读取 .ico 失败:', e.message);
    return null;
  }
}

async function extractFolderIconToDataUrl() {
  // 使用 PowerShell 通过 SHGetFileInfo API 获取系统文件夹图标
  return new Promise((resolve) => {
    try {
      const os = require('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffm-folder-icon-'));
      const outFile = path.join(tmpDir, 'folder-icon.png');

      const psScript = `
Add-Type -AssemblyName System.Drawing
$code = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class ShellIconExtractor {
    [StructLayout(LayoutKind.Sequential)]
    public struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon GetFolderIcon() {
        SHFILEINFO shfi = new SHFILEINFO();
        const uint SHGFI_ICON = 0x100;
        const uint SHGFI_LARGEICON = 0x0;
        const uint SHGFI_USEFILEATTRIBUTES = 0x10;
        const uint FILE_ATTRIBUTE_DIRECTORY = 0x10;
        
        IntPtr res = SHGetFileInfo("dummy", FILE_ATTRIBUTE_DIRECTORY, ref shfi, (uint)Marshal.SizeOf(shfi), SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES);
        if (shfi.hIcon != IntPtr.Zero) {
            Icon icon = Icon.FromHandle(shfi.hIcon);
            Icon result = (Icon)icon.Clone();
            DestroyIcon(shfi.hIcon);
            return result;
        }
        return null;
    }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
$icon = [ShellIconExtractor]::GetFolderIcon()
if ($icon) {
    $bmp = New-Object System.Drawing.Bitmap(64, 64)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $rect = New-Object System.Drawing.Rectangle(0, 0, 64, 64)
    $g.DrawIcon($icon, $rect)
    $bmp.Save('${outFile.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $icon.Dispose()
}
`.trim();

      const { exec } = require('child_process');
      const psPath = path.join(tmpDir, 'get-folder-icon.ps1');
      fs.writeFileSync(psPath, '\ufeff' + psScript, 'utf8');
      
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 5000 }, (err) => {
        fs.rmSync(psPath, { force: true });
        if (!err && fs.existsSync(outFile)) {
          try {
            const buffer = fs.readFileSync(outFile);
            const dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve(dataUrl);
            return;
          } catch (e) {
            console.error('读取文件夹图标失败:', e.message);
          }
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve(null);
      });
    } catch (e) {
      console.error('提取文件夹图标失败:', e.message);
      resolve(null);
    }
  });
}

function extractLargeIconAsync(filePath, callback) {
  // 异步提取 64x64 图标，避免阻塞主进程
  try {
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffm-lgicon-'));
    const outFile = path.join(tmpDir, 'icon.png');
    const shortPath = require('child_process').execSync(
      `cmd /c for %A in ("${filePath}") do @echo %~sA`, { encoding: 'utf8' }
    ).trim();
    const psScript = `
Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon('${shortPath.replace(/'/g, "''")}')
if ($ico) {
  $bmp = New-Object System.Drawing.Bitmap(64, 64)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect = New-Object System.Drawing.Rectangle(0, 0, 64, 64)
  $g.DrawIcon($ico, $rect)
  $bmp.Save('${outFile.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $ico.Dispose()
}
`.trim();
    const psPath = path.join(tmpDir, 'extract.ps1');
    fs.writeFileSync(psPath, '\ufeff' + psScript, 'utf8');
    const { exec } = require('child_process');
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 5000 }, (err) => {
      fs.rmSync(psPath, { force: true });
      if (!err && fs.existsSync(outFile)) {
        try {
          const buf = fs.readFileSync(outFile);
          fs.rmSync(tmpDir, { recursive: true, force: true });
          callback('data:image/png;base64,' + buf.toString('base64'));
          return;
        } catch (e) {
          console.error('读取高清图标失败:', e.message);
        }
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      callback(null);
    });
  } catch (e) {
    console.error('提取大尺寸图标失败:', e.message);
    callback(null);
  }
}

const iconPending = new Map();
const MAX_CONCURRENT = 5;
let iconActive = 0;

function drainIconPending() {
  const it = iconPending.entries();
  while (iconActive < MAX_CONCURRENT) {
    const { value, done } = it.next();
    if (done) break;
    const [key, fn] = value;
    iconPending.delete(key);
    iconActive++;
    fn().finally(() => { iconActive--; drainIconPending(); });
  }
}

function getFileIconWithTimeout(iconFile, timeoutMs = 3000) {
  const { app } = require('electron');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
    app.getFileIcon(iconFile, { size: 'normal' }).then((icon) => {
      clearTimeout(timer);
      resolve(icon);
    }).catch(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

ipcMain.handle('helper-native-get-file-icon', async (event, filePath, isDirectory) => {
  try {
    if (isDirectory) return null;

    const ext = path.extname(filePath).toLowerCase();
    const isLnk = ext === '.lnk';
    const isUrl = ext === '.url';
    let result = null;
    let iconFile = filePath;

    if (isLnk) {
      const targetPath = resolveLnkTarget(filePath);
      if (targetPath) {
        iconFile = targetPath;
      }
    }

    if (isUrl) {
      const urlInfo = parseUrlFile(filePath);
      if (urlInfo.iconFile) {
        const p = cleanPath(urlInfo.iconFile);
        if (p && fs.existsSync(p)) {
          const e = path.extname(p).toLowerCase();
          if (e === '.ico') { result = readIcoToDataUrl(p); }
          else if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(e)) {
            try {
              const buf = fs.readFileSync(p);
              result = 'data:' + (e==='.jpg'?'image/jpeg':'image/'+e.slice(1)) + ';base64,' + buf.toString('base64');
            } catch (er) { console.error('url图标读取失败:', er.message); }
          } else {
            iconFile = p;
          }
        }
      }
      if (!result && urlInfo.url && urlInfo.url.startsWith('steam://')) {
        const si = getSteamGameIcon(urlInfo.url);
        if (si) {
          const se = path.extname(si).toLowerCase();
          if (se === '.ico') result = readIcoToDataUrl(si);
          else {
            try {
              const buf = fs.readFileSync(si);
              result = 'data:' + (se==='.jpg'?'image/jpeg':'image/'+se.slice(1)) + ';base64,' + buf.toString('base64');
            } catch (er) { console.error('Steam图标读取失败:', er.message); }
          }
        }
      }
    }

    if (!result) {
      try {
        const icon = await getFileIconWithTimeout(iconFile, 3000);
        if (icon) {
          result = iconToDataUrl(icon);
        }
      } catch (e) {
        console.error('getFileIcon失败:', e.message);
      }
    }

    if (!result) {
      result = extractIconToDataUrl(iconFile);
      if (result) {
        console.log('PowerShell提取图标成功:', filePath);
      }
    }

    return result;
  } catch (e) {
    console.error('helper获取图标失败:', e.message);
    return null;
  }
});

async function resolveFileIcon(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isLnk = ext === '.lnk';
  const isUrl = ext === '.url';
  let result = null;
  let iconFile = filePath;

  if (isLnk) {
    const targetPath = resolveLnkTarget(filePath);
    if (targetPath) {
      iconFile = targetPath;
    }
  }

  if (isUrl) {
    const urlInfo = parseUrlFile(filePath);
    if (urlInfo.iconFile) {
      const p = cleanPath(urlInfo.iconFile);
      if (p && fs.existsSync(p)) {
        const e = path.extname(p).toLowerCase();
        if (e === '.ico') { result = readIcoToDataUrl(p); }
        else if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(e)) {
          try {
            const buf = fs.readFileSync(p);
            result = 'data:' + (e==='.jpg'?'image/jpeg':'image/'+e.slice(1)) + ';base64,' + buf.toString('base64');
          } catch (er) { console.error('url图标读取失败:', er.message); }
        } else {
          iconFile = p;
        }
      }
    }
    if (!result && urlInfo.url && urlInfo.url.startsWith('steam://')) {
      const si = getSteamGameIcon(urlInfo.url);
      if (si) {
        const se = path.extname(si).toLowerCase();
        if (se === '.ico') result = readIcoToDataUrl(si);
        else {
          try {
            const buf = fs.readFileSync(si);
            result = 'data:' + (se==='.jpg'?'image/jpeg':'image/'+se.slice(1)) + ';base64,' + buf.toString('base64');
          } catch (er) { console.error('Steam图标读取失败:', er.message); }
        }
      }
    }
  }

  if (!result) {
    result = await getFileIconViaPowerShell(iconFile);
    if (result) {
      console.log('PowerShell API提取图标成功:', filePath);
    }
  }

  if (!result) {
    try {
      const icon = await getFileIconWithTimeout(iconFile, 3000);
      if (icon) {
        result = iconToDataUrl(icon);
        console.log('Electron getFileIcon提取图标成功:', filePath);
      }
    } catch (e) {
      console.error('getFileIcon失败:', e.message);
    }
  }

  return result;
}

ipcMain.handle('get-file-icon', async (event, filePath, isDirectory) => {
  try {
    if (isDirectory) return null;

    const ext = path.extname(filePath).toLowerCase();
    const isLnk = ext === '.lnk';
    const isUrl = ext === '.url';
    
    const cacheKey = (isLnk || isUrl) ? filePath.toLowerCase() : (ext || 'file');
    
    if (iconCache.has(cacheKey)) {
      return iconCache.get(cacheKey);
    }

    const result = await resolveFileIcon(filePath);
    if (result) {
      iconCache.set(cacheKey, result);
      scheduleSaveIconCache();
    }
    return result;
  } catch (e) {
    console.error('获取文件图标失败:', e.message);
    return null;
  }
});

ipcMain.handle('move-window', (event, deltaX, deltaY) => {
  if (!floatWindow) return;
  const bounds = floatWindow.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  let newX = bounds.x + deltaX;
  let newY = bounds.y + deltaY;
  const minVisible = 60;
  newX = Math.max(0 - bounds.width + minVisible, Math.min(newX, workArea.width - minVisible));
  newY = Math.max(0 - bounds.height + minVisible, Math.min(newY, workArea.height - minVisible));
  floatWindow.setPosition(newX, newY);
});

function getSnapEdges(bounds, workArea) {
  const visibleSize = 100;
  const w = bounds.width;
  const h = bounds.height;
  const edges = [];

  if (bounds.x <= 0 - w + visibleSize + 10) edges.push('left');
  else if (bounds.x >= workArea.width - visibleSize - 10) edges.push('right');
  if (bounds.y <= 0 - h + visibleSize + 10) edges.push('top');
  else if (bounds.y >= workArea.height - visibleSize - 10) edges.push('bottom');
  return edges;
}

// 拖动结束时单次保存位置（避免 moved 事件频繁写配置导致 EPERM）
ipcMain.handle('save-window-position', () => {
  if (!floatWindow) return false;
  const bounds = floatWindow.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  
  const edgeThreshold = 60;
  const visibleSize = 100;
  const hideOffset = bounds.width - visibleSize;
  const hideOffsetY = bounds.height - visibleSize;
  let newX = bounds.x;
  let newY = bounds.y;
  
  // 左侧贴边
  if (bounds.x < edgeThreshold && bounds.x > 0 - bounds.width / 2) {
    newX = 0 - hideOffset;
  }
  // 右侧贴边
  if (bounds.x + bounds.width > workArea.width - edgeThreshold && bounds.x < workArea.width - bounds.width / 2) {
    newX = workArea.width - bounds.width + hideOffset;
  }
  // 顶部贴边
  if (bounds.y < edgeThreshold && bounds.y > 0 - bounds.height / 2) {
    newY = 0 - hideOffsetY;
  }
  // 底部贴边
  if (bounds.y + bounds.height > workArea.height - edgeThreshold && bounds.y < workArea.height - bounds.height / 2) {
    newY = workArea.height - bounds.height + hideOffsetY;
  }
  
  if (newX !== bounds.x || newY !== bounds.y) {
    floatWindow.setPosition(newX, newY);
  }
  
  const finalBounds = floatWindow.getBounds();
  const config = loadConfig();
  config.floatPosition = { x: finalBounds.x, y: finalBounds.y };
  
  // 保存贴边方向（数组，支持同时贴两个边）
  const edges = getSnapEdges(finalBounds, workArea);
  config.snapEdges = edges.length > 0 ? edges : null;
  
  saveConfig(config);
  
  // 通知渲染进程更新贴边样式
  floatWindow.webContents.send('snap-edge-changed', edges.length > 0 ? edges : null);
  
  return true;
});

let savedSnapEdges = null;

ipcMain.handle('unsnap-window', () => {
  if (!floatWindow) return;
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = floatWindow.getBounds();
  const config = loadConfig();
  savedSnapEdges = config.snapEdges || null;

  let newX = bounds.x;
  let newY = bounds.y;

  if (bounds.x < 0) newX = 10;
  else if (bounds.x + bounds.width > workArea.width) newX = workArea.width - bounds.width - 10;
  if (bounds.y < 0) newY = 10;
  else if (bounds.y + bounds.height > workArea.height) newY = workArea.height - bounds.height - 10;

  floatWindow.setPosition(newX, newY);
  floatWindow.webContents.send('snap-edge-changed', null);

  return savedSnapEdges;
});

ipcMain.handle('resnap-window', () => {
  if (!floatWindow || !savedSnapEdges) return;
  const bounds = floatWindow.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const visibleSize = 100;
  const w = bounds.width;
  const h = bounds.height;

  let newX = bounds.x;
  let newY = bounds.y;

  for (const edge of savedSnapEdges) {
    switch (edge) {
      case 'left':  newX = -(w - visibleSize); break;
      case 'right': newX = workArea.width - visibleSize; break;
      case 'top':   newY = -(h - visibleSize); break;
      case 'bottom': newY = workArea.height - visibleSize; break;
    }
  }

  floatWindow.setPosition(newX, newY);
  floatWindow.webContents.send('snap-edge-changed', savedSnapEdges);
});

ipcMain.handle('get-window-bounds', () => {
  if (!floatWindow) return null;
  return floatWindow.getBounds();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('toggle-always-on-top', () => {
  if (!floatWindow) return false;
  const newState = !alwaysOnTopEnabled;
  alwaysOnTopEnabled = newState;
  floatWindow.setAlwaysOnTop(newState, 'screen-saver');
  if (fileManagerWindow) {
    fileManagerWindow.setAlwaysOnTop(newState, 'screen-saver');
  }
  if (settingsWindow) {
    settingsWindow.setAlwaysOnTop(newState, 'screen-saver');
  }
  return newState;
});

ipcMain.handle('get-always-on-top', () => {
  return alwaysOnTopEnabled;
});

ipcMain.handle('focus-search', () => {
  if (fileManagerWindow) {
    fileManagerWindow.webContents.send('focus-search');
  }
  return true;
});

}
