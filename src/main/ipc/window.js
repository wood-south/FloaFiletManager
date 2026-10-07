const { ipcMain, shell, BrowserWindow } = require('electron');

let savedSnapEdges = null;
let savedFloatBounds = null;
let savedDockBounds = null;
let dockPanelOffset = null; // dock-panel 真实渲染边界相对 dock 窗口左上角的偏移 {left,top,width,height}
let floatSnapToDock = null; // 浮窗吸附到 dock 的关系 {side, offsetX, offsetY}

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

function register({ loadConfig, saveConfig, screen, app, getFloatWindow, getFileManagerWindow, getAlwaysOnTopEnabled, setAlwaysOnTopEnabled, getDockAlwaysOnTopEnabled, setDockAlwaysOnTopEnabled }) {
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

    const edgeThreshold = 20;
    const visibleSize = 100;
    const hideOffset = bounds.width - visibleSize;
    const hideOffsetY = bounds.height - visibleSize;
    let newX = bounds.x;
    let newY = bounds.y;
    let dockSnapSide = null; // 浮窗吸附到 Dock 的朝向（top/bottom/left/right），用于让宠物底部朝向 dock 边框

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

    // 浮窗吸附到 Dock 真实渲染边框：仅当未触发屏幕边缘贴边时生效
    // 让浮窗可见地贴在 dock-panel 某一侧（上/下/左/右），与"屏幕贴边隐藏"互斥
    if (newX === bounds.x && newY === bounds.y) {
      try {
        const { getDockWindow, getDockVisible } = require('../windows');
        const dockWin = typeof getDockWindow === 'function' ? getDockWindow() : null;
        const dockVisible = typeof getDockVisible === 'function' ? getDockVisible() : false;
        if (dockVisible && dockWin && !dockWin.isDestroyed()) {
          const dk = getDockPanelScreenBounds(); // 真实渲染边界（而非透明窗口边界）
          const snapDist = 50; // 吸附触发阈值：浮窗距 dock 多远时吸附
          // 视觉间隙补偿：浮窗窗口(160)与宠物视觉(90)差值一半，让宠物视觉贴紧 dock
          // 四个方向独立可调，数值越大浮窗越往 dock 方向重叠（越贴边）
          const snapInsetTop = 52;
          const snapInsetBottom = 52;
          const snapInsetLeft = 52;
          const snapInsetRight = 52;
          const fx = bounds.x, fy = bounds.y, fw = bounds.width, fh = bounds.height;
          let snapped = null;

          // x 方向有重叠时才考虑上下吸附
          const xOverlap = fx + fw > dk.x && fx < dk.x + dk.width;
          // y 方向有重叠时才考虑左右吸附
          const yOverlap = fy + fh > dk.y && fy < dk.y + dk.height;

          if (xOverlap) {
            // gap 正数=浮窗在 dock 外侧，负数=浮窗边已越过 dock 边；均在阈值内吸附
            const gapAbove = dk.y - (fy + fh);          // 浮窗下沿 vs dock 上沿
            const gapBelow = fy - (dk.y + dk.height);   // 浮窗上沿 vs dock 下沿
            if (Math.abs(gapAbove) <= snapDist) {
              newY = dk.y - fh + snapInsetTop;   // 吸附到 dock 上方
              snapped = 'top';
            } else if (Math.abs(gapBelow) <= snapDist) {
              newY = dk.y + dk.height - snapInsetBottom; // 吸附到 dock 下方
              snapped = 'bottom';
            }
          }
          if (!snapped && yOverlap) {
            const gapLeft = dk.x - (fx + fw);           // 浮窗右沿 vs dock 左沿
            const gapRight = fx - (dk.x + dk.width);    // 浮窗左沿 vs dock 右沿
            if (Math.abs(gapLeft) <= snapDist) {
              newX = dk.x - fw + snapInsetLeft;   // 吸附到 dock 左侧
              snapped = 'left';
            } else if (Math.abs(gapRight) <= snapDist) {
              newX = dk.x + dk.width - snapInsetRight; // 吸附到 dock 右侧
              snapped = 'right';
            }
          }

          if (snapped) {
            // 记录吸附关系（相对 dock-panel 左上角的偏移），供 dock 移动时浮窗跟随
            floatSnapToDock = {
              side: snapped,
              offsetX: newX - dk.x,
              offsetY: newY - dk.y
            };
            dockSnapSide = snapped; // 记录朝向，让宠物底部朝向 dock 边框
          } else {
            floatSnapToDock = null; // 未吸附，清除关系
            dockSnapSide = null;
          }
        } else {
          floatSnapToDock = null;
        }
      } catch (_) {
        floatSnapToDock = null;
      }
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
    // 通知渲染进程更新 Dock 吸附朝向（让宠物底部朝向 dock 边框）
    floatWindow.webContents.send('dock-snap-changed', dockSnapSide);

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

  // 获取 Dock 窗口边界（用于 dock 右键菜单 screen→client 坐标转换）
  ipcMain.handle('get-dock-bounds', () => {
    const { getDockWindow } = require('../windows');
    const dockWin = getDockWindow();
    if (!dockWin || dockWin.isDestroyed()) return null;
    return dockWin.getBounds();
  });

  // 上报 dock-panel 真实渲染边界（相对 dock 窗口左上角的 client 偏移）
  // 用于浮窗吸附到真实可见的 dock 边框（而非透明窗口边界）
  ipcMain.handle('report-dock-panel-offset', (event, offset) => {
    if (offset && typeof offset.width === 'number' && typeof offset.height === 'number') {
      dockPanelOffset = offset;
    }
  });

  // 计算 dock-panel 的真实屏幕边界
  function getDockPanelScreenBounds() {
    const { getDockWindow } = require('../windows');
    const dockWin = getDockWindow();
    if (!dockWin || dockWin.isDestroyed()) return null;
    if (!dockPanelOffset) {
      // 未上报时回退到 dock 窗口边界
      return dockWin.getBounds();
    }
    const dk = dockWin.getBounds();
    return {
      x: dk.x + (dockPanelOffset.left || 0),
      y: dk.y + (dockPanelOffset.top || 0),
      width: dockPanelOffset.width,
      height: dockPanelOffset.height
    };
  }

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
    // 持久化
    try {
      const config = loadConfig();
      config.floatAlwaysOnTop = newState;
      saveConfig(config);
    } catch (_) {}
    return newState;
  });

  ipcMain.handle('get-always-on-top', () => {
    return getAlwaysOnTopEnabled();
  });

  // Dock 专用始终置顶（不影响浮窗和文件管理窗口）
  ipcMain.handle('toggle-dock-always-on-top', () => {
    const newState = !getDockAlwaysOnTopEnabled();
    setDockAlwaysOnTopEnabled(newState);
    // 持久化
    try {
      const config = loadConfig();
      config.dockAlwaysOnTop = newState;
      saveConfig(config);
    } catch (_) {}
    return newState;
  });

  ipcMain.handle('get-dock-always-on-top', () => {
    return getDockAlwaysOnTopEnabled();
  });

  ipcMain.handle('get-dock-visible', () => {
    const { getDockVisible } = require('../windows');
    return getDockVisible();
  });

  ipcMain.handle('focus-search', () => {
    const fileManagerWindow = getFileManagerWindow();
    if (fileManagerWindow) {
      fileManagerWindow.webContents.send('focus-search');
    }
    return true;
  });

  ipcMain.handle('toggle-dock', () => {
    const { toggleDockWindow } = require('../windows');
    return toggleDockWindow();
  });

  ipcMain.handle('show-dock', () => {
    const { showDockWindow } = require('../windows');
    showDockWindow();
  });

  ipcMain.handle('hide-dock', () => {
    const { hideDockWindow } = require('../windows');
    hideDockWindow();
  });

  // 防抖保存 dock 位置，避免拖动过程中频繁写盘
  // 保存底部位置（bottom）而非顶部，因为 dock 高度会随内容/浮层变化，底部才是稳定锚点
  let dockPosSaveTimer = null;
  function scheduleDockPosSave(x, bottom) {
    if (dockPosSaveTimer) clearTimeout(dockPosSaveTimer);
    dockPosSaveTimer = setTimeout(() => {
      dockPosSaveTimer = null;
      try {
        const config = loadConfig();
        config.dockX = x;
        config.dockBottom = bottom;
        saveConfig(config);
      } catch (e) {
        console.error('保存 dock 位置失败:', e);
      }
    }, 400);
  }

  ipcMain.handle('move-dock', (event, deltaX, deltaY) => {
    const { getDockWindow } = require('../windows');
    const win = getDockWindow();
    if (!win) return;
    const bounds = win.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    let newX = bounds.x + deltaX;
    let newY = bounds.y + deltaY;
    newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - bounds.width));
    newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - bounds.height));
    const actualDx = newX - bounds.x;
    const actualDy = newY - bounds.y;
    win.setPosition(newX, newY);

    // 浮窗吸附在 dock 上时，随 dock 一起移动（保持吸附关系）
    if (floatSnapToDock) {
      const floatWin = getFloatWindow();
      if (floatWin && !floatWin.isDestroyed()) {
        const fb = floatWin.getBounds();
        floatWin.setPosition(fb.x + actualDx, fb.y + actualDy);
      }
    }

    scheduleDockPosSave(newX, newY + bounds.height);
  });

  ipcMain.handle('open-settings', () => {
    const { createSettingsWindow } = require('../windows');
    createSettingsWindow();
  });

  ipcMain.handle('close-settings', () => {
    const { getSettingsWindow } = require('../windows');
    const win = getSettingsWindow();
    if (win) win.close();
  });

  ipcMain.handle('apply-dock-style', (event, style) => {
    const { getDockWindow } = require('../windows');
    const dockWin = getDockWindow();
    if (dockWin && !dockWin.isDestroyed()) {
      dockWin.webContents.send('dock-style-changed', style);
    }
  });

  ipcMain.handle('move-settings', (event, deltaX, deltaY) => {
    const { getSettingsWindow } = require('../windows');
    const win = getSettingsWindow();
    if (!win) return;
    const bounds = win.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    let newX = bounds.x + deltaX;
    let newY = bounds.y + deltaY;
    newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - bounds.width));
    newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - bounds.height));
    win.setPosition(newX, newY);
  });

  // 重置 Dock 到默认底部居中位置
  ipcMain.handle('reset-dock-pos', () => {
    const { getDockWindow } = require('../windows');
    const win = getDockWindow();
    if (!win) return false;
    const { workArea } = screen.getPrimaryDisplay();
    const dockWidth = 800;
    // 初始占位高度，autoFitDockWindow 会在加载后自动适配
    const dockHeight = 120;
    const newX = Math.round(workArea.x + (workArea.width - dockWidth) / 2);
    const desiredBottom = workArea.y + workArea.height - 2;
    const newY = desiredBottom - dockHeight;
    win.setBounds({ x: newX, y: newY, width: dockWidth, height: dockHeight });
    scheduleDockPosSave(newX, desiredBottom);
    return true;
  });

  // 扩展 Dock 窗口以容纳音量/WiFi浮层（保持底部位置不变，向上扩展）
  ipcMain.handle('expand-dock-window', (event, height) => {
    const { getDockWindow } = require('../windows');
    const win = getDockWindow();
    if (!win) return false;
    const bounds = win.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    const targetH = Math.round(height);
    // 保存原始边界（仅首次扩展时保存）
    if (!savedDockBounds) {
      savedDockBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }
    // 基于原始边界计算新位置：保持底部不变，向上扩展
    const baseBottom = savedDockBounds.y + savedDockBounds.height;
    let newY = baseBottom - targetH;
    newY = Math.max(workArea.y, newY);
    win.setResizable(true);
    win.setBounds({ x: savedDockBounds.x, y: newY, width: savedDockBounds.width, height: targetH });
    win.setResizable(false);
    return true;
  });

  // 恢复 Dock 窗口到扩展前的尺寸
  ipcMain.handle('restore-dock-window', () => {
    const { getDockWindow } = require('../windows');
    const win = getDockWindow();
    if (!win || !savedDockBounds) return false;
    win.setResizable(true);
    win.setBounds(savedDockBounds);
    win.setResizable(false);
    savedDockBounds = null;
    return true;
  });

  // 调整 Dock 窗口大小（用于根据图标数量自动适配）
  ipcMain.handle('resize-dock-window', (event, width, height) => {
    const { getDockWindow } = require('../windows');
    const win = getDockWindow();
    if (!win) return false;
    const { workArea } = screen.getPrimaryDisplay();
    const newW = Math.max(180, Math.round(width));
    const newH = Math.max(60, Math.round(height));

    // 保持当前窗口的中心 X 和底部位置不变
    const bounds = win.getBounds();
    const currentCenterX = bounds.x + bounds.width / 2;
    const currentBottom = bounds.y + bounds.height;

    let newX = Math.round(currentCenterX - newW / 2);
    let newY = currentBottom - newH;
    // 边界保护
    newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - newW));
    newY = Math.max(workArea.y, newY);

    win.setResizable(true);
    win.setBounds({ x: newX, y: newY, width: newW, height: newH });
    win.setResizable(false);
    savedDockBounds = { x: newX, y: newY, width: newW, height: newH };
    scheduleDockPosSave(newX, newY + newH);
    return true;
  });

  // 水平居中 Dock（保持当前 Y）
  ipcMain.handle('center-dock', () => {
    const { getDockWindow } = require('../windows');
    const win = getDockWindow();
    if (!win) return false;
    const { workArea } = screen.getPrimaryDisplay();
    const bounds = win.getBounds();
    const newX = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
    win.setPosition(newX, bounds.y);
    scheduleDockPosSave(newX, bounds.y + bounds.height);
    return true;
  });

  // 打开配置文件夹
  ipcMain.handle('open-config-folder', () => {
    try {
      const { configPath } = require('../config');
      const dir = require('path').dirname(configPath);
      shell.openPath(dir);
      return true;
    } catch (e) {
      console.error('打开配置文件夹失败:', e);
      return false;
    }
  });

  // 点击穿透：控制窗口透明区域是否允许鼠标穿透到桌面
  ipcMain.handle('set-ignore-mouse-events', (event, { ignore, opts }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    try {
      win.setIgnoreMouseEvents(ignore, opts);
    } catch (_) {}
  });
}

module.exports = { register };
