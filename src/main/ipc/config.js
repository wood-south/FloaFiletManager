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
     阶段 5 起，主进程能力层（src/main/capabilities/）的 six 个能力也共用它，
     键为 `enabled`（布尔）。 */

  const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
  const SAFE_ID = /^[a-z0-9-]{1,48}$/;

  function readCapabilityStore() {
    const config = loadConfig();
    if (!config.capabilities || typeof config.capabilities !== 'object') {
      config.capabilities = {};
    }
    return config;
  }

  /* 注意：不在参数位置解构。`(event, { x } = {})` 的默认值只对 undefined 生效，
     渲染层若传 null 会抛 "Cannot destructure property ... of null"，
     且异常发生在函数体外（连 try 都来不及拦），渲染层拿到的是 reject。 */
  ipcMain.handle('capability-get', (event, payload) => {
    const { capabilityId, key } = (payload && typeof payload === 'object') ? payload : {};
    if (!SAFE_ID.test(String(capabilityId || ''))) return undefined;
    if (!SAFE_KEY.test(String(key || ''))) return undefined;
    const config = loadConfig();
    const store = config.capabilities && config.capabilities[capabilityId];
    return store ? store[key] : undefined;
  });

  ipcMain.handle('capability-set', (event, payload) => {
    const { capabilityId, key, value } = (payload && typeof payload === 'object') ? payload : {};
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

  /* ========== 主进程能力的启用开关（阶段 5） ==========
     关闭某能力后其 IPC 通道不再注册（下次启动生效）。
     实时卸载已注册的处理器会让 preload 的桥接方法变成 reject，
     比"重启后生效"更容易出错，因此这里明确是**重启生效**。 */

  ipcMain.handle('capability-list', () => {
    try {
      const { listMeta, isEnabled } = require('../capabilities');
      const config = loadConfig();
      return listMeta().map((meta) => ({
        ...meta,
        enabled: isEnabled(config, meta)
      }));
    } catch (e) {
      console.error('读取能力清单失败:', e);
      return [];
    }
  });

  ipcMain.handle('capability-enable', (event, payload) => {
    const { capabilityId, enabled } = (payload && typeof payload === 'object') ? payload : {};
    if (!SAFE_ID.test(String(capabilityId || ''))) {
      return { success: false, error: '非法的能力 id' };
    }
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'enabled 必须是布尔值' };
    }
    try {
      const { CAPABILITIES } = require('../capabilities');
      if (!CAPABILITIES.some((cap) => cap.id === capabilityId)) {
        return { success: false, error: '未知能力: ' + capabilityId };
      }
      const config = readCapabilityStore();
      const entry = config.capabilities[capabilityId];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        entry.enabled = enabled;
      } else {
        config.capabilities[capabilityId] = { enabled };
      }
      saveConfig(config);
      return { success: true, restartRequired: true };
    } catch (e) {
      console.error('保存能力开关失败:', e);
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
