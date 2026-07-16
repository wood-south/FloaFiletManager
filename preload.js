const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSavePath: (path) => ipcRenderer.invoke('set-save-path', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFileManager: () => ipcRenderer.invoke('open-file-manager'),
  closeFileManager: () => ipcRenderer.invoke('close-file-manager'),
  openThisComputer: () => ipcRenderer.invoke('open-this-computer'),
  getQuickAccess: () => ipcRenderer.invoke('get-quick-access'),
  addQuickAccess: (item) => ipcRenderer.invoke('add-quick-access', item),
  updateQuickAccess: (index, item) => ipcRenderer.invoke('update-quick-access', { index, item }),
  removeQuickAccess: (index) => ipcRenderer.invoke('remove-quick-access', index),
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
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
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
  unsnapWindow: () => ipcRenderer.invoke('unsnap-window'),
  resnapWindow: () => ipcRenderer.invoke('resnap-window'),
  expandFloatWindow: (width, height) => ipcRenderer.invoke('expand-float-window', width, height),
  restoreFloatWindow: () => ipcRenderer.invoke('restore-float-window'),
  getPreferredPath: () => ipcRenderer.invoke('get-preferred-path'),
  setPreferredPath: (path) => ipcRenderer.invoke('set-preferred-path', path),
  syncCurrentPath: (path) => ipcRenderer.invoke('sync-current-path', path),
  getUploadDest: () => ipcRenderer.invoke('get-upload-dest'),
  startDrag: (filePath, iconDataUrl) => ipcRenderer.invoke('start-drag', { filePath, iconDataUrl })
});
