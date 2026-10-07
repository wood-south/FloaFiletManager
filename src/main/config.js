const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const schema = require('./config-schema');

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
const configBackupPath = configPath + '.bak';

/** 把内存/磁盘上的配置文件统一读成「扁平视图」 */
function readFlatConfig() {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (schema.isV2(raw)) {
    // v2：摊平回扁平视图（内部代码一行不用改）
    const res = schema.decodeV2(raw);
    if (res.warnings.length) {
      res.warnings.forEach((w) => console.warn('[config] ' + w));
    }
    return res.config;
  }

  // v1：迁移到 v2。**先备份再写**，且只做一次（写盘后 version 即为 2）
  backupOnce(raw);
  const migrated = schema.migrateToV2(raw);
  if (!migrated.ok) {
    console.error('[config] v1→v2 迁移失败，按原结构使用（不会写盘覆盖）');
    return raw;
  }
  migrated.warnings.forEach((w) => console.warn('[config] ' + w));
  try {
    fs.writeFileSync(configPath + '.tmp', JSON.stringify(migrated.config, null, 2));
    fs.renameSync(configPath + '.tmp', configPath);
    console.log('[config] 已迁移配置结构 v1 → v2（备份: config.json.bak）');
  } catch (e) {
    // 写盘失败不影响本次运行：内存里已是正确数据，下次启动再试
    console.error('[config] 迁移结果写盘失败（本次内存中仍生效）:', e.message);
  }
  return schema.decodeV2(migrated.config).config;
}

/** 迁移前的强制备份（只写一次，绝不覆盖已有备份） */
function backupOnce(rawDoc) {
  try {
    if (fs.existsSync(configBackupPath)) return;
    fs.writeFileSync(configBackupPath, JSON.stringify(rawDoc, null, 2));
  } catch (e) {
    console.error('[config] 备份失败:', e.message);
  }
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = readFlatConfig();
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

  // 能力层开关（阶段 5）：缺省视为「全部启用」，因此老配置不需要任何改动。
  // 这里只保证它是个对象，具体缺省值由能力层按 defaultEnabled 判定。
  if (!config.capabilities || typeof config.capabilities !== 'object' ||
      Array.isArray(config.capabilities)) {
    config.capabilities = {};
    changed = true;
  }

  if (changed) {
    saveConfig(config);
  }
}

function saveConfig(config) {
  // 磁盘上始终写 v2 文档；内存里的调用方仍然传/收扁平对象，
  // 两个视图由 config-schema 负责转换，因此调用点无需感知结构变化。
  const data = JSON.stringify(schema.encodeForDisk(config), null, 2);
  // 重试机制：频繁写入可能因文件被占用而 EPERM
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

module.exports = {
  loadConfig,
  saveConfig,
  isDev,
  rootDir,
  configPath,
  configBackupPath,
  userDataDir
};
