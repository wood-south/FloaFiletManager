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

  ipcMain.handle('move-path-to-partition', (event, { fromPartitionId, pathIndex, toPartitionId }) => {
    try {
      if (!fromPartitionId || !toPartitionId) return { success: false, error: '分区ID不能为空' };
      const config = loadConfig();
      const fromPart = (config.partitions || []).find(p => p.id === fromPartitionId);
      const toPart = (config.partitions || []).find(p => p.id === toPartitionId);
      if (!fromPart || !toPart) return { success: false, error: '分区不存在' };
      if (!fromPart.paths || !fromPart.paths[pathIndex]) {
        return { success: false, error: '路径索引无效' };
      }
      const movedItem = fromPart.paths[pathIndex];
      // 检查目标分区是否已有相同路径
      if (toPart.paths.some(q => q.path === movedItem.path)) {
        return { success: false, error: '该路径已在目标分区中' };
      }
      fromPart.paths.splice(pathIndex, 1);
      toPart.paths.push(movedItem);
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('移动路径到分区失败:', e);
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

  ipcMain.handle('get-preferred-path', () => {
    const config = loadConfig();
    return config.preferredPath || config.savePath;
  });

  /* ========== 能力层配置（按能力 id 隔离命名空间） ==========
     每个可插拔能力（renderer/capabilities/<id>/）把自己的开关与偏好
     存在 config.capabilities[id] 下，避免继续往扁平结构里塞字段。
     保留 config.capabilities 整块，阶段 6 的 v1→v2 命名空间化迁移
     会把它一并搬到正式结构里。 */

  const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
  const SAFE_ID = /^[a-z0-9-]{1,48}$/;

  function readCapabilityStore() {
    const config = loadConfig();
    if (!config.capabilities || typeof config.capabilities !== 'object') {
      config.capabilities = {};
    }
    return config;
  }

  ipcMain.handle('capability-get', (event, { capabilityId, key } = {}) => {
    if (!SAFE_ID.test(String(capabilityId || ''))) return undefined;
    if (!SAFE_KEY.test(String(key || ''))) return undefined;
    const config = loadConfig();
    const store = config.capabilities && config.capabilities[capabilityId];
    return store ? store[key] : undefined;
  });

  ipcMain.handle('capability-set', (event, { capabilityId, key, value } = {}) => {
    // 只接受 JSON 基本类型，避免把任意对象写进配置
    const isPrimitive = value === null || ['boolean', 'number', 'string'].includes(typeof value);
    if (!SAFE_ID.test(String(capabilityId || ''))) {
      return { success: false, error: '非法的能力 id' };
    }
    if (!SAFE_KEY.test(String(key || ''))) {
      return { success: false, error: '非法的配置键' };
    }
    if (!isPrimitive) {
      return { success: false, error: '不支持的值类型' };
    }
    try {
      const config = readCapabilityStore();
      if (!config.capabilities[capabilityId]) config.capabilities[capabilityId] = {};
      config.capabilities[capabilityId][key] = value;
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('保存能力配置失败:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('set-preferred-path', async (event, newPath) => {
    try {
      if (!newPath) return { success: false, error: '路径不能为空' };
      if (!fs.existsSync(newPath)) return { success: false, error: '路径不存在' };
      const stat = fs.statSync(newPath);
      if (!stat.isDirectory()) return { success: false, error: '必须是文件夹路径' };
      const config = loadConfig();
      config.preferredPath = newPath;
      saveConfig(config);
      console.log('首选路径设置成功:', newPath);
      return { success: true };
    } catch (e) {
      console.error('设置首选路径失败:', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
