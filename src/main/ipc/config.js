const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function genId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

function register({ loadConfig, saveConfig }) {
  ipcMain.handle('get-config', () => {
    return loadConfig();
  });

  ipcMain.handle('set-save-path', async (event, newPath) => {
    try {
      const config = loadConfig();
      config.savePath = newPath;
      saveConfig(config);
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
      }
      console.log('保存路径设置成功:', newPath);
      return true;
    } catch (e) {
      console.error('保存路径设置失败:', e);
      return false;
    }
  });

  ipcMain.handle('get-partitions', () => {
    const config = loadConfig();
    const partitions = (config.partitions || []).map(p => ({
      ...p,
      paths: (p.paths || []).filter(item =>
        item && item.name && item.path && fs.existsSync(item.path)
      )
    }));
    return partitions;
  });

  ipcMain.handle('add-partition', (event, { name }) => {
    try {
      if (!name || !name.trim()) return { success: false, error: '分区名称不能为空' };
      const config = loadConfig();
      if (!config.partitions) config.partitions = [];
      const newPartition = {
        id: genId(),
        name: name.trim(),
        paths: []
      };
      config.partitions.push(newPartition);
      saveConfig(config);
      return { success: true, partition: newPartition };
    } catch (e) {
      console.error('添加分区失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update-partition', (event, { partitionId, name }) => {
    try {
      if (!partitionId) return { success: false, error: '分区ID不能为空' };
      const config = loadConfig();
      const partition = (config.partitions || []).find(p => p.id === partitionId);
      if (!partition) return { success: false, error: '分区不存在' };
      if (name && name.trim()) {
        partition.name = name.trim();
      }
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('更新分区失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-partition', (event, partitionId) => {
    try {
      if (!partitionId) return { success: false, error: '分区ID不能为空' };
      if (partitionId === 'default') return { success: false, error: '默认分区不能删除' };
      const config = loadConfig();
      if (!config.partitions) return { success: false, error: '分区不存在' };
      const idx = config.partitions.findIndex(p => p.id === partitionId);
      if (idx === -1) return { success: false, error: '分区不存在' };
      config.partitions.splice(idx, 1);
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('删除分区失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-path-to-partition', (event, { partitionId, name, path: itemPath }) => {
    try {
      if (!partitionId) return { success: false, error: '分区ID不能为空' };
      if (!itemPath) return { success: false, error: '路径不能为空' };
      if (!fs.existsSync(itemPath)) return { success: false, error: '路径不存在' };
      const config = loadConfig();
      const partition = (config.partitions || []).find(p => p.id === partitionId);
      if (!partition) return { success: false, error: '分区不存在' };
      if (!partition.paths) partition.paths = [];
      if (partition.paths.some(q => q.path === itemPath)) {
        return { success: false, error: '路径已在该分区中' };
      }
      const displayName = (name && name.trim()) ? name.trim() : path.basename(itemPath);
      partition.paths.push({ name: displayName, path: itemPath });
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('添加路径到分区失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update-partition-path', (event, { partitionId, pathIndex, name }) => {
    try {
      if (!partitionId) return { success: false, error: '分区ID不能为空' };
      const config = loadConfig();
      const partition = (config.partitions || []).find(p => p.id === partitionId);
      if (!partition) return { success: false, error: '分区不存在' };
      if (!partition.paths || !partition.paths[pathIndex]) {
        return { success: false, error: '路径索引无效' };
      }
      if (name && name.trim()) {
        partition.paths[pathIndex].name = name.trim();
      }
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('更新分区路径失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-partition-path', (event, { partitionId, pathIndex }) => {
    try {
      if (!partitionId) return { success: false, error: '分区ID不能为空' };
      const config = loadConfig();
      const partition = (config.partitions || []).find(p => p.id === partitionId);
      if (!partition) return { success: false, error: '分区不存在' };
      if (!partition.paths || !partition.paths[pathIndex]) {
        return { success: false, error: '路径索引无效' };
      }
      partition.paths.splice(pathIndex, 1);
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('删除分区路径失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-quick-access', () => {
    const config = loadConfig();
    const allPaths = [];
    (config.partitions || []).forEach(p => {
      (p.paths || []).forEach(item => {
        if (item && item.name && item.path && fs.existsSync(item.path)) {
          allPaths.push(item);
        }
      });
    });
    return allPaths;
  });
}

module.exports = { register };
