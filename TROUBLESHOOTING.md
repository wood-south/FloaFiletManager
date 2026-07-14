# 故障排除与问题解决文档

本文档记录了浮窗文件管理器开发过程中遇到的真实问题、根因分析和解决方案。

---

## 目录

1. [浮窗拖动失效](#1-浮窗拖动失效)
2. [悬停菜单自动缩回](#2-悬停菜单自动缩回)
3. [配置文件 EPERM 权限错误](#3-配置文件-eperm-权限错误)
4. [快捷方式图标不显示](#4-快捷方式图标不显示)
5. [Steam 游戏图标显示错误](#5-steam-游戏图标显示错误)
6. [应用启动卡顿](#6-应用启动卡顿)
7. [打包失败 - 网络问题](#7-打包失败---网络问题)
8. [文件管理窗口视图切换失效](#8-文件管理窗口视图切换失效)
9. [快捷方式无法启动](#9-快捷方式无法启动)
10. [图标缓存导致所有 .url 显示同一图标](#10-图标缓存导致所有-url-显示同一图标)

---

## 1. 浮窗拖动失效

### 问题现象
浮窗无法拖动，鼠标按下后移动无效。

### 尝试过的方案
1. 使用 `-webkit-app-region: drag` CSS 属性
2. 在整个浮窗 body 上设置 drag 区域

### 根因分析
在透明窗口（`transparent: true`）中，`-webkit-app-region: drag` 不可靠，Electron 官方也承认这是一个已知问题。透明窗口的拖动区域检测存在 bug。

### 最终解决方案
使用纯 JavaScript + IPC 实现拖动：

```javascript
// 渲染进程 (float.js)
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

// 主进程 (main.js)
ipcMain.handle('move-window', (event, deltaX, deltaY) => {
  const [x, y] = floatWindow.getPosition();
  floatWindow.setPosition(x + deltaX, y + deltaY);
});
```

### 经验总结
- 透明窗口中避免使用 `-webkit-app-region`
- 使用 JS 监听鼠标事件 + IPC 通信是可靠方案
- 拖动结束后才保存位置，避免频繁写入

---

## 2. 悬停菜单自动缩回

### 问题现象
鼠标悬停显示功能按钮后，移动到按钮上时菜单会缩回，无法点击。

### 尝试过的方案
1. 增加 hover 区域延迟
2. 监听 mouseleave 事件并延迟隐藏

### 根因分析
悬停逻辑本身复杂，鼠标快速移动容易触发误判。用户真实需求是"想显示菜单时点击"，而非"悬停自动显示"。

### 最终解决方案
彻底改变交互方式：
- **单击** → 显示/隐藏功能按钮环
- **双击** → 打开文件管理窗口
- **右键** → 显示退出按钮

```javascript
// 单击/双击区分
let clickTimer = null;
let lastClickTime = 0;

floatBall.addEventListener('click', (e) => {
  const now = Date.now();
  if (now - lastClickTime < 300) {
    // 双击
    clearTimeout(clickTimer);
    window.electronAPI.openFileManager();
  } else {
    // 可能是单击，等待确认
    clickTimer = setTimeout(() => {
      toggleMenu();
    }, 300);
  }
  lastClickTime = now;
});
```

### 经验总结
- 悬停交互在复杂场景中不可靠
- 明确的点击操作更符合用户预期
- 单击/双击需要时间判断，300ms 是合理阈值

---

## 3. 配置文件 EPERM 权限错误

### 问题现象
```
EPERM: operation not permitted, open '...\config.json'
```

### 尝试过的方案
1. 重试写入
2. 使用原子替换（临时文件 + rename）

### 根因分析
在窗口 `moved` 事件中频繁写入配置，拖动时可能每秒触发数十次，导致文件被锁定。

### 最终解决方案
```javascript
// 移除 moved 事件监听
// floatWindow.on('moved', saveWindowPosition); // 错误做法

// 只在拖动结束时保存
ipcMain.handle('save-window-position', () => {
  const config = loadConfig();
  config.windowX = floatWindow.getPosition()[0];
  config.windowY = floatWindow.getPosition()[1];
  saveConfig(config);
});

// saveConfig 增加重试和原子替换
function saveConfig(config) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return true;
    } catch (e) {
      // 重试
    }
  }
  // 兜底：原子替换
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath);
}
```

### 经验总结
- 避免在高频事件中执行文件 IO
- 使用原子替换避免文件损坏
- 文件写入需要重试机制

---

## 4. 快捷方式图标不显示

### 问题现象
`.lnk` 文件显示空白图标或默认链接图标。

### 尝试过的方案
1. 用 `app.getFileIcon(lnkPath)` 获取图标
2. 检查 dataURL 长度判断是否空白

### 根因分析
`app.getFileIcon` 对 `.lnk` 文件返回的是"链接类型"图标（小箭头），而非目标程序图标。需要解析快捷方式的目标路径。

### 最终解决方案
```javascript
// 解析 .lnk 文件
function resolveLnkTarget(lnkPath) {
  const { shell } = require('electron');
  const shortcut = shell.readShortcutLink(lnkPath);
  
  // 优先使用 IconLocation（可能带索引）
  if (shortcut.icon) {
    const iconPath = shortcut.icon.split(',')[0];
    if (fs.existsSync(iconPath)) return iconPath;
  }
  
  // 回退到目标路径
  if (shortcut.target && fs.existsSync(shortcut.target)) {
    return shortcut.target;
  }
  return null;
}

// 获取图标时对目标路径获取
const targetPath = resolveLnkTarget(filePath);
const icon = await app.getFileIcon(targetPath, { size: 'large' });
```

### 经验总结
- `app.getFileIcon` 对 `.lnk` 返回链接图标，需解析目标
- `shell.readShortcutLink` 可获取 `target` 和 `icon` 字段
- IconLocation 可能是 `"path,index"` 格式，需拆分处理

---

## 5. Steam 游戏图标显示错误

### 问题现象
`.url` 文件（Steam 游戏快捷方式）显示的是 `.ico` 文档图标或默认地球图标。

### 根因分析
1. `.url` 文件的 `IconFile` 可能指向 `steam.exe`，获取的是 Steam 图标
2. `app.getFileIcon` 对 `.ico` 文件返回的是"文件类型图标"（文档图标），而非图标内容本身

### 最终解决方案
```javascript
// .ico 文件直接读取内容
function readIcoToDataUrl(icoPath) {
  const buf = fs.readFileSync(icoPath);
  return 'data:image/x-icon;base64,' + buf.toString('base64');
}

// Steam 游戏图标查找
function getSteamGameIcon(steamUrl) {
  const match = steamUrl.match(/rungameid\/(\d+)/);
  if (!match) return null;
  const appId = match[1];
  const steamPath = findSteamInstallPath();
  return path.join(steamPath, 'steam', 'games', `${appId}.ico`);
}

// .url 文件处理
const urlInfo = parseUrlFile(filePath); // 解析 IconFile 字段
if (iconExt === '.ico') {
  return readIcoToDataUrl(iconFilePath); // 直接读取
}
```

### 经验总结
- `app.getFileIcon` 不适用于 `.ico` 文件，应直接读取
- Steam 游戏图标在 `Steam/steam/games/{appid}.ico`
- `.url` 文件是 INI 格式，需手动解析

---

## 6. 应用启动卡顿

### 问题现象
打开文件管理器时明显卡顿，滚动不流畅。

### 根因分析
使用 `execSync` 同步执行 PowerShell 提取 64x64 高清图标，阻塞了主进程。

### 最终解决方案
```javascript
// 改为异步执行
function extractLargeIconAsync(filePath, callback) {
  const { exec } = require('child_process');
  exec(`powershell ...`, (err) => {
    if (!err) {
      callback(dataUrl);
    }
  });
}

// 先返回基础图标，后台升级
const icon = await app.getFileIcon(targetPath, { size: 'large' });
const basicIcon = iconToDataUrl(icon);

// 后台异步提取高清图标
extractLargeIconAsync(targetPath, (large) => {
  iconCache.set(cacheKey, large);
  // 通知渲染进程刷新
  event.sender.send('icon-updated', { filePath, iconDataUrl: large });
});

return basicIcon; // 立即返回，不等待
```

### 经验总结
- 主进程中避免使用 `execSync` 等同步操作
- 异步处理 + IPC 通知是解决卡顿的标准方案
- 先显示低质量版本，后台升级到高质量版本

---

## 7. 打包失败 - 网络问题

### 问题现象
```
ETIMEDOUT downloading electron
cdn.npmmirror.com DNS resolution failed
```

### 根因分析
沙箱环境无法解析 GitHub 和 npmmirror.com 域名。

### 最终解决方案
在外部 PowerShell 中设置镜像后打包：
```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build
```

### 经验总结
- 沙箱环境有网络限制
- 使用镜像源加速下载
- 打包前先清理旧的 `dist` 目录

---

## 8. 文件管理窗口视图切换失效

### 问题现象
点击视图切换按钮无反应，文件列表不刷新。

### 根因分析
```javascript
const viewBtns = document.querySelectorAll('.view-btn'); // 这行代码被删除了
viewBtns.forEach(btn => { ... }); // 未定义变量报错
```

整个脚本因 `viewBtns is not defined` 错误停止执行。

### 最终解决方案
恢复变量声明：
```javascript
const viewBtns = document.querySelectorAll('.view-btn');
```

### 经验总结
- 变量未定义会导致整个脚本停止
- 使用 ESLint 检查未定义变量
- 关键变量应在文件顶部声明

---

## 9. 快捷方式无法启动

### 问题现象
双击 `.lnk` 文件无反应，或启动错误程序。

### 根因分析
使用 PowerShell `Start-Process` 启动，中文路径导致乱码。

### 最终解决方案
```javascript
// 直接用 shell.openPath，Electron 会自动解析 .lnk
const result = await shell.openPath(filePath);

// .url 文件解析 URL 后用 shell.openExternal
const urlInfo = parseUrlFile(filePath);
await shell.openExternal(urlInfo.url);
```

### 经验总结
- `shell.openPath` 对 `.lnk` 文件自动解析目标
- PowerShell 处理中文路径需要特殊编码
- `.url` 文件需手动解析 URL 内容

---

## 10. 图标缓存导致所有 .url 显示同一图标

### 问题现象
多个 Steam 游戏的 `.url` 文件显示同一个游戏的图标。

### 根因分析
缓存键使用扩展名 `'.url'`，所有 `.url` 文件共用缓存。第一个文件设置缓存后，后续文件直接返回缓存结果。

### 错误代码
```javascript
const cacheKey = ext; // 'url' - 所有 .url 共用
```

### 最终解决方案
使用完整文件路径作为缓存键：
```javascript
const cacheKey = (isLnk || isUrl) 
  ? filePath.toLowerCase()  // 每个文件独立缓存
  : ext;
```

### 经验总结
- 快捷方式文件（`.lnk`、`.url`）每个图标可能不同
- 缓存键应能区分不同的资源
- 扩展名只适合用作普通文件的缓存键

---

## 附录：开发环境限制

### 沙箱环境限制
| 限制 | 影响 | 解决方案 |
|-----|------|---------|
| 无法访问非项目目录 | 无法操作 F: 盘等 | 使用项目内 `.userdata` 目录 |
| 无法解析外网域名 | GitHub、npm 仓库无法访问 | 外部终端运行 |
| 进程锁文件创建失败 | 单实例锁失败 | 外部终端运行 |

### 推荐工作流
```powershell
# 外部 PowerShell
cd "项目路径"
npx electron .          # 测试
npm run build           # 打包
```

---

## 总结

### 问题分类
| 类别 | 问题数 | 关键教训 |
|-----|-------|---------|
| Electron API 限制 | 3 | 透明窗口、getFileIcon 需要特殊处理 |
| 文件 IO | 2 | 避免高频写入，使用原子替换 |
| 缓存设计 | 2 | 缓存键要能区分资源，持久化到磁盘 |
| 异步处理 | 1 | 主进程避免同步阻塞操作 |
| 路径编码 | 2 | 中文路径、引号、协议头需清理 |

### 最佳实践
1. **透明窗口**：用 JS 拖动替代 `-webkit-app-region`
2. **文件写入**：低频 + 重试 + 原子替换
3. **图标获取**：解析目标路径，`.ico` 直接读取
4. **性能优化**：异步处理 + 缓存 + 后台升级
5. **缓存设计**：路径作为键，持久化到磁盘