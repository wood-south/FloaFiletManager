const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { isDev, rootDir } = require('../config');

const iconCache = new Map();
let iconCachePath = null;
let iconCacheSaveTimeout = null;

// 缓存路径解析：
// - 开发环境放项目根目录，便于查看与清理（已在 .gitignore 中忽略）
// - 生产环境必须放 userData：早期实现写在 path.dirname(app.getPath('exe'))，
//   安装到 C:\Program Files\ 等只读目录时必然写入失败（EPERM），且无补救手段
function resolveCachePath() {
  if (isDev) {
    return path.join(rootDir, 'icon-cache.json');
  }
  return path.join(app.getPath('userData'), 'icon-cache.json');
}

// 兼容旧版本：若新位置没有缓存，尝试从 exe 同目录迁移一次
function legacyCachePath() {
  try {
    return path.join(path.dirname(app.getPath('exe')), 'icon-cache.json');
  } catch (_) {
    return null;
  }
}

function loadIconCache() {
  if (!iconCachePath) {
    iconCachePath = resolveCachePath();
    // 迁移旧缓存，避免升级后重新提取全部图标
    try {
      const legacy = legacyCachePath();
      if (legacy && legacy !== iconCachePath &&
          !fs.existsSync(iconCachePath) && fs.existsSync(legacy)) {
        fs.copyFileSync(legacy, iconCachePath);
        console.log('已迁移旧图标缓存:', legacy, '->', iconCachePath);
      }
    } catch (e) {
      console.warn('迁移旧图标缓存失败(忽略):', e.message);
    }
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
