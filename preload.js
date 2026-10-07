const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSavePath: (path) => ipcRenderer.invoke('set-save-path', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFileManager: () => ipcRenderer.invoke('open-file-manager'),
  closeFileManager: () => ipcRenderer.invoke('close-file-manager'),
  openThisComputer: () => ipcRenderer.invoke('open-this-computer'),
  getQuickAccess: () => ipcRenderer.invoke('get-quick-access'),
  getPartitions: () => ipcRenderer.invoke('get-partitions'),
  addPartition: (name) => ipcRenderer.invoke('add-partition', { name }),
  updatePartition: (partitionId, name) => ipcRenderer.invoke('update-partition', { partitionId, name }),
  removePartition: (partitionId) => ipcRenderer.invoke('remove-partition', partitionId),
  addPathToPartition: (partitionId, name, path) => ipcRenderer.invoke('add-path-to-partition', { partitionId, name, path }),
  updatePartitionPath: (partitionId, pathIndex, name) => ipcRenderer.invoke('update-partition-path', { partitionId, pathIndex, name }),
  removePartitionPath: (partitionId, pathIndex) => ipcRenderer.invoke('remove-partition-path', { partitionId, pathIndex }),
  movePathToPartition: (fromPartitionId, pathIndex, toPartitionId) => ipcRenderer.invoke('move-path-to-partition', { fromPartitionId, pathIndex, toPartitionId }),
  uploadFile: (data) => ipcRenderer.invoke('upload-file', data),
  uploadFolder: (data) => ipcRenderer.invoke('upload-folder', data),
  isDirectory: (filePath) => ipcRenderer.invoke('is-directory', filePath),
  checkPathsExist: (paths) => ipcRenderer.invoke('check-paths-exist', paths),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  searchFiles: (keyword) => ipcRenderer.invoke('search-files', keyword),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getFileIcon: (filePath, isDirectory) => ipcRenderer.invoke('get-file-icon', filePath, isDirectory),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  moveFile: (data) => ipcRenderer.invoke('move-file', data),
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
  saveWindowPosition: () => ipcRenderer.invoke('save-window-position'),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  getDockBounds: () => ipcRenderer.invoke('get-dock-bounds'),
  reportDockPanelOffset: (offset) => ipcRenderer.invoke('report-dock-panel-offset', offset),
  reportPetAnchor: (anchor) => ipcRenderer.invoke('report-pet-anchor', anchor),
  setPetDragging: (dragging) => ipcRenderer.invoke('set-pet-dragging', dragging),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  toggleDockAlwaysOnTop: () => ipcRenderer.invoke('toggle-dock-always-on-top'),
  getDockAlwaysOnTop: () => ipcRenderer.invoke('get-dock-always-on-top'),
  focusSearch: () => ipcRenderer.invoke('focus-search'),
  onFocusSearch: (callback) => {
    ipcRenderer.on('focus-search', callback);
  },
  onIconUpdated: (callback) => {
    ipcRenderer.on('icon-updated', (event, data) => callback(data));
  },
  onFilesChanged: (callback) => {
    ipcRenderer.on('files-changed', (event, data) => callback(data));
  },
  onSnapEdgeChanged: (callback) => {
    ipcRenderer.on('snap-edge-changed', (event, edge) => callback(edge));
  },
  onDockSnapChanged: (callback) => {
    ipcRenderer.on('dock-snap-changed', (event, side) => callback(side));
  },
  unsnapWindow: () => ipcRenderer.invoke('unsnap-window'),
  resnapWindow: () => ipcRenderer.invoke('resnap-window'),
  expandFloatWindow: (width, height) => ipcRenderer.invoke('expand-float-window', width, height),
  restoreFloatWindow: () => ipcRenderer.invoke('restore-float-window'),
  getPreferredPath: () => ipcRenderer.invoke('get-preferred-path'),
  setPreferredPath: (path) => ipcRenderer.invoke('set-preferred-path', path),
  syncCurrentPath: (path) => ipcRenderer.invoke('sync-current-path', path),
  getUploadDest: () => ipcRenderer.invoke('get-upload-dest'),
  // 能力层（可插拔业务）自己的配置命名空间
  capabilityGet: (capabilityId, key) => ipcRenderer.invoke('capability-get', { capabilityId, key }),
  capabilitySet: (capabilityId, key, value) => ipcRenderer.invoke('capability-set', { capabilityId, key, value }),
  // 皮肤包（阶段 8）：列出 / 导入 / 导出 / 试穿
  listSkins: () => ipcRenderer.invoke('list-skins'),
  selectSkinDirectory: () => ipcRenderer.invoke('select-skin-directory'),
  selectSkinZip: () => ipcRenderer.invoke('select-skin-zip'),
  importSkin: (sourceDir) => ipcRenderer.invoke('import-skin', { sourceDir }),
  exportSkin: (skinId) => ipcRenderer.invoke('export-skin', { skinId }),
  applySkin: (skinId) => ipcRenderer.invoke('apply-skin', { skinId }),
  getActiveSkin: () => ipcRenderer.invoke('get-active-skin'),
  // 主进程能力清单与启用开关（阶段 5：关闭的能力不注册其 IPC 通道，重启生效）
  capabilityList: () => ipcRenderer.invoke('capability-list'),
  capabilityEnable: (capabilityId, enabled) => ipcRenderer.invoke('capability-enable', { capabilityId, enabled }),
  startDrag: (filePath, iconDataUrl) => ipcRenderer.invoke('start-drag', { filePath, iconDataUrl }),
  systemAction: (action) => ipcRenderer.invoke('system-action', action),
  toggleTaskbar: (hide) => ipcRenderer.invoke('toggle-taskbar', hide),
  getTaskbarHidden: () => ipcRenderer.invoke('get-taskbar-hidden'),
  // 桌面图标显示/隐藏
  toggleDesktopIcons: () => ipcRenderer.invoke('toggle-desktop-icons'),
  getDesktopIconsHidden: () => ipcRenderer.invoke('get-desktop-icons-hidden'),
  getBatteryStatus: () => ipcRenderer.invoke('get-battery-status'),
  // 音量控制
  getVolume: () => ipcRenderer.invoke('get-volume'),
  setVolume: (volume) => ipcRenderer.invoke('set-volume', volume),
  toggleMute: () => ipcRenderer.invoke('toggle-mute'),
  setMute: (mute) => ipcRenderer.invoke('set-mute', mute),
  // WiFi 控制
  getWifiStatus: () => ipcRenderer.invoke('get-wifi-status'),
  getWifiNetworks: () => ipcRenderer.invoke('get-wifi-networks'),
  connectWifi: (ssid) => ipcRenderer.invoke('connect-wifi', ssid),
  disconnectWifi: () => ipcRenderer.invoke('disconnect-wifi'),
  // 网络状态（有线+无线）
  getNetworkStatus: () => ipcRenderer.invoke('get-network-status'),
  // Dock 窗口扩展/恢复（用于显示音量/WiFi浮层）
  expandDockWindow: (height) => ipcRenderer.invoke('expand-dock-window', height),
  restoreDockWindow: () => ipcRenderer.invoke('restore-dock-window'),
  resizeDockWindow: (width, height, preserveSavedBounds) => ipcRenderer.invoke('resize-dock-window', width, height, preserveSavedBounds),
  // 电源操作
  powerAction: (action) => ipcRenderer.invoke('power-action', action),
  getNavItems: () => ipcRenderer.invoke('get-nav-items'),
  saveNavItems: (items) => ipcRenderer.invoke('save-nav-items', items),
  addNavItem: (item) => ipcRenderer.invoke('add-nav-item', item),
  updateNavItem: (id, updates) => ipcRenderer.invoke('update-nav-item', { id, updates }),
  removeNavItem: (id) => ipcRenderer.invoke('remove-nav-item', id),
  toggleDock: () => ipcRenderer.invoke('toggle-dock'),
  showDock: () => ipcRenderer.invoke('show-dock'),
  hideDock: () => ipcRenderer.invoke('hide-dock'),
  getDockVisible: () => ipcRenderer.invoke('get-dock-visible'),
  moveDock: (deltaX, deltaY) => ipcRenderer.invoke('move-dock', deltaX, deltaY),
  moveFileManager: (deltaX, deltaY) => ipcRenderer.invoke('move-file-manager', deltaX, deltaY),
  getDockSettings: () => ipcRenderer.invoke('get-dock-settings'),
  saveDockSettings: (settings) => ipcRenderer.invoke('save-dock-settings', settings),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  applyDockStyle: (style) => ipcRenderer.invoke('apply-dock-style', style),
  moveSettings: (dx, dy) => ipcRenderer.invoke('move-settings', dx, dy),
  resetDockPos: () => ipcRenderer.invoke('reset-dock-pos'),
  centerDock: () => ipcRenderer.invoke('center-dock'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),
  onDockStyleChanged: (callback) => {
    ipcRenderer.on('dock-style-changed', (event, style) => callback(style));
  },
  onNavItemsChanged: (callback) => {
    ipcRenderer.on('nav-items-changed', () => callback());
  },
  // 点击穿透：透明区域允许鼠标穿透到桌面
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.invoke('set-ignore-mouse-events', { ignore, opts })
});
