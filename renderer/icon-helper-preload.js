// 【已废弃】图标辅助窗口的 preload，不再被任何窗口加载。
//
// 图标提取链路已统一到主进程 src/main/ipc/icons.js 的 'get-file-icon' 通道
// （resolveFileIcon：快捷方式/.url 解析 → PowerShell + SHGetFileInfo →
// Electron app.getFileIcon），带图标缓存与 'icon-updated' 增量通知。
// 原先的隐藏辅助窗口（helper-get-file-icon / helper-native-get-file-icon /
// helper-return-file-icon）是一套重复且无缓存的实现，且没有任何调用方。
//
// 保留空文件仅为避免删除操作（受工作区目录权限限制）。
// 可以安全删除，不会影响任何功能。
