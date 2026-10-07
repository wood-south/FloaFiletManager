<h1 align="center">浮窗文件管理器</h1>
<p align="center">Floating File Manager — 基于 Electron 的 Windows 桌面浮窗文件管理工具</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="platform">
  <img src="https://img.shields.io/badge/electron-28.x-9feaf9" alt="electron">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/version-1.1.0-orange" alt="version">
</p>

---

## 简介

浮窗文件管理器是一款轻量级的 Windows 桌面辅助工具：以始终置顶的**桌宠浮窗**作为快速入口，配合**文件管理窗口**、**Dock 导航栏**与**设置窗口**，提供拖拽上传、文件浏览、实时搜索，并完整兼容 `.lnk` / `.url` 快捷方式的图标显示与启动。

## 功能特性

### 浮窗（桌宠）

- **桌面浮窗** — 可拖动的桌宠，始终置顶，不占任务栏空间
- **点击穿透** — 透明区域鼠标直接穿透到桌面，只有桌宠与菜单可交互
- **贴边隐藏** — 拖到屏幕边缘自动收边，鼠标移入再弹出
- **吸附 Dock** — 靠近 Dock 时自动贴到其真实可见边框，并随 Dock 一起移动
- **拖拽上传** — 把文件/文件夹拖到浮窗即复制到目标目录；开启回收站模式后改为删除
- **单击/双击/右键** — 单击展开功能环、双击打开文件管理、右键显示退出

### 文件管理

- **双视图** — 列表 / 图标网格，显示名称、大小、修改时间
- **分区侧边栏** — 自定义分区与路径（可拖拽跨分区移动、右键菜单增删改）
- **上传与移动** — 按钮选择或直接拖入；重名时可选择覆盖
- **搜索 / 导航** — 递归搜索，进入子目录、返回上级、打开所在位置
- **安全删除** — 删除走系统回收站（`shell.trashItem`）

### Dock 导航栏

- **快捷图标区** — 拖拽应用/文件到 Dock 即添加，支持横向滚动与隐藏/删除
- **四种模糊材质** — 玻璃 / 高斯 / 亚克力 / 自定义，参数可调
- **系统托盘区** — 音量、网络（有线+无线）、电量、时钟、设置、关闭
- **系统动作** — 开始菜单、任务视图、终端、资源管理器、电源（睡眠/休眠/重启/关机）

### 其他

- **快捷方式支持** — 完整解析 `.lnk` / `.url`，显示程序原始图标
- **单实例运行** — 防止重复启动，再次启动自动聚焦已有窗口
- **崩溃自愈** — GPU / 渲染进程连续崩溃时自动带 `--disable-gpu` 重启
- **配置持久化** — 窗口位置、贴边状态、分区、Dock 外观与位置全部记忆

## 界面交互

| 操作 | 效果 |
| --- | --- |
| 单击浮窗 | 显示/隐藏功能按钮环 |
| 双击浮窗 | 打开文件管理窗口 |
| 右键浮窗 | 显示退出按钮 |
| 拖动浮窗 | 移动位置（自动保存） |
| 拖拽文件到浮窗 | 上传到默认保存目录 |

## 快速开始

### 环境要求

- Windows 10/11
- Node.js ≥ 18

### 安装与运行

```bash
# 克隆项目
git clone <your-repo-url>
cd 浮窗文件管理1.0.0

# 安装依赖
npm install

# 启动开发
npx electron .
```

### 打包构建

```bash
# 生成便携版 exe
npm run build
```

输出文件位于 `dist-new/` 目录。

## 项目结构

```
├── main.js                 # 主进程入口（仅 require src/main/index.js）
├── preload.js              # 预加载脚本（contextBridge 暴露 electronAPI）
├── package.json            # 项目配置与打包配置
├── src/main/               # 主进程源码
│   ├── index.js            # 启动流程、单实例锁、崩溃自愈、装配 IPC
│   ├── config.js           # 配置读写、迁移、原子替换
│   ├── windows.js          # 各类窗口的创建与状态
│   ├── ipc/                # 按功能域拆分的 IPC 处理器
│   │   ├── config.js       #   分区与路径
│   │   ├── files.js        #   文件列表/上传/移动/删除
│   │   ├── icons.js        #   图标获取与缓存
│   │   ├── window.js       #   窗口移动、贴边、Dock 尺寸
│   │   ├── dialog.js       #   目录选择、打开文件
│   │   └── system.js       #   系统动作、音量、网络、电源
│   └── services/           # 图标提取与缓存
├── renderer/               # 渲染进程
│   ├── float.html          # 浮窗（桌宠）页面
│   ├── file-manager.html   # 文件管理页面
│   ├── dock.html           # Dock 栏页面
│   ├── settings.html       # 设置页面
│   ├── styles/             # 样式
│   └── scripts/            # 脚本
├── docs/                   # 文档
│   ├── TECHNICAL_GUIDE.md  # 技术文档
│   ├── PROJECT_GUIDE.md    # 项目指南
│   └── PROBLEM_SOLUTIONS.md# 问题解决方案
├── .userdata/              # 开发环境数据（gitignore）
└── dist-new/               # 打包输出（gitignore）
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Electron 28 |
| 前端 | 原生 HTML / CSS / JavaScript |
| 图标提取 | PowerShell + Windows Shell API |
| 缓存 | JSON 文件持久化 |
| 构建 | electron-builder |
| 代码规范 | ESLint + Prettier |

## 核心机制

### 图标提取

采用 PowerShell 调用 Windows 原生 `SHGetFileInfo` API 提取文件图标，不依赖 Electron GPU 渲染，确保在禁用硬件加速时也能稳定工作。回退链为：快捷方式/`.url` 解析 → PowerShell 提取 → Electron `app.getFileIcon`。图标首次提取后缓存至 `icon-cache.json`（上限 5 MB），并在提取完成后通过 `icon-updated` 通知渲染进程增量更新，避免整批重取。

### 窗口拖动

透明无边框窗口中 `-webkit-app-region` 不可靠，改用原生 JavaScript 监听鼠标事件 + IPC 通信实现拖动。

### 点击穿透

浮窗与 Dock 都是「透明大窗口」，默认让鼠标穿透到桌面，仅在鼠标进入可见内容区时通过 `setIgnoreMouseEvents(false)` 捕获事件——这是它们能当桌面组件使用的关键。

### 配置管理

支持重试写入与原子替换，避免高频操作导致的文件锁定（EPERM）错误。开发环境（未打包）下 `userData` 会重定向到项目内的 `.userdata/`，避免沙箱权限问题。

## 开发

```bash
npm install     # 安装依赖
npm start       # 启动
npm run lint    # 代码检查
npm run build   # 打包为便携版 exe（输出到 dist-new/）
```

## 文档

- [技术文档](docs/TECHNICAL_GUIDE.md) — 架构、模块划分、IPC 通道、存储路径说明
- [项目指南](docs/PROJECT_GUIDE.md) — 架构介绍、二次开发、自定义配置
- [问题解决方案](docs/PROBLEM_SOLUTIONS.md) — 常见问题记录与排查流程

## 许可证

[MIT](LICENSE)
