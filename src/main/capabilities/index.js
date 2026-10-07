/* ============================================================
   主进程能力层（阶段 5）
   ------------------------------------------------------------
   把「主进程注册了哪些 IPC」从"写死在 index.js 里"变成**可声明、可开关**。

   为什么需要这一层：
   - 现状：index.js 里六个 `require` + 六个 `register()` 硬编码，无法关闭任何一个；
     关闭某个功能只能注释代码。
   - 目标（ROADMAP 阶段 5 检测项）：关闭某能力后其 IPC 通道**不再注册**，
     菜单按钮不再出现，设置页签不再渲染。

   本阶段的落地方式（有意保守）：
   - 六个能力仍复用现有的 `src/main/ipc/*.js` 实现 —— 它们本就按域拆分，
     本阶段**不搬迁文件**，只在其上建立「能力 = 声明 + 开关」这层；
     大规模搬迁会在同一次提交里叠加两类风险（见 ROADMAP 阶段 5 说明）。
   - 每个能力用 `channels` 声明自己负责的通道名。
     `test/ipc-contract.test.js` 会断言「声明的通道集合」与
     「真实模块注册的通道集合」**完全一致**，因此声明不会悄悄过期。
   - `defaultEnabled: false` 表示默认不加载（目前没有这样的能力；
     字段先立起来，供后续按需扩展）。

   `channels` 的另一个用途：`preload.js` 的 91 个方法与主进程 91 个处理器
   必须一一对应，本文件是这条契约在主进程侧的单一事实来源。
   ============================================================ */

'use strict';

const ipcConfig = require('../ipc/config');
const ipcFiles = require('../ipc/files');
const ipcIcons = require('../ipc/icons');
const ipcWindow = require('../ipc/window');
const ipcDialog = require('../ipc/dialog');
const ipcSkin = require('../ipc/skin');
const ipcSystem = require('../ipc/system');

/**
 * 能力清单。顺序即加载顺序。
 * `build(deps)` 返回该能力 register() 所需的依赖对象。
 */
const CAPABILITIES = [
  {
    id: 'core-window',
    name: '窗口与桌宠壳层',
    description: '窗口移动、贴边/吸附、点击穿透、置顶、Dock 定位与显隐',
    defaultEnabled: true,
    channels: [
      'move-window', 'save-window-position', 'unsnap-window', 'resnap-window',
      'get-window-bounds', 'get-dock-bounds', 'report-dock-panel-offset',
      'report-pet-anchor', 'set-pet-dragging', 'expand-float-window',
      'restore-float-window', 'quit-app', 'toggle-always-on-top',
      'get-always-on-top', 'toggle-dock-always-on-top', 'get-dock-always-on-top',
      'get-dock-visible', 'focus-search', 'toggle-dock', 'show-dock', 'hide-dock',
      'move-dock', 'move-file-manager', 'open-settings', 'close-settings',
      'apply-dock-style', 'move-settings', 'reset-dock-pos', 'expand-dock-window',
      'restore-dock-window', 'resize-dock-window', 'center-dock',
      'open-config-folder', 'set-ignore-mouse-events'
    ],
    build: (deps) => ({
      loadConfig: deps.loadConfig,
      saveConfig: deps.saveConfig,
      screen: deps.screen,
      app: deps.app,
      getFloatWindow: deps.windows.getFloatWindow,
      getFileManagerWindow: deps.windows.getFileManagerWindow,
      getAlwaysOnTopEnabled: deps.windows.getAlwaysOnTopEnabled,
      setAlwaysOnTopEnabled: deps.windows.setAlwaysOnTopEnabled,
      getDockAlwaysOnTopEnabled: deps.windows.getDockAlwaysOnTopEnabled,
      setDockAlwaysOnTopEnabled: deps.windows.setDockAlwaysOnTopEnabled
    }),
    register: (deps) => ipcWindow.register(deps)
  },

  {
    id: 'file-manager',
    name: '文件管理',
    description: '文件列表、搜索、上传/下载复制、移动、删除到回收站、原生拖出',
    defaultEnabled: true,
    channels: [
      'sync-current-path', 'get-upload-dest', 'upload-file', 'check-paths-exist',
      'is-directory', 'upload-folder', 'list-files', 'search-files',
      'delete-file', 'move-file', 'start-drag', 'get-file-icon'
    ],
    build: (deps) => ({
      loadConfig: deps.loadConfig,
      getFileManagerWindow: deps.windows.getFileManagerWindow,
      iconCache: deps.iconCache,
      scheduleSaveIconCache: deps.scheduleSaveIconCache,
      iconExtractor: deps.iconExtractor
    }),
    register: (deps) => {
      ipcFiles.register(deps);
      ipcIcons.register(deps);
    }
  },

  {
    id: 'file-dialog',
    name: '目录选择与打开',
    description: '系统目录选择框、打开文件/所在位置、此电脑、消息框',
    defaultEnabled: true,
    channels: [
      'select-directory', 'open-file-manager', 'close-file-manager',
      'open-this-computer', 'show-message-box', 'open-file-location', 'open-file'
    ],
    build: (deps) => ({
      createFileManagerWindow: deps.windows.createFileManagerWindow,
      getFileManagerWindow: deps.windows.getFileManagerWindow,
      getDockWindow: deps.windows.getDockWindow,
      iconExtractor: deps.iconExtractor
    }),
    register: (deps) => ipcDialog.register(deps)
  },

  {
    id: 'partitions',
    name: '分区与路径',
    description: '分区 CRUD、快捷路径、首选路径，以及能力配置读写通道',
    defaultEnabled: true,
    channels: [
      'get-config', 'set-save-path', 'get-partitions', 'add-partition',
      'update-partition', 'remove-partition', 'add-path-to-partition',
      'update-partition-path', 'remove-partition-path', 'move-path-to-partition',
      'get-quick-access', 'get-preferred-path', 'set-preferred-path',
      'capability-get', 'capability-set', 'capability-list', 'capability-enable'
    ],
    build: (deps) => ({
      loadConfig: deps.loadConfig,
      saveConfig: deps.saveConfig
    }),
    register: (deps) => ipcConfig.register(deps)
  },

  {
    id: 'skins',
    name: '皮肤包',
    description: '内置/用户皮肤的列出、导入与导出（主进程侧安全边界）',
    defaultEnabled: true,
    channels: [
      'list-skins', 'import-skin', 'export-skin',
      'select-skin-directory', 'select-skin-zip',
      'apply-skin', 'get-active-skin'
    ],
    build: (deps) => ({
      userDataDir: deps.userDataDir,
      rootDir: deps.rootDir,
      loadConfig: deps.loadConfig,
      saveConfig: deps.saveConfig
    }),
    register: (deps) => ipcSkin.register(deps)
  },

  {
    id: 'system',
    name: '系统能力',
    description: '系统动作、电源、音量、网络/WiFi、电量、任务栏与桌面图标',
    defaultEnabled: true,
    channels: [
      'system-action', 'get-battery-status', 'get-dock-settings',
      'save-dock-settings', 'toggle-taskbar', 'get-taskbar-hidden',
      'toggle-desktop-icons', 'get-desktop-icons-hidden', 'power-action',
      'get-volume', 'set-volume', 'toggle-mute', 'set-mute',
      'get-network-status', 'get-wifi-status', 'get-wifi-networks',
      'connect-wifi', 'disconnect-wifi', 'get-nav-items', 'save-nav-items',
      'add-nav-item', 'update-nav-item', 'remove-nav-item'
    ],
    build: (deps) => ({
      loadConfig: deps.loadConfig,
      saveConfig: deps.saveConfig,
      getDockWindow: deps.windows.getDockWindow
    }),
    register: (deps) => ipcSystem.register(deps)
  }
];

/** 全部能力声明的通道（用于契约自检与 preload 对齐核对） */
function allDeclaredChannels() {
  const out = [];
  for (const cap of CAPABILITIES) {
    for (const ch of cap.channels) out.push(ch);
  }
  return out;
}

/** 配置里该能力是否启用（缺省用 defaultEnabled） */
function isEnabled(config, cap) {
  const store = (config && config.capabilities) || {};
  const raw = store[cap.id];
  if (raw === undefined) return cap.defaultEnabled !== false;
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object' && typeof raw.enabled === 'boolean') return raw.enabled;
  return cap.defaultEnabled !== false;
}

/**
 * 按配置加载全部启用的能力。
 * @returns {{loaded:string[], skipped:string[]}}
 */
function loadAll(deps) {
  const config = deps.loadConfig();
  const loaded = [];
  const skipped = [];

  for (const cap of CAPABILITIES) {
    if (!isEnabled(config, cap)) {
      skipped.push(cap.id);
      continue;
    }
    try {
      const capDeps = typeof cap.build === 'function' ? cap.build(deps) : deps;
      cap.register(capDeps);
      loaded.push(cap.id);
    } catch (err) {
      // 单个能力注册失败不得拖垮整个应用启动
      console.error('[capabilities] 能力 ' + cap.id + ' 注册失败:', err);
    }
  }

  console.log('[capabilities] 已加载: ' + (loaded.join(', ') || '无') +
    (skipped.length ? ' | 已跳过: ' + skipped.join(', ') : ''));
  return { loaded, skipped };
}

/** 列出能力元信息（不含 build/register，便于序列化给渲染层） */
function listMeta() {
  return CAPABILITIES.map((cap) => ({
    id: cap.id,
    name: cap.name,
    description: cap.description,
    defaultEnabled: cap.defaultEnabled !== false,
    channelCount: cap.channels.length
  }));
}

module.exports = {
  CAPABILITIES,
  allDeclaredChannels,
  isEnabled,
  loadAll,
  listMeta
};
