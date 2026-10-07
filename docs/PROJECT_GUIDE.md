# 项目文档 - 浮窗文件管理器 v1.1.0

本文档帮助您快速了解项目，便于复刻和二次开发。

---

## 目录

1. [项目概述](#1-项目概述)
2. [功能特性](#2-功能特性)
3. [技术架构](#3-技术架构)
4. [开发环境配置](#4-开发环境配置)
5. [核心模块说明](#5-核心模块说明)
6. [数据流程](#6-数据流程)
7. [界面交互](#7-界面交互)
8. [配置与自定义](#8-配置与自定义)
9. [打包与部署](#9-打包与部署)
10. [二次开发指南](#10-二次开发指南)
11. [附录：常见问题](#附录常见问题)

---

## 1. 项目概述

### 项目定位

浮窗文件管理器是一款 Windows 桌面辅助工具，通过始终置顶的透明悬浮窗（桌宠）提供便捷的文件管理功能，并附带一个仿 macOS 的 Dock 导航栏，用于快速启动应用、查看网络/音量/电量状态和执行电源操作。

### 核心价值

- **快速访问**：无需切换窗口，随时拖拽文件到浮窗完成上传
- **高效管理**：文件管理窗口提供双视图浏览、实时搜索、分区侧边栏
- **桌面整合**：Dock 栏 + 桌宠式浮窗，可贴边隐藏，不占任务栏空间
- **轻量级**：原生 HTML/CSS/JS，无前端框架依赖

### 技术选型

| 选择 | 原因 |
|-----|------|
| Electron 28 | 跨平台、生态丰富、可直接调用 Windows 原生能力 |
| 原生 HTML/CSS/JS | 无框架依赖、代码简洁、易于定制 |
| PowerShell + Windows Shell API | 在禁用 GPU 时仍可稳定提取文件图标 |
| JSON 文件持久化 | 配置与图标缓存无需数据库 |

### 版本说明

- 应用版本：**1.1.0**（见 `package.json` 的 `version` 字段）
- Electron：`^28.0.0`（开发环境实际安装 28.3.3）
- Node.js：18.x 或更高
- 目标平台：Windows 10/11 x64

---

## 2. 功能特性

### 浮窗（桌宠）

| 操作 | 功能 |
|-----|------|
| 单击浮窗 | 显示/隐藏功能按钮环 |
| 双击浮窗 | 打开文件管理窗口 |
| 右键浮窗 | 显示/隐藏退出按钮 |
| 拖动浮窗 | 移动位置，松手后自动保存 |
| 拖拽文件到浮窗 | 上传到「首选路径」（文件管理窗口打开时上传到其当前路径） |
| 拖到屏幕边缘 | 自动贴边隐藏，鼠标悬停时弹出 |
| 拖到 Dock 附近 | 自动吸附到 Dock 边框，并随 Dock 一起移动 |

### 浮窗功能按钮环

| 按钮 | data-action | 功能 |
|-----|------|------|
| 桌面导航 | `nav` | 显示/隐藏 Dock 栏 |
| 文件管理 | `folder` | 切换「回收站模式」（拖入的文件改为删除到回收站） |
| 此电脑 | `computer` | 打开系统「此电脑」 |
| 置顶 | `pin` | 切换浮窗/文件管理窗口的置顶状态 |
| 退出 | `quit` | 退出应用（在退出按钮环中） |

### 文件管理窗口

- **双视图**：列表视图（文件名、大小、修改时间）/ 图标网格视图
- **分区侧边栏**：把常用目录归入自定义分区，支持新增分区、重命名、删除、添加路径、路径跨分区拖拽
- **搜索**：在保存路径下递归搜索文件名
- **导航**：双击进入子目录、返回上一级、当前路径显示
- **文件操作**：双击打开、点击按钮打开所在位置、多选后删除到回收站
- **上传**：按钮选择文件/文件夹、外部拖拽到列表区域上传、拖到文件夹图标上传到该文件夹
- **内部拖拽移动**：把文件项拖到某个文件夹图标上完成移动
- **拖出**：把文件项拖到桌面或资源管理器（原生拖拽）
- **右键菜单**：分区/路径项的增删改，以及「添加到 Dock」「设为首选路径」

### Dock 栏

- **快捷图标区**：拖拽应用或文件到 Dock 即添加，支持横向滚动、右键隐藏/删除
- **系统托盘区**：网络（WiFi/有线）、音量、电量、时间、设置、关闭 Dock
- **电源菜单**：睡眠、休眠、重启、关机
- **开始 / 任务视图**：调用系统内置动作
- **四种模糊模式**：玻璃、高斯、亚克力、自定义（圆角、图标大小、显示数量、主题色可调）
- **可以拖动**：拖动面板即可移动整个 Dock，位置持久化
- **仅显示快捷图标**：隐藏开始按钮与托盘区

### 设置窗口

| 页签 | 内容 |
|-----|------|
| 外观 | 模糊模式（玻璃/高斯/亚克力/自定义）、自定义模式模糊强度与背景透明度、圆角、图标大小、显示图标数量、主题色（5 个预设 + 取色器）、仅显示快捷图标、实时预览 |
| 常规 | Dock 始终置顶、隐藏系统任务栏、重置 Dock 位置、居中 Dock |
| 图标 | 图标列表（显示/隐藏、删除）、重置为默认图标、显示已隐藏图标 |
| 关于 | 版本信息、打开配置文件夹 |

---

## 3. 技术架构

### 进程模型

```
┌──────────────────────────────────────────────────────────────────────┐
│                    主进程 (main.js → src/main/)                       │
│                                                                      │
│  main.js                仅一行，require('./src/main/index.js')        │
│  index.js               单实例锁、崩溃自愈、装配 IPC、启动窗口         │
│  config.js              配置读写 + 迁移（loadConfig/saveConfig）      │
│  windows.js             窗口创建与状态（浮窗/文件管理/Dock/设置）      │
│                                                                      │
│  ipc/config.js  分区、路径、首选路径、保存路径                        │
│  ipc/files.js   列表、搜索、上传、删除、移动、原生拖出                 │
│  ipc/icons.js   图标查询与缓存（get-file-icon）                       │
│  ipc/window.js  移动、贴边、吸附、扩容、置顶、点击穿透、Dock 尺寸      │
│  ipc/dialog.js  选目录、打开文件/位置、此电脑、消息框                  │
│  ipc/system.js  系统动作、任务栏、桌面图标、电源、音量、WiFi/网络      │
│                                                                      │
│  services/icon-extractor.js   图标提取（PowerShell + Shell API）      │
│  services/icon-cache.js       图标缓存落盘（icon-cache.json）         │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ IPC（通道名见 preload.js）
        ┌───────────────┬───────┴───────┬───────────────┐
        ▼               ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   浮窗         │ │  文件管理      │ │   Dock 栏      │ │   设置窗口     │
│ float.html    │ │file-manager   │ │  dock.html    │ │settings.html  │
│ (160×160)     │ │(900×600)      │ │ (按内容自适应) │ │ (440×560)     │
│               │ │               │ │               │ │               │
│ 拖动/贴边     │ │ 列表/网格      │ │ 快捷图标       │ │ 外观/常规      │
│ 环形菜单      │ │ 分区侧边栏     │ │ 系统托盘       │ │ 图标管理       │
│ 拖拽上传      │ │ 搜索/上传/删除 │ │ 音量/WiFi 浮层 │ │ 实时预览       │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
```

所有窗口共用同一个预加载脚本 `preload.js`，通过 `contextBridge` 在 `window.electronAPI` 上暴露 85 个方法，与主进程注册的 85 个通道**一一对应**；`contextIsolation: true`、`nodeIntegration: false`。

### 文件结构

```
浮窗文件管理1.0.0/
│
├── main.js                     # 入口（1 行）：require('./src/main/index.js')
├── preload.js                  # 预加载脚本：contextBridge 暴露 IPC 桥
├── package.json                # 项目配置 + electron-builder 打包配置
├── .eslintrc.json              # ESLint 规则
├── .prettierrc                 # Prettier 规则
├── jsconfig.json               # 编辑器 JS 项目配置
├── icon.png                    # 应用图标
├── LICENSE                     # MIT
├── README.md                   # 项目说明
├── CHANGELOG.md                # 更新日志
│
├── src/main/                   # 主进程（1.0.0 → 1.1.0 期间由单体 main.js 拆分）
│   ├── index.js                # 应用生命周期、单实例锁、崩溃自愈、装配 IPC
│   ├── config.js               # 配置路径、loadConfig/saveConfig/migrateConfig
│   ├── windows.js              # 浮窗/文件管理/Dock/设置窗口的创建与状态
│   ├── ipc/
│   │   ├── config.js           # 分区与路径相关通道
│   │   ├── files.js            # 文件操作相关通道
│   │   ├── icons.js            # 图标查询通道
│   │   ├── window.js           # 窗口/Dock 控制通道
│   │   ├── dialog.js           # 系统对话框与打开文件
│   │   └── system.js           # 系统集成（电源/音量/WiFi/任务栏/托盘项）
│   └── services/
│       ├── icon-extractor.js   # 图标提取核心
│       └── icon-cache.js       # 图标缓存读写
│
├── renderer/                   # 渲染进程
│   ├── float.html              # 浮窗（桌宠）页面
│   ├── file-manager.html       # 文件管理页面
│   ├── dock.html               # Dock 栏页面
│   ├── settings.html           # 设置页面
│   ├── scripts/
│   │   ├── float.js            # 浮窗交互逻辑
│   │   ├── file-manager.js     # 文件管理逻辑
│   │   ├── dock.js             # Dock 逻辑
│   │   ├── settings.js         # 设置逻辑
│   │   └── icon-helper.js      # 【已废弃】旧图标辅助窗口逻辑（不被加载）
│   ├── styles/
│   │   ├── float.css           # 浮窗样式
│   │   ├── file-manager.css    # 文件管理样式
│   │   ├── dock.css            # Dock 样式（含四种模糊模式）
│   │   └── settings.css        # 设置样式
│   ├── icon-helper.html        # 【已废弃】内容已替换为说明性注释
│   └── icon-helper-preload.js  # 【已废弃】内容已替换为说明性注释
│
├── docs/                       # 文档
│   ├── TECHNICAL_GUIDE.md      # 技术文档
│   ├── PROJECT_GUIDE.md        # 项目文档（本文档）
│   └── PROBLEM_SOLUTIONS.md    # 问题解决方案
│
├── .userdata/                  # 开发环境数据目录（已 gitignore）
│   └── config.json             # 配置文件
│
├── icon-cache.json             # 图标缓存（运行时生成，已 gitignore）
└── dist-new/                   # 打包输出（已 gitignore）
    ├── win-unpacked/
    └── 浮窗文件管理器-1.1.0.exe
```

### 关于已废弃的 icon-helper 三件套

`renderer/icon-helper.html`、`renderer/icon-helper-preload.js`、`renderer/scripts/icon-helper.js` 属于 1.0.0 时期「隐藏辅助窗口」方案（通道 `helper-get-file-icon` / `helper-native-get-file-icon` / `helper-return-file-icon`）的遗留文件。

- **现状**：`icon-helper.html` 与 `icon-helper-preload.js` 的内容已被替换为纯说明性注释；`renderer/scripts/icon-helper.js` 仍保留原转发逻辑代码，但**没有任何页面加载它**。
- **不再被加载**：`src/main/` 中已不存在 `createIconHelperWindow` 或 `helper-*` 通道的任何引用，因此这三者不会被任何窗口使用。
- **可以安全删除**：图标提取链路已统一到主进程 `src/main/ipc/icons.js` 的 `get-file-icon` 通道（带缓存与增量通知），原方案是一套重复且无缓存的实现。
- **为何还留着**：删除操作受工作区目录权限限制被拒，故保留为说明性空壳。

---

## 4. 开发环境配置

### 环境要求

- Node.js 18.x 或更高版本
- npm 9.x 或更高版本
- Windows 10/11

### 安装依赖

```powershell
cd "浮窗文件管理1.0.0"
npm install
```

### 开发运行

```powershell
# 开发环境启动
npm start
# 等价于 npx electron .

# 带 --dev 参数启动
npm run dev

# 遇到 GPU 渲染问题时禁用 GPU
npx electron . --disable-gpu
```

### 代码检查与格式化

```powershell
npm run lint        # 检查 main.js、preload.js、renderer/、src/main/
npm run lint:fix    # 自动修复可修复项
npm run format      # Prettier 格式化 js/json/html/css
```

### 数据目录配置

开发环境自动把 Electron 的 `userData` 指向项目内的 `.userdata/`，避免写入系统 AppData 被安全软件拦截；打包后使用系统默认目录（`%APPDATA%\floating-file-manager`）：

```javascript
// src/main/config.js
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(rootDir, '.userdata');
  if (!fs.existsSync(devDataDir)) {
    fs.mkdirSync(devDataDir, { recursive: true });
  }
  app.setPath('userData', devDataDir);
}
```

同一文件还导出了 `rootDir`（项目根目录）与 `configPath`（配置文件绝对路径），其他模块统一从这里引用，不要自己拼路径。

---

## 5. 核心模块说明

### 主进程入口 `src/main/index.js`

- **单实例锁**：`app.requestSingleInstanceLock()`，第二次启动时聚焦已有浮窗
- **崩溃自愈**：监听 `gpu-process-crashed` 与 `render-process-gone`，连续崩溃 2 次后带 `--disable-gpu` 自动重启
- **静音已知噪音异常**：`uncaughtException` 中忽略 Electron 自身的 `shortcut link`、`NOTREACHED` 报错
- **启动流程**（`app.whenReady`）：`loadConfig()` → 确保保存路径存在 → `loadIconCache()` → `windows.loadPersistedState()` → `createFloatWindow()` → 若上次 Dock 可见则 `showDockWindow()`
- **退出流程**：`window-all-closed` / `will-quit` 时 `saveIconCache()`，`will-quit` 还会 `restoreTaskbar()` 恢复被隐藏的系统任务栏
- **IPC 装配**：依次调用 `ipcConfig.register`、`ipcFiles.register`、`ipcIcons.register`、`ipcWindow.register`、`ipcDialog.register`、`ipcSystem.register`，各自按需注入依赖（如 `loadConfig`、`getFloatWindow`）

### 配置模块 `src/main/config.js`

- `loadConfig()`：读取 `config.json`；不存在或解析失败时返回一份带默认分区（我的文件/桌面/文档/下载/图片）的完整默认配置
- `migrateConfig(config)`：配置升级钩子，补齐缺失字段并写回。已处理的迁移包括：
  - 旧字段 `quickAccess` → 合并进 `partitions` 里的 `default` 分区
  - 旧字段 `dockY`（顶部锚点）→ 删除，改用 `dockBottom`（底部锚点，因为 Dock 高度随内容变化）
  - 补齐 `dockVisible`、`floatAlwaysOnTop`、`dockAlwaysOnTop`、`dockX`、`dockBottom`、`preferredPath`
- `saveConfig(config)`：先直接写入最多 3 次（每次失败间约 80ms 忙等），全部失败后走「写临时文件 + rename」原子替换，规避高频写入导致的 EPERM
- 导出：`loadConfig`、`saveConfig`、`isDev`、`rootDir`、`configPath`、`userDataDir`

> 分区模型取代了早期的「快捷访问」列表。`get-quick-access` 通道仍保留，作用是把所有分区里的路径「拉平」成一个列表，供需要扁平结构的调用方使用。

### 窗口管理 `src/main/windows.js`

| 函数 | 说明 |
|-----|------|
| `createFloatWindow()` | 浮窗 160×160，透明、无边框、不占任务栏；位置取 `floatPosition` 并做边界收敛；加载 `renderer/float.html`；`did-finish-load` 时把 `snapEdges` 推给渲染层恢复贴边状态 |
| `createFileManagerWindow()` | 900×600，优先出现在浮窗右侧，越界则翻到左侧并做工作区收敛；重复调用只聚焦不重建 |
| `createDockWindow()` | 初始 800×200，位置以 `dockX` + `dockBottom` 还原并对越界回退到底部居中；`did-finish-load` 与 `show` 时调用 `setBackgroundMaterial('acrylic')` 获得系统级桌面模糊 |
| `createSettingsWindow()` | 440×560，屏幕居中，单例 |
| `showDockWindow()` / `hideDockWindow()` / `toggleDockWindow()` | Dock 显示控制，切换时写回 `dockVisible` |
| `loadPersistedState()` | 从配置恢复 `alwaysOnTopEnabled`、`dockAlwaysOnTopEnabled`、`dockVisible` |
| `savePersistedState()` | 把上述三个状态写回配置 |
| `getXxxWindow()` / `getAlwaysOnTopEnabled()` 等 | 提供给 IPC 模块的只读访问器 |

> 所有窗口的 `webPreferences` 均使用 `preload: path.join(rootDir, 'preload.js')` + `contextIsolation: true` + `nodeIntegration: false`。

### IPC 模块

| 文件 | 通道（部分） | 职责 |
|-----|------|------|
| `ipc/config.js` | `get-config`、`set-save-path`、`get-partitions`、`add-partition`、`update-partition`、`remove-partition`、`add-path-to-partition`、`update-partition-path`、`remove-partition-path`、`move-path-to-partition`、`get-quick-access`、`get-preferred-path`、`set-preferred-path` | 分区与路径 CRUD；删除 `default` 分区会被拒绝 |
| `ipc/files.js` | `list-files`、`search-files`、`upload-file`、`upload-folder`、`is-directory`、`delete-file`、`move-file`、`start-drag`、`sync-current-path`、`get-upload-dest` | 文件系统操作；上传前做重名检测（返回 `{duplicate:true}` 交渲染层确认）；`.lnk` 用 Buffer 复制规避 EPERM；删除走 `shell.trashItem` 回收站；变更后向文件管理窗口推送 `files-changed` |
| `ipc/icons.js` | `get-file-icon` | 图标查询入口：先查 `iconCache`，未命中调用 `resolveFileIcon`，成功后写缓存、`scheduleSaveIconCache()` 并广播 `icon-updated` |
| `ipc/window.js` | `move-window`、`save-window-position`、`unsnap-window`、`resnap-window`、`toggle-always-on-top`、`toggle-dock`、`move-dock`、`resize-dock-window`、`expand-dock-window`、`reset-dock-pos`、`center-dock`、`open-settings`、`close-settings`、`apply-dock-style`、`move-settings`、`set-ignore-mouse-events` 等 | 窗口移动/贴边/吸附/扩容、Dock 尺寸自适应、置顶、点击穿透 |
| `ipc/dialog.js` | `select-directory`、`open-file-manager`、`close-file-manager`、`open-this-computer`、`show-message-box`、`open-file-location`、`open-file` | 系统对话框与打开操作；`.url` 文件会解析出真实 URL 后用 `shell.openExternal` 打开 |
| `ipc/system.js` | `system-action`、`get-dock-settings`、`save-dock-settings`、`toggle-taskbar`、`get-taskbar-hidden`、`toggle-desktop-icons`、`get-desktop-icons-hidden`、`power-action`、`get-volume`、`set-volume`、`toggle-mute`、`set-mute`、`get-network-status`、`get-wifi-status`、`get-wifi-networks`、`connect-wifi`、`disconnect-wifi`、`get-nav-items`、`save-nav-items`、`add-nav-item`、`update-nav-item`、`remove-nav-item`、`get-battery-status` | 全部系统集成能力 |

> 完整通道清单以 `preload.js` 为准——那里的每个方法都对应一个 `ipcRenderer.invoke` 或 `ipcRenderer.on`，且与主进程注册的通道数量一致（各 85 个）。

### 服务模块

#### 图标提取 `src/main/services/icon-extractor.js`

核心导出 `resolveFileIcon(filePath)`，内部按顺序回退：

1. **快捷方式解析**：`.lnk` 用 `shell.readShortcutLink` 取目标路径，失败则用 PowerShell 读 `TargetPath`；`.url` 按 INI 解析 `IconFile` / `URL` / `IconIndex`，`steam://rungameid/<id>` 会去 Steam 安装目录找图标
2. **PowerShell + Shell API**：`getFileIconViaPowerShell()` 生成临时 `.ps1`，用 `SHGetFileInfo` 取 64×64 图标（禁用 GPU 时也有效）
3. **Electron 回退**：`getFileIconWithTimeout()` 调用 `app.getFileIcon`，带超时保护

当前导出清单：`cleanPath`、`parseIconPath`、`resolveLnkTarget`、`parseUrlFile`、`findSteamInstallPath`、`getSteamGameIcon`、`getFileIconViaPowerShell`、`iconToDataUrl`、`readIcoToDataUrl`、`getFileIconWithTimeout`、`resolveFileIcon`。

所有拼进 PowerShell 的路径都会经 `escapePsSingleQuote()` 转义，防止命令注入。

> **已删除（1.1.0）**：`getLnkIconLocation`、`extractFolderIconToDataUrl`、`extractLargeIconAsync`，以及旧的主进程侧并发闸门 `iconPending` / `MAX_CONCURRENT` / `drainIconPending` 均已从本文件移除。图标并发控制现在完全由渲染进程负责（见下文 `processIconQueue()`）。

#### 图标缓存 `src/main/services/icon-cache.js`

- `loadIconCache()` / `saveIconCache()`：读写 `icon-cache.json`（开发态位于项目根，打包后位于 exe 同目录），只保留 `data:image/` 开头的有效项，总大小上限 5 MB
- `scheduleSaveIconCache()`：延迟 5 秒合并写入，避免频繁落盘
- 缓存键规则见第 8 章「缓存键设计」

### 渲染进程模块

#### 浮窗 `renderer/scripts/float.js`

- **点击穿透**：`enableClickThrough()` / `enableMouseCapture()` 包装 `setIgnoreMouseEvents`；鼠标进入内容区关闭穿透，离开且菜单/模态框都关闭时恢复穿透
- **拖动**：`petBody` 的 `mousedown` 记录起始屏幕坐标，`document` 的 `mousemove` 累加增量并调用 `moveWindow(dx, dy)`，`mouseup` 时若有位移则 `saveWindowPosition()`
- **单击/双击区分**：`mouseup` 里用 250ms 定时器判定，单击 `toggleMenu()`、双击 `openFileManager()`
- **贴边弹回**：`hasSnapClass()` 判断当前是否贴边；`mouseenter` 调 `unsnapWindow()` 弹出，`mouseleave` 在「未移动且菜单未开」时调 `resnapWindow()` 收回
- **拖放**：`drop` 时优先读 `dataTransfer.files`（系统拖入），其次读 `text/plain`（文件管理页拖出）；`recycleMode` 为真则删除到回收站，否则上传到 `getUploadDest()`
- **模态框**：`showModal()` 先用 `expandFloatWindow(420, 320)` 临时放大窗口（浮窗只有 160×160），完成后再 `restoreFloatWindow()`

#### 文件管理 `renderer/scripts/file-manager.js`

- `loadFiles(dirPath)` → `listFiles` → `renderFiles(files)`：目录优先排序，`document.createDocumentFragment()` 批量插入
- `getIconCacheKeyByName(name, filePath)`：与主进程 `getIconCacheKey` 严格对应（见第 8 章）
- `processIconQueue()`：**全项目唯一的图标并发闸门**——每批最多 3 个并发请求，批与批之间间隔 50ms，同一批内按缓存键去重，并复用 `iconDataUrlCache` 中已有的结果
- `scheduleIconLoad()`：触发图标队列处理
- `showModal()` / `showInputModal()`：自研 Promise 化模态框，支持 `success/warning/question/error` 图标与文本输入
- 分区侧边栏：`loadPartitions()`、`renderPartitions()`、`updateSidebarActive()`、`handleContextMenuAction()`；路径项 `draggable`，用 `text/x-path-item` 自定义 MIME 携带来源分区与索引，可拖到其它分区或 Dock
- `onFilesChanged`：主进程上传/删除/移动后推送的 `files-changed` 事件，仅当变化目录等于当前目录时刷新
- `onIconUpdated`：收到 `icon-updated` 时写入本地缓存并按缓存键就地替换图标，不整批刷新
- 初始化：`loadPartitions()` 拿到 `preferredPath` 后 `loadFiles(pref)`，没有首选路径则 `loadFiles()` 走 `savePath`

#### Dock `renderer/scripts/dock.js`

- `loadNavItems()` / `renderNavItems()`：渲染快捷图标（`renderingLock` 防并发渲染闪烁），按路径和名称双重去重，系统项用内置 SVG
- `autoFitDockWindow(itemCount, iconSize)`：按可见数量计算 `dock-items` 精确像素宽度，再量测面板真实尺寸调用 `resizeDockWindow(w, h)` 反调窗口大小；随后 `reportPanelOffset()` 把面板真实渲染矩形上报主进程，供浮窗吸附计算
- `applyDockStyle(settings)`：把设置写入 CSS 变量并切换 `glass-mode` / `gaussian-mode` / `acrylic-mode` / `custom-mode` 类，同时更新所有按钮与图标尺寸
- 系统托盘：`updateDockTime()`（1s 定时）、`updateBattery()`（30s）、`initNetworkMonitoring()`（15s 轮询网络状态并替换托盘图标）
- 浮层：`showPopup` / `hidePopup` / `togglePopup` 控制音量与 WiFi 面板，打开时 `expandForMenu()` 临时把窗口撑高到 380px，关闭后 `restoreAfterMenu()`
- 右键菜单：图标项（隐藏/删除）、空白区（打开设置/仅显示快捷图标/隐藏桌面图标）、电源菜单（睡眠/休眠/重启/关机）
- 拖拽添加：`drop` 支持系统文件、`text/x-path-item`、`text/plain` 三种来源，用 `dropInProgress` + 800ms 时间窗双重去重
- 兜底显示：`dock-panel` 初始 `opacity:0`，加载完成后淡入，另有 2 秒强制显示兜底

#### 设置 `renderer/scripts/settings.js`

- `loadSettings()`：从 `getDockSettings()` 载入完整设置对象并回填控件、更新预览
- `updatePreview()`：把设置写入预览元素上的 `--preview-*` 变量并切换预览模式类
- `pushStyleToDock()`：调用 `applyDockStyle` 通道，把当前设置实时推给 Dock 窗口（这就是「改滑块 Dock 立刻变样」的实现）
- `saveSettings()`：调用 `saveDockSettings` 通道持久化到 `config.json` 的 `dockSettings` 字段
- 交互约定：滑块 `input` 时只预览不落盘，`change` 时才保存；模糊模式/主题色/开关切换后立即「预览 + 保存」
- `renderIconList()`：渲染 Dock 图标管理列表，支持逐项显示/隐藏与删除，以及一键重置为默认、一键显示全部
- `onDockStyleChanged`：接收外部的样式变更并同步回本页控件（用空值判断 + 逐字段 `typeof` 守卫，只更新本页真实存在的控件）

---

## 6. 数据流程

### 文件上传流程

```
用户拖拽文件到浮窗 / 文件管理窗口
     │
     ▼
渲染进程：阻止默认行为，从 dataTransfer.files 取文件路径
     │
     ▼
IPC：window.electronAPI.uploadFile({ sourcePath, fileName, destDir })
     │
     ▼
主进程 ipc/files.js：
   1. 目标目录不存在则递归创建
   2. 校验源文件存在且不是目录
   3. 目标同名且未指定 overwrite
     │
     ├─ 是 → 返回 { success:false, duplicate:true, destPath }
     │        └─ 渲染层弹模态框询问 → 选「覆盖」则带 overwrite:true 重发
     │
     └─ 否 → .lnk 用 Buffer 读写，其余 fs.copyFileSync()
              → notifyFilesChanged() 推送 files-changed
     │
     ▼
渲染进程：清空本地图标缓存并刷新列表
```

### 图标加载流程

```
渲染文件列表
     │
     ▼
为每个非文件夹项计算 iconKey = getIconCacheKeyByName(name, path)
     │
     ├─ 本地 iconDataUrlCache 命中 → 直接显示
     │
     └─ 未命中 → 加入图标加载队列
     │
     ▼
processIconQueue()（渲染进程侧并发闸门）
   每批最多 3 个并发，批间隔 50ms，同批按缓存键去重
     │
     ▼
IPC：window.electronAPI.getFileIcon(filePath, isDirectory)
     │
     ▼
主进程 ipc/icons.js：
   1. cacheKey = getIconCacheKey(filePath)
   2. iconCache 命中 → 直接返回
   3. 未命中 → resolveFileIcon(filePath)
        ├─ 快捷方式/.url 解析目标
        ├─ PowerShell + SHGetFileInfo（64×64 PNG）
        └─ 回退 app.getFileIcon（带超时）
   4. 成功 → 写 iconCache + scheduleSaveIconCache() + broadcastIconUpdated()
     │
     ▼
渲染进程：写入本地缓存 → 就地替换图标
```

### `icon-updated` 增量通知流程

```
主进程某个图标提取成功
     │
     ▼
src/main/ipc/icons.js 的 broadcastIconUpdated(cacheKey, dataUrl)
   遍历 BrowserWindow.getAllWindows()，向每个窗口发送：
   'icon-updated' 载荷 { filePath: cacheKey, iconDataUrl: dataUrl }
     │
     ▼
各渲染窗口的 onIconUpdated 回调（preload.js 注册）
     │
     ▼
renderer/scripts/file-manager.js：
   1. iconDataUrlCache.set(iconKey, iconDataUrl)
   2. 遍历 .file-item，用 getIconCacheKeyByName(name, dataset.path) 重新计算键
   3. 键相等者就地替换 <img>，无需重新请求
   4. 已存在的旧缓存（含磁盘上的 icon-cache.json）沿用同一键格式，因此兼容

说明：载荷字段名为 filePath，实际传的是「缓存键」而非真实路径；
因此渲染层必须用同一套键规则换算，否则匹配不上。
```

### 配置保存流程

```
用户修改设置（滑块 change / 开关 / 分区右键菜单）
     │
     ▼
IPC：window.electronAPI.saveDockSettings(settings) 等
     │
     ▼
主进程：
   1. loadConfig() 读取当前配置
   2. 合并本次变更（如 config.dockSettings = {...旧值, ...新值}）
   3. saveConfig() 写入文件
     │
     ├─ 直接写入，最多尝试 3 次（每次失败间约 80ms）
     │
     └─ 全部失败 → 写 config.json.tmp 再 renameSync 原子替换
     │
     ▼
返回 { success: true }
```

### Dock 样式实时预览流程

```
设置窗口拖动滑块
     │
     ├─ input 事件 → updatePreview()（只更新本页预览）
     │             → pushStyleToDock()
     │                  │
     │                  ▼
     │            IPC：apply-dock-style
     │                  │
     │                  ▼
     │            主进程 ipc/window.js：
     │            dockWindow.webContents.send('dock-style-changed', style)
     │                  │
     │                  ▼
     │            Dock 窗口 dock.js：applyDockStyle(style)
     │            （写 CSS 变量 + 切模式类 + 重新适配窗口尺寸）
     │
     └─ change 事件 → saveSettings() → save-dock-settings → 落盘 config.json
```

> 该广播会发给所有窗口，因此设置窗口也会收到自己发出的 `dock-style-changed`；其处理器用空值判断与逐字段 `typeof` 守卫做了忽略处理，属于可接受的自我同步。

---

## 7. 界面交互

### 浮窗

```
┌─────────────────────────────────────────────┐
│                   浮窗 (160×160)             │
│                                              │
│    ┌──────────────────────────────────┐     │
│    │            桌宠（悬浮球）          │     │
│    │                                  │     │
│    │     单击 → 显示/隐藏功能按钮环     │     │
│    │     双击 → 打开文件管理           │     │
│    │     右键 → 显示/隐藏退出按钮       │     │
│    │     拖动 → 移动位置（松手保存）    │     │
│    │     拖到边缘 → 贴边隐藏            │     │
│    │     拖到 Dock 附近 → 吸附          │     │
│    │     拖入文件 → 上传/删除到回收站   │     │
│    └──────────────────────────────────┘     │
│                                              │
│         ┌──┐ ┌──┐ ┌──┐ ┌──┐                │
│         │导航│ │文件│ │电脑│ │置顶│          │
│         └──┘ └──┘ └──┘ └──┘                │
│         功能按钮环（单击后显示）              │
└─────────────────────────────────────────────┘
```

### 文件管理窗口

```
┌─────────────────────────────────────────────────────────────┐
│  文件管理器                                          [×]     │
├──────────┬──────────────────────────────────────────────────┤
│ 分区列表  │  [🔍搜索框]  [列表][图标]  [📤上传][▾]           │
│          ├──────────────────────────────────────────────────┤
│ ▾ 常用    │  [⬅返回]  D:\FloatUploads              [🗑删除]  │
│   📁我的文件├──────────────────────────────────────────────────┤
│   📁桌面   │  ┌──────┐ 文件名.docx                            │
│   📁文档   │  │ 📄 │  123 KB · 2小时前         [📍][▶]      │
│   📁下载   │  └──────┘                                        │
│   📁图片   │  ┌──────┐ 文件夹                                 │
│ ▾ 工作    │  │ 📁 │  文件夹 · 昨天              [📍]         │
│   📁项目   │  └──────┘                                        │
│ [+ 添加分区]├──────────────────────────────────────────────────┤
│          │  5 个文件夹，23 个文件                             │
└──────────┴──────────────────────────────────────────────────┘
```

### Dock 栏

```
        ┌──────────────────────────────────────────────────────────────┐
        │ [⏻] [⊞] │ [图标][图标][图标][图标][图标][图标] │ [📶][🔊][🔋][时间][⚙][×] │
        └──────────────────────────────────────────────────────────────┘
          电源 开始        快捷图标区（可横向滚动）        托盘区

  托盘浮层：点击 🔊 → 音量面板（静音按钮 + 滑块），点击 📶 → WiFi 面板（信号/已连网络/扫描列表）
  右键空白区 → 打开设置 / 仅显示快捷图标 / 隐藏桌面图标
  右键图标   → 隐藏此图标 / 删除此图标
  拖动面板   → 移动整个 Dock（位置持久化）
```

### 设置窗口

```
┌──────────────────────────────────────┐
│ ⚙ 设置                          [×] │
├──────────────────────────────────────┤
│ 外观 │ 常规 │ 图标 │ 关于            │
├──────────────────────────────────────┤
│  Dock 外观                            │
│  ┌────────────────────────────────┐  │
│  │      预览 Dock（实时）          │  │
│  └────────────────────────────────┘  │
│  模糊模式  [玻璃][高斯][亚克力][自定义]│
│  （自定义模式时显示模糊强度/背景透明度）│
│  圆角大小   ────●────  24px          │
│  图标大小   ────●────  52px          │
│  显示数量   ────●────  8             │
│  主题色     ● ● ● ● ●  [取色器]      │
│  Dock 布局                            │
│  仅显示快捷图标            [开关]     │
├──────────────────────────────────────┤
│              [应用]  [确定]           │
└──────────────────────────────────────┘
```

---

## 8. 配置与自定义

### 配置文件位置

| 环境 | 路径 |
|-----|------|
| 开发（`!app.isPackaged`） | `<项目根>/.userdata/config.json` |
| 打包后 | `%APPDATA%\floating-file-manager\config.json` |

图标缓存 `icon-cache.json` 与之不同：开发态位于项目根目录，打包后位于 exe 同目录（`path.dirname(app.getPath('exe'))`）。

### 配置文件结构

```json
{
  "savePath": "C:\\Users\\<用户>\\Documents\\FloatUploads",
  "preferredPath": "C:\\Users\\<用户>\\Documents\\FloatUploads",
  "floatPosition": { "x": 1490, "y": 700 },
  "snapEdges": ["right"],
  "partitions": [
    {
      "id": "default",
      "name": "常用",
      "paths": [
        { "name": "我的文件", "path": "C:\\Users\\<用户>\\Documents\\FloatUploads" },
        { "name": "桌面", "path": "C:\\Users\\<用户>\\Desktop" }
      ]
    }
  ],
  "dockVisible": true,
  "floatAlwaysOnTop": true,
  "dockAlwaysOnTop": true,
  "dockX": 560,
  "dockBottom": 1060,
  "hideSystemTaskbar": false,
  "dockSettings": {
    "blurMode": "glass",
    "radius": 24,
    "iconSize": 52,
    "itemCount": 10,
    "onlyShortcuts": false,
    "bgColor": "#1e1e1e",
    "glassBlur": 20,
    "glassOpacity": 0.2,
    "gaussianBlur": 16,
    "acrylicBlur": 60,
    "acrylicOpacity": 0.08,
    "customColor": "#1e1e1e",
    "customOpacity": 0.5,
    "customBlur": 40
  },
  "navItems": [
    { "id": "nav_explorer", "name": "资源管理器", "action": "explorer", "type": "system", "icon": "explorer", "visible": true },
    { "id": "nav_1234_ab", "name": "Visual Studio Code", "path": "C:\\...\\Code.exe", "type": "application", "visible": true }
  ]
}
```

> 说明：项目**没有** `pathHistory` 字段。历史/常用路径能力由 `partitions[]`（分区与路径集合）加 `preferredPath`（首选路径，侧边栏带星标）共同承担。

### 字段速查

| 字段 | 类型 | 说明 |
|-----|------|------|
| `savePath` | string | 默认保存（上传）目录，搜索也以此为根递归 |
| `preferredPath` | string | 首选路径；文件管理窗口打开时的默认目录，侧边栏显示星标 |
| `floatPosition` | `{x,y}` | 浮窗位置，拖动结束保存 |
| `snapEdges` | `string[] \| null` | 贴边方向，可同时多个（`left`/`right`/`top`/`bottom`） |
| `partitions` | array | 分区列表，`default` 分区不可删除 |
| `dockVisible` | boolean | Dock 是否显示，启动时据此恢复 |
| `floatAlwaysOnTop` | boolean | 浮窗与文件管理窗口是否置顶 |
| `dockAlwaysOnTop` | boolean | Dock 是否置顶（与浮窗独立） |
| `dockX` | number \| null | Dock 左边界 |
| `dockBottom` | number \| null | Dock 底边（用底边而非顶边做锚点，因为 Dock 高度随内容变化） |
| `hideSystemTaskbar` | boolean | 是否隐藏 Windows 任务栏 |
| `dockSettings` | object | Dock 外观设置，见上方结构 |
| `navItems` | array | Dock 图标项；`type: 'system'` 用内置动作，`type: 'application'` 用 `path` 启动 |

### 缓存键设计

图标缓存键在主进程与渲染进程各有一份实现，**两者必须严格一致**，否则 `icon-updated` 通知与本地缓存对不上：

| 文件类型 | 缓存键 |
|---------|--------|
| `.lnk` / `.url` | 完整路径小写（每个快捷方式独立图标） |
| 其它文件 | 带点的扩展名小写，如 `.docx`；无扩展名则为 `file` |

- 主进程：`src/main/ipc/icons.js` 的 `getIconCacheKey(filePath)`
- 渲染进程：`renderer/scripts/file-manager.js` 的 `getIconCacheKeyByName(name, filePath)`
- 磁盘上的 `icon-cache.json` 也使用同一格式，因此升级后旧缓存仍然兼容

### 自定义窗口大小

修改 `src/main/windows.js`：

```javascript
// 浮窗大小（createFloatWindow）
const size = 160;

// 文件管理窗口大小（createFileManagerWindow）
const fmWidth = 900;
const fmHeight = 600;

// 设置窗口大小（createSettingsWindow）
const w = 440;
const h = 560;

// Dock 初始大小（createDockWindow）；最小尺寸约束在 ipc/window.js 的 resize-dock-window
const dockWidth = 800;
const dockHeight = 200;
```

### 自定义 Dock 最小可见图标数

`renderer/scripts/dock.js` 顶部的 `MIN_VISIBLE_ITEMS = 8`，它同时是 `autoFitDockWindow()` 的下限和设置页「显示图标数量」滑块的基准。

### 自定义主题颜色

- 浮窗与文件管理窗口的主色写在各样式表里（`renderer/styles/float.css`、`file-manager.css`），典型值为 `#667eea` → `#764ba2` 渐变
- Dock 的主题色由设置里的 `bgColor` / `customColor` 驱动，通过 CSS 变量 `--dock-bg`、`--dock-custom-color` 生效，可在 `renderer/styles/dock.css` 中调整默认值

### 自定义图标缓存上限

修改 `src/main/services/icon-cache.js` 的 `saveIconCache()`：

```javascript
if (totalSize + entrySize > 5 * 1024 * 1024) break;  // 默认 5 MB
```

### 自定义图标并发数

修改 `renderer/scripts/file-manager.js` 的 `processIconQueue()` 中「每批 3 个」的上限常量与批间隔（50ms）。这是全项目唯一的图标并发闸门，主进程侧不再做并发限制。

### 自定义启动时编译音量组件的行为

音量控制通过运行时编译一个 C# dll 实现（见 `src/main/ipc/system.js` 的 `compileAudioDllAsync`）。为避免杀毒软件对「运行时编译代码」的启发式拦截，编译已改为**首次使用音量功能时按需触发**，不在启动时执行。若需改回启动预编译，可在 `src/main/index.js` 的 `whenReady` 中调用 `compileAudioDllAsync()`（该函数已被 `system.js` 导出）。

---

## 9. 打包与部署

### 构建命令

```powershell
# 打包为 portable 单文件 exe（默认 target）
npm run build
# 或显式指定
npm run build:portable

# 打包为 NSIS 安装包
npm run build:nsis
```

### 输出位置

```
dist-new/
├── win-unpacked/
│   └── 浮窗文件管理器.exe          # 免安装可执行文件
├── 浮窗文件管理器-1.1.0.exe        # portable 单文件
└── latest.yml                      # 更新元数据
```

### 打包配置（`package.json` 的 `build` 字段）

```json
{
  "appId": "com.floating.filemanager",
  "productName": "浮窗文件管理器",
  "directories": { "output": "dist-new" },
  "files": ["main.js", "preload.js", "src/**/*", "renderer/**/*", "package.json"],
  "electronDownload": { "mirror": "https://npmmirror.com/mirrors/electron/" },
  "win": {
    "icon": "icon.png",
    "target": [{ "target": "portable", "arch": ["x64"] }],
    "artifactName": "${productName}-${version}.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "shortcutName": "浮窗文件管理器"
  }
}
```

要点：

- `files` 只打包 `main.js`、`preload.js`、`src/`、`renderer/`、`package.json`，**`docs/` 不进入产物**
- `electronDownload.mirror` 已指向 npmmirror，国内网络无需再设 `ELECTRON_MIRROR` 环境变量
- 修改版本号只需改 `package.json` 的 `version`，产物名会自动跟随

### 运行要求

- Windows 10 或更高版本（x64）
- 无需安装 Node.js 或 Electron
- 首次运行会在 `%APPDATA%\floating-file-manager\` 创建配置目录
- 部分功能（隐藏任务栏、桌面图标开关、电源操作、音量、WiFi 连接）依赖 PowerShell 与系统组件，可能需要管理员权限或在受管设备上被策略限制

---

## 10. 二次开发指南

### 添加一个新功能（四步，对应新模块结构）

**第 1 步：在 `preload.js` 暴露 API**

```javascript
// preload.js
newFeature: (arg) => ipcRenderer.invoke('new-feature', arg),
```

**第 2 步：在对应的 `src/main/ipc/*.js` 里注册处理函数**

按功能归属选择文件（文件操作放 `files.js`、窗口相关放 `window.js`、系统能力放 `system.js`、配置相关放 `config.js`），并在该模块的 `register({...})` 参数里声明所需依赖：

```javascript
// src/main/ipc/files.js（示例）
function register({ loadConfig, getFileManagerWindow }) {
  ipcMain.handle('new-feature', async (event, arg) => {
    // 功能实现
    return { success: true };
  });
}
```

如果新建了一个 IPC 模块，记得在 `src/main/index.js` 中 `require` 并按同样风格调用它的 `register(...)`。

**第 3 步：在渲染层调用**

```javascript
// renderer/scripts/float.js
const result = await window.electronAPI.newFeature('参数');
```

**第 4 步：如需界面元素**

在对应的 HTML（`renderer/float.html`、`file-manager.html`、`dock.html`、`settings.html`）中加元素，样式加到同名 CSS，事件绑定加到同名 `scripts/*.js`。

> 注意：所有渲染页面共用同一个 `preload.js`，因此任一页面都能调用全部通道；新增 API 时请自行确认调用方窗口是否合理。新增通道后，`preload.js` 的暴露数量应与主进程注册数量保持一一对应。

### 添加一个 Dock 系统图标

1. 在 `src/main/ipc/system.js` 的 `getDefaultNavItems()` 中加入一项，`type: 'system'`、指定 `icon` 与 `action`
2. 在 `renderer/scripts/dock.js` 的 `NAV_ICONS` 中为该 `icon` 名添加 SVG
3. 若 `action` 是新动作，在 `system.js` 的 `system-action` 通道里加一个 `case`
4. 设置页的图标列表也需要对应 SVG，请在 `renderer/scripts/settings.js` 的 `SYSTEM_ICON_SVG` 中同步一份

### 修改图标提取方案

核心函数：`resolveFileIcon()`，位于 `src/main/services/icon-extractor.js`。它内部依次尝试「快捷方式解析 → PowerShell + Shell API → Electron `app.getFileIcon`」，替换其中任一步即可（例如接入第三方图标库）。

调用链为：渲染层 `getFileIcon` → `src/main/ipc/icons.js` 的 `get-file-icon` 通道 → `resolveFileIcon()`。若要改变返回格式，注意同时更新渲染层的 `getIconCacheKeyByName()` 与缓存键约定。

### 添加新的文件类型图标

在 `renderer/scripts/file-manager.js` 的 `getFileIcon(name, isDirectory, targetIsDirectory)` 中添加分支：

```javascript
if (ext === 'newext') {
  return `<div class="file-icon newtype">...</div>`;
}
```

相应的 `.file-icon.newtype` 样式加到 `renderer/styles/file-manager.css`。

### 新增一个设置项

1. `renderer/settings.html` 加控件，`renderer/styles/settings.css` 加样式
2. `renderer/scripts/settings.js` 的 `currentSettings` 默认值、`loadSettings()`、`buildDockStyle()`、`saveSettings()` 四处同步加字段，并绑定事件
3. 若该设置影响 Dock 外观：在 `renderer/scripts/dock.js` 的 `applyDockStyle(settings)` 中读取并应用（写 CSS 变量或切类）；纯 CSS 的消费点写在 `renderer/styles/dock.css`
4. 持久化无需改主进程——`save-dock-settings` 通道按 `{...旧值, ...新值}` 合并写入 `config.json` 的 `dockSettings`

### 添加一个新的分区/路径操作

- 主进程：`src/main/ipc/config.js` 加 `ipcMain.handle`，操作后调用 `saveConfig(config)`
- 渲染层：`preload.js` 暴露 → `renderer/scripts/file-manager.js` 的 `renderPartitions()` / `handleContextMenuAction()` 中调用并 `loadPartitions()` 刷新
- 右键菜单项直接写在 `renderer/file-manager.html` 的 `#partitionContextMenu` / `#pathContextMenu` 中，用 `data-action` 区分

### 集成云存储

1. 添加云存储 SDK 依赖
2. 在 `src/main/ipc/files.js` 中新增 IPC 通道（或扩展 `upload-file`）
3. 渲染层在 `uploadFile` / `uploadFolder` 调用处增加目标类型分支

### 清理已废弃的 icon-helper 三件套

若确认不再需要，可删除以下文件（当前已不被任何窗口加载，删除不影响任何功能）：

- `renderer/icon-helper.html`
- `renderer/icon-helper-preload.js`
- `renderer/scripts/icon-helper.js`

---

## 附录：常见问题

### Q：如何修改浮窗默认位置？

修改 `src/main/config.js` 的 `loadConfig()` 默认返回值：

```javascript
floatPosition: { x: 200, y: 200 }  // 修改坐标
```

注意窗口创建时（`src/main/windows.js` 的 `createFloatWindow`）还会按工作区做一次「至少保留 45px 可见」的收敛，所以极端坐标会被自动纠正。

### Q：如何禁用自动置顶？

浮窗/文件管理窗口的置顶由配置项 `floatAlwaysOnTop` 控制（运行时也可通过浮窗的「置顶」按钮或 `toggle-always-on-top` 通道切换）；Dock 的置顶由独立的 `dockAlwaysOnTop` 控制。若要在代码层面改默认值：

```javascript
// src/main/config.js → loadConfig() 的默认返回对象
floatAlwaysOnTop: false,
dockAlwaysOnTop: false,
```

### Q：为什么 Dock 位置存的是 `dockBottom` 而不是 `dockY`？

Dock 窗口高度会随图标数量、浮层（音量/WiFi）、右键菜单动态变化，顶边会随之上下浮动；底边才是稳定锚点。`migrateConfig()` 会自动删除历史遗留的 `dockY` 字段。

### Q：为什么设置里改了「图标大小」但预览和 Dock 不一致？

预览使用 `--preview-icon-size`（视觉上是实机的约 0.85 倍）以便在 440×560 的窗口里放下完整预览。实际 Dock 的图标尺寸由 `applyIconSizes()` 直接写内联宽高，并参与 `autoFitDockWindow()` 的窗口宽度计算。

### Q：如何添加系统托盘图标（`Tray`）？

当前 Dock 的托盘区是渲染进程绘制的伪托盘，并非 Electron 原生 `Tray`。如需原生托盘：

```javascript
// src/main/index.js 的 whenReady 中
const { Tray, nativeImage } = require('electron');
const tray = new Tray(nativeImage.createFromPath(path.join(rootDir, 'icon.png')));
tray.setToolTip('浮窗文件管理器');
```

### Q：如何支持多语言？

1. 新建语言文件，如 `src/main/i18n/zh-CN.json`
2. 在渲染进程按当前语言加载对应 JSON
3. 替换 HTML/JS 中硬编码的中文文本（目前为直接硬编码）

### Q：图标不显示或显示为默认图标怎么办？

按链路逐层排查：

1. **磁盘缓存**：删除项目根的 `icon-cache.json` 后重启，排除缓存了坏数据
2. **缓存键一致性**：确认 `renderer/scripts/file-manager.js` 的 `getIconCacheKeyByName()` 与 `src/main/ipc/icons.js` 的 `getIconCacheKey()` 规则一致（快捷方式用全路径小写、其余用带点扩展名小写）
3. **提取链路**：在 `resolveFileIcon()` 内排查，看是快捷方式解析失败、PowerShell 超时，还是 `app.getFileIcon` 返回空
4. **PowerShell 可用性**：确认系统 PowerShell 未被安全策略禁用（提取依赖它写入临时 PNG）
5. **并发与队列**：确认 `processIconQueue()` 未被异常中断（它负责全项目唯一的图标并发控制）
6. **日志**：主进程控制台会打印「获取文件图标失败」等中文错误信息

### Q：`icon-updated` 收到了但图标没更新？

检查缓存键是否对得上。该事件的载荷字段名虽然是 `filePath`，实际传的是缓存键（如 `.docx` 或快捷方式全路径小写）。渲染层必须用 `getIconCacheKeyByName(name, path)` 重新计算后再比对，直接用真实路径比较会永远不相等。

### Q：隐藏了系统任务栏但应用异常退出，任务栏不见了？

应用在 `will-quit` 时会调用 `src/main/index.js` 的 `restoreTaskbar()` 恢复任务栏。如果进程被强制杀死（任务管理器结束进程、断电），恢复逻辑不会执行，可以手动重启 explorer：

```powershell
Stop-Process -Name explorer -Force; Start-Process explorer
```

### Q：开发时配置写在项目里，会不会被误提交？

不会。`.gitignore` 已忽略 `.userdata/`、`icon-cache.json`、`dist-new/`、`uploads/`、`node_modules/`。

---

*文档对应版本：v1.1.0*
