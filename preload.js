const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSavePath: (path) => ipcRenderer.invoke('set-save-path', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFileManager: () => ipcRenderer.invoke('open-file-manager'),
  closeFileManager: () => ipcRenderer.invoke('close-file-manager'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  uploadFile: (data) => ipcRenderer.invoke('upload-file', data),
  uploadFolder: (sourcePath) => ipcRenderer.invoke('upload-folder', sourcePath),
  isDirectory: (filePath) => ipcRenderer.invoke('is-directory', filePath),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  searchFiles: (keyword) => ipcRenderer.invoke('search-files', keyword),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getFileIcon: (filePath, isDirectory) => ipcRenderer.invoke('get-file-icon', filePath, isDirectory),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
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
  onSnapEdgeChanged: (callback) => {
    ipcRenderer.on('snap-edge-changed', (event, edge) => callback(edge));
  },
  unsnapWindow: () => ipcRenderer.invoke('unsnap-window'),
  resnapWindow: () => ipcRenderer.invoke('resnap-window')
});
