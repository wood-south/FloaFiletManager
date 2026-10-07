/* 各模块的自检脚本集合。
   约定：每个脚本独立运行，失败时以非 0 退出码结束。 */
module.exports = [
  { name: 'IPC 安全防线 guard.js', file: 'guard.test.js' },
  { name: '主进程能力层契约 capabilities', file: 'ipc-contract.test.js' },
  { name: '配置结构 v1→v2 迁移 config-schema', file: 'config-migration.test.js' },
  { name: '多显示器选屏与钳制 display.js', file: 'display.test.js' },
  { name: '皮肤包仓库 skin-store.js', file: 'skin-store.test.js' },
  { name: '共用 UI 原语 primitives.js', file: 'primitives.test.js' },
  { name: '能力层契约 capabilities.js + quick-upload', file: 'capabilities.test.js' },
  { name: '点击穿透仲裁 penetration.js', file: 'penetration.test.js' },
  { name: '桌宠交互手势 interaction.js', file: 'interaction.test.js' },
  { name: '宠物视觉框测量与上报 anchor.js', file: 'anchor.test.js' },
  { name: '桌宠动画状态机 behavior.js', file: 'behavior.test.js' },
  { name: '皮肤包校验与合并 skin.js', file: 'skin.test.js' },
  { name: '浮窗吸附几何 snap.js', file: 'snap.test.js' },
  { name: '吸附与 Dock 移动契约 window.js', file: 'snap-contract.test.js' },
  { name: 'Dock 菜单扩展几何契约 dock.js', file: 'dock-geometry.test.js' },
  { name: 'PowerShell 输出编码契约 system.js', file: 'system-encoding.test.js' }
];
