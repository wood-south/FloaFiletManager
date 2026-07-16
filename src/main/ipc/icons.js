const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register({ iconCache, scheduleSaveIconCache, iconExtractor }) {
  const {
    resolveLnkTarget,
    parseUrlFile,
    cleanPath,
    readIcoToDataUrl,
    getSteamGameIcon,
    getFileIconWithTimeout,
    iconToDataUrl,
    resolveFileIcon
  } = iconExtractor;

  ipcMain.handle('helper-native-get-file-icon', async (event, filePath, isDirectory) => {
    try {
      if (isDirectory) return null;

      const ext = path.extname(filePath).toLowerCase();
      const isLnk = ext === '.lnk';
      const isUrl = ext === '.url';
      let result = null;
      let iconFile = filePath;

      if (isLnk) {
        const targetPath = resolveLnkTarget(filePath);
        if (targetPath) {
          iconFile = targetPath;
        }
      }

      if (isUrl) {
        const urlInfo = parseUrlFile(filePath);
        if (urlInfo.iconFile) {
          const p = cleanPath(urlInfo.iconFile);
          if (p && fs.existsSync(p)) {
            const e = path.extname(p).toLowerCase();
            if (e === '.ico') { result = readIcoToDataUrl(p); }
            else if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(e)) {
              try {
                const buf = fs.readFileSync(p);
                result = 'data:' + (e==='.jpg'?'image/jpeg':'image/'+e.slice(1)) + ';base64,' + buf.toString('base64');
              } catch (er) { console.error('url图标读取失败:', er.message); }
            } else {
              iconFile = p;
            }
          }
        }
        if (!result && urlInfo.url && urlInfo.url.startsWith('steam://')) {
          const si = getSteamGameIcon(urlInfo.url);
          if (si) {
            const se = path.extname(si).toLowerCase();
            if (se === '.ico') result = readIcoToDataUrl(si);
            else {
              try {
                const buf = fs.readFileSync(si);
                result = 'data:' + (se==='.jpg'?'image/jpeg':'image/'+se.slice(1)) + ';base64,' + buf.toString('base64');
              } catch (er) { console.error('Steam图标读取失败:', er.message); }
            }
          }
        }
      }

      if (!result) {
        try {
          const icon = await getFileIconWithTimeout(iconFile, 3000);
          if (icon) {
            result = iconToDataUrl(icon);
          }
        } catch (e) {
          console.error('getFileIcon失败:', e.message);
        }
      }

      if (!result) {
        result = extractIconToDataUrl(iconFile);
        if (result) {
          console.log('PowerShell提取图标成功:', filePath);
        }
      }

      return result;
    } catch (e) {
      console.error('helper获取图标失败:', e.message);
      return null;
    }
  });

  ipcMain.handle('get-file-icon', async (event, filePath, isDirectory) => {
    try {
      if (isDirectory) return null;

      const ext = path.extname(filePath).toLowerCase();
      const isLnk = ext === '.lnk';
      const isUrl = ext === '.url';

      const cacheKey = (isLnk || isUrl) ? filePath.toLowerCase() : (ext || 'file');

      if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
      }

      const result = await resolveFileIcon(filePath);
      if (result) {
        iconCache.set(cacheKey, result);
        scheduleSaveIconCache();
      }
      return result;
    } catch (e) {
      console.error('获取文件图标失败:', e.message);
      return null;
    }
  });
}

module.exports = { register };
