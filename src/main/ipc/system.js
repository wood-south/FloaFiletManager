const { ipcMain, shell } = require('electron');
const { exec } = require('child_process');

function register({ loadConfig, saveConfig }) {
  ipcMain.handle('system-action', async (event, action) => {
    try {
      switch (action) {
        case 'start':
          exec('explorer shell:::{2559a1f8-21d7-11d4-bdaf-00c04f60b9f0}');
          break;
        case 'taskview':
          exec('powershell -Command "(New-Object -ComObject Shell.Application).ToggleDesktop()"');
          break;
        case 'explorer':
          shell.openPath('C:\\');
          break;
        case 'browser':
          shell.openExternal('https://www.google.com');
          break;
        case 'settings':
          exec('ms-settings:');
          break;
        case 'terminal':
          exec('wt');
          break;
        case 'wifi':
          exec('ms-settings:network-wifi');
          break;
        case 'volume':
          exec('ms-settings:sound');
          break;
        case 'battery':
          exec('ms-settings:batterysaver');
          break;
        case 'actioncenter':
          exec('powershell -Command "New-Object -ComObject Shell.Application).FileRun()"');
          break;
        case 'shutdown':
          exec('shutdown /s /t 0');
          break;
        default:
          shell.openPath(action);
          break;
      }
      return { success: true };
    } catch (e) {
      console.error('System action failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-dock-settings', () => {
    const config = loadConfig();
    return config.dockSettings || { opacity: 0.72, blur: 30 };
  });

  ipcMain.handle('save-dock-settings', (event, settings) => {
    const config = loadConfig();
    config.dockSettings = { ...(config.dockSettings || {}), ...settings };
    saveConfig(config);
    return { success: true };
  });

  ipcMain.handle('toggle-taskbar', async (event, hide) => {
    try {
      if (hide) {
        exec('powershell -Command "& {$taskbar = (New-Object -ComObject Shell.Application).Taskbar; $taskbar.AutoHide = $true; $taskbar.AlwaysOnTop = $false}"');
      } else {
        exec('powershell -Command "& {$taskbar = (New-Object -ComObject Shell.Application).Taskbar; $taskbar.AutoHide = $false; $taskbar.AlwaysOnTop = $true}"');
      }
      return { success: true };
    } catch (e) {
      console.error('Toggle taskbar failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-nav-items', () => {
    const config = loadConfig();
    return config.navItems || getDefaultNavItems();
  });

  ipcMain.handle('save-nav-items', async (event, items) => {
    try {
      const config = loadConfig();
      config.navItems = items === null ? getDefaultNavItems() : items;
      saveConfig(config);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Save nav items failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-nav-item', async (event, item) => {
    try {
      const config = loadConfig();
      if (!config.navItems) {
        config.navItems = getDefaultNavItems();
      }
      config.navItems.push({
        id: 'nav_' + Date.now(),
        name: item.name,
        path: item.path,
        type: item.type || 'application',
        visible: true
      });
      saveConfig(config);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Add nav item failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update-nav-item', async (event, { id, updates }) => {
    try {
      const config = loadConfig();
      if (!config.navItems) config.navItems = getDefaultNavItems();
      const idx = config.navItems.findIndex(i => i.id === id);
      if (idx !== -1) {
        config.navItems[idx] = { ...config.navItems[idx], ...updates };
        saveConfig(config);
      }
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Update nav item failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-nav-item', async (event, id) => {
    try {
      const config = loadConfig();
      if (!config.navItems) config.navItems = getDefaultNavItems();
      config.navItems = config.navItems.filter(i => i.id !== id);
      saveConfig(config);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Remove nav item failed:', e.message);
      return { success: false, error: e.message };
    }
  });
}

function getDefaultNavItems() {
  return [
    { id: 'nav_explorer', name: '资源管理器', action: 'explorer', type: 'system', icon: 'explorer', visible: true },
    { id: 'nav_browser', name: '浏览器', action: 'browser', type: 'system', icon: 'browser', visible: true },
    { id: 'nav_terminal', name: '终端', action: 'terminal', type: 'system', icon: 'terminal', visible: true },
    { id: 'nav_taskview', name: '任务视图', action: 'taskview', type: 'system', icon: 'taskview', visible: true }
  ];
}

module.exports = { register };
