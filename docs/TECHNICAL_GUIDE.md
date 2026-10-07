# 技术文档 - 浮窗文件管理器 v1.1.0

本文档说明 v1.1.0 的技术实现、模块划分、IPC 契约与关键机制。

> **引用约定**：本项目在 1.0.0 → 1.1.0 期间把近 1500 行的单体 `main.js` 拆分为 `src/main/` 下的模块，**所有历史行号引用均已失效**。因此本文一律以「**文件路径 + 函数名 / ipcMain 通道名 / 事件名**」定位代码，不使用行号。跨节引用直接用节号（如「见 4.5 节」），不做锚点跳转。

---

## 目录

1. 架构与目录结构
2. 核心代码位置（按模块）
3. 存储路径和读取方式
4. 图标获取技术
5. IPC 通信机制
6. 窗口管理
7. 文件操作
8. 缓存机制
9. 关键技术点
- 附录 A：API 速查表
- 附录 B：相关文档

---

## 1. 架构与目录结构

### 1.1 进程模型

```
┌──────────────────────────────────────────────────────────────┐
│  主进程  main.js → src/main/index.js                          │
│                                                              │
│  启动 / 单实例锁 / 崩溃自愈 / 装配 IPC                          │
│  config.js   配置读写 · 迁移 · 原子替换                         │
│  windows.js  浮窗 · 文件管理 · Dock · 设置 四个窗口              │
│  ipc/*       配置 文件 图标 窗口 对话框 系统 六个功能域           │
│  services/*  图标提取（icon-extractor）· 图标缓存（icon-cache）   │
└───────────────────────────┬──────────────────────────────────┘
                            │ IPC（contextBridge / ipcRenderer.invoke）
        ┌───────────────┬───┴───────────┬───────────────┐
        ▼               ▼               ▼               ▼
┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐
│ 浮窗（桌宠）   ││ 文件管理窗口  ││ Dock 导航栏   ││ 设置窗口      │
│ float.html   ││file-manager  ││ dock.html    ││settings.html │
│ float.js     ││.html / .js   ││ dock.js      ││ settings.js  │
└──────────────┘└──────────────┘└──────────────┘└──────────────┘
```

四个窗口共用同一个 `preload.js`，通过 `contextBridge` 暴露 `window.electronAPI`（**85 个** `ipcRenderer.invoke` 方法 + 7 个 `onXxx` 事件订阅方法）。

### 1.2 目录结构

```
浮窗文件管理1.0.0/
├── main.js                       # 主进程入口，仅一行：require('./src/main/index.js')
├── preload.js                    # contextBridge 暴露 electronAPI（85 个 invoke 通道）
├── package.json                  # 版本 1.1.0、依赖与 electron-builder 配置
├── .eslintrc.json / .prettierrc / jsconfig.json   # 代码规范与编辑器配置
├── icon-cache.json               # 图标磁盘缓存（运行时生成，已 gitignore）
├── README.md / CHANGELOG.md / LICENSE
├── docs/
│   ├── PROJECT_GUIDE.md          # 项目指南（面向复刻/二次开发）
│   ├── TECHNICAL_GUIDE.md        # 本文档
│   └── PROBLEM_SOLUTIONS.md      # 问题记录与排查
│
├── src/main/                     # 主进程源码
│   ├── index.js                  # 启动流程、单实例锁、崩溃自愈、装配各 IPC 模块
│   ├── config.js                 # loadConfig / saveConfig / migrateConfig
│   ├── windows.js                # 四个窗口的创建与持久化状态
│   ├── ipc/
│   │   ├── config.js             # 分区 partitions 与路径 CRUD、首选路径
│   │   ├── files.js              # 文件列表/搜索/上传/移动/删除/原生拖拽
│   │   ├── icons.js              # get-file-icon、缓存键、icon-updated 广播
│   │   ├── window.js             # 移动/贴边/吸附/Dock 尺寸/点击穿透
│   │   ├── dialog.js             # 目录选择、打开文件、消息框
│   │   └── system.js             # 系统动作、音量、网络/WiFi、电源、Dock 导航项
│   └── services/
│       ├── icon-extractor.js     # 图标提取回退链与各解析器
│       └── icon-cache.js         # 内存 Map + 磁盘 JSON 缓存
│
├── renderer/                     # 渲染进程
│   ├── float.html                scripts/float.js         styles/float.css
│   ├── file-manager.html         scripts/file-manager.js  styles/file-manager.css
│   ├── dock.html                 scripts/dock.js          styles/dock.css
│   ├── settings.html             scripts/settings.js      styles/settings.css
│   ├── icon-helper.html          # 已废弃，仅剩说明性注释，可安全删除
│   ├── icon-helper-preload.js    # 已废弃，仅剩说明性注释，可安全删除
│   └── scripts/icon-helper.js    # 已废弃，不再被任何页面加载，可安全删除
│
├── .userdata/                    # 开发环境 userData（运行时生成，已 gitignore）
│   └── config.json
└── dist-new/                     # 打包输出（已 gitignore）
    └── win-unpacked/
        └── 浮窗文件管理器.exe
```

> `renderer/icon-helper.*` 三个文件是「图标辅助隐藏窗口」子系统的残留（详见 4.5 节）。它们不被任何窗口加载，保留空壳只是因为该工作区目录权限受限、删除操作被拒。

### 1.3 技术栈

| 层级 | 技术 |
|-----|------|
| 框架 | Electron 28（`package.json` 声明 `^28.0.0`，`node_modules` 实装 **28.3.3**） |
| 运行时 | Node.js **18 及以上**（Electron 28 内置 Node 18.x；`package.json` 未额外约束，README 写 Node ≥ 18） |
| UI | 原生 HTML / CSS / JavaScript（无前端框架） |
| 图标提取 | PowerShell + Windows Shell API（`SHGetFileInfo`），回退 Electron `app.getFileIcon` |
| 缓存 | 内存 `Map` + `icon-cache.json`（上限 5 MB） |
| 构建 | electron-builder 26（portable + NSIS） |
| 代码规范 | ESLint 8 + Prettier 3 |

### 1.4 1.0.0 → 1.1.0 的结构性变化

| 项 | 1.0.0 | 1.1.0 |
|---|-------|-------|
| 主进程 | 单体 `main.js`（近 1500 行） | `src/main/` 模块化，根 `main.js` 仅一行入口 |
| 窗口 | 浮窗 + 文件管理 + 设置 | 新增 **Dock 导航栏**，设置窗口独立为 440×560 |
| 浮窗形态 | 圆形悬浮球 | **桌宠**（SVG 猫，含贴边 / 吸附朝向旋转） |
| 路径记忆 | `pathHistory` 数组 | **`partitions[]` + `preferredPath`**（`pathHistory` 字段已不存在） |
| 图标提取 | 主链路 + 「图标辅助隐藏窗口」双实现 | 统一走 `get-file-icon` → `resolveFileIcon` 单链路，辅助窗口子系统已删除 |
| 图标刷新 | 整批清空缓存重取 | `icon-updated` **增量通知** |
| 死代码清理 | — | 移除从未被调用的主进程图标并发闸门（`iconPending` / `MAX_CONCURRENT` / `drainIconPending`）与三个未使用的提取函数 |
| IPC 契约 | preload 中存在无对应处理器的通道 | `preload.js` 与主进程一一对应（85 ↔ 85），无孤立通道 |
| 交互 | — | 点击穿透、贴边隐藏、吸附 Dock、分区侧边栏、原生拖出 |

---

## 2. 核心代码位置（按模块）

### 2.1 `src/main/index.js`（应用启动）

| 功能 | 函数 / 事件 |
|-----|------------|
| 未捕获异常噪音过滤 | `process.on('uncaughtException')`（忽略含 `shortcut link`、`NOTREACHED` 的错误） |
| 单实例锁 | `app.requestSingleInstanceLock()` + `app.on('second-instance')` |
| GPU 崩溃自愈 | `app.on('gpu-process-crashed')` |
| 渲染进程崩溃自愈 | `app.on('render-process-gone')` |
| 启动装配 | `app.whenReady().then(...)`：`loadConfig` → 建保存目录 → `loadIconCache` → `windows.loadPersistedState` → `createFloatWindow` → 按需 `showDockWindow` |
| 退出清理 | `app.on('window-all-closed')` / `app.on('will-quit')` → `saveIconCache()` + `restoreTaskbar()` |
| 恢复系统任务栏 | `restoreTaskbar()`（`will-quit` 时调用的 `FindWindow("Shell_TrayWnd")` + `ShowWindow(h, 5)`） |
| IPC 注册 | `ipcConfig.register` / `ipcFiles.register` / `ipcIcons.register` / `ipcWindow.register` / `ipcDialog.register` / `ipcSystem.register` |

> 注意：音量 dll **不在启动时编译**。`index.js` 的 `whenReady` 中留有注释说明——原先启动即调用 `csc.exe` 会触发杀毒软件对「运行时编译代码」的启发式拦截，导致启动卡顿/CPU 占满；现在改为首次使用音量接口时按需编译（见 `src/main/ipc/system.js` 的 `compileAudioDllAsync`）。

### 2.2 `src/main/config.js`（配置）

| 功能 | 函数 / 常量 |
|-----|------------|
| 开发态 userData 重定向 | 模块顶层：`isDev = !app.isPackaged` → `app.setPath('userData', <rootDir>/.userdata)` |
| 路径常量 | `rootDir`、`userDataDir`、`configPath` |
| 读取配置 | `loadConfig()`（含默认值兜底） |
| 写入配置 | `saveConfig(config)`（3 次重试 + 临时文件原子替换） |
| 结构迁移 | `migrateConfig(config)` |

### 2.3 `src/main/windows.js`（窗口）

| 功能 | 函数 |
|-----|------|
| 浮窗（桌宠，160×160） | `createFloatWindow()` |
| 文件管理窗口（900×600，跟随浮窗定位） | `createFileManagerWindow()` |
| Dock 窗口（初始 800×200，加载后自动适配） | `createDockWindow()` / `showDockWindow()` / `hideDockWindow()` / `toggleDockWindow()` |
| 设置窗口（440×560，屏幕居中） | `createSettingsWindow()` |
| 状态读取 | `getFloatWindow` / `getFileManagerWindow` / `getDockWindow` / `getSettingsWindow` / `getDockVisible` / `getAlwaysOnTopEnabled` / `getDockAlwaysOnTopEnabled` |
| 状态写入 | `setAlwaysOnTopEnabled` / `setDockAlwaysOnTopEnabled` / `savePersistedState` |
| 启动恢复 | `loadPersistedState()`（`floatAlwaysOnTop` / `dockAlwaysOnTop` / `dockVisible`） |
| Dock DWM 模糊 | `applyDwmBlur()`（`did-finish-load` 与 `show` 时调用 `setBackgroundMaterial('acrylic')`） |

### 2.4 `src/main/ipc/config.js`（分区与路径）

`register({ loadConfig, saveConfig })`，辅助函数 `genId()`。共 **13** 个通道：

`get-config`、`set-save-path`、`get-partitions`、`add-partition`、`update-partition`、`remove-partition`、`add-path-to-partition`、`update-partition-path`、`remove-partition-path`、`move-path-to-partition`、`get-quick-access`、`get-preferred-path`、`set-preferred-path`。

要点：
- `get-partitions` 返回前会**过滤掉磁盘上已不存在的路径**（`fs.existsSync`），因此界面不会展示失效路径。
- `remove-partition` 拒绝删除 `id === 'default'` 的默认分区。
- `set-preferred-path` 校验路径存在且必须是目录。
- `get-quick-access` 是分区路径的扁平视图（遍历所有分区的所有 `paths`），供旧调用方使用。

### 2.5 `src/main/ipc/files.js`（文件操作）

`register({ loadConfig, getFileManagerWindow })`，模块级变量 `fileManagerCurrentPath`，辅助函数 `notifyFilesChanged()`。共 **10** 个通道：

`sync-current-path`、`get-upload-dest`、`upload-file`、`is-directory`、`upload-folder`、`list-files`、`search-files`、`delete-file`、`move-file`、`start-drag`。

### 2.6 `src/main/ipc/icons.js`（图标）

`register({ iconCache, scheduleSaveIconCache, iconExtractor })`，辅助函数 `getIconCacheKey(filePath)`、`broadcastIconUpdated(cacheKey, dataUrl)`。共 **1** 个通道：`get-file-icon`。

流程：`isDirectory` → 直接返回 `null`；否则算缓存键 → 命中即返回 → 未命中调 `resolveFileIcon(filePath)` → 写缓存 + `scheduleSaveIconCache()` + `broadcastIconUpdated()`。

### 2.7 `src/main/ipc/window.js`（窗口行为）

`register({ loadConfig, saveConfig, screen, app, getFloatWindow, getFileManagerWindow, getAlwaysOnTopEnabled, setAlwaysOnTopEnabled, getDockAlwaysOnTopEnabled, setDockAlwaysOnTopEnabled })`。

模块级状态：`savedSnapEdges`、`savedFloatBounds`、`savedDockBounds`、`dockPanelOffset`、`floatSnapToDock`、`dockPosSaveTimer`。
辅助函数：`getSnapEdges(bounds, workArea)`、`getDockPanelScreenBounds()`、`scheduleDockPosSave(x, bottom)`。

共 **31** 个通道（按功能分组）：

| 分组 | 通道 |
|-----|------|
| 浮窗移动 / 贴边 | `move-window`、`save-window-position`、`unsnap-window`、`resnap-window`、`get-window-bounds` |
| 浮窗 / Dock 扩容 | `expand-float-window`、`restore-float-window`、`expand-dock-window`、`restore-dock-window`、`resize-dock-window` |
| 置顶 | `toggle-always-on-top`、`get-always-on-top`、`toggle-dock-always-on-top`、`get-dock-always-on-top` |
| Dock 显示 / 位置 | `get-dock-visible`、`get-dock-bounds`、`report-dock-panel-offset`、`move-dock`、`reset-dock-pos`、`center-dock`、`toggle-dock`、`show-dock`、`hide-dock` |
| 设置窗口 | `open-settings`、`close-settings`、`apply-dock-style`、`move-settings`、`open-config-folder` |
| 其他 | `focus-search`、`quit-app`、`set-ignore-mouse-events` |

### 2.8 `src/main/ipc/dialog.js`（对话框 / 打开）

`register({ createFileManagerWindow, getFileManagerWindow, iconExtractor })`（用 `iconExtractor.parseUrlFile` 解析 `.url`）。共 **7** 个通道：

`select-directory`、`open-file-manager`、`close-file-manager`、`open-this-computer`、`show-message-box`、`open-file-location`、`open-file`。

### 2.9 `src/main/ipc/system.js`（系统能力）

`register({ loadConfig, saveConfig, getDockWindow })`，辅助函数 `findCsc()`、`compileAudioDllAsync()`、`runAudioCommand(action, value)`、`notifyDockChanged()`、`runPowershell(script)`、`getDesktopIconsHiddenReal()`、`parseNetworkAdapters()`、`parseWifiInterfaces()`、`parseWifiNetworks()`、`getDefaultNavItems()`。

共 **23** 个通道：

| 分组 | 通道 |
|-----|------|
| 系统动作 | `system-action`（内置动作：`start` / `taskview` / `explorer` / `browser` / `settings` / `terminal` / `wifi` / `volume` / `battery` / `calendar` / `actioncenter` / `shutdown`；也接受自定义 URL、`mailto:`、文件/文件夹/快捷方式路径） |
| 电源 | `power-action`（`shutdown` / `restart` / `sleep` / `hibernate`） |
| 任务栏 / 桌面图标 | `toggle-taskbar`、`get-taskbar-hidden`、`toggle-desktop-icons`、`get-desktop-icons-hidden` |
| 电量 | `get-battery-status`（WMI `Win32_Battery`） |
| 音量 | `get-volume`、`set-volume`、`toggle-mute`、`set-mute` |
| 网络 / WiFi | `get-network-status`、`get-wifi-status`、`get-wifi-networks`、`connect-wifi`、`disconnect-wifi` |
| Dock 外观 | `get-dock-settings`、`save-dock-settings` |
| Dock 导航项 | `get-nav-items`、`save-nav-items`、`add-nav-item`、`update-nav-item`、`remove-nav-item` |

### 2.10 `src/main/services/icon-extractor.js`（图标提取）

当前文件共导出 **11 个**函数：

| 功能 | 函数 |
|-----|------|
| 主入口（回退链） | `resolveFileIcon(filePath)` |
| 快捷方式目标解析 | `resolveLnkTarget(lnkPath)` |
| `.url` 解析 | `parseUrlFile(urlPath)` |
| Steam 游戏图标 | `findSteamInstallPath()`、`getSteamGameIcon(steamUrl)` |
| PowerShell 提取（64×64 PNG） | `getFileIconViaPowerShell(filePath)` |
| 转换工具 | `iconToDataUrl(icon)`、`readIcoToDataUrl(icoPath)`、`cleanPath(rawPath)`、`parseIconPath(iconPath)` |
| Electron 兜底（带超时） | `getFileIconWithTimeout(iconFile, timeoutMs = 3000)` |

内部工具函数 `escapePsSingleQuote(str)` 不导出，供各处拼接 PowerShell 命令时转义单引号。

> 已删除：`getLnkIconLocation`、`extractFolderIconToDataUrl`、`extractLargeIconAsync`，以及从未被任何代码调用的并发闸门 `iconPending` / `MAX_CONCURRENT` / `drainIconPending` / `iconActive`。图标提取的压力控制现在只存在于渲染进程（见 8.5 节）。

### 2.11 `src/main/services/icon-cache.js`（图标缓存）

| 功能 | 函数 / 变量 |
|-----|------------|
| 内存缓存 | `iconCache`（`Map`） |
| 定位缓存文件 | `loadIconCache()` 首次调用时确定 `iconCachePath` |
| 读盘 | `loadIconCache()` |
| 写盘 | `saveIconCache()`（临时文件 + `renameSync`，上限 5 MB） |
| 延迟落盘 | `scheduleSaveIconCache()`（`setTimeout(..., 5000)`，重复调用会重置计时） |

### 2.12 `preload.js`（IPC 桥）

`contextBridge.exposeInMainWorld('electronAPI', {...})`，共 **85 个** `ipcRenderer.invoke` 包装 + 7 个事件订阅方法。命名约定：

- `动词+名词` 的 invoke 包装（如 `listFiles` → `list-files`）；
- 主进程推送使用 `onXxx(callback)` 形式：`onIconUpdated`、`onFilesChanged`、`onSnapEdgeChanged`、`onDockSnapChanged`、`onFocusSearch`、`onDockStyleChanged`、`onNavItemsChanged`。

85 个 invoke 通道与主进程 `ipcMain.handle` 注册的 85 个通道**一一对应，无孤立通道**（见 5.5 节）。

### 2.13 渲染进程

| 文件 | 职责 | 关键函数 |
|-----|------|---------|
| `renderer/scripts/float.js` | 桌宠浮窗：拖动、单击/双击/右键、贴边回弹、吸附朝向、拖放上传/删除、点击穿透、模态框 | `enableMouseCapture` / `enableClickThrough` / `showModal` / `showToast` / `toggleMenu` / `closeMenu` / `toggleQuit` / `closeQuit` / `hasSnapClass` / `initPinState` |
| `renderer/scripts/file-manager.js` | 文件管理：列表/网格视图、图标队列、搜索、上传、移动、删除、分区侧边栏、原生拖出 | `getIconCacheKeyByName` / `processIconQueue` / `scheduleIconLoad` / `renderFiles` / `loadFiles` / `getParentPath` / `goBack` / `renderPartitions` / `loadPartitions` / `updateSidebarActive` / `handleContextMenuAction` / `addPathToPartition` / `showModal` / `showInputModal` |
| `renderer/scripts/dock.js` | Dock：导航项渲染、滚动、音量/WiFi 浮层、电源菜单、右键菜单、拖拽添加、外观应用、窗口自适应 | `renderNavItems` / `applyIconSizes` / `applyDockStyle` / `autoFitDockWindow` / `reportPanelOffset` / `expandForMenu` / `restoreAfterMenu` / `positionMenuAtMouse` / `showPopup` / `hidePopup` / `loadVolume` / `loadWifiStatus` / `loadWifiNetworks` / `loadNetworkStatus` |
| `renderer/scripts/settings.js` | 设置：外观（模糊模式/圆角/图标大小与数量/主题色，实时预览）、常规（置顶、隐藏系统任务栏、Dock 位置）、图标管理、关于 | `buildDockStyle` / `updatePreview` / `pushStyleToDock` / `saveSettings` / `loadSettings` / `loadGeneralSettings` / `loadNavItems` / `renderIconList` / `closeWindow` |

---

## 3. 存储路径和读取方式

### 3.1 userData 重定向（`src/main/config.js`）

```javascript
// 模块顶层执行，早于任何 app.getPath('userData') 调用
const rootDir = path.join(__dirname, '..', '..');   // 项目根目录
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(rootDir, '.userdata');
  fs.mkdirSync(devDataDir, { recursive: true });
  app.setPath('userData', devDataDir);              // 开发态把 userData 搬到项目内
}
const configPath = path.join(app.getPath('userData'), 'config.json');
```

| 环境 | 配置路径 | 图标缓存路径 |
|-----|---------|-------------|
| 开发（`npx electron .`） | `<项目根>/.userdata/config.json` | `<项目根>/icon-cache.json` |
| 打包后 | `%APPDATA%\floating-file-manager\config.json` | `<exe 所在目录>\icon-cache.json` |

> 图标缓存的位置由 `src/main/services/icon-cache.js` 的 `loadIconCache()` 决定：`isDev ? rootDir : path.dirname(app.getPath('exe'))`。也就是说便携版把缓存写在 **exe 同级目录**，而不是 userData。两者都已加入 `.gitignore`。

### 3.2 读取：`loadConfig()`

```javascript
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      migrateConfig(config);      // 补齐 / 迁移字段，必要时回写
      return config;
    }
  } catch (e) {
    console.error('加载配置失败:', e);   // 解析失败不抛错，直接落到默认值
  }
  const desktopPath = app.getPath('desktop');
  const defaultSavePath = path.join(app.getPath('documents'), 'FloatUploads');
  return {
    savePath: defaultSavePath,
    preferredPath: defaultSavePath,
    floatPosition: { x: 100, y: 100 },
    partitions: [{
      id: 'default', name: '常用',
      paths: [
        { name: '我的文件', path: defaultSavePath },
        { name: '桌面', path: desktopPath },
        { name: '文档', path: app.getPath('documents') },
        { name: '下载', path: app.getPath('downloads') },
        { name: '图片', path: app.getPath('pictures') }
      ]
    }]
  };
}
```

### 3.3 写入：`saveConfig(config)`

```javascript
function saveConfig(config) {
  const data = JSON.stringify(config, null, 2);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(configPath, data); return true; }
    catch (e) {
      console.error(`保存配置失败(第${attempt + 1}次):`, e.message);
      if (attempt < 2) {              // 忙碌等待约 80ms 后重试
        const start = Date.now();
        while (Date.now() - start < 80) { /* busy wait */ }
      }
    }
  }
  // 兜底：写临时文件再原子替换
  try {
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, configPath);
    return true;
  } catch (e) { console.error('保存配置最终失败:', e); return false; }
}
```

设计要点：**低频写入 + 重试 + 原子替换**。所有高频场景都做了节流：浮窗位置只在 `mouseup` 后由 `save-window-position` 单次保存；Dock 位置由 `scheduleDockPosSave` 做 400 ms 防抖；Dock 外观由设置窗口显式保存。

### 3.4 配置字段（与 `src/main/config.js` 严格一致）

| 字段 | 类型 | 说明 |
|-----|------|------|
| `savePath` | string | 默认保存（上传）目录 |
| `preferredPath` | string | **首选路径**：文件管理窗口未打开时浮窗拖放上传的目标 |
| `floatPosition` | `{x, y}` | 浮窗最后位置 |
| `snapEdges` | `string[] \| null` | 贴边方向，可同时含两个边：`left`/`right`/`top`/`bottom` |
| `partitions` | `{id,name,paths:[{name,path}]}[]` | 分区侧边栏数据；`id === 'default'` 为受保护默认分区 |
| `dockVisible` | boolean | 上次退出时 Dock 是否可见（启动时据此恢复） |
| `floatAlwaysOnTop` | boolean | 浮窗/文件管理窗口置顶 |
| `dockAlwaysOnTop` | boolean | Dock 独立置顶 |
| `dockX` | number \| null | Dock 水平位置 |
| `dockBottom` | number \| null | Dock **底部**坐标（高度会随内容变化，底部才是稳定锚点） |
| `dockSettings` | object | Dock 外观（见下） |
| `hideSystemTaskbar` | boolean | 是否隐藏系统任务栏 |
| `navItems` | array | Dock 导航项（`{id,name,path,type,visible}`，`type` 为 `system` / `application`） |

`dockSettings` 默认值（`get-dock-settings` 兜底）：

```json
{
  "blurMode": "glass", "radius": 24, "iconSize": 52, "itemCount": 10,
  "onlyShortcuts": false, "bgColor": "#1e1e1e",
  "glassBlur": 20, "glassOpacity": 0.2,
  "gaussianBlur": 16,
  "acrylicBlur": 60, "acrylicOpacity": 0.08,
  "customColor": "#1e1e1e", "customOpacity": 0.5, "customBlur": 40
}
```

> **注意**：旧文档中的 `pathHistory` 字段**不存在**。「历史路径」这一能力在 1.1.0 已由 `partitions[]`（分组路径）+ `preferredPath`（默认可写目标）取代。

### 3.5 迁移：`migrateConfig(config)`

`loadConfig()` 每次读盘都会调用，逐项补齐并 `changed` 标记，最后统一 `saveConfig`：

- 补 `dockVisible` / `floatAlwaysOnTop` / `dockAlwaysOnTop`（默认 `true`）、`dockX` / `dockBottom`（默认 `null`）。
- **删除废弃的 `dockY`**（旧的顶部锚点，改用 `dockBottom`）。
- `partitions` 不存在或非数组 → 置空数组；为空数组 → 生成内置 `default`「常用」分区（我的文件/桌面/文档/下载/图片）。
- 旧字段 `quickAccess` → 合并进 `default` 分区的 `paths`（按 `path` 去重），随后删除 `quickAccess`。
- 每个分区补齐 `id`（`'part_' + Date.now() + '_' + 随机串`）与 `paths`。
- 补 `preferredPath`（回退 `savePath`）。

---

## 4. 图标获取技术

### 4.1 方案演变

| 阶段 | 方案 | 问题 |
|-----|------|------|
| 1.0.0 初版 | `app.getFileIcon()` | 禁用 GPU 时失效 |
| 1.0.0 中期 | PowerShell `ExtractAssociatedIcon` | 部分图标不正确（类型关联不完整） |
| **1.1.0 当前** | **PowerShell + `SHGetFileInfo`（附 `ExtractAssociatedIcon` 二次兜底）→ Electron `app.getFileIcon` 兜底** | 不依赖 GPU，快捷方式/.url/Steam 全覆盖 |

### 4.2 主入口：`resolveFileIcon(filePath)`（`src/main/services/icon-extractor.js`）

回退链**严格按以下顺序**：

```
1. .lnk  → resolveLnkTarget() 解析出 targetPath，作为后续 iconFile
2. .url  → parseUrlFile() 解析 INI：
     ├─ IconFile 是 .ico      → readIcoToDataUrl()（data:image/x-icon;base64）
     ├─ IconFile 是图片       → 直接 readFileSync 转 data:image/*;base64
     ├─ IconFile 其他         → 作为 iconFile 继续走第 3 步
     └─ 且 URL 为 steam://    → getSteamGameIcon() 找 Steam 库缓存图标
3. getFileIconViaPowerShell(iconFile)  ← PowerShell + Windows Shell API
4. getFileIconWithTimeout(iconFile, 3000) ← Electron app.getFileIcon（带 3s 超时）
5. 仍失败 → 返回 null
```

### 4.3 PowerShell 提取：`getFileIconViaPowerShell(filePath)`

关键实现细节（均为真实代码行为）：

- 用 `fs.mkdtempSync(path.join(os.tmpdir(), 'ffm-icon-ext-'))` 建临时目录，产出 `icon.png` 与 `extract-icon.ps1`；脚本以 **UTF-8 BOM**（`'\ufeff' + psScript`）写入，避免中文路径/中文输出乱码。
- 脚本内用 `Add-Type -TypeDefinition` 编译 C# 类 `IconExtractor`：
  - `SHGetFileInfo`（`shell32.dll`，`CharSet.Auto`）+ `DestroyIcon`（`user32.dll`）；
  - `SHFILEINFO` 结构体按 `LayoutKind.Sequential` 定义（`szDisplayName` 260、`szTypeName` 80）；
  - 标志位 `SHGFI_ICON(0x100) | SHGFI_LARGEICON(0x0)`，另定义 `SHGFI_USEFILEATTRIBUTES(0x10)`；
  - 若 `SHGetFileInfo` 拿不到 hIcon，脚本内再退 `[System.Drawing.Icon]::ExtractAssociatedIcon($filePath)`。
- 绘制：`Bitmap(64, 64)` + `Graphics.FromImage` + `HighQualityBicubic` / `AntiAlias`，`Clear(Transparent)` 后 `DrawIcon`，存为 PNG，输出 `SUCCESS` / `NO_ICON`。
- 执行：`exec('powershell -NoProfile -ExecutionPolicy Bypass -File "<ps1>"', { timeout: 8000 })`；成功后读 PNG 转 `data:image/png;base64,...`，**无论成败都清理临时目录**。
- 路径注入防护：所有插入 PowerShell 单引号字符串的路径都经 `escapePsSingleQuote()`（`'` → `''`）。

### 4.4 其他解析器

| 函数 | 说明 |
|-----|------|
| `resolveLnkTarget(lnkPath)` | 先 `shell.readShortcutLink(lnkPath)` 取 `target`（不存在则取 `icon` 并 `parseIconPath` 去掉 `,index`）；失败再走 PowerShell `(New-Object -ComObject WScript.Shell).CreateShortcut(...).TargetPath`（`execSync`，3 s 超时）。均需 `fs.existsSync` 通过才返回 |
| `parseUrlFile(urlPath)` | 按 INI 解析 `.url`，返回 `{ url, iconFile, iconIndex }` |
| `findSteamInstallPath()` | 依次探测 `%ProgramFiles(x86)%\Steam`、`%ProgramFiles%\Steam`、`C:\Program Files (x86)\Steam`、`C:\Program Files\Steam`、`D:\Steam`、`E:\Steam` |
| `getSteamGameIcon(steamUrl)` | 从 `steam://rungameid/<appId>` 取 appId，在 `steam/games/<id>.ico`、`appcache/librarycache/<id>_icon.jpg\|png`、`steam/games/<id>.jpg\|png` 中找第一个存在的 |
| `iconToDataUrl(icon)` | 用 `icon.toPNG()`（比 `toDataURL` 可靠）；尺寸 < 8×8 或 buffer < 50 字节视为无效 |
| `readIcoToDataUrl(icoPath)` | `.ico` 直接读为 `data:image/x-icon;base64`（浏览器原生支持显示）；< 10 字节判为损坏 |
| `getFileIconWithTimeout(iconFile, 3000)` | `app.getFileIcon(iconFile, { size: 'normal' })` 加 3 s 定时器兜底，超时 resolve `null` |
| `cleanPath(rawPath)` | 去首尾引号/空白、去 `file:///` 前缀、`decodeURIComponent` 解码 `%20` 等 |
| `parseIconPath(iconPath)` | 处理 `"路径,索引"` 格式的图标位置（如 `shell32.dll,167`），仅返回真实存在的路径 |

> 主进程**不做**图标提取的并发池：这些函数都是「一次调用拉起一次 PowerShell 进程」，压力由渲染进程的批量加载（每批 3 个、间隔 50 ms）与 Electron 兜底路径的 3 s 超时来约束（见 8.5 节）。

### 4.5 历史沿革：为什么不再有「图标辅助窗口」

1.0.0 曾存在**第二条**图标提取实现——一个隐藏的辅助 `BrowserWindow`（`renderer/icon-helper.html` + `renderer/icon-helper-preload.js` + `renderer/scripts/icon-helper.js`），配 `helper-get-file-icon` / `helper-native-get-file-icon` / `helper-return-file-icon` 三个通道。它在 1.1.0 被整体移除，原因：

1. 与主链路功能重复，且**没有任何缓存与增量通知**；
2. 其内联脚本被该页面自身 CSP（`script-src 'self'`）静默拦截，从来没真正跑通过；
3. 全仓库已无任何调用方。

现状（以真实文件为准）：这三个文件**都已废弃、不再被任何窗口加载，可以安全删除**，之所以保留空壳是因为该工作区目录权限受限、删除操作被拒：

| 文件 | 现状 |
|-----|------|
| `renderer/icon-helper.html` | 已废弃，仅剩说明性注释 |
| `renderer/icon-helper-preload.js` | 已废弃，仅剩说明性注释 |
| `renderer/scripts/icon-helper.js` | 已废弃，不再被任何页面加载（其原本转发的图标请求已统一由主进程处理） |

图标提取**统一走 `src/main/ipc/icons.js` 的 `get-file-icon`** 通道 → `icon-extractor.js` 的 `resolveFileIcon`，带缓存与 `icon-updated` 增量通知。

### 4.6 缓存键必须两进程一致

主进程 `getIconCacheKey(filePath)`（`src/main/ipc/icons.js`）与渲染进程 `getIconCacheKeyByName(name, filePath)`（`renderer/scripts/file-manager.js`）**必须严格一致**，否则 `icon-updated` 通知与本地缓存对不上号，磁盘上既有的 `icon-cache.json` 也会失配：

| 文件类型 | 缓存键 | 说明 |
|---------|--------|------|
| `.lnk` / `.url` | **完整文件路径小写** | 每个快捷方式独立图标 |
| 其他文件 | **带点的扩展名**（如 `.png`） | 同类型文件共享一个图标 |
| 无扩展名 | 字符串 `file` | 兜底 |

两处实现对 `.txt` 都返回 `'.txt'`（带点），对无扩展名都返回 `'file'`。

---

## 5. IPC 通信机制

### 5.1 三层结构

```
渲染进程（4 个页面共用）
  window.electronAPI.xxx(...)            ← preload.js 用 contextBridge 暴露
        │  ipcRenderer.invoke('<通道>', ...)
        ▼
主进程  ipcMain.handle('<通道>', handler)  ← src/main/ipc/*.js 在 index.js 中 register()
```

- 所有窗口统一使用 `contextIsolation: true` + `nodeIntegration: false`，preload 路径固定为 `<rootDir>/preload.js`。
- 请求-响应统一用 `ipcRenderer.invoke` / `ipcMain.handle`（Promise 化）。
- 主进程 → 渲染进程用 `webContents.send(事件名, payload)`，preload 暴露为 `onXxx(callback)`。
- 统一返回值约定：`{ success: true, ... }` / `{ success: false, error: '...' }`；重名场景额外返回 `{ duplicate: true, destPath }`。

### 5.2 请求-响应通道总表（85 个，按模块）

| 模块 | 数量 | 通道 |
|-----|-----|------|
| `src/main/ipc/config.js` | 13 | `get-config`、`set-save-path`、`get-partitions`、`add-partition`、`update-partition`、`remove-partition`、`add-path-to-partition`、`update-partition-path`、`remove-partition-path`、`move-path-to-partition`、`get-quick-access`、`get-preferred-path`、`set-preferred-path` |
| `src/main/ipc/files.js` | 10 | `sync-current-path`、`get-upload-dest`、`upload-file`、`is-directory`、`upload-folder`、`list-files`、`search-files`、`delete-file`、`move-file`、`start-drag` |
| `src/main/ipc/icons.js` | 1 | `get-file-icon` |
| `src/main/ipc/window.js` | 31 | `move-window`、`save-window-position`、`unsnap-window`、`resnap-window`、`get-window-bounds`、`get-dock-bounds`、`report-dock-panel-offset`、`expand-float-window`、`restore-float-window`、`quit-app`、`toggle-always-on-top`、`get-always-on-top`、`toggle-dock-always-on-top`、`get-dock-always-on-top`、`get-dock-visible`、`focus-search`、`toggle-dock`、`show-dock`、`hide-dock`、`move-dock`、`open-settings`、`close-settings`、`apply-dock-style`、`move-settings`、`reset-dock-pos`、`expand-dock-window`、`restore-dock-window`、`resize-dock-window`、`center-dock`、`open-config-folder`、`set-ignore-mouse-events` |
| `src/main/ipc/dialog.js` | 7 | `select-directory`、`open-file-manager`、`close-file-manager`、`open-this-computer`、`show-message-box`、`open-file-location`、`open-file` |
| `src/main/ipc/system.js` | 23 | `system-action`、`power-action`、`get-battery-status`、`get-dock-settings`、`save-dock-settings`、`toggle-taskbar`、`get-taskbar-hidden`、`toggle-desktop-icons`、`get-desktop-icons-hidden`、`get-volume`、`set-volume`、`toggle-mute`、`set-mute`、`get-network-status`、`get-wifi-status`、`get-wifi-networks`、`connect-wifi`、`disconnect-wifi`、`get-nav-items`、`save-nav-items`、`add-nav-item`、`update-nav-item`、`remove-nav-item` |
| **合计** | **85** | — |

### 5.3 主进程 → 渲染进程 事件

| 事件名 | 发送方 | 接收方 | 载荷 |
|-------|-------|-------|------|
| `icon-updated` | `ipc/icons.js` 的 `broadcastIconUpdated()`（**广播给所有窗口**） | 文件管理窗口（`onIconUpdated` 有监听，做增量替换）；Dock / 浮窗 / 设置窗口**未注册监听，收到即忽略**（设置窗口的图标列表用 `getFileIcon` 直取） | `{ filePath: <缓存键>, iconDataUrl }` |
| `files-changed` | `ipc/files.js` 的 `notifyFilesChanged()` | 文件管理（`onFilesChanged`） | `{ dir }` |
| `snap-edge-changed` | `ipc/window.js`（`save-window-position` / `unsnap-window` / `resnap-window`）、`windows.js`（`did-finish-load` 恢复） | 浮窗 | `string[] \| null` |
| `dock-snap-changed` | `ipc/window.js` 的 `save-window-position` | 浮窗 | `'top'\|'bottom'\|'left'\|'right'\|null` |
| `focus-search` | `ipc/window.js`（`focus-search` 通道） | 文件管理 | — |
| `nav-items-changed` | `ipc/system.js` 的 `notifyDockChanged()` | Dock | — |
| `dock-style-changed` | `ipc/window.js`（`apply-dock-style` 通道） | Dock | 样式对象 |

### 5.4 通信示例

**渲染进程调用**（`renderer/scripts/file-manager.js`，`loadFiles()`）：

```javascript
const result = await window.electronAPI.listFiles(dirPath);
if (result.success) { currentPath = result.currentPath; renderFiles(result.files); }
```

**主进程处理**（`src/main/ipc/files.js`，注册 `list-files`）：

```javascript
ipcMain.handle('list-files', async (event, dirPath) => {
  const config = loadConfig();
  const targetPath = dirPath || config.savePath;
  const files = fs.readdirSync(targetPath, { withFileTypes: true });
  return { success: true, files: result, currentPath: targetPath };
});
```

**preload 桥接**（`preload.js`）：

```javascript
listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
onIconUpdated: (callback) => { ipcRenderer.on('icon-updated', (event, data) => callback(data)); },
```

### 5.5 契约一致性（85 ↔ 85）

`preload.js` 暴露的 85 个 invoke 通道与主进程通过 `ipcMain.handle` 注册的 85 个通道**完全一一对应**，不存在孤立通道：

| 模块 | 通道数 |
|-----|-------|
| `ipc/config.js` | 13 |
| `ipc/files.js` | 10 |
| `ipc/icons.js` | 1 |
| `ipc/window.js` | 31 |
| `ipc/dialog.js` | 7 |
| `ipc/system.js` | 23 |
| **合计** | **85** |

历史遗留的 `addQuickAccess` / `updateQuickAccess` / `removeQuickAccess`（原对应 `add-quick-access` / `update-quick-access` / `remove-quick-access`）已从 `preload.js` 中删除——主进程从未注册过这三个通道，保留它们只会让调用方静默 reject。路径管理请统一使用分区 API：`addPathToPartition` / `updatePartitionPath` / `removePartitionPath` / `movePathToPartition`（`getQuickAccess` 仍保留，对应 `get-quick-access`，是分区路径的扁平视图）。

> 维护提醒：新增或删除 IPC 时，务必同时改 `src/main/ipc/*.js`、`src/main/index.js` 的 register 装配与 `preload.js`，保持 85↔85 的对称关系。

---

## 6. 窗口管理

### 6.1 四个窗口的参数（`src/main/windows.js`）

| 窗口 | 尺寸 | 关键选项 |
|-----|------|---------|
| 浮窗 | 160×160 | `frame:false`、`transparent:true`、`backgroundColor:'#00000000'`、`alwaysOnTop:true`、`resizable:false`、`skipTaskbar:true`、`hasShadow:false` |
| 文件管理 | 900×600 | 同上，但 `resizable:true`、`minimizable:false`、`maximizable:false` |
| Dock | 800×200（加载后按内容自适应） | 同上 + `focusable:true`，加载后 `setBackgroundMaterial('acrylic')` |
| 设置 | 440×560 | 屏幕居中，`resizable:false` |

共同点：`setAlwaysOnTop(true, 'screen-saver')`；浮窗与 Dock 额外 `setVisibleOnAllWorkspaces(true)`；四窗口共用 `preload.js`，`contextIsolation: true` / `nodeIntegration: false`。

**浮窗位置恢复**：从 `config.floatPosition` 读取，并用 `minVisible = 45` 做边界保护（保证至少有 45px 可见，防止窗口被拖到屏幕外找不回来）。
**文件管理窗口定位**：默认贴在浮窗右侧 +10px，右侧空间不足则翻到左侧，再对工作区做边界钳制。
**Dock 定位**：读取 `dockX` + `dockBottom`，`dockY = dockBottom - dockHeight`；若保存的位置越界（横向完全出屏或纵向超出 workArea + 60）则回退到底部居中。

### 6.2 窗口拖动：为什么不用 `-webkit-app-region`

透明窗口（`transparent: true`）下 `-webkit-app-region: drag` 的命中判定不可靠，实测拖动失效。因此改为**纯 JavaScript 监听鼠标事件 + IPC 移动窗口**：

**渲染进程**（`renderer/scripts/float.js`）：

```javascript
petBody.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true; hasMoved = false;
  mouseStartX = e.screenX; mouseStartY = e.screenY;
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const deltaX = e.screenX - mouseStartX, deltaY = e.screenY - mouseStartY;
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {   // 3px 阈值区分点击与拖动
    hasMoved = true; mouseStartX = e.screenX; mouseStartY = e.screenY;
    window.electronAPI.moveWindow(deltaX, deltaY);
  }
});
document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  if (hasMoved) { wasSnapped = false; window.electronAPI.saveWindowPosition(); }
  // 未移动 → 单击/双击判定（250ms 定时器区分）
});
```

Dock 的拖动同理（`renderer/scripts/dock.js` 的 `dockPanel` `mousedown` → `window.electronAPI.moveDock(dx, dy)`），并排除落在 `.dock-item` / `.dock-start` / `.dock-tray-item` 上的按下。

**主进程**（`src/main/ipc/window.js`，通道 `move-window`）：按增量移动，并用 `minVisible = 60` 钳制在工作区内。

### 6.3 贴边隐藏

- 判定：`getSnapEdges(bounds, workArea)`，可见尺寸 `visibleSize = 100`，`x <= -w + 100 + 10` 记 `left`，右侧对称；`y` 方向同理记 `top` / `bottom`（可同时两个方向）。
- 保存：`save-window-position` 中 `edgeThreshold = 20`，靠近边缘则把窗口推出去，只留 `visibleSize` 可见（`newX = 0 - (width - 100)` 等），随后写入 `config.snapEdges` 并 `send('snap-edge-changed', edges)`。
- 弹出/收回：渲染进程 `mouseenter` 时若带 `snap-*` class 就调 `unsnapWindow()`（`ipc/window.js` 通道 `unsnap-window`：把窗口移回屏内 10px 并清除样式），`mouseleave` 且本次没有拖动/未打开菜单时调 `resnapWindow()`（通道 `resnap-window`：按 `savedSnapEdges` 重新贴回）。两处都用 `snapLock` + 200ms 时间锁防止来回抖动。
- 启动恢复：`createFloatWindow()` 在 `did-finish-load` 时把 `config.snapEdges` 推给浮窗，恢复贴边外观。

### 6.4 浮窗吸附到 Dock

Dock 是「透明大窗口」，其窗口边界 ≠ 可见面板边界，因此：

1. Dock 渲染进程在 `autoFitDockWindow()` 末尾调 `reportPanelOffset()`，用 `getBoundingClientRect()` 上报 `dockPanel` 相对窗口左上角的偏移 → 通道 `report-dock-panel-offset` → 主进程记入 `dockPanelOffset`。
2. 主进程 `getDockPanelScreenBounds()` 把窗口边界 + 偏移换算成面板的真实屏幕边界（未上报时回退为窗口边界）。
3. `save-window-position` 中，**仅当未触发屏幕边缘贴边时**才尝试吸附：`snapDist = 50` 为触发阈值，四方向各有一个视觉间隙补偿 `snapInsetTop/Bottom/Left/Right = 52`（浮窗窗口 160 与宠物视觉 90 的差值一半），命中后记录 `floatSnapToDock = { side, offsetX, offsetY }` 并通过 `dock-snap-changed` 让宠物旋转朝向 Dock 边框。
4. `move-dock` 时若 `floatSnapToDock` 存在，浮窗按 `actualDx/actualDy` 一起移动，保持吸附关系。

### 6.5 点击穿透（`set-ignore-mouse-events`）

- 通道 `set-ignore-mouse-events` 用 `BrowserWindow.fromWebContents(event.sender)` 取**发起窗口**，即浮窗和 Dock 各自控制自己。
- 默认穿透：渲染进程初始化时 `setIgnoreMouseEvents(true, { forward: true })`，`forward: true` 保证窗口仍能收到鼠标移动事件，从而能判断「进入内容区」。
- 进入可见内容区 → `setIgnoreMouseEvents(false)` 捕获事件；离开 → 恢复穿透。
- 抑制恢复穿透的条件（各页面独立维护）：浮窗的 `menuOpen` / `quitOpen` / `modalActive` / `isDragging`；Dock 的 `openContextMenus > 0` / `activePopup` / `dockDragging`。

### 6.6 窗口扩容（容纳模态框与浮层）

- **浮窗**：默认仅 160×160，放不下模态框。`showModal()` 先 `expandFloatWindow(420, 320)`（通道 `expand-float-window`：以浮窗中心为中心扩展到指定尺寸，`setResizable(true)` → `setBounds` → `setResizable(false)`，并用 `savedFloatBounds` 保存原边界，重复调用不覆盖），关闭后 `restoreFloatWindow()` 还原。
- **Dock**：音量/WiFi 浮层与右键菜单需要更高的窗口。`expandForMenu()` 调 `resizeDockWindow(panelWidth, 380)`；`resize-dock-window` 保持「中心 X + 底部 Y」不变并按 workArea 钳制；`expand-dock-window` / `restore-dock-window` 用 `savedDockBounds` 做「保持底部不变向上扩展」。Dock 收起后由 `restoreAfterMenu()` → `autoFitDockWindow()` 重新按内容自适应。
- **右键菜单坐标**：窗口扩容后 client 坐标失效，因此 `contextmenu` 记录的是 `e.screenX/screenY`，再用 `get-dock-bounds` 换算成 client 坐标（`positionMenuAtMouse()`）。

### 6.7 Dock 位置保存与 DWM 模糊

- `scheduleDockPosSave(x, bottom)` 400 ms 防抖后写 `config.dockX` / `config.dockBottom`；`move-dock`、`resize-dock-window`、`center-dock`、`reset-dock-pos` 都会调用它。
- 模糊：CSS `backdrop-filter` 在透明窗口中无法模糊桌面，必须用 OS 级 `setBackgroundMaterial('acrylic')`（`windows.js` 的 `applyDwmBlur()`，Win10+ 亚克力）。外观参数（玻璃/高斯/亚克力/自定义）通过 CSS 变量由 Dock 渲染进程应用（`applyDockStyle`）。

---

## 7. 文件操作

### 7.1 `list-files`（列出目录）

```javascript
ipcMain.handle('list-files', async (event, dirPath) => {
  const config = loadConfig();
  const targetPath = dirPath || config.savePath;
  const files = fs.readdirSync(targetPath, { withFileTypes: true });
  // 逐项 statSync 取 size / mtime；单个文件失败仅 warn，不影响整体
  result.push({ name, isDirectory: file.isDirectory(), targetIsDirectory: false, path: fullPath, size, mtime });
  return { success: true, files: result, currentPath: targetPath };
});
```

`targetIsDirectory` 目前固定为 `false`（渲染进程的 `.lnk` 文件夹快捷方式样式留有该分支，但主进程未做解析）。失败返回 `{ success:false, error }`。

### 7.2 `search-files`（递归搜索）

- 搜索根**固定为 `config.savePath`**（不跟随文件管理器当前路径），递归 `readdirSync` 并对子目录继续下钻。
- 匹配方式为文件名 `includes(keyword.toLowerCase())`；单个子目录出错只 `console.error` 后继续。
- 结果项的 `size` 固定 0、`mtime` 固定 `null`（不做 stat，保证搜索速度）。
- 渲染侧有 300 ms 输入防抖（`searchInput` 的 `input` 监听 → `doSearch()`）。

### 7.3 `upload-file`（上传文件到目标目录）

```javascript
ipcMain.handle('upload-file', async (event, { sourcePath, fileName, overwrite, destDir }) => {
  const config = loadConfig();
  const savePath = destDir || config.savePath;
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });
  if (!fs.existsSync(sourcePath)) return { success: false, error: '源文件不存在: ' + sourcePath };
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) return { success: false, error: '请使用上传文件夹功能上传文件夹' };
  const destPath = path.join(savePath, fileName);
  if (fs.existsSync(destPath) && !overwrite) return { success: false, duplicate: true, destPath };
  // .lnk 等特殊文件用 Buffer 复制，避免 EPERM
  if (fileName.toLowerCase().endsWith('.lnk')) {
    fs.writeFileSync(destPath, fs.readFileSync(sourcePath));
  } else {
    fs.copyFileSync(sourcePath, destPath);
  }
  notifyFilesChanged(getFileManagerWindow, savePath);   // 通知文件管理窗口刷新
  return { success: true, destPath };
});
```

### 7.4 `upload-folder`（递归复制文件夹）

- 目标目录不存在则创建；源不存在报错；目标同名文件夹已存在 → `{ success:false, duplicate:true, destPath }`（覆盖由前端先 `delete-file` 再重传）。
- 内部 `copyFolderRecursive(src, dest)` 递归复制，其中 `.lnk` 同样用 Buffer 读写避免 EPERM。
- 完成后 `notifyFilesChanged`。

### 7.5 `move-file`（移动）

```javascript
fs.renameSync(sourcePath, destPath);   // 同一卷内为原子操作
notifyFilesChanged(getFileManagerWindow, path.dirname(sourcePath));
notifyFilesChanged(getFileManagerWindow, destDir);
```

返回 `{ success:false, duplicate:true, destPath }`（已存在）、`'源路径和目标路径相同'`、`'源文件不存在'`。**注意**：`renameSync` 不支持跨盘移动（会抛 `EXDEV`，被 catch 后以 error 返回）。

### 7.6 `delete-file`（删除到回收站）

```javascript
await shell.trashItem(filePath);        // 不永久删除
await new Promise(resolve => setTimeout(resolve, 200));   // 等回收站操作落盘
notifyFilesChanged(getFileManagerWindow, path.dirname(filePath));
return { success: true };
```

### 7.7 `open-file` / `open-file-location` / `open-this-computer`

- `open-file`（`src/main/ipc/dialog.js`）：`.url` 先用 `parseUrlFile` 取 URL 再 `shell.openExternal`；其余（含 `.lnk`）交给 `shell.openPath`（Windows 自动解析快捷方式）；`shell.openPath` 返回非空字符串即视为失败。
- `open-file-location`：`shell.showItemInFolder(filePath)`。
- `open-this-computer`：`shell.openPath('::{20D04FE0-3AEA-1069-A2D8-08002B30309D}')`（「此电脑」CLSID）。
- `select-directory`：`dialog.showOpenDialog({ properties: ['openDirectory'] })`，取消返回 `null`。

### 7.8 原生拖出：`start-drag`

```javascript
ipcMain.handle('start-drag', async (event, { filePath, iconDataUrl }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const icon = iconDataUrl ? nativeImage.createFromDataURL(iconDataUrl) : undefined;
  await win.webContents.startDrag({ file: filePath, icon: icon || nativeImage.createEmpty() });
});
```

渲染侧（`renderer/scripts/file-manager.js`）在文件项上监听 `mousedown` + `mousemove`，位移超过 5px 才触发 `startDrag(file.path, iconDataUrl)`，避免与单击选中冲突。

### 7.9 上传目标判定

| 通道 | 逻辑 |
|-----|------|
| `sync-current-path` | 文件管理器每次 `loadFiles()` 成功后上报当前路径（`fileManagerCurrentPath`） |
| `get-upload-dest` | 文件管理窗口存在且有 `fileManagerCurrentPath` → 用它；否则用 `config.preferredPath \|\| config.savePath` |
| `is-directory` | `fs.statSync(path).isDirectory()`，异常返回 `false` |

浮窗拖放上传即用 `get-upload-dest`：文件管理器开着就传到它当前浏览的目录，否则传到「首选路径」。分区侧边栏右键「设为首选路径」调 `set-preferred-path`。

### 7.10 界面刷新链路

文件操作完成后主进程 `send('files-changed', { dir })` → 文件管理窗口比较规范化后的路径，若与当前路径一致就清空 `iconDataUrlCache` 并重新 `loadFiles()`。上传/删除/移动后渲染侧也会主动 `loadFiles(currentPath, false)` 兜底。

---

## 8. 缓存机制

### 8.1 两层结构（`src/main/services/icon-cache.js`）

| 层 | 载体 | 生命周期 |
|---|------|---------|
| 内存 | `iconCache`（`Map`） | 进程内，命中直接返回 data URL |
| 磁盘 | `icon-cache.json` | 启动时 `loadIconCache()` 载入；写盘由 `scheduleSaveIconCache()` 延迟 5 s 触发，`window-all-closed` / `will-quit` 再强制 `saveIconCache()` |

### 8.2 读盘与校验

```javascript
function loadIconCache() {
  if (!iconCachePath) {
    const cacheDir = isDev ? rootDir : path.dirname(app.getPath('exe'));
    iconCachePath = path.join(cacheDir, 'icon-cache.json');
  }
  try {
    if (fs.existsSync(iconCachePath)) {
      const data = JSON.parse(fs.readFileSync(iconCachePath, 'utf8'));
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'string' && val.startsWith('data:image/')) {
          iconCache.set(key, val); loadedCount++;
        } else { filteredCount++; }      // 无效项直接丢弃
      }
    }
  } catch (e) {
    console.error('加载图标缓存失败:', e.message);
    iconCachePath = null;                // 解析失败 → 本次运行禁用缓存写盘
  }
}
```

要点：**逐条校验前缀 `data:image/`**，脏数据/半截数据不会污染内存缓存；JSON 整体损坏时不会崩溃，但会把 `iconCachePath` 置空，等于本次运行不再写盘（下次启动重新尝试）。

### 8.3 写盘：容量上限与原子替换

```javascript
function saveIconCache() {
  if (!iconCachePath) return;
  const data = {};
  let totalSize = 0;
  for (const [key, val] of iconCache) {
    const entrySize = key.length + val.length;         // 以字符串长度近似字节数
    if (totalSize + entrySize > 5 * 1024 * 1024) break; // 上限 5 MB
    data[key] = val; totalSize += entrySize;
  }
  const tmp = iconCachePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, iconCachePath);                   // 原子替换，避免写坏
}

function scheduleSaveIconCache() {
  if (iconCacheSaveTimeout) clearTimeout(iconCacheSaveTimeout);
  iconCacheSaveTimeout = setTimeout(saveIconCache, 5000);   // 延迟 5 s 合并写入
}
```

超过 5 MB 时按 `Map` 迭代顺序**截断**（先写入的先保留），因此不再新增，也不会让文件无限膨胀。

### 8.4 缓存键与增量通知

- 缓存键规则见 4.6 节。
- `get-file-icon` 首次提取成功后：写内存缓存 → `scheduleSaveIconCache()` → `broadcastIconUpdated(cacheKey, result)` → 所有窗口收到 `icon-updated`（仅文件管理窗口有监听，见 5.3 节）。
- 渲染侧（`renderer/scripts/file-manager.js` 的 `onIconUpdated`）只替换命中的图标元素，**不再整批清空缓存重取**；`iconDataUrlCache` 同步写入该键。
- Dock 与设置窗口各自维护自己的图标缓存（Dock 的 `iconCache` 对象、设置窗口的 `getFileIcon` 直取），并都在列表刷新时清空重取。

### 8.5 渲染侧图标批量加载（`renderer/scripts/file-manager.js`）

**这是项目唯一的图标并发控制点**：

```javascript
function processIconQueue() {
  if (iconLoading || iconLoadQueue.length === 0) return;
  iconLoading = true;
  const seen = new Set(); const batch = [];
  while (batch.length < 3 && iconLoadQueue.length > 0) {   // 每批 3 个
    const item = iconLoadQueue.shift();
    if (seen.has(item.iconKey)) continue;                  // 同批去重（同扩展名只取一次）
    if (iconDataUrlCache.has(item.iconKey)) { /* 直接套用缓存 */ continue; }
    seen.add(item.iconKey); batch.push(item);
  }
  batch.forEach(item => item.iconEl.classList.add('loading'));   // 加载态动画
  Promise.all(batch.map(item =>
    window.electronAPI.getFileIcon(item.filePath, false).then(dataUrl => { /* 写入 img */ })
  )).finally(() => { iconLoading = false; if (iconLoadQueue.length) setTimeout(processIconQueue, 50); });
}
```

`renderFiles()` 只把**非目录**项入队（目录用内置 SVG 图标）；每个 item 都检查 `isConnected` 再写入，避免翻目录后旧元素被误改。

---

## 9. 关键技术点

### 9.1 单实例运行

```javascript
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const floatWindow = windows.getFloatWindow();
    if (floatWindow) { if (floatWindow.isMinimized()) floatWindow.restore(); floatWindow.focus(); }
  });
  // ... 所有 require 与 IPC 注册都在这个分支内
}
```

### 9.2 GPU / 渲染进程崩溃自愈

```javascript
let crashCount = 0;
app.on('gpu-process-crashed', () => {
  crashCount++;
  if (crashCount >= 2) {                 // 连续两次才降级，避免偶发崩溃就重启
    app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu'] });
    app.exit(0);
  }
});
app.on('render-process-gone', (event, webContents, details) => {
  if (details.reason === 'crashed') { crashCount++; /* 同上阈值 → 带 --disable-gpu 重启 */ }
});
```

因为可能以 `--disable-gpu` 运行，图标提取主链路**刻意不依赖 Electron 渲染**（走 PowerShell），见 4.2 节。

### 9.3 未捕获异常噪音过滤

```javascript
process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('shortcut link')) return;   // Electron 解析坏快捷方式
  if (err.message && err.message.includes('NOTREACHED')) return;      // Electron 内部日志噪音
  console.error('未捕获异常:', err);
});
```

### 9.4 系统任务栏显隐

- 隐藏/显示：`toggle-taskbar` 用 `Add-Type` 定义 `FindWindow` / `ShowWindow`，`FindWindow("Shell_TrayWnd", $null)` 后 `ShowWindow(h, 0|5)`；命令以 **UTF-16LE base64 + `-EncodedCommand`** 下发（避免引号/中文转义问题）。
- 状态持久化：`config.hideSystemTaskbar`，读取用 `get-taskbar-hidden`。
- **兜底恢复**：`src/main/index.js` 的 `restoreTaskbar()` 在 `will-quit` 时无条件把任务栏重新 `ShowWindow(h, 5)`，防止应用异常退出后任务栏永久消失。

### 9.5 桌面图标显隐

- 用 `Add-Type -TypeDefinition` 定义 `DeskIcons` 类：`EnumWindows` 枚举顶层窗口，命中类名 `WorkerW` 或 `Progman` 后用 `EnumChildWindows` 找 `SHELLDLL_DefView`（Win11 下它是 WorkerW 的子窗口，而不是 Progman 的子窗口，所以必须两个都枚举）。
- 找到后 `SendMessage(defView, 0x0111 /* WM_COMMAND */, (IntPtr)0x7402, IntPtr.Zero)` 切换显示/隐藏。
- **真实状态从注册表读**：`getDesktopIconsHiddenReal()` 读 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced` 的 `HideIcons`（`'1'` 为已隐藏），避免与系统真实状态不同步。`toggle-desktop-icons` 返回 `{ success, hidden }`，Dock 右键菜单据此显示「隐藏桌面图标 / 显示桌面图标」。

### 9.6 音量控制：运行时编译 C# dll

1. 源码常量 `AUDIO_CS_CODE`（`src/main/ipc/system.js`）内联完整 C# 代码：以 `ComImport` 声明 `IAudioEndpointVolume` / `IMMDevice` / `IMMDeviceEnumerator` / `MMDeviceEnumeratorClass`（CLSID `BCDE0395-E52F-467C-8E3D-C4579291692E`），提供 `AudioVolumeControl.GetVolume/SetVolume/GetMute/SetMute`。
2. 编译：`findCsc()` 在 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`、`...\Framework\v4.0.30319\csc.exe` 中找编译器，`compileAudioDllAsync()` 用 `exec('"<csc>" /nologo /target:library /out:"<dll>" "<cs>"', { timeout: 20000 })` 生成 `%TEMP%\trae_audio_control_v2.dll`。
3. 调用：`runAudioCommand(action, value)` 拼出 `Add-Type -Path '<dll>';[AudioVolumeControl]::...` 脚本，同样 base64 + `powershell -NoProfile -EncodedCommand` 执行；`get` 输出 `"音量|静音"` 由主进程解析成 `{ success, volume, muted }`。
4. 缓存与版本：`AUDIO_VER = 'v2'` 参与文件名，接口变更时换版本号即可避免加载旧 dll；**dll 不存在时才编译，且不在启动时编译**（避开杀软对运行时编译的启发式拦截与启动卡顿）。
5. 渲染侧节流：Dock 音量滑块 `input` 250 ms 防抖后才真正 `set-volume`。

### 9.7 网络与 WiFi（PowerShell 文本解析）

- 统一 `chcp 65001 >nul & <命令>` 强制 UTF-8 输出，`maxBuffer: 1MB`、`windowsHide: true`。
- `get-network-status` 解析 `ipconfig`：`parseNetworkAdapters()` 用中英文双正则匹配「Ethernet adapter / 以太网适配器 / Wireless LAN adapter / 无线局域网适配器」标题行与 `IPv4` 行，区分 `wired` / `wireless`。
- `get-wifi-status` 解析 `netsh wlan show interfaces`（`parseWifiInterfaces()`，识别 `SSID` / `State` / `Signal` / `Name` 及中文「状态 / 信号 / 名称」，`disconnected|断开` 判为未连接）。
- `get-wifi-networks` 解析 `netsh wlan show networks mode=bssid`（`parseWifiNetworks()`，按 `SSID N` 分组，取 `Signal` / `Authentication` / 是否含 `BSSID`）。
- `connect-wifi` 用 `netsh wlan connect name="<ssid>"`（仅对**已保存过**的配置文件生效，需要密码时会失败，渲染侧会回退打开系统 WiFi 设置页）；`disconnect-wifi` 用 `netsh wlan disconnect`。
- 电量：`get-battery-status` 用 `Get-WmiObject Win32_Battery` 取 `EstimatedChargeRemaining` 与 `BatteryStatus`（2/6/8/9 视为充电中），无电池返回 `{ percent: null, charging: false }`。Dock 每 30 s 刷新，网络每 15 s 刷新。

### 9.8 系统动作与电源

- `system-action` 内置 switch：`start`（`explorer shell:::{2559a1f8-...}` 开始菜单）、`taskview`、`explorer`、`browser`、`settings`、`terminal`（`wt`）、`wifi`、`volume`、`battery`、`calendar`、`actioncenter`、`shutdown`；未命中内置项时按 `https?://` / `mailto:` → `shell.openExternal`，其余 → `shell.openPath`（路径即使已被删除也仍尝试交给系统处理）。
- `power-action`：`shutdown /s /t 0`、`shutdown /r /t 0`、`rundll32.exe powrprof.dll,SetSuspendState 0,1,0`（睡眠）、`rundll32.exe powrprof.dll,SetSuspendState Hibernate`（休眠）。
- Dock 默认导航项（`getDefaultNavItems()`）：资源管理器、终端、任务视图，`type: 'system'`；应用类项由拖拽/文件管理器右键「添加到 Dock」写入 `config.navItems`，`add-nav-item` 会按 `path`（或无名时的 `name`）去重并顺手清理配置中已有的重复项。

### 9.9 浮窗交互细节

- 单击/双击区分：`mouseup` 后若未移动且左键，用 250 ms 定时器判断是否再来一次；双击 → `openFileManager()`，单击 → 切换功能环。
- 右键 → 切换退出按钮环（`toggleQuit`）。
- 拖放：`dragenter`/`dragover`/`drop` 均 `preventDefault`，覆盖层提示文案随「回收站模式」切换（回收站模式下调 `deleteFile`，否则调 `uploadFile`，重名时弹自定义模态框询问是否覆盖）。
- 模态框：`showModal()` 先扩容窗口、打开时关闭点击穿透（`modalActive = true`），按钮点击后恢复原尺寸与穿透。

### 9.10 二次开发注意

1. 新增 IPC 必须三处同步：`src/main/ipc/*.js` 注册 `ipcMain.handle` → 在 `src/main/index.js` 的 `register({...})` 依赖中按需传入 → `preload.js` 暴露方法；改完请核对 5.5 节的 85↔85 对称性。
2. 修改图标缓存键逻辑时，`src/main/ipc/icons.js` 与 `renderer/scripts/file-manager.js` 必须同步修改，且要兼容磁盘上既有的 `icon-cache.json`。
3. 不要重新引入高频配置写入；新增写配置场景请复用 `saveConfig()`（含重试 + 原子替换）并做防抖。
4. 窗口尺寸/位置类 IPC 都遵循「`setResizable(true)` → `setBounds` → `setResizable(false)`」的模式，新增同类接口请保持一致。
5. 涉及 PowerShell 的路径拼接一律使用 `escapePsSingleQuote()`，长命令用 base64 `-EncodedCommand` 下发。
6. 图标提取的压力控制放在渲染进程（批量 + 去重 + 间隔），不要在主进程堆并发池。

---

## 附录 A：API 速查表

### 文件系统（Node.js）

| 操作 | API |
|-----|-----|
| 读取目录 | `fs.readdirSync(path, { withFileTypes: true })` |
| 判断目录 | `fs.statSync(path).isDirectory()` |
| 复制文件 | `fs.copyFileSync(src, dest)` |
| 读写 Buffer（.lnk 等） | `fs.readFileSync` + `fs.writeFileSync` |
| 移动 | `fs.renameSync(src, dest)`（限同卷） |
| 删除到回收站 | `shell.trashItem(path)` |
| 打开文件 / 位置 | `shell.openPath(path)` / `shell.showItemInFolder(path)` |
| 打开 URL | `shell.openExternal(url)` |

### 窗口（Electron）

| 操作 | API |
|-----|-----|
| 创建窗口 | `new BrowserWindow(options)` |
| 位置 | `window.setPosition(x, y)` / `window.getBounds()` / `window.setBounds(b)` |
| 置顶 | `window.setAlwaysOnTop(true, 'screen-saver')` |
| 多桌面可见 | `window.setVisibleOnAllWorkspaces(true)` |
| 点击穿透 | `window.setIgnoreMouseEvents(true, { forward: true })` |
| 亚克力模糊 | `window.setBackgroundMaterial('acrylic')` |
| 原生拖出 | `webContents.startDrag({ file, icon })` |
| 读取快捷方式 | `shell.readShortcutLink(lnkPath)` |
| 图标（兜底） | `app.getFileIcon(path, { size: 'normal' })` |

---

## 附录 B：相关文档

- `README.md` — 项目简介、功能清单、快速开始
- `CHANGELOG.md` — 版本变更（1.1.0 的模块化重构、修复与移除记录）
- `docs/PROJECT_GUIDE.md` — 项目指南、二次开发
- `docs/PROBLEM_SOLUTIONS.md` — 问题现象 / 根因 / 解决方案记录

> 说明：`docs/TROUBLESHOOTING.md` 与 `docs/specs/` 已不存在，相关能力已并入 `docs/PROBLEM_SOLUTIONS.md`。

---

*文档版本：v1.1.0 · 引用方式：文件路径 + 函数名/通道名（不含行号）*
