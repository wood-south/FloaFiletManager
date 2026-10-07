# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-07-17

### Added

- **Dock 导航栏**：独立的 Dock 窗口，含电源/开始按钮、可滚动的快捷图标区、系统托盘区（音量、网络、电量、时钟、设置、关闭）
- **四种模糊材质**：玻璃 / 高斯 / 亚克力 / 自定义，参数可调并实时预览
- **音量浮层**：运行时用 `csc.exe` 将 C# 编译为临时 dll，再经 PowerShell 调用 Windows Core Audio API（首次使用时编译，避免启动卡顿与杀软误报）
- **网络状态**：有线 + 无线适配器状态、WiFi 列表扫描、连接与断开
- **电源菜单**：睡眠 / 休眠 / 重启 / 关机
- **设置窗口**：外观（模糊模式、圆角、图标大小与数量、主题色、实时预览）、常规（置顶、隐藏系统任务栏、Dock 位置）、图标管理（重置/显示已隐藏/删除）、关于
- **分区侧边栏**：文件管理窗口支持自定义分区与路径，可拖拽跨分区移动，右键菜单支持添加/重命名/删除
- **贴边隐藏与吸附**：浮窗拖到屏幕边缘自动收边，靠近 Dock 时吸附到 Dock 的真实可见边框并随其移动
- **点击穿透**：浮窗与 Dock 的透明区域允许鼠标穿透到桌面，仅在内容区捕获事件
- **电量与任务栏/桌面图标控制**：读取电量、隐藏系统任务栏、切换桌面图标显示
- **项目工程化**：新增 `.eslintrc.json`、`.prettierrc`、`jsconfig.json`、`LICENSE` 与 `docs/` 文档体系

### Changed

- **主进程模块化重构**：原先近 1500 行的单体 `main.js` 拆分到 `src/main/`（`index.js`、`config.js`、`windows.js`、`ipc/*`、`services/*`），根目录 `main.js` 变为一行入口
- **IPC 契约集中化**：`preload.js` 通过 `contextBridge` 统一暴露约 90 个 `electronAPI` 方法
- **文件管理界面**：新增侧边栏分区、上传下拉菜单、原生拖出（拖到桌面/资源管理器）、拖入上传与移动
- 浮窗由「圆形悬浮球」升级为「桌宠」形态（SVG 猫，含贴边/吸附朝向的旋转动画）
- 图标提取链路统一到 `get-file-icon` 通道，并加入 `icon-updated` 增量通知

### Fixed

- 修复图标提取兜底调用不存在的函数 `extractIconToDataUrl`，导致 PowerShell 提取路径始终失效的问题
- 修复设置窗口样式同步回调引用未定义变量、在收到 `opacity`/`blurIntensity` 时抛 `ReferenceError` 的问题
- 修复 `icon-updated` 事件从未发送、且渲染层缓存键双重转义导致永远匹配不上的问题（两进程缓存键现严格一致，并兼容磁盘上既有的 `icon-cache.json` 格式）
- 修复「已添加」成功提示因缺少 `success` 图标而显示为问号的问题

### Removed

- 移除已失效的「图标辅助隐藏窗口」子系统的调用链（`createIconHelperWindow` / `requestIconFromHelper` 等已无调用方）

### 未落地（计划中，勿视为已完成）

> 以下条目曾记于 1.1.0，但经 2026-XX 代码审查确认**在仓库中尚未落地**。
> 在此显式标注，避免文档领先于代码继续造成误导；完成后请移入对应版本条目并删除本节。

- [ ] **修复右键菜单危险色**：`renderer/file-manager.html` 的「删除分区 / 从分区移除」使用 `class="ctx-item danger"`，
      但 `renderer/styles/file-manager.css` 中没有 `.ctx-item.danger` 规则（危险色只定义在 `dock.css` 的
      `.dock-context-menu .ctx-item.danger`），因此这两项当前不会显示为红色。
- [ ] **移除图标辅助窗口子系统**：`renderer/icon-helper.html`、`renderer/icon-helper-preload.js`、
      `renderer/scripts/icon-helper.js` 当前仍为完整可用代码。
- [ ] **清理 `dock.css` 废弃样式**：`renderer/styles/dock.css:908-1133`（`.dock-settings-panel`、`.settings-overlay`、
      `.settings-slider*`、`.settings-item` 等）在设置窗口独立后已无任何使用方。
- [ ] **移除无消费者的 CSS 变量**：`renderer/dock.html:13` 的 `#acrylic-noise` 滤镜未被引用；
      `renderer/scripts/dock.js:1107-1108` 仍在写入 `--dock-icon-size` / `--dock-item-count`，但 `dock.css` 无读取方
      （图标尺寸实际由 `applyIconSizes()` 写内联样式实现）。

## [1.0.0] - 2024-07-15

### Added
- 桌面浮窗，可拖动的圆形悬浮球，始终置顶
- 文件管理窗口，支持列表/图标双视图
- 拖拽上传文件和文件夹
- 拖拽移动文件到文件夹
- 快捷方式 (.lnk / .url) 图标解析与显示
- 文件搜索功能
- 配置持久化（窗口位置、保存路径、历史路径）
- 单实例运行
- 图标缓存机制
- GPU 崩溃恢复机制
- 目录导航与返回
