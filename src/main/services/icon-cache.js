const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { isDev, rootDir } = require('../config');

const iconCache = new Map();
let iconCachePath = null;
let iconCacheSaveTimeout = null;

function loadIconCache() {
  if (!iconCachePath) {
    const cacheDir = isDev ? rootDir : path.dirname(app.getPath('exe'));
    iconCachePath = path.join(cacheDir, 'icon-cache.json');
  }
  try {
    if (fs.existsSync(iconCachePath)) {
      const data = JSON.parse(fs.readFileSync(iconCachePath, 'utf8'));
      if (data && typeof data === 'object') {
        let loadedCount = 0;
        let filteredCount = 0;
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'string' && val.startsWith('data:image/')) {
            iconCache.set(key, val);
            loadedCount++;
          } else {
            filteredCount++;
          }
        }
        console.log('加载图标缓存:', loadedCount, '个, 过滤无效:', filteredCount, '个, 路径:', iconCachePath);
      }
    } else {
      console.log('图标缓存不存在: ' + iconCachePath + ', 将在首次获取图标时自动生成');
    }
  } catch (e) {
    console.error('加载图标缓存失败:', e.message);
    iconCachePath = null;
  }
}

function saveIconCache() {
  if (!iconCachePath) return;
  try {
    const data = {};
    let totalSize = 0;
    for (const [key, val] of iconCache) {
      if (val && typeof val === 'string') {
        const entrySize = key.length + val.length;
        if (totalSize + entrySize > 5 * 1024 * 1024) break;
        data[key] = val;
        totalSize += entrySize;
      }
    }
    const json = JSON.stringify(data, null, 2);
    const tmp = iconCachePath + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, iconCachePath);
    console.log('保存图标缓存:', Object.keys(data).length, '个');
  } catch (e) {
    console.error('保存图标缓存失败:', e.message);
  }
}

function scheduleSaveIconCache() {
  if (iconCacheSaveTimeout) {
    clearTimeout(iconCacheSaveTimeout);
  }
  iconCacheSaveTimeout = setTimeout(saveIconCache, 5000);
}

module.exports = { iconCache, loadIconCache, saveIconCache, scheduleSaveIconCache };
