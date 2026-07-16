const { ipcMain, nativeImage, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

let fileManagerCurrentPath = null;

function notifyFilesChanged(getFileManagerWindow, destDir) {
  if (!getFileManagerWindow) return;
  const fmWindow = getFileManagerWindow();
  if (fmWindow) {
    fmWindow.webContents.send('files-changed', { dir: destDir });
  }
}

function register({ loadConfig, getFileManagerWindow }) {

  // 文件管理器同步当前浏览路径
  ipcMain.handle('sync-current-path', (event, currentPath) => {
    fileManagerCurrentPath = currentPath;
  });

  // 获取上传目标路径：文件管理器打开则用其当前路径，否则用首选路径
  ipcMain.handle('get-upload-dest', () => {
    const fmWindow = getFileManagerWindow();
    if (fmWindow && !fmWindow.isDestroyed() && fileManagerCurrentPath) {
      return fileManagerCurrentPath;
    }
    const config = loadConfig();
    return config.preferredPath || config.savePath;
  });
  ipcMain.handle('upload-file', async (event, { sourcePath, fileName, overwrite, destDir }) => {
    const config = loadConfig();

    const savePath = destDir || config.savePath;

    console.log('上传文件:', { sourcePath, fileName, savePath, destDir, overwrite });

    try {
      if (!fs.existsSync(savePath)) {
        console.log('保存路径不存在，创建:', savePath);
        fs.mkdirSync(savePath, { recursive: true });
      }

      if (!fs.existsSync(sourcePath)) {
        console.error('源文件不存在:', sourcePath);
        return { success: false, error: '源文件不存在: ' + sourcePath };
      }

      // 检查 sourcePath 是否为文件夹，如果是则拒绝处理
      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        console.error('不能使用文件上传接口上传文件夹:', sourcePath);
        return { success: false, error: '请使用上传文件夹功能上传文件夹' };
      }

      const destPath = path.join(savePath, fileName);

      // 检查重名：未明确覆盖时，返回重复提示让前端确认
      if (fs.existsSync(destPath) && !overwrite) {
        return { success: false, duplicate: true, destPath };
      }

      let finalDestPath = destPath;
      if (overwrite && fs.existsSync(destPath)) {
        // 覆盖模式：直接覆盖原文件
      } else if (overwrite) {
        // 覆盖模式但文件不存在，正常流程
      }

      // 对于快捷方式(.lnk)等特殊文件，用 Buffer 复制避免 EPERM
      const isLnk = fileName.toLowerCase().endsWith('.lnk');
      if (isLnk) {
        const content = fs.readFileSync(sourcePath);
        fs.writeFileSync(finalDestPath, content);
      } else {
        fs.copyFileSync(sourcePath, finalDestPath);
      }

      console.log('上传成功:', finalDestPath);
      notifyFilesChanged(getFileManagerWindow, savePath);
      return { success: true, destPath: finalDestPath };
    } catch (error) {
      console.error('上传失败:', error.message);
      return { success: false, error: error.message };
    }
  });

  // 判断路径是否为文件夹
  ipcMain.handle('is-directory', async (event, filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return stat.isDirectory();
    } catch (e) {
      return false;
    }
  });

  // 上传文件夹（递归复制整个文件夹）
  ipcMain.handle('upload-folder', async (event, { sourceFolder, destDir }) => {
    const config = loadConfig();

    const savePath = destDir || config.savePath;

    console.log('上传文件夹:', { sourceFolder, savePath, destDir });

    try {
      if (!fs.existsSync(savePath)) {
        console.log('保存路径不存在，创建:', savePath);
        fs.mkdirSync(savePath, { recursive: true });
      }

      if (!fs.existsSync(sourceFolder)) {
        console.error('源文件夹不存在:', sourceFolder);
        return { success: false, error: '源文件夹不存在: ' + sourceFolder };
      }

      const folderName = path.basename(sourceFolder);
      const destFolder = path.join(savePath, folderName);

      // 检查目标文件夹是否已存在
      if (fs.existsSync(destFolder)) {
        return { success: false, duplicate: true, destPath: destFolder };
      }

      // 递归复制文件夹
      function copyFolderRecursive(src, dest) {
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);

          if (entry.isDirectory()) {
            copyFolderRecursive(srcPath, destPath);
          } else {
            // 处理快捷方式(.lnk)等特殊文件
            const isLnk = entry.name.toLowerCase().endsWith('.lnk');
            if (isLnk) {
              const content = fs.readFileSync(srcPath);
              fs.writeFileSync(destPath, content);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          }
        }
      }

      copyFolderRecursive(sourceFolder, destFolder);
      console.log('文件夹上传成功:', destFolder);
      notifyFilesChanged(getFileManagerWindow, savePath);
      return { success: true, destPath: destFolder };
    } catch (error) {
      console.error('文件夹上传失败:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('list-files', async (event, dirPath) => {
    const config = loadConfig();
    const targetPath = dirPath || config.savePath;

    try {
      const files = fs.readdirSync(targetPath, { withFileTypes: true });
      const result = [];

      for (const file of files) {
        const fullPath = path.join(targetPath, file.name);
        let size = 0;
        let mtime = null;
        try {
          const stat = fs.statSync(fullPath);
          size = stat.size;
          mtime = stat.mtime.getTime();
        } catch (e) {
          console.warn('获取文件信息失败:', fullPath, e.message);
        }
        result.push({
          name: file.name,
          isDirectory: file.isDirectory(),
          targetIsDirectory: false,
          path: fullPath,
          size: size,
          mtime: mtime
        });
      }

      return { success: true, files: result, currentPath: targetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('search-files', async (event, keyword) => {
    const config = loadConfig();
    const searchPath = config.savePath;
    const results = [];

    function searchRecursive(dir) {
      try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(dir, file.name);
          if (file.name.toLowerCase().includes(keyword.toLowerCase())) {
            results.push({
              name: file.name,
              isDirectory: file.isDirectory(),
              targetIsDirectory: false,
              path: fullPath,
              size: 0,
              mtime: null
            });
          }
          if (file.isDirectory()) {
            searchRecursive(fullPath);
          }
        }
      } catch (e) {
        console.error('搜索出错:', e);
      }
    }

    searchRecursive(searchPath);
    return { success: true, files: results };
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    const { shell } = require('electron');
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }
      // 移到回收站，而不是永久删除，更安全
      await shell.trashItem(filePath);
      console.log('删除文件:', filePath);
      await new Promise(resolve => setTimeout(resolve, 200));
      notifyFilesChanged(getFileManagerWindow, path.dirname(filePath));
      return { success: true };
    } catch (e) {
      console.error('删除文件失败:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('move-file', async (event, { sourcePath, destDir }) => {
    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: '源文件不存在' };
      }
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const fileName = path.basename(sourcePath);
      const destPath = path.join(destDir, fileName);

      if (sourcePath === destPath) {
        return { success: false, error: '源路径和目标路径相同' };
      }

      if (fs.existsSync(destPath)) {
        return { success: false, duplicate: true, destPath };
      }

      fs.renameSync(sourcePath, destPath);
      console.log('移动文件:', sourcePath, '->', destPath);
      notifyFilesChanged(getFileManagerWindow, path.dirname(sourcePath));
      notifyFilesChanged(getFileManagerWindow, destDir);
      return { success: true, destPath };
    } catch (e) {
      console.error('移动文件失败:', e.message);
      return { success: false, error: e.message };
    }
  });

  // 原生文件拖拽：允许从文件管理器拖出文件到桌面/资源管理器
  ipcMain.handle('start-drag', async (event, { filePath, iconDataUrl }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;

      let icon;
      if (iconDataUrl) {
        try {
          icon = nativeImage.createFromDataURL(iconDataUrl);
        } catch (_) {
          icon = undefined;
        }
      }

      await win.webContents.startDrag({
        file: filePath,
        icon: icon || nativeImage.createEmpty()
      });
    } catch (e) {
      console.error('原生拖拽失败:', e.message);
    }
  });
}

module.exports = { register };
