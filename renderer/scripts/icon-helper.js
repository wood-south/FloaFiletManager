// 【已废弃】图标辅助窗口的渲染脚本，不再被任何页面加载。
//
// 1.0.0 时期存在「隐藏辅助窗口」第二条图标提取实现，涉及：
//   renderer/icon-helper.html、renderer/icon-helper-preload.js、本文件，
//   以及主进程通道 helper-get-file-icon / helper-native-get-file-icon /
//   helper-return-file-icon 与 windows.js 的 createIconHelperWindow()。
//
// 该子系统在 1.1.0 之后被整体移除，原因：
//   1) 与主链路（src/main/ipc/icons.js 的 'get-file-icon' → services/icon-extractor.js
//      的 resolveFileIcon）功能重复，且没有缓存与增量通知；
//   2) icon-helper.html 的内联脚本被该页面自身的 CSP（script-src 'self'）静默拦截，
//      因此这条链路从未真正跑通过；
//   3) 全仓库没有任何调用方。
//
// 原先此处的转发代码引用 onGetFileIcon / getFileIconNative / returnFileIcon，
// 这三个方法已从 preload.js 中删除，保留会导致误用，故一并清除。
//
// 图标提取请统一使用：window.electronAPI.getFileIcon(filePath, isDirectory)。
// 本文件（含同名的 icon-helper.html 与 icon-helper-preload.js）可以安全删除。
