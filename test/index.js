/* 各模块的自检脚本集合。
   约定：每个脚本独立运行，失败时以非 0 退出码结束。 */
module.exports = [
  { name: 'IPC 安全防线 guard.js', file: 'guard.test.js' },
  { name: '共用 UI 原语 primitives.js', file: 'primitives.test.js' },
  { name: 'Dock 菜单扩展几何契约 dock.js', file: 'dock-geometry.test.js' },
  { name: 'PowerShell 输出编码契约 system.js', file: 'system-encoding.test.js' }
];
