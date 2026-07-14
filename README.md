<h1 align="center">浮窗文件管理器</h1>
<p align="center">Floating File Manager — 基于 Electron 的 Windows 桌面浮窗文件管理工具</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="platform">
  <img src="https://img.shields.io/badge/electron-36.x-9feaf9" alt="electron">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
</p>

---

## 简介

浮窗文件管理器是一款轻量级的 Windows 桌面辅助工具，通过始终置顶的悬浮球提供快速文件管理入口。支持拖拽上传、文件浏览、实时搜索，并完美兼容 `.lnk` 和 `.url` 快捷方式的图标显示与启动。

## 功能特性

- **桌面浮窗** — 可拖动的圆形悬浮球，始终置顶，不占任务栏空间
- **拖拽上传** — 将文件/文件夹拖拽到浮窗即可快速复制到目标目录
- **文件管理** — 列表/图标双视图，支持目录导航、文件搜索、删除、打开
- **快捷方式支持** — 完整解析 `.lnk` / `.url` 文件，显示程序原始图标
- **单实例运行** — 防止重复启动，再次点击自动聚焦已有窗口
- **配置持久化** — 窗口位置、保存路径、历史路径自动记忆

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
├── main.js                 # 主进程
├── preload.js              # 预加载脚本（IPC 桥接）
├── package.json            # 项目配置
├── renderer/               # 渲染进程
│   ├── float.html          # 浮窗页面
│   ├── file-manager.html   # 文件管理页面
│   ├── settings.html       # 设置页面
│   ├── styles/             # 样式
│   └── scripts/            # 脚本
├── docs/                   # 文档
│   ├── TECHNICAL_GUIDE.md  # 技术文档
│   ├── PROJECT_GUIDE.md    # 项目指南
│   └── PROBLEM_SOLUTIONS.md# 问题解决方案
├── .userdata/              # 开发环境数据
└── dist-new/               # 打包输出
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Electron 36 |
| 前端 | 原生 HTML / CSS / JavaScript |
| 图标提取 | PowerShell + Windows Shell API |
| 缓存 | JSON 文件持久化 |
| 构建 | electron-builder |

## 核心机制

### 图标提取

采用 PowerShell 调用 Windows 原生 `SHGetFileInfo` API 提取文件图标，不依赖 Electron GPU 渲染，确保在禁用硬件加速时也能稳定工作。图标首次提取后缓存至 `icon-cache.json`，后续启动直接读取。

### 窗口拖动

透明无边框窗口中 `-webkit-app-region` 不可靠，改用原生 JavaScript 监听鼠标事件 + IPC 通信实现拖动。

### 配置管理

支持重试写入与原子替换，避免高频操作导致的文件锁定（EPERM）错误。

## 文档

- [技术文档](docs/TECHNICAL_GUIDE.md) — API 速查、代码位置、存储路径说明
- [项目指南](docs/PROJECT_GUIDE.md) — 架构介绍、二次开发、自定义配置
- [问题解决方案](docs/PROBLEM_SOLUTIONS.md) — 常见问题记录与排查流程

## 许可证

[MIT](LICENSE)
