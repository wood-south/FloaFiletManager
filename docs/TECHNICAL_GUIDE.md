# 技术文档 - 浮窗文件管理器 v1.0.0

本文档详细说明项目的技术实现、代码位置和关键配置。

---

## 目录

1. [项目架构](#1-项目架构)
2. [核心代码位置](#2-核心代码位置)
3. [存储路径和读取方式](#3-存储路径和读取方式)
4. [图标获取技术](#4-图标获取技术)
5. [IPC通信机制](#5-ipc通信机制)
6. [窗口管理](#6-窗口管理)
7. [文件操作](#7-文件操作)
8. [缓存机制](#8-缓存机制)
9. [关键技术点](#9-关键技术点)

---

## 1. 项目架构

### 目录结构

```
浮窗文件管理1.0.0/
├── main.js                    # 主进程入口
├── preload.js                 # 预加载脚本（IPC桥接）
├── package.json               # 项目配置
├── icon-cache.json            # 图标缓存文件
│
├── renderer/                  # 渲染进程
│   ├── float.html             # 浮窗页面
│   ├── file-manager.html      # 文件管理页面
│   ├── settings.html          # 设置页面
│   ├── icon-helper.html       # 图标辅助窗口
│   │
│   ├── styles/
│   │   ├── float.css          # 浮窗样式
│   │   ├── file-manager.css   # 文件管理样式
│   │   └── settings.css       # 设置样式
│   │
│   └── scripts/
│       ├── float.js           # 浮窗逻辑
│       ├── file-manager.js    # 文件管理逻辑
│       ├── settings.js        # 设置逻辑
│       └── icon-helper-preload.js
│
├── docs/                      # 文档目录
│   └── specs/
│
├── .userdata/                 # 开发环境数据目录
│   ├── config.json            # 配置文件
│   └── Cache/                 # 缓存目录
│
└── dist-new/                  # 打包输出目录
    └── win-unpacked/
        └── 浮窗文件管理器.exe
```

### 技术栈

| 层级 | 技术 |
|-----|------|
| 框架 | Electron 36.x |
| 运行时 | Node.js 22.x |
| UI | 原生 HTML/CSS/JavaScript |
| 图标提取 | PowerShell + Windows API |
| 缓存 | JSON文件 |

---

## 2. 核心代码位置

### 主进程 (main.js)

| 功能 | 代码位置 | 说明 |
|-----|---------|------|
| 应用启动 | L320-L328 | `app.whenReady()` 创建窗口 |
| 浮窗创建 | L107-L148 | `createFloatWindow()` |
| 文件管理窗口 | L150-L200 | `createFileManagerWindow()` |
| 设置窗口 | L202-L250 | `createSettingsWindow()` |
| 图标缓存加载 | L659-L680 | `loadIconCache()` |
| 图标获取 | L1291-L1315 | `ipcMain.handle('get-file-icon')` |
| 文件列表 | L537-L561 | `ipcMain.handle('list-files')` |
| 文件上传 | L407-L459 | `ipcMain.handle('upload-file')` |
| 配置保存 | L79-L105 | `saveConfig()` |

### 预加载脚本 (preload.js)

位置：`renderer/preload.js`

暴露给渲染进程的API：
```javascript
window.electronAPI = {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSavePath: (path) => ipcRenderer.invoke('set-save-path', path),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  getFileIcon: (filePath, isDirectory) => ipcRenderer.invoke('get-file-icon', filePath, isDirectory),
  // ... 更多API
}
```

### 渲染进程

| 文件 | 功能 |
|-----|------|
| `renderer/scripts/float.js` | 浮窗交互：拖动、单击/双击、菜单显示 |
| `renderer/scripts/file-manager.js` | 文件列表渲染、图标加载、搜索 |
| `renderer/scripts/settings.js` | 保存路径设置、历史路径管理 |

---

## 3. 存储路径和读取方式

### 配置文件路径

**代码位置**: `main.js` L48-L63

```javascript
// 开发环境：使用项目目录下的 .userdata
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(__dirname, '.userdata');
  app.setPath('userData', devDataDir);
}

// 配置文件路径
const userDataDir = app.getPath('userData');
const configPath = path.join(userDataDir, 'config.json');
```

### 路径规则

| 环境 | 配置路径 | 说明 |
|-----|---------|------|
| 开发环境 | `项目目录/.userdata/config.json` | 避免沙箱权限问题 |
| 打包后 | `%APPDATA%/floating-file-manager/config.json` | 系统标准位置 |

### 配置读取

**代码位置**: `main.js` L65-L77

```javascript
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
```

### 配置保存

**代码位置**: `main.js` L79-L105

```javascript
function saveConfig(config) {
  const data = JSON.stringify(config, null, 2);
  // 重试机制：避免文件被占用时写入失败
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(configPath, data);
      return true;
    } catch (e) {
      // 短暂等待后重试
    }
  }
  // 兜底：原子替换
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, configPath);
}
```

### 配置结构

```json
{
  "savePath": "D:\\FloatUploads",
  "floatPosition": { "x": 100, "y": 100 },
  "snapEdges": null,
  "pathHistory": [
    "D:\\FloatUploads",
    "E:\\Documents"
  ]
}
```

---

## 4. 图标获取技术

### 技术方案演变

| 版本 | 方案 | 问题 |
|-----|------|------|
| v1.0 | `app.getFileIcon()` | 禁用GPU时失效 |
| v1.1 | PowerShell `ExtractAssociatedIcon` | 部分图标不正确 |
| **v1.2** | **PowerShell + SHGetFileInfo API** | ✅ 完全解决 |

### 当前方案

**代码位置**: `main.js` L856-L954

使用 PowerShell 调用 Windows 原生 API：

```javascript
function getFileIconViaPowerShell(filePath) {
  // PowerShell 脚本：调用 SHGetFileInfo API
  const psScript = `
Add-Type -AssemblyName System.Drawing
$code = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class IconExtractor {
    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SHGetFileInfo(
        string pszPath, uint dwFileAttributes,
        ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);
    
    public static Icon GetFileIcon(string filePath) {
        SHFILEINFO shfi = new SHFILEINFO();
        const uint SHGFI_ICON = 0x100;
        const uint SHGFI_LARGEICON = 0x0;
        
        SHGetFileInfo(filePath, 0, ref shfi, 
            (uint)Marshal.SizeOf(shfi), 
            SHGFI_ICON | SHGFI_LARGEICON);
        
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

$icon = [IconExtractor]::GetFileIcon($filePath)
# 转换为PNG保存
`;
  
  // 异步执行，避免阻塞主进程
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, 
    { timeout: 8000 }, (err, stdout) => {
      // 读取生成的PNG文件，转为base64
    });
}
```

### 图标获取流程

**代码位置**: `main.js` L1223-L1288

```javascript
async function resolveFileIcon(filePath) {
  // 1. 解析快捷方式目标路径
  if (isLnk) {
    iconFile = resolveLnkTarget(filePath);
  }
  
  // 2. 处理 .url 文件
  if (isUrl) {
    // 直接读取 IconFile 指向的图标文件
    if (iconExt === '.ico') {
      return readIcoToDataUrl(iconPath);
    }
  }
  
  // 3. 优先使用 PowerShell + Windows API
  result = await getFileIconViaPowerShell(iconFile);
  
  // 4. 回退到 Electron API
  if (!result) {
    const icon = await app.getFileIcon(iconFile);
    result = iconToDataUrl(icon);
  }
  
  return result;
}
```

### 快捷方式解析

**代码位置**: `main.js` L743-L773

```javascript
function resolveLnkTarget(lnkPath) {
  // 方案1: Electron API
  try {
    const shortcut = shell.readShortcutLink(lnkPath);
    if (shortcut.target) return cleanPath(shortcut.target);
  } catch (e) {}
  
  // 方案2: PowerShell + WScript.Shell
  const cmd = `powershell -NoProfile -Command 
    "(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath}').TargetPath"`;
  const target = execSync(cmd, { timeout: 3000 }).trim();
  return cleanPath(target);
}
```

---

## 5. IPC通信机制

### 通道列表

| 通道 | 方向 | 位置 | 说明 |
|-----|------|------|------|
| `get-config` | 渲染→主 | L344 | 获取配置 |
| `set-save-path` | 渲染→主 | L348 | 设置保存路径 |
| `list-files` | 渲染→主 | L537 | 列出目录文件 |
| `search-files` | 渲染→主 | L563 | 搜索文件 |
| `get-file-icon` | 渲染→主 | L1291 | 获取文件图标 |
| `upload-file` | 渲染→主 | L407 | 上传文件 |
| `upload-folder` | 渲染→主 | L472 | 上传文件夹 |
| `delete-file` | 渲染→主 | L638 | 删除文件 |
| `open-file` | 渲染→主 | L602 | 打开文件 |
| `open-file-location` | 渲染→主 | L596 | 打开文件位置 |
| `move-window` | 渲染→主 | L1323 | 移动浮窗 |
| `save-window-position` | 渲染→主 | L1192 | 保存窗口位置 |
| `toggle-always-on-top` | 渲染→主 | L1297 | 切换置顶 |

### 通信示例

**渲染进程调用**:
```javascript
// renderer/scripts/file-manager.js
const result = await window.electronAPI.listFiles(dirPath);
```

**主进程处理**:
```javascript
// main.js
ipcMain.handle('list-files', async (event, dirPath) => {
  const files = fs.readdirSync(targetPath, { withFileTypes: true });
  return { success: true, files: result };
});
```

---

## 6. 窗口管理

### 浮窗配置

**代码位置**: `main.js` L107-L148

```javascript
floatWindow = new BrowserWindow({
  width: 160,
  height: 160,
  frame: false,           // 无边框
  transparent: true,      // 透明背景
  backgroundColor: '#00000000',
  alwaysOnTop: true,      // 始终置顶
  skipTaskbar: true,      // 不显示在任务栏
  hasShadow: false,       // 无阴影
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
});

// 设置置顶级别
floatWindow.setAlwaysOnTop(true, 'screen-saver');
floatWindow.setVisibleOnAllWorkspaces(true);
```

### 窗口拖动

**实现方式**: 纯 JavaScript（`-webkit-app-region` 在透明窗口不可靠）

**渲染进程** (`renderer/scripts/float.js`):
```javascript
let isDragging = false;
let startX, startY;

document.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.screenX;
  startY = e.screenY;
});

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const deltaX = e.screenX - startX;
    const deltaY = e.screenY - startY;
    window.electronAPI.moveWindow(deltaX, deltaY);
    startX = e.screenX;
    startY = e.screenY;
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    window.electronAPI.saveWindowPosition();
  }
});
```

**主进程** (`main.js` L1166-L1176):
```javascript
ipcMain.handle('move-window', (event, deltaX, deltaY) => {
  const bounds = floatWindow.getBounds();
  floatWindow.setPosition(bounds.x + deltaX, bounds.y + deltaY);
});
```

---

## 7. 文件操作

### 文件列表

**代码位置**: `main.js` L537-L561

```javascript
ipcMain.handle('list-files', async (event, dirPath) => {
  const targetPath = dirPath || config.savePath;
  const files = fs.readdirSync(targetPath, { withFileTypes: true });
  
  const result = files.map(file => ({
    name: file.name,
    isDirectory: file.isDirectory(),
    path: path.join(targetPath, file.name)
  }));
  
  return { success: true, files: result, currentPath: targetPath };
});
```

### 文件上传

**代码位置**: `main.js` L407-L459

```javascript
ipcMain.handle('upload-file', async (event, { sourcePath, fileName, overwrite }) => {
  const destPath = path.join(config.savePath, fileName);
  
  // 检查重名
  if (fs.existsSync(destPath) && !overwrite) {
    return { success: false, duplicate: true };
  }
  
  // 处理快捷方式（特殊复制）
  if (fileName.toLowerCase().endsWith('.lnk')) {
    const content = fs.readFileSync(sourcePath);
    fs.writeFileSync(destPath, content);
  } else {
    fs.copyFileSync(sourcePath, destPath);
  }
  
  return { success: true, destPath };
});
```

### 文件删除

**代码位置**: `main.js` L638-L651

```javascript
ipcMain.handle('delete-file', async (event, filePath) => {
  // 移到回收站，而不是永久删除
  shell.trashItem(filePath);
  return { success: true };
});
```

### 文件打开

**代码位置**: `main.js` L602-L636

```javascript
ipcMain.handle('open-file', async (event, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  
  // .url 文件：解析 URL 后用 shell.openExternal
  if (ext === '.url') {
    const urlInfo = parseUrlFile(filePath);
    await shell.openExternal(urlInfo.url);
    return { success: true };
  }
  
  // 其他文件：shell.openPath 自动处理 .lnk
  const result = await shell.openPath(filePath);
  return { success: !result };
});
```

---

## 8. 缓存机制

### 图标缓存

**代码位置**: `main.js` L654-L710

#### 内存缓存
```javascript
const iconCache = new Map();

// 使用
if (iconCache.has(cacheKey)) {
  return iconCache.get(cacheKey);
}
iconCache.set(cacheKey, dataUrl);
```

#### 磁盘缓存
```javascript
// 加载
function loadIconCache() {
  const data = JSON.parse(fs.readFileSync(iconCachePath, 'utf8'));
  for (const [key, val] of Object.entries(data)) {
    iconCache.set(key, val);
  }
}

// 保存（限制5MB）
function saveIconCache() {
  let totalSize = 0;
  for (const [key, val] of iconCache) {
    if (totalSize + key.length + val.length > 5 * 1024 * 1024) break;
    data[key] = val;
  }
  fs.writeFileSync(iconCachePath, JSON.stringify(data, null, 2));
}
```

### 缓存键设计

| 文件类型 | 缓存键 | 说明 |
|---------|--------|------|
| `.lnk` | 文件路径（小写） | 每个快捷方式独立图标 |
| `.url` | 文件路径（小写） | 每个URL独立图标 |
| 其他文件 | 扩展名 | 同类型文件共享图标 |

**代码位置**: `main.js` L1299

```javascript
const cacheKey = (isLnk || isUrl) 
  ? filePath.toLowerCase()  // 路径作为键
  : (ext || 'file');         // 扩展名作为键
```

---

## 9. 关键技术点

### 单实例限制

**代码位置**: `main.js` L10-L19

```javascript
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();  // 已有实例运行，退出
} else {
  app.on('second-instance', () => {
    // 激活已有实例
    if (floatWindow) {
      if (floatWindow.isMinimized()) floatWindow.restore();
      floatWindow.focus();
    }
  });
}
```

### GPU崩溃恢复

**代码位置**: `main.js` L21-L40

```javascript
let crashCount = 0;

app.on('gpu-process-crashed', () => {
  crashCount++;
  if (crashCount >= 2) {
    // 连续崩溃：重启并禁用GPU
    app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu'] });
    app.exit(0);
  }
});
```

### 异常捕获

**代码位置**: `main.js` L5-L8

```javascript
process.on('uncaughtException', (err) => {
  // 忽略已知的快捷方式解析错误
  if (err.message && err.message.includes('shortcut link')) return;
  if (err.message && err.message.includes('NOTREACHED')) return;
});
```

### 批量图标加载

**代码位置**: `renderer/scripts/file-manager.js` L64-L111

```javascript
function processIconQueue() {
  // 每批处理3个图标
  while (batch.length < 3 && iconLoadQueue.length > 0) {
    const item = iconLoadQueue.shift();
    batch.push(item);
  }
  
  // 添加加载指示器
  batch.forEach(item => item.iconEl.classList.add('loading'));
  
  // 并行请求
  Promise.all(promises).finally(() => {
    // 间隔50ms处理下一批
    setTimeout(processIconQueue, 50);
  });
}
```

---

## 附录：API速查表

### 文件系统API

| 操作 | Node.js API |
|-----|-------------|
| 读取目录 | `fs.readdirSync(path, { withFileTypes: true })` |
| 判断是否目录 | `fs.statSync(path).isDirectory()` |
| 复制文件 | `fs.copyFileSync(src, dest)` |
| 删除到回收站 | `shell.trashItem(path)` |
| 打开文件 | `shell.openPath(path)` |
| 打开URL | `shell.openExternal(url)` |

### 窗口API

| 操作 | Electron API |
|-----|-------------|
| 创建窗口 | `new BrowserWindow(options)` |
| 设置位置 | `window.setPosition(x, y)` |
| 获取位置 | `window.getPosition()` |
| 置顶 | `window.setAlwaysOnTop(true, 'screen-saver')` |
| 隐藏任务栏 | `skipTaskbar: true` |

---

*文档生成时间: 2026-07-14*