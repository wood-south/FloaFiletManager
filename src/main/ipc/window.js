const { ipcMain } = require('electron');

let savedSnapEdges = null;
let savedFloatBounds = null;

function getSnapEdges(bounds, workArea) {
  const visibleSize = 100;
  const w = bounds.width;
  const h = bounds.height;
  const edges = [];

  if (bounds.x <= 0 - w + visibleSize + 10) edges.push('left');
  else if (bounds.x >= workArea.width - visibleSize - 10) edges.push('right');
  if (bounds.y <= 0 - h + visibleSize + 10) edges.push('top');
  else if (bounds.y >= workArea.height - visibleSize - 10) edges.push('bottom');
  return edges;
}

function register({ loadConfig, saveConfig, screen, app, getFloatWindow, getFileManagerWindow, getAlwaysOnTopEnabled, setAlwaysOnTopEnabled }) {
  ipcMain.handle('move-window', (event, deltaX, deltaY) => {
    const floatWindow = getFloatWindow();
    if (!floatWindow) return;
    const bounds = floatWindow.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    let newX = bounds.x + deltaX;
    let newY = bounds.y + deltaY;
    const minVisible = 60;
    newX = Math.max(0 - bounds.width + minVisible, Math.min(newX, workArea.width - minVisible));
    newY = Math.max(0 - bounds.height + minVisible, Math.min(newY, workArea.height - minVisible));
    floatWindow.setPosition(newX, newY);
  });

  // 拖动结束时单次保存位置（避免 moved 事件频繁写配置导致 EPERM）
  ipcMain.handle('save-window-position', () => {
    const floatWindow = getFloatWindow();
    if (!floatWindow) return false;
    const bounds = floatWindow.getBounds();
    const { workArea } = screen.getPrimaryDisplay();

    const edgeThreshold = 60;
    const visibleSize = 100;
    const hideOffset = bounds.width - visibleSize;
    const hideOffsetY = bounds.height - visibleSize;
    let newX = bounds.x;
    let newY = bounds.y;

    // 左侧贴边
    if (bounds.x < edgeThreshold && bounds.x > 0 - bounds.width / 2) {
      newX = 0 - hideOffset;
    }
    // 右侧贴边
    if (bounds.x + bounds.width > workArea.width - edgeThreshold && bounds.x < workArea.width - bounds.width / 2) {
      newX = workArea.width - bounds.width + hideOffset;
    }
    // 顶部贴边
    if (bounds.y < edgeThreshold && bounds.y > 0 - bounds.height / 2) {
      newY = 0 - hideOffsetY;
    }
    // 底部贴边
    if (bounds.y + bounds.height > workArea.height - edgeThreshold && bounds.y < workArea.height - bounds.height / 2) {
      newY = workArea.height - bounds.height + hideOffsetY;
    }

    if (newX !== bounds.x || newY !== bounds.y) {
      floatWindow.setPosition(newX, newY);
    }

    const finalBounds = floatWindow.getBounds();
    const config = loadConfig();
    config.floatPosition = { x: finalBounds.x, y: finalBounds.y };

    // 保存贴边方向（数组，支持同时贴两个边）
    const edges = getSnapEdges(finalBounds, workArea);
    config.snapEdges = edges.length > 0 ? edges : null;

    saveConfig(config);

    // 通知渲染进程更新贴边样式
    floatWindow.webContents.send('snap-edge-changed', edges.length > 0 ? edges : null);

    return true;
  });

  ipcMain.handle('unsnap-window', () => {
    const floatWindow = getFloatWindow();
    if (!floatWindow) return;
    const { workArea } = screen.getPrimaryDisplay();
    const bounds = floatWindow.getBounds();
    const config = loadConfig();
    savedSnapEdges = config.snapEdges || null;

    let newX = bounds.x;
    let newY = bounds.y;

    if (bounds.x < 0) newX = 10;
    else if (bounds.x + bounds.width > workArea.width) newX = workArea.width - bounds.width - 10;
    if (bounds.y < 0) newY = 10;
    else if (bounds.y + bounds.height > workArea.height) newY = workArea.height - bounds.height - 10;

    floatWindow.setPosition(newX, newY);
    floatWindow.webContents.send('snap-edge-changed', null);

    return savedSnapEdges;
  });

  ipcMain.handle('resnap-window', () => {
    const floatWindow = getFloatWindow();
    if (!floatWindow || !savedSnapEdges) return;
    const bounds = floatWindow.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    const visibleSize = 100;
    const w = bounds.width;
    const h = bounds.height;

    let newX = bounds.x;
    let newY = bounds.y;

    for (const edge of savedSnapEdges) {
      switch (edge) {
        case 'left':  newX = -(w - visibleSize); break;
        case 'right': newX = workArea.width - visibleSize; break;
        case 'top':   newY = -(h - visibleSize); break;
        case 'bottom': newY = workArea.height - visibleSize; break;
      }
    }

    floatWindow.setPosition(newX, newY);
    floatWindow.webContents.send('snap-edge-changed', savedSnapEdges);
  });

  ipcMain.handle('get-window-bounds', () => {
    const floatWindow = getFloatWindow();
    if (!floatWindow) return null;
    return floatWindow.getBounds();
  });

  // 临时扩大浮窗窗口以容纳模态框（浮窗默认仅 160x160，模态框无法完整显示）
  ipcMain.handle('expand-float-window', (event, width, height) => {
    const floatWindow = getFloatWindow();
    if (!floatWindow) return false;

    // 若已扩容过则直接返回，避免重复保存被覆盖
    if (savedFloatBounds) return true;

    savedFloatBounds = floatWindow.getBounds();
    const { workArea } = screen.getPrimaryDisplay();

    // 以浮窗中心为中心扩展
    const centerX = savedFloatBounds.x + savedFloatBounds.width / 2;
    const centerY = savedFloatBounds.y + savedFloatBounds.height / 2;

    const newW = Math.round(width);
    const newH = Math.round(height);

    let newX = Math.round(centerX - newW / 2);
    let newY = Math.round(centerY - newH / 2);

    // 保证扩容后的窗口在屏幕工作区内
    newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - newW));
    newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - newH));

    floatWindow.setResizable(true);
    floatWindow.setBounds({ x: newX, y: newY, width: newW, height: newH });
    floatWindow.setResizable(false);
    return true;
  });

  // 恢复浮窗窗口到扩容前的尺寸和位置
  ipcMain.handle('restore-float-window', () => {
    const floatWindow = getFloatWindow();
    if (!floatWindow || !savedFloatBounds) return false;

    floatWindow.setResizable(true);
    floatWindow.setBounds(savedFloatBounds);
    floatWindow.setResizable(false);

    savedFloatBounds = null;
    return true;
  });

  ipcMain.handle('quit-app', () => {
    app.quit();
  });

  ipcMain.handle('toggle-always-on-top', () => {
    const floatWindow = getFloatWindow();
    if (!floatWindow) return false;
    const newState = !getAlwaysOnTopEnabled();
    setAlwaysOnTopEnabled(newState);
    floatWindow.setAlwaysOnTop(newState, 'screen-saver');
    const fileManagerWindow = getFileManagerWindow();
    if (fileManagerWindow) {
      fileManagerWindow.setAlwaysOnTop(newState, 'screen-saver');
    }
    return newState;
  });

  ipcMain.handle('get-always-on-top', () => {
    return getAlwaysOnTopEnabled();
  });

  ipcMain.handle('focus-search', () => {
    const fileManagerWindow = getFileManagerWindow();
    if (fileManagerWindow) {
      fileManagerWindow.webContents.send('focus-search');
    }
    return true;
  });
}

module.exports = { register };
