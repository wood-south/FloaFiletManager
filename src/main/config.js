const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const rootDir = path.join(__dirname, '..', '..');

// 开发环境下将 userData 放到项目目录，避免沙箱拦截
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(rootDir, '.userdata');
  if (!fs.existsSync(devDataDir)) {
    fs.mkdirSync(devDataDir, { recursive: true });
  }
  app.setPath('userData', devDataDir);
}

const userDataDir = app.getPath('userData');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const configPath = path.join(userDataDir, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      migrateConfig(config);
      return config;
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  const desktopPath = app.getPath('desktop');
  const defaultSavePath = path.join(app.getPath('documents'), 'FloatUploads');
  return {
    savePath: defaultSavePath,
    preferredPath: defaultSavePath,
    floatPosition: { x: 100, y: 100 },
    partitions: [
      {
        id: 'default',
        name: '常用',
        paths: [
          { name: '我的文件', path: defaultSavePath },
          { name: '桌面', path: desktopPath },
          { name: '文档', path: app.getPath('documents') },
          { name: '下载', path: app.getPath('downloads') },
          { name: '图片', path: app.getPath('pictures') }
        ]
      }
    ]
  };
}

function migrateConfig(config) {
  let changed = false;

  // 持久化窗口状态
  if (config.dockVisible === undefined) { config.dockVisible = true; changed = true; }
  if (config.floatAlwaysOnTop === undefined) { config.floatAlwaysOnTop = true; changed = true; }
  if (config.dockAlwaysOnTop === undefined) { config.dockAlwaysOnTop = true; changed = true; }
  if (config.dockX === undefined) { config.dockX = null; changed = true; }
  if (config.dockBottom === undefined) { config.dockBottom = null; changed = true; }
  // 旧的 dockY（顶部位置）已废弃，改用 dockBottom（底部位置）作为稳定锚点
  if (config.dockY !== undefined) { delete config.dockY; changed = true; }

  if (!config.partitions || !Array.isArray(config.partitions)) {
    config.partitions = [];
    changed = true;
  }

  if (config.quickAccess && Array.isArray(config.quickAccess) && config.quickAccess.length > 0) {
    const defaultPartition = config.partitions.find(p => p.id === 'default');
    if (!defaultPartition) {
      config.partitions.unshift({
        id: 'default',
        name: '常用',
        paths: config.quickAccess.filter(q => q && q.name && q.path)
      });
    } else {
      const existingPaths = new Set(defaultPartition.paths.map(p => p.path));
      config.quickAccess.forEach(q => {
        if (q && q.name && q.path && !existingPaths.has(q.path)) {
          defaultPartition.paths.push({ name: q.name, path: q.path });
        }
      });
    }
    delete config.quickAccess;
    changed = true;
  }

  if (config.partitions.length === 0) {
    const desktopPath = app.getPath('desktop');
    config.partitions.push({
      id: 'default',
      name: '常用',
      paths: [
        { name: '我的文件', path: config.savePath || path.join(app.getPath('documents'), 'FloatUploads') },
        { name: '桌面', path: desktopPath },
        { name: '文档', path: app.getPath('documents') },
        { name: '下载', path: app.getPath('downloads') },
        { name: '图片', path: app.getPath('pictures') }
      ]
    });
    changed = true;
  }

  config.partitions.forEach(p => {
    if (!p.id) {
      p.id = 'part_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      changed = true;
    }
    if (!p.paths) {
      p.paths = [];
      changed = true;
    }
  });

  if (!config.preferredPath) {
    config.preferredPath = config.savePath || path.join(app.getPath('documents'), 'FloatUploads');
    changed = true;
  }

  if (changed) {
    saveConfig(config);
  }
}

function saveConfig(config) {
  // 重试机制：频繁写入可能因文件被占用而 EPERM
  const data = JSON.stringify(config, null, 2);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(configPath, data);
      return true;
    } catch (e) {
      console.error(`保存配置失败(第${attempt + 1}次):`, e.message);
      if (attempt < 2) {
        // 短暂等待后重试
        const start = Date.now();
        while (Date.now() - start < 80) { /* busy wait */ }
      }
    }
  }
  // 兜底：写到临时文件再原子替换
  try {
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, configPath);
    return true;
  } catch (e) {
    console.error('保存配置最终失败:', e);
    return false;
  }
}

module.exports = { loadConfig, saveConfig, isDev, rootDir, configPath, userDataDir };
