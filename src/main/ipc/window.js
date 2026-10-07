const { ipcMain, shell, BrowserWindow } = require('electron');
const { decide } = require('../snap');

let savedSnapEdges = null;
let savedFloatBounds = null;
let savedDockBounds = null;
let dockPanelOffset = null; // dock-panel 真实渲染边界相对 dock 窗口左上角的偏移 {left,top,width,height}
let floatSnapToDock = null; // 浮窗吸附到 dock 的关系 {side, offsetX, offsetY}
// 宠物在浮窗内的真实视觉框（相对浮窗左上角，含贴边旋转与 hover 缩放）
// 由渲染进程上报；吸附位置一律由它推导，不再使用手调的 snapInset 常数
let petVisualAnchor = null;

// 吸附触发距离（像素）
// 刻意取较小值：吸附要"贴得足够近"才触发，用户一旦往外拖就应立刻脱离。
// 早期取值 60，导致松手时只要还在 60px 内就被重新吸回，表现为"吸附后拖不动、会弹回"。
const SNAP_DISTANCE = 26;
// 吸附后宠物视觉边框与面板之间的间隙（0 = 视觉紧贴）
const SNAP_VISUAL_GAP = 0;
// 用户正在手动拖动浮窗：这段时间内不得自动吸附/回吸
let petDragging = false;
// 排查吸附问题时设置 DSH_DEBUG_SNAP=1 打开日志（输出到终端）
const DEBUG_SNAP = !!process.env.DSH_DEBUG_SNAP;

/** 吸附调试日志（默认关闭，不影响正常运行） */
function debugSnap(action, side, panel, anchor, floatBounds, result) {
  if (!DEBUG_SNAP) return;
  const visual = {
    left: floatBounds.x + anchor.left,
    top: floatBounds.y + anchor.top,
    right: floatBounds.x + anchor.left + anchor.width,
    bottom: floatBounds.y + anchor.top + anchor.height
  };
  console.log('[snap]', action, {
    side,
    panel: { x: panel.x, y: panel.y, w: panel.width, h: panel.height },
    anchor,
    float: { x: floatBounds.x, y: floatBounds.y },
    visual,
    result
  });
}

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
    // 几何计算见 ../snap.js（纯函数，可用 test/snap.test.js 验证）：
    // 不再使用手调的 snapInset 常数，改用渲染进程上报的宠物真实视觉框，
    // 这样贴边旋转（视觉框变 90×80）与 hover 缩放时位置依然准确。
    if (newX === bounds.x && newY === bounds.y) {
      // 松手后重新评估吸附：**先清除拖动抑制**，否则搜索会被自己挡掉
      petDragging = false;
      searchDockSnap({ requireExistingRelation: false });
      const afterBounds = floatWindow.getBounds();
      newX = afterBounds.x;
      newY = afterBounds.y;
      dockSnapSide = floatSnapToDock ? floatSnapToDock.side : null;
    } else {
      // 触发了屏幕边缘贴边，不与 Dock 吸附叠加
      floatSnapToDock = null;
      dockSnapSide = null;
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
      // 面板几何变了（改图标大小/数量、切模糊模式、窗口缩放等）：
      // 若浮窗正在吸附，按新几何校正一次，否则会停在旧位置
      maintainDockSnap();
    }
  });

  // 计算 dock-panel 的真实屏幕边界
  function getDockPanelScreenBounds() {
    const { getDockWindow, getDockVisible } = require('../windows');
    const dockWin = typeof getDockWindow === 'function' ? getDockWindow() : null;
    if (!dockWin || dockWin.isDestroyed()) return null;
    // Dock 隐藏时不应参与吸附
    if (typeof getDockVisible === 'function' && !getDockVisible()) return null;
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

  /**
   * 宠物视觉框上报（相对浮窗左上角，含贴边旋转与 hover 缩放）。
   * 锚点或 Dock 几何变化后重算吸附位置：
   * 早期实现只在拖动结束（mouseup）时算一次吸附，之后旋转/缩放/移动 Dock 都不会修正，
   * 表现为「有时候吸附位置不对」。
   */
  ipcMain.handle('report-pet-anchor', (event, anchor) => {
    if (!anchor || typeof anchor.width !== 'number' || typeof anchor.height !== 'number') {
      return false;
    }
    const prev = petVisualAnchor;
    petVisualAnchor = {
      left: Math.round(anchor.left || 0),
      top: Math.round(anchor.top || 0),
      width: Math.round(anchor.width),
      height: Math.round(anchor.height)
    };
    // 用户正在拖动：不做任何自动吸附，避免与手动位移打架
    if (petDragging) return true;
    // 变化不足 1px 视为相同，避免 hover 过渡期间频繁重算
    if (prev &&
        prev.left === petVisualAnchor.left &&
        prev.top === petVisualAnchor.top &&
        prev.width === petVisualAnchor.width &&
        prev.height === petVisualAnchor.height) {
      return true;
    }
    // 视觉框变化后必须重新评估：
    //  - 已在吸附关系中 → 沿当前边校正位置
    //  - 尚未建立关系 → 做一次吸附搜索（这是关键修正：早期只做「保持」而不搜索，
    //    导致「锚点缺失时按窗口吸附产生的偏差」永远得不到纠正，
    //    表现为吸附后始终差一截；同时也无法在首次拖动后建立跟随关系）
    if (floatSnapToDock) maintainDockSnap();
    else searchDockSnap({ requireExistingRelation: false });
    return true;
  });

  /**
   * 标记浮窗是否正在被用户手动拖动。
   * 拖动期间必须完全停止自动吸附：否则「保持」逻辑会在每一帧把浮窗拉回吸附位置，
   * 表现为「吸附后拖不动、会弹回」。
   */
  ipcMain.handle('set-pet-dragging', (event, dragging) => {
    petDragging = !!dragging;
    if (petDragging) {
      // 开始手动拖动即解除吸附关系，松手后由 save-window-position 重新评估
      floatSnapToDock = null;
    }
    return petDragging;
  });

  /**
   * 吸附搜索：按当前几何找最近的一侧并建立吸附关系。
   *
   * 注意顺序：**先判定、后移动**。早期实现先计算位置再无条件 setPosition，
   * 于是"搜索失败"时窗口也会被移动（computeDockSnap 在非候选轴上原样返回当前坐标，
   * 但在候选轴上会给出目标值），表现为位置被改坏、跟随关系丢失。
   *
   * @param {object} [opts]
   * @param {boolean} [opts.requireExistingRelation=true] 为 true 时必须已存在吸附关系
   *   （用于 Dock 移动/改尺寸后的「保持跟随」路径）；为 false 时允许新建关系
   *   （用于宠物视觉框上报后的首次吸附与偏差纠正）。
   * @param {number} [opts.snapDistance] 覆盖默认吸附触发距离
   */
  function searchDockSnap(opts) {
    const requireRelation = !opts || opts.requireExistingRelation !== false;

    // 用户正在手动拖动：不吸附
    if (petDragging) return false;
    if (requireRelation && !floatSnapToDock) return false;

    const floatWindow = getFloatWindow();
    if (!floatWindow || floatWindow.isDestroyed()) return false;
    const panel = getDockPanelScreenBounds();
    if (!panel) {
      if (!requireRelation) return false;
      floatSnapToDock = null;
      return false;
    }
    // 视觉框尚未上报时不做吸附：早期回退为「按整个窗口吸附」会让宠物
    // 比正确位置偏差 (windowH - petH)/2，且该偏差不会被后续上报纠正
    if (!petVisualAnchor) return false;

    const bounds = floatWindow.getBounds();
    const decision = decide({
      floatBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      anchor: petVisualAnchor,
      panelBounds: panel,
      relation: floatSnapToDock,
      mode: 'search',
      snapDistance: (opts && opts.snapDistance) || SNAP_DISTANCE,
      visualGap: SNAP_VISUAL_GAP
    });

    if (decision.action === 'snap') {
      if (decision.x !== bounds.x || decision.y !== bounds.y) {
        floatWindow.setPosition(decision.x, decision.y);
      }
      floatSnapToDock = decision.relation;
      try {
        floatWindow.webContents.send('dock-snap-changed', decision.side);
      } catch (_) {}
      debugSnap('search', decision.side, panel, petVisualAnchor, bounds, decision);
      return true;
    }

    // 未命中吸附：不移动窗口；仅在有旧关系时清除（用户已拖离 Dock）
    if (decision.action === 'release') {
      floatSnapToDock = null;
      try {
        floatWindow.webContents.send('dock-snap-changed', null);
      } catch (_) {}
    }
    return false;
  }

  // 位置已足够接近目标时不再移动，避免浮点/取整造成 1px 级反复微调（抖动）
  const SNAP_SETTLE_TOLERANCE = 2;

  /**
   * 保持跟随：已吸附时沿**当前那条边**重算位置，不重新挑方向
   * （否则 Dock 一移动，浮窗可能被「吸」到另一侧）。
   * 用关系重算而非 delta 累加 —— 累加会把浮窗自身的边界钳制误差一并带进去。
   */
  function maintainDockSnap() {
    if (!floatSnapToDock) return false;
    // 用户正在手动拖动：不把浮窗拉回吸附位置
    if (petDragging) return false;
    const floatWindow = getFloatWindow();
    if (!floatWindow || floatWindow.isDestroyed()) return false;
    if (!petVisualAnchor) return false;
    const panel = getDockPanelScreenBounds();
    if (!panel) {
      floatSnapToDock = null;
      return false;
    }
    const bounds = floatWindow.getBounds();

    // 决策统一交给 snap.js 的 decide()：搜索与保持共用同一套公式，
    // 避免两处公式分叉（历史上正是分叉导致「搜索」与「保持」结果不一致）
    const decision = decide({
      floatBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      anchor: petVisualAnchor,
      panelBounds: panel,
      relation: floatSnapToDock,
      mode: 'maintain',
      visualGap: SNAP_VISUAL_GAP,
      settleTolerance: SNAP_SETTLE_TOLERANCE
    });

    if (decision.action === 'release') {
      floatSnapToDock = null;
      return false;
    }
    if (decision.action !== 'snap') {
      // 已在容差内：仅刷新关系，不移动窗口（避免 1px 级反复微调）
      floatSnapToDock = decision.relation || floatSnapToDock;
      return true;
    }

    floatWindow.setPosition(decision.x, decision.y);
    floatSnapToDock = decision.relation;
    try {
      floatWindow.webContents.send('dock-snap-changed', decision.side);
    } catch (_) {}
    debugSnap('maintain', decision.side, panel, petVisualAnchor, bounds, decision);
    return true;
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

    // 垂直钳制必须按**面板可见边界**而不是窗口边界：
    // 窗口为了预留右键菜单/浮层空间，高度远大于面板（DOCK_RESERVED_HEIGHT），
    // 若按窗口钳制，面板最低只能到 workArea.y + (窗口高 - 面板高)，永远拖不到屏幕上方。
    // 这里允许窗口部分移出工作区上沿（透明区域出屏无副作用），
    // 使面板上沿可以贴到 workArea.y；下沿仍以工作区底部为界。
    const panelHeight = (dockPanelOffset && dockPanelOffset.height) ? dockPanelOffset.height : bounds.height;
    const minY = Math.round(workArea.y - Math.max(0, bounds.height - panelHeight));
    const maxY = workArea.y + workArea.height - bounds.height;
    newY = Math.max(minY, Math.min(newY, Math.max(minY, maxY)));

    win.setPosition(newX, newY);

    // 浮窗吸附在 dock 上时，随 dock 一起移动：按吸附关系重算位置，
    // 而不是累加 delta（累加会把浮窗自身的边界钳制误差一并带进去，越移动越偏）
    maintainDockSnap();

    scheduleDockPosSave(newX, newY + bounds.height);
  });

  // 文件管理窗口拖动
  // 注意：透明无边框窗口下 CSS -webkit-app-region: drag 不可靠（见 docs/PROBLEM_SOLUTIONS.md），
  // 因此与设置窗口一致，改由渲染进程监听鼠标事件 + IPC 移动原生窗口。
  ipcMain.handle('move-file-manager', (event, deltaX, deltaY) => {
    const win = getFileManagerWindow();
    if (!win || win.isDestroyed()) return false;
    const bounds = win.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    let newX = bounds.x + deltaX;
    let newY = bounds.y + deltaY;
    // 至少保留一部分窗口在屏幕内，避免被拖丢
    const minVisible = 80;
    newX = Math.max(workArea.x - bounds.width + minVisible,
      Math.min(newX, workArea.x + workArea.width - minVisible));
    newY = Math.max(workArea.y,
      Math.min(newY, workArea.y + workArea.height - minVisible));
    win.setPosition(newX, newY);
    return true;
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
  // preserveSavedBounds: 当 Dock 因右键菜单/浮层临时扩展时，调用方传入 true，
  // 避免覆盖 savedDockBounds 导致 restore-dock-window 还原到错误的尺寸
  ipcMain.handle('resize-dock-window', (event, width, height, preserveSavedBounds) => {
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
    if (!preserveSavedBounds) {
      savedDockBounds = { x: newX, y: newY, width: newW, height: newH };
    }
    scheduleDockPosSave(newX, newY + newH);
    // 窗口边界与随后的面板上报都会改变面板几何；若浮窗正在吸附，按新几何校正一次
    // （渲染进程会在 resize 后上报 dock-panel 偏移，届时同样会触发校正）
    maintainDockSnap();
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
