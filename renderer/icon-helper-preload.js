const { contextBridge, ipcRenderer } = require('electron');

let pendingIcons = new Map();

contextBridge.exposeInMainWorld('electronAPI', {
  onGetFileIcon: (callback) => {
    ipcRenderer.on('helper-get-file-icon', (event, requestId, filePath, isDirectory) => {
      callback(requestId, filePath, isDirectory);
    });
  },
  getFileIconNative: (filePath, isDirectory) => {
    return ipcRenderer.invoke('helper-native-get-file-icon', filePath, isDirectory);
  },
  returnFileIcon: (requestId, dataUrl) => {
    ipcRenderer.send('helper-return-file-icon', requestId, dataUrl);
  }
});