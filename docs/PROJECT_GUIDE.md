# 项目文档 - 浮窗文件管理器 v1.0.0

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

---

## 1. 项目概述

### 项目定位

浮窗文件管理器是一款 Windows 桌面辅助工具，通过始终置顶的悬浮窗口提供便捷的文件管理功能。

### 核心价值

- **快速访问**：无需切换窗口，随时拖拽上传文件
- **高效管理**：直观的文件列表，支持搜索和导航
- **轻量级**：占用资源少，不影响其他应用运行

### 技术选型

| 选择 | 原因 |
|-----|------|
| Electron | 跨平台、生态丰富、开发效率高 |
| 原生 HTML/CSS/JS | 无框架依赖、代码简洁、易于定制 |
| PowerShell + Windows API | 可靠的图标提取方案 |

---

## 2. 功能特性

### 浮窗功能

| 操作 | 功能 |
|-----|------|
| 单击浮窗 | 显示/隐藏功能按钮环 |
| 双击浮窗 | 打开文件管理窗口 |
| 右键浮窗 | 显示退出按钮 |
| 拖动浮窗 | 移动位置，自动保存 |
| 拖拽文件到浮窗 | 快速上传到默认目录 |

### 功能按钮

| 按钮 | 功能 |
|-----|------|
| 📂 打开 | 打开文件管理窗口 |
| ⚙️ 设置 | 打开设置窗口 |
| 🔝 置顶 | 切换窗口置顶状态 |
| ❌ 退出 | 关闭应用 |

### 文件管理窗口

- **列表视图**：显示文件名、大小、修改时间
- **图标视图**：大图标网格布局
- **搜索功能**：实时过滤文件名
- **目录导航**：进入子目录、返回上级、打开目录位置
- **文件操作**：双击打开、右键菜单（打开、打开位置、删除）
- **上传功能**：点击按钮选择文件/文件夹上传，或拖拽文件上传

### 设置窗口

- 修改默认保存路径
- 查看历史路径记录
- 快速切换常用目录

---

## 3. 技术架构

### 进程模型

```
┌─────────────────────────────────────────────────────────────┐
│                      主进程 (main.js)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  - 窗口管理（浮窗、文件管理、设置）                        │ │
│  │  - 文件系统操作（读取、写入、复制、删除）                  │ │
│  │  - 图标提取（PowerShell + Windows API）                  │ │
│  │  - 配置管理（读取、保存）                                 │ │
│  │  - IPC 处理                                              │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (进程间通信)
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   浮窗进程     │  │ 文件管理进程   │  │   设置进程     │
│ (float.html)  │  │(file-manager) │  │(settings.html)│
│               │  │               │  │               │
│  - 拖动逻辑   │  │  - 文件列表   │  │  - 路径设置   │
│  - 菜单显示   │  │  - 图标加载   │  │  - 历史管理   │
│  - 单击/双击  │  │  - 搜索过滤   │  │               │
└───────────────┘  └───────────────┘  └───────────────┘
```

### 文件结构

```
浮窗文件管理1.0.0/
│
├── main.js                    # 主进程：核心逻辑
├── preload.js                 # 预加载脚本：IPC桥接
├── package.json               # 项目配置
├── icon-cache.json            # 图标缓存（运行时生成）
│
├── renderer/                  # 渲染进程
│   ├── float.html             # 浮窗页面
│   ├── file-manager.html      # 文件管理页面
│   ├── settings.html          # 设置页面
│   │
│   ├── styles/                # 样式文件
│   │   ├── float.css          # 浮窗样式
│   │   ├── file-manager.css   # 文件管理样式
│   │   └── settings.css       # 设置样式
│   │
│   └── scripts/               # 脚本文件
│       ├── float.js           # 浮窗交互逻辑
│       ├── file-manager.js    # 文件管理逻辑
│       └── settings.js        # 设置逻辑
│
├── docs/                      # 文档
│   ├── TECHNICAL_GUIDE.md     # 技术文档
│   ├── PROJECT_GUIDE.md       # 项目文档（本文档）
│   └── TROUBLESHOOTING.md     # 问题解决文档
│
└── .userdata/                 # 开发环境数据目录
    └── config.json            # 配置文件
```

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
# 开发环境
npx electron .

# 禁用GPU（遇到问题时）
npx electron . --disable-gpu
```

### 目录配置

开发环境自动将数据目录设置为 `.userdata/`，避免沙箱权限问题：

```javascript
// main.js
const isDev = !app.isPackaged;
if (isDev) {
  app.setPath('userData', path.join(__dirname, '.userdata'));
}
```

---

## 5. 核心模块说明

### 主进程模块

#### 窗口管理

```javascript
// 浮窗：160x160，透明，始终置顶
function createFloatWindow() {
  floatWindow = new BrowserWindow({
    width: 160,
    height: 160,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true
  });
}

// 文件管理窗口：900x600
function createFileManagerWindow() { ... }

// 设置窗口：400x400
function createSettingsWindow() { ... }
```

#### 文件操作

```javascript
// 列出目录文件
ipcMain.handle('list-files', async (event, dirPath) => {
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  return { success: true, files };
});

// 上传文件
ipcMain.handle('upload-file', async (event, { sourcePath, fileName }) => {
  fs.copyFileSync(sourcePath, destPath);
  return { success: true };
});

// 删除文件（到回收站）
ipcMain.handle('delete-file', async (event, filePath) => {
  shell.trashItem(filePath);
  return { success: true };
});
```

#### 图标提取

```javascript
// 核心函数：获取文件图标
async function resolveFileIcon(filePath) {
  // 1. 解析快捷方式目标
  // 2. 优先 PowerShell + Windows API
  // 3. 回退 Electron API
}
```

### 渲染进程模块

#### 浮窗交互 (`float.js`)

```javascript
// 拖动实现
document.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', doDrag);
document.addEventListener('mouseup', endDrag);

// 单击/双击区分
floatBall.addEventListener('click', (e) => {
  if (isDoubleClick) {
    openFileManager();
  } else {
    toggleMenu();
  }
});
```

#### 文件列表 (`file-manager.js`)

```javascript
// 渲染文件列表
function renderFiles(files) {
  files.forEach(file => {
    // 创建列表项
    // 加载图标（批量异步）
    // 绑定事件
  });
}

// 图标批量加载
function processIconQueue() {
  // 每批3个，间隔50ms
}
```

---

## 6. 数据流程

### 文件上传流程

```
用户拖拽文件
     │
     ▼
渲染进程：阻止默认行为，获取文件路径
     │
     ▼
IPC调用：window.electronAPI.uploadFile({ sourcePath, fileName })
     │
     ▼
主进程：检查目标路径是否存在
     │
     ├─ 存在 → 返回 { duplicate: true }
     │
     └─ 不存在 → fs.copyFileSync() → 返回 { success: true }
     │
     ▼
渲染进程：刷新文件列表
```

### 图标加载流程

```
渲染文件列表
     │
     ▼
遍历文件项 → 加入图标加载队列
     │
     ▼
批量处理（每批3个）
     │
     ▼
IPC调用：window.electronAPI.getFileIcon(filePath)
     │
     ▼
主进程：
  1. 检查缓存 → 命中则返回
  2. 解析快捷方式目标
  3. PowerShell + SHGetFileInfo 提取图标
  4. 回退 Electron API
  5. 存入缓存
     │
     ▼
渲染进程：更新图标显示
```

### 配置保存流程

```
用户修改设置
     │
     ▼
IPC调用：window.electronAPI.setSavePath(newPath)
     │
     ▼
主进程：
  1. 更新配置对象
  2. 更新历史路径列表
  3. saveConfig() 写入文件
     │
     ├─ 尝试直接写入（最多3次）
     │
     └─ 失败则原子替换（临时文件 + rename）
     │
     ▼
返回 { success: true }
```

---

## 7. 界面交互

### 浮窗交互

```
┌─────────────────────────────────────────────┐
│                   浮窗                        │
│                                              │
│    ┌──────────────────────────────────┐     │
│    │         悬浮球 (160x160)          │     │
│    │                                  │     │
│    │     单击 → 显示按钮环             │     │
│    │     双击 → 打开文件管理           │     │
│    │     右键 → 显示退出按钮           │     │
│    │     拖动 → 移动窗口               │     │
│    │     拖拽文件 → 上传               │     │
│    └──────────────────────────────────┘     │
│                                              │
│         ┌──┐ ┌──┐ ┌──┐ ┌──┐                │
│         │📂│ │⚙️│ │🔝│ │❌│                │
│         └──┘ └──┘ └──┘ └──┘                │
│         功能按钮环（单击后显示）              │
└─────────────────────────────────────────────┘
```

### 文件管理窗口

```
┌─────────────────────────────────────────────────────────────┐
│  📂 文件管理器                                     [×]      │
├─────────────────────────────────────────────────────────────┤
│  [⬅返回]  [📤上传]  路径: D:\FloatUploads    [🔍搜索框]    │
│  [列表视图] [图标视图]                          [打开目录]   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────┐ 文件名.docx                                       │
│  │ 📄 │  123 KB  ·  2小时前                    [📍][▶][🗑️] │
│  └──────┘                                                   │
│  ┌──────┐ 文件夹                                            │
│  │ 📁 │  文件夹  ·  昨天                      [📍]         │
│  └──────┘                                                   │
│  ...                                                        │
├─────────────────────────────────────────────────────────────┤
│  5 个文件夹，23 个文件                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 配置与自定义

### 配置文件结构

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

### 自定义窗口大小

修改 `main.js`：

```javascript
// 浮窗大小
const size = 160;  // 修改为其他值

// 文件管理窗口大小
const fmWidth = 900;
const fmHeight = 600;

// 设置窗口大小
const sw = 400;
const sh = 400;
```

### 自定义主题颜色

修改 `renderer/styles/float.css`：

```css
/* 主色调 */
--primary-color: #667eea;
--primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

/* 浮窗背景 */
float-ball {
  background: rgba(255, 255, 255, 0.95);
}
```

### 自定义图标缓存大小

修改 `main.js`：

```javascript
function saveIconCache() {
  // 修改缓存上限（默认5MB）
  if (totalSize + entrySize > 5 * 1024 * 1024) break;
}
```

---

## 9. 打包与部署

### 构建命令

```powershell
# 设置镜像（加速下载）
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

# 打包
npm run build
```

### 输出位置

```
dist-new/
├── win-unpacked/
│   └── 浮窗文件管理器.exe    # 可执行文件
│
└── 浮窗文件管理器-1.0.0.exe  # 安装包
```

### 打包配置 (`package.json`)

```json
{
  "build": {
    "appId": "com.floating-file-manager",
    "productName": "浮窗文件管理器",
    "directories": {
      "output": "dist-new"
    },
    "win": {
      "target": "portable"
    }
  }
}
```

### 运行要求

- Windows 10 或更高版本
- 无需安装 Node.js（已打包）
- 首次运行会创建 `%APPDATA%/floating-file-manager/` 目录

---

## 10. 二次开发指南

### 添加新功能按钮

1. 在 `renderer/float.html` 添加按钮元素
2. 在 `renderer/scripts/float.js` 添加点击事件
3. 在 `preload.js` 暴露新API
4. 在 `main.js` 添加IPC处理

示例：

```javascript
// float.html
<button id="newFeatureBtn">新功能</button>

// float.js
newFeatureBtn.addEventListener('click', () => {
  window.electronAPI.newFeature();
});

// preload.js
newFeature: () => ipcRenderer.invoke('new-feature'),

// main.js
ipcMain.handle('new-feature', async () => {
  // 功能实现
});
```

### 修改图标提取方案

核心函数位置：`main.js` L1223-L1288

```javascript
async function resolveFileIcon(filePath) {
  // 修改提取逻辑
  // 例如：使用第三方图标库
}
```

### 添加新的文件类型支持

在 `renderer/scripts/file-manager.js` 的 `getFileIcon()` 函数中添加：

```javascript
if (ext === 'newext') {
  return `<div class="file-icon newtype">...</div>`;
}
```

### 集成云存储

1. 添加云存储SDK依赖
2. 创建新的IPC通道处理上传
3. 修改 `upload-file` 逻辑

---

## 附录：常见问题

### Q: 如何修改浮窗默认位置？

修改 `main.js` 的 `loadConfig()` 默认值：

```javascript
return {
  floatPosition: { x: 200, y: 200 }  // 修改坐标
};
```

### Q: 如何禁用自动置顶？

修改 `main.js` 的窗口创建：

```javascript
floatWindow = new BrowserWindow({
  alwaysOnTop: false,  // 改为 false
});
```

### Q: 如何添加系统托盘图标？

```javascript
const { Tray, nativeImage } = require('electron');

const tray = new Tray(nativeImage.createFromPath('icon.png'));
tray.setToolTip('浮窗文件管理器');
```

### Q: 如何支持多语言？

1. 创建语言文件 `locales/zh-CN.json`
2. 在渲染进程加载语言包
3. 替换所有硬编码文本

---

*文档生成时间: 2026-07-14*