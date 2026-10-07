const dockItems = document.getElementById('dockItems');
const dockItemsInner = document.getElementById('dockItemsInner');
const dockItemsWrapper = document.getElementById('dockItemsWrapper');
const dockContainer = document.getElementById('dockContainer');
const dockTime = document.getElementById('dockTime');
const scrollLeftBtn = document.getElementById('scrollLeft');
const scrollRightBtn = document.getElementById('scrollRight');
const dockPanel = document.getElementById('dockPanel');
const dockClose = document.getElementById('dockClose');
const dockSettings = document.getElementById('dockSettings');

const NAV_ICONS = {
  explorer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 2 12 12 16 14"></polyline></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
  taskview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
  default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
};

let navItems = [];
let iconCache = {};
let renderingLock = false;
let pendingRender = false;
const MIN_VISIBLE_ITEMS = 8;
const currentSettings = {
  blurMode: 'glass',
  radius: 24,
  iconSize: 52,
  itemCount: MIN_VISIBLE_ITEMS,
  onlyShortcuts: false,
  bgColor: '#1e1e1e',
  glassBlur: 20,
  glassOpacity: 0.2,
  gaussianBlur: 16,
  acrylicBlur: 60,
  acrylicOpacity: 0.08,
  customColor: '#1e1e1e',
  customOpacity: 0.5,
  customBlur: 40
};

/* ========== 时间 ========== */
function updateDockTime() {
  if (!dockTime) return;
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const mo = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  dockTime.innerHTML = `<span class="time-date">${mo}/${d}</span><span class="time-clock">${h}:${m}</span>`;
}
setInterval(updateDockTime, 1000);
updateDockTime();

if (dockTime) {
  dockTime.addEventListener('click', (e) => {
    e.stopPropagation();
    window.electronAPI.systemAction('calendar');
  });
}

/* ========== 电量 ========== */
async function updateBattery() {
  if (!window.electronAPI || !window.electronAPI.getBatteryStatus) return;
  try {
    const status = await window.electronAPI.getBatteryStatus();
    const batteryText = document.getElementById('batteryText');
    const dockBattery = document.getElementById('dockBattery');
    if (batteryText && status && typeof status.percent === 'number') {
      batteryText.textContent = status.percent + '%';
    }
    if (dockBattery && status) {
      dockBattery.title = status.charging ? `充电中 ${status.percent}%` : `电量 ${status.percent}%`;
    }
  } catch (e) {
    console.warn('获取电量失败', e);
  }
}
setInterval(updateBattery, 30000);
updateBattery();

/* ========== 加载图标 ========== */
async function loadNavItems() {
  if (!dockItems) return;
  navItems = await window.electronAPI.getNavItems();
  renderNavItems();
}

async function renderNavItems() {
  // 渲染锁：防止并发渲染导致闪烁和重复显示
  if (renderingLock) { pendingRender = true; return; }
  renderingLock = true;

  try {
    if (!dockItemsInner) return;
    dockItemsInner.innerHTML = '';

    // 按路径/名称去重，防止配置中已存在重复项导致显示两个
    const seenPaths = new Set();
    const seenNames = new Set();
    const dedupedItems = [];
    for (const item of navItems) {
      if (!item.visible) continue;
      if (item.type === 'system') {
        dedupedItems.push(item);
        continue;
      }
      const pathKey = (item.path || '').toLowerCase();
      const nameKey = (item.name || '').toLowerCase();
      if (pathKey && seenPaths.has(pathKey)) continue;
      if (!pathKey && nameKey && seenNames.has(nameKey)) continue;
      if (pathKey) seenPaths.add(pathKey);
      if (nameKey) seenNames.add(nameKey);
      dedupedItems.push(item);
    }

    for (const item of dedupedItems) {
      const el = document.createElement('div');
      el.className = 'dock-item';
      el.dataset.navId = item.id;
      // 使用 path 作为启动路径，action 用于系统内置动作
      el.dataset.navAction = item.type === 'system' ? (item.action || item.path) : item.path;
      el.dataset.navPath = item.path || '';
      el.dataset.navType = item.type || 'application';
      el.title = item.name;

      if (item.type === 'system') {
        el.innerHTML = NAV_ICONS[item.icon] || NAV_ICONS[item.action] || NAV_ICONS.default;
      } else {
        const iconUrl = await getAppIcon(item.path);
        if (iconUrl) {
          el.innerHTML = `<img src="${iconUrl}" alt="${item.name}" />`;
        } else {
          el.innerHTML = NAV_ICONS.default;
        }
        // 绑定点击事件打开应用
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const path = el.dataset.navPath;
          if (path && window.electronAPI) {
            window.electronAPI.systemAction(path);
          }
        });
      }

      dockItemsInner.appendChild(el);
    }
    // 重置滚动位置并更新按钮状态
    requestAnimationFrame(() => {
      scrollToOffset(0);
      updateScrollButtons();
    });
    // 应用图标尺寸到新创建的元素
    applyIconSizes(currentSettings.iconSize || 52);
  } finally {
    renderingLock = false;
    if (pendingRender) {
      pendingRender = false;
      renderNavItems();
    }
  }
}

/* 应用图标尺寸到所有按钮和图标 */
function applyIconSizes(iconSize) {
  const sz = iconSize || 52;
  const svgSize = Math.round(sz * 0.54);
  // 更新所有按钮容器
  document.querySelectorAll('.dock-item, .dock-start, .dock-power, .dock-tray-item').forEach(el => {
    el.style.width = sz + 'px';
    el.style.height = sz + 'px';
  });
  // 更新所有SVG图标
  document.querySelectorAll('.dock-item svg, .dock-start svg, .dock-power svg, .dock-tray-item svg').forEach(el => {
    el.style.width = svgSize + 'px';
    el.style.height = svgSize + 'px';
  });
  // 更新img图标
  document.querySelectorAll('.dock-item img').forEach(el => {
    el.style.width = svgSize + 'px';
    el.style.height = svgSize + 'px';
  });
}

/* ========== 滚动控制（transform 方案，避免 overflow 裁剪上浮效果） ========== */
let scrollOffset = 0;

function getMaxScrollOffset() {
  if (!dockItems || !dockItemsInner) return 0;
  return Math.max(0, dockItemsInner.scrollWidth - dockItems.clientWidth);
}

function scrollToOffset(offset) {
  if (!dockItemsInner) return;
  scrollOffset = Math.max(0, Math.min(offset, getMaxScrollOffset()));
  dockItemsInner.style.transform = `translateX(${-scrollOffset}px)`;
  updateScrollButtons();
}

function updateScrollButtons() {
  if (!scrollLeftBtn || !scrollRightBtn) return;
  const max = getMaxScrollOffset();
  const canScrollLeft = scrollOffset > 4;
  const canScrollRight = scrollOffset < max - 4;

  scrollLeftBtn.classList.toggle('visible', canScrollLeft);
  scrollRightBtn.classList.toggle('visible', canScrollRight);
}

if (dockItems) {
  dockItems.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollToOffset(scrollOffset + (e.deltaY > 0 ? 60 : -60));
  }, { passive: false });
}

if (dockPanel) {
  dockPanel.addEventListener('wheel', (e) => {
    // 仅当鼠标在快捷方式区域上方时才滚动
    const rect = dockItems ? dockItems.getBoundingClientRect() : null;
    if (rect && e.clientX >= rect.left && e.clientX <= rect.right) {
      e.preventDefault();
      scrollToOffset(scrollOffset + (e.deltaY > 0 ? 60 : -60));
    }
  }, { passive: false });
}

if (scrollLeftBtn) {
  scrollLeftBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    scrollToOffset(scrollOffset - 120);
  });
}

if (scrollRightBtn) {
  scrollRightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    scrollToOffset(scrollOffset + 120);
  });
}

async function getAppIcon(path) {
  if (iconCache[path]) return iconCache[path];
  try {
    const isDir = await window.electronAPI.isDirectory(path);
    const dataUrl = await window.electronAPI.getFileIcon(path, isDir);
    if (dataUrl) {
      iconCache[path] = dataUrl;
      return dataUrl;
    }
  } catch (e) {
    console.warn('Failed to get icon for', path, e.message);
  }
  return null;
}

/* ========== 点击穿透：透明区域允许鼠标穿透到桌面 ========== */
// 初始化：窗口加载后启用点击穿透（forward: true 保留鼠标事件转发）
if (window.electronAPI?.setIgnoreMouseEvents) {
  window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
}

// 鼠标进入内容区域 → 关闭穿透，捕获鼠标事件
function enableMouseCapture() {
  if (window.electronAPI?.setIgnoreMouseEvents) {
    window.electronAPI.setIgnoreMouseEvents(false);
  }
}
// 鼠标离开内容区域 → 恢复穿透
function enableClickThrough() {
  if (window.electronAPI?.setIgnoreMouseEvents) {
    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
  }
}

// Dock 容器（含面板+浮层）：进入捕获，离开穿透
// 用 mouseover/mouseout 检测是否在容器内任意元素上
let dockDragging = false; // dock 拖动中，禁止点击穿透
if (dockContainer) {
  dockContainer.addEventListener('mouseover', () => {
    // 鼠标在容器内任何子元素上 → 捕获
    enableMouseCapture();
  });
  dockContainer.addEventListener('mouseleave', () => {
    // 右键菜单/浮层打开/拖动中不恢复穿透，确保可交互、避免拖动断连
    if (openContextMenus > 0 || activePopup || dockDragging) return;
    // 鼠标完全离开容器 → 恢复穿透
    enableClickThrough();
  });
}

/* ========== 点击启动 ========== */
document.addEventListener('click', (e) => {
  const item = e.target.closest('[data-nav-action]');
  if (!item) return;
  const action = item.dataset.navAction;
  // 音量和网络按钮显示浮层，不打开系统设置
  if (action === 'volume') {
    e.stopPropagation();
    togglePopup('volume');
    return;
  }
  if (action === 'wifi') {
    e.stopPropagation();
    togglePopup('wifi');
    return;
  }
  if (action === 'power') {
    e.stopPropagation();
    showPowerMenu(e.clientX, e.clientY);
    return;
  }
  if (action === 'start') {
    e.stopPropagation();
    window.electronAPI.systemAction('start');
    return;
  }
  window.electronAPI.systemAction(action);
});

/* ========== 电源菜单（关机/重启/休眠） ========== */
function showPowerMenu(x, y) {
  const existing = document.querySelector('.dock-context-menu');
  if (existing) { existing.remove(); }

  const menu = document.createElement('div');
  menu.className = 'dock-context-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-power="sleep">睡眠</div>
    <div class="ctx-item" data-power="hibernate">休眠</div>
    <div class="ctx-item" data-power="restart">重启</div>
    <div class="ctx-item danger" data-power="shutdown">关机</div>
  `;
  document.body.appendChild(menu);

  // 定位到鼠标位置左上角
  positionMenuAtMouse(menu, x, y);

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.power;
    if (action && window.electronAPI.powerAction) {
      window.electronAPI.powerAction(action);
    }
    menu.remove();
  });

  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/* ========== 音量/WiFi 浮层 ========== */
const volumePopup = document.getElementById('volumePopup');
const wifiPopup = document.getElementById('wifiPopup');
const popupMuteBtn = document.getElementById('popupMuteBtn');
const popupVolumeSlider = document.getElementById('popupVolumeSlider');
const popupVolumeValue = document.getElementById('popupVolumeValue');
const wifiRefreshBtn = document.getElementById('wifiRefreshBtn');
const wifiStatusIcon = document.getElementById('wifiStatusIcon');
const wifiStatusSsid = document.getElementById('wifiStatusSsid');
const wifiStatusSignal = document.getElementById('wifiStatusSignal');
const wifiDisconnectBtn = document.getElementById('wifiDisconnectBtn');
const wifiList = document.getElementById('wifiList');
const wifiStatusRow = document.querySelector('#wifiStatus .wifi-status-row');

let activePopup = null;
let volumeTimer = null;
let currentVolume = 50;
let currentMuted = false;
let currentWifiStatus = null;

function positionPopup(popup, button) {
  if (!popup || !button || !dockContainer) return;
  const containerRect = dockContainer.getBoundingClientRect();
  const btnRect = button.getBoundingClientRect();
  const popupWidth = popup.offsetWidth || 240;
  let left = btnRect.left - containerRect.left + btnRect.width / 2 - popupWidth / 2;
  left = Math.max(8, Math.min(left, containerRect.width - popupWidth - 8));
  popup.style.left = left + 'px';
  // 浮窗显示在 dock 面板上方
  popup.style.bottom = '72px';
  // 扩展窗口以容纳浮层
  if (!windowExpandedForMenu) expandForMenu();
}

async function showPopup(type) {
  const popup = type === 'volume' ? volumePopup : wifiPopup;
  if (!popup) return;

  // 如果当前已有其他浮层显示，先隐藏
  if (activePopup && activePopup !== type) {
    const oldPopup = activePopup === 'volume' ? volumePopup : wifiPopup;
    if (oldPopup) { oldPopup.classList.remove('show'); oldPopup.hidden = true; }
  }

  // 扩展窗口以容纳浮层
  if (!windowExpandedForMenu) expandForMenu();

  popup.hidden = false;
  requestAnimationFrame(() => {
    const button = type === 'volume'
      ? document.querySelector('[data-nav-action="volume"]')
      : document.querySelector('[data-nav-action="wifi"]');
    positionPopup(popup, button);
    popup.classList.add('show');
  });
  activePopup = type;
  if (type === 'volume') loadVolume();
  if (type === 'wifi') {
    loadNetworkStatus();
    loadWifiStatus();
  }
}

function hidePopup() {
  if (volumePopup) { volumePopup.classList.remove('show'); volumePopup.hidden = true; }
  if (wifiPopup) { wifiPopup.classList.remove('show'); wifiPopup.hidden = true; }
  activePopup = null;
  if (volumeTimer) { clearTimeout(volumeTimer); volumeTimer = null; }
  // 如果没有右键菜单打开，恢复窗口大小
  if (openContextMenus === 0) {
    restoreAfterMenu();
  }
}

function togglePopup(type) {
  if (activePopup === type) {
    hidePopup();
  } else {
    if (activePopup) {
      // 先隐藏当前浮层再显示新的
      if (volumePopup) { volumePopup.classList.remove('show'); volumePopup.hidden = true; }
      if (wifiPopup) { wifiPopup.classList.remove('show'); wifiPopup.hidden = true; }
      activePopup = null;
    }
    showPopup(type);
  }
}

/* ========== 音量控制 ========== */
async function loadVolume() {
  if (!window.electronAPI || !window.electronAPI.getVolume) return;
  try {
    const r = await window.electronAPI.getVolume();
    if (r && r.success) {
      currentVolume = r.volume;
      currentMuted = r.muted;
      updateVolumeUI();
    }
  } catch (e) {
    console.warn('获取音量失败', e);
  }
}

function updateVolumeUI() {
  if (popupVolumeSlider) {
    popupVolumeSlider.value = currentVolume;
    popupVolumeSlider.style.setProperty('--vol', currentVolume + '%');
  }
  if (popupVolumeValue) popupVolumeValue.textContent = currentVolume;
  if (popupMuteBtn) popupMuteBtn.classList.toggle('muted', currentMuted);
}

if (popupVolumeSlider) {
  popupVolumeSlider.addEventListener('input', (e) => {
    currentVolume = parseInt(e.target.value, 10);
    popupVolumeSlider.style.setProperty('--vol', currentVolume + '%');
    if (popupVolumeValue) popupVolumeValue.textContent = currentVolume;
    if (currentMuted && currentVolume > 0) {
      currentMuted = false;
      popupMuteBtn.classList.remove('muted');
    }
    // 防抖：拖动结束后才真正设置系统音量
    if (volumeTimer) clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => {
      if (window.electronAPI && window.electronAPI.setVolume) {
        window.electronAPI.setVolume(currentVolume);
      }
    }, 250);
  });
}

if (popupMuteBtn) {
  popupMuteBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.toggleMute) return;
    try {
      const r = await window.electronAPI.toggleMute();
      if (r && r.success) {
        currentMuted = r.muted;
        updateVolumeUI();
      }
    } catch (e) {
      console.warn('静音切换失败', e);
    }
  });
}

/* ========== WiFi 控制 ========== */
const WIFI_ICON_CONNECTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
const WIFI_ICON_DISCONNECTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.28-3.49"></path><path d="M1.42 9a15.91 15.91 0 0 1 8.06-3.16"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
const WIRED_ICON_CONNECTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l3-4M21 7l-3-4M9 7v12M15 7v12"></path></svg>';
const WIRED_ICON_DISCONNECTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l3-4M21 7l-3-4"></path><line x1="1" y1="1" x2="23" y2="23" stroke-width="2"></line></svg>';

/* ========== 网络状态（有线+无线） ========== */
const wiredStatus = document.getElementById('wiredStatus');
const wiredStatusIcon = document.getElementById('wiredStatusIcon');
const wiredStatusName = document.getElementById('wiredStatusName');
const wiredStatusIp = document.getElementById('wiredStatusIp');
const wiredDivider = document.getElementById('wiredDivider');
const wiredStatusRow = document.querySelector('.wifi-status-row.wired');
let networkStatusTimer = null;

async function loadNetworkStatus() {
  if (!window.electronAPI || !window.electronAPI.getNetworkStatus) return;
  try {
    const status = await window.electronAPI.getNetworkStatus();
    renderNetworkStatus(status);
    updateNetworkTrayIcon(status);
  } catch (e) {
    console.warn('获取网络状态失败', e);
  }
}

function renderNetworkStatus(status) {
  if (!status) return;
  // 有线连接
  if (wiredStatus && wiredStatusRow && wiredStatusIcon) {
    if (status.wired) {
      wiredStatus.hidden = false;
      if (wiredDivider) wiredDivider.hidden = false;
      const connected = status.wired.connected;
      wiredStatusIcon.innerHTML = connected ? WIRED_ICON_CONNECTED : WIRED_ICON_DISCONNECTED;
      wiredStatusRow.classList.toggle('disconnected', !connected);
      if (wiredStatusName) wiredStatusName.textContent = status.wired.name || '以太网';
      if (wiredStatusIp) wiredStatusIp.textContent = connected && status.wired.ip ? 'IP: ' + status.wired.ip : (connected ? '已连接' : '未连接');
    } else {
      wiredStatus.hidden = true;
      if (wiredDivider) wiredDivider.hidden = true;
    }
  }
}

function updateNetworkTrayIcon(status) {
  const trayIcon = document.querySelector('[data-nav-action="wifi"] svg');
  if (!trayIcon) return;
  // 优先显示有线连接图标，其次无线，最后断开
  if (status && status.wired && status.wired.connected) {
    trayIcon.outerHTML = WIRED_ICON_CONNECTED.replace('<svg', '<svg data-tray-icon="network"');
  } else if (status && status.wireless && status.wireless.connected) {
    trayIcon.outerHTML = WIFI_ICON_CONNECTED.replace('<svg', '<svg data-tray-icon="network"');
  } else {
    trayIcon.outerHTML = WIFI_ICON_DISCONNECTED.replace('<svg', '<svg data-tray-icon="network"');
  }
}

// 定期更新网络状态和托盘图标
async function initNetworkMonitoring() {
  await loadNetworkStatus();
  if (networkStatusTimer) clearInterval(networkStatusTimer);
  networkStatusTimer = setInterval(loadNetworkStatus, 15000);
}

function signalToBars(signal) {
  const m = String(signal || '').match(/(\d+)/);
  const pct = m ? parseInt(m[1], 10) : 0;
  if (pct >= 75) return 4;
  if (pct >= 50) return 3;
  if (pct >= 25) return 2;
  if (pct > 0) return 1;
  return 0;
}

function wifiBarsIcon(bars) {
  if (bars <= 0) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.28-3.49"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
  }
  // 用不同透明度的弧线表示信号强度
  const paths = [
    '<path d="M1.42 9a16 16 0 0 1 21.16 0" stroke-opacity="' + (bars >= 1 ? 1 : 0.25) + '"></path>',
    '<path d="M5 12.55a11 11 0 0 1 14.08 0" stroke-opacity="' + (bars >= 2 ? 1 : 0.25) + '"></path>',
    '<path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke-opacity="' + (bars >= 3 ? 1 : 0.25) + '"></path>',
    '<circle cx="12" cy="20" r="1" fill="currentColor" fill-opacity="' + (bars >= 4 ? 1 : 0.25) + '"></circle>'
  ];
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + paths.join('') + '</svg>';
}

async function loadWifiStatus() {
  if (!window.electronAPI || !window.electronAPI.getWifiStatus) return;
  try {
    const status = await window.electronAPI.getWifiStatus();
    currentWifiStatus = status;
    renderWifiStatus(status);
  } catch (e) {
    console.warn('获取WiFi状态失败', e);
    renderWifiStatus({ connected: false, ssid: '', signal: '', error: e.message });
  }
}

function renderWifiStatus(status) {
  if (!wifiStatusIcon || !wifiStatusSsid || !wifiStatusSignal || !wifiStatusRow) return;
  if (status && status.connected && status.ssid) {
    wifiStatusIcon.innerHTML = WIFI_ICON_CONNECTED;
    wifiStatusSsid.textContent = status.ssid;
    wifiStatusSignal.textContent = status.signal ? '信号 ' + status.signal : '已连接';
    wifiStatusRow.classList.remove('disconnected');
    wifiDisconnectBtn.hidden = false;
  } else {
    wifiStatusIcon.innerHTML = WIFI_ICON_DISCONNECTED;
    wifiStatusSsid.textContent = '未连接';
    wifiStatusSignal.textContent = status && status.state ? status.state : '';
    wifiStatusRow.classList.add('disconnected');
    wifiDisconnectBtn.hidden = true;
  }
}

async function loadWifiNetworks() {
  if (!window.electronAPI || !window.electronAPI.getWifiNetworks) return;
  if (wifiRefreshBtn) wifiRefreshBtn.classList.add('spinning');
  if (wifiList) wifiList.innerHTML = '<div class="wifi-empty">正在扫描...</div>';
  try {
    const r = await window.electronAPI.getWifiNetworks();
    if (r && r.success) {
      renderWifiNetworks(r.networks || []);
    } else {
      if (wifiList) wifiList.innerHTML = '<div class="wifi-empty">扫描失败</div>';
    }
  } catch (e) {
    console.warn('获取WiFi列表失败', e);
    if (wifiList) wifiList.innerHTML = '<div class="wifi-empty">扫描失败</div>';
  } finally {
    if (wifiRefreshBtn) wifiRefreshBtn.classList.remove('spinning');
  }
}

function renderWifiNetworks(networks) {
  if (!wifiList) return;
  if (!networks || networks.length === 0) {
    wifiList.innerHTML = '<div class="wifi-empty">未找到可用网络</div>';
    return;
  }
  wifiList.innerHTML = '';
  const connectedSsid = currentWifiStatus && currentWifiStatus.connected ? currentWifiStatus.ssid : '';
  for (const net of networks) {
    const item = document.createElement('div');
    item.className = 'wifi-item';
    if (connectedSsid && net.ssid === connectedSsid) item.classList.add('active');
    const bars = signalToBars(net.signal);
    item.innerHTML = `
      <div class="wifi-item-icon">${wifiBarsIcon(bars)}</div>
      <div class="wifi-item-info">
        <div class="wifi-item-name">${escapeHtml(net.ssid)}</div>
        <div class="wifi-item-meta">${net.signal || ''} ${net.security ? '· ' + escapeHtml(net.security) : ''}</div>
      </div>
    `;
    item.addEventListener('click', async () => {
      if (connectedSsid && net.ssid === connectedSsid) return;
      // 显示连接中状态
      const connecting = document.createElement('div');
      connecting.className = 'wifi-item-connecting';
      connecting.textContent = '连接中...';
      item.appendChild(connecting);
      try {
        if (window.electronAPI && window.electronAPI.connectWifi) {
          const r = await window.electronAPI.connectWifi(net.ssid);
          if (r && r.success) {
            connecting.textContent = '已连接';
            connecting.style.color = '#4fc3f7';
            setTimeout(() => connecting.remove(), 1500);
            await loadWifiStatus();
            await loadWifiNetworks();
          } else {
            // 连接失败（可能需要密码或权限），打开系统WiFi设置作为回退
            connecting.textContent = '需在系统设置中连接';
            connecting.style.color = '#ffb900';
            setTimeout(() => {
              connecting.remove();
              // 打开Windows WiFi设置页面
              if (window.electronAPI && window.electronAPI.systemAction) {
                window.electronAPI.systemAction('wifi');
              }
            }, 1500);
          }
        }
      } catch (e) {
        connecting.textContent = '连接失败';
        connecting.style.color = '#ff6b6b';
        setTimeout(() => connecting.remove(), 2000);
      }
    });
    wifiList.appendChild(item);
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (wifiRefreshBtn) {
  wifiRefreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    loadWifiNetworks();
  });
}

if (wifiDisconnectBtn) {
  wifiDisconnectBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!window.electronAPI || !window.electronAPI.disconnectWifi) return;
    try {
      await window.electronAPI.disconnectWifi();
      await loadWifiStatus();
      await loadWifiNetworks();
    } catch (err) {
      console.warn('断开WiFi失败', err);
    }
  });
}

// 点击浮层外区域关闭
document.addEventListener('mousedown', (e) => {
  if (!activePopup) return;
  const popup = activePopup === 'volume' ? volumePopup : wifiPopup;
  const button = activePopup === 'volume'
    ? document.querySelector('[data-nav-action="volume"]')
    : document.querySelector('[data-nav-action="wifi"]');
  if (popup && popup.contains(e.target)) return;
  if (button && button.contains(e.target)) return;
  hidePopup();
});

// 阻止浮层内点击冒泡到 document 的 mousedown（避免误关）
[volumePopup, wifiPopup].forEach((p) => {
  if (p) {
    p.addEventListener('click', (e) => e.stopPropagation());
  }
});

// 窗口失焦时关闭浮层（如点击桌面或其他应用）
window.addEventListener('blur', () => {
  if (activePopup) hidePopup();
});

/* ========== 关闭Dock ========== */
if (dockClose) {
  dockClose.addEventListener('click', () => {
    window.electronAPI.hideDock();
  });
}

/* ========== 设置（独立窗口） ========== */
if (dockSettings) {
  dockSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    window.electronAPI.openSettings();
  });
}

/* ========== 右键菜单 ========== */
let openContextMenus = 0;
let windowExpandedForMenu = false;

function expandForMenu() {
  if (!window.electronAPI || !window.electronAPI.resizeDockWindow || windowExpandedForMenu) return;
  // 扩展窗口到 380px 高度以容纳菜单，向上扩展（保持底部位置）
  windowExpandedForMenu = true;
  requestAnimationFrame(() => {
    if (window.electronAPI && window.electronAPI.resizeDockWindow) {
      // 读取当前面板实际宽度
      const w = dockPanel ? dockPanel.getBoundingClientRect().width : 400;
      window.electronAPI.resizeDockWindow(w, 380);
    }
  });
}

function restoreAfterMenu() {
  if (!windowExpandedForMenu || !window.electronAPI || !window.electronAPI.resizeDockWindow) return;
  windowExpandedForMenu = false;
  requestAnimationFrame(() => {
    autoFitDockWindow(
      Math.max(currentSettings?.itemCount || 0, MIN_VISIBLE_ITEMS),
      currentSettings?.iconSize || 52
    );
  });
}

// 关闭右键菜单
function closeContextMenu(menu) {
  if (!menu) return;
  menu.remove();
  openContextMenus = Math.max(0, openContextMenus - 1);
  if (openContextMenus === 0) {
    restoreAfterMenu();
  }
}

// 在鼠标位置左上角显示菜单，带边界保护
async function positionMenuAtMouse(menu, screenX, screenY) {
  if (!menu) return;
  openContextMenus++; // 先计数，确保 mouseleave 检测到菜单已打开
  // 先扩展窗口以容纳菜单（如果未扩展）
  if (!windowExpandedForMenu) {
    expandForMenu();
    // 等待窗口扩展完成
    await new Promise(r => setTimeout(r, 100));
  }

  // 通过 IPC 获取 dock 窗口边界，将 screen 坐标转为 client 坐标
  let clientX = screenX, clientY = screenY;
  if (window.electronAPI?.getDockBounds) {
    try {
      const bounds = await window.electronAPI.getDockBounds();
      clientX = screenX - bounds.x;
      clientY = screenY - bounds.y;
    } catch (_) {}
  }

  requestAnimationFrame(() => {
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    if (!menuW || !menuH) return;

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const padding = 6;

    let left = clientX;
    let top = clientY;

    if (left + menuW > winW - padding) left = winW - menuW - padding;
    if (top + menuH > winH - padding) top = winH - menuH - padding;
    left = Math.max(padding, left);
    top = Math.max(padding, top);

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  });
}

document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.dock-item');
  // 用 screen 坐标保存鼠标位置，避免窗口扩展后 client 坐标失效
  if (item) {
    e.preventDefault();
    showContextMenu(e.screenX, e.screenY, item.dataset.navId);
    return;
  }
  // 右键 Dock 空白区域
  const inPanel = e.target.closest('.dock-panel') || e.target.closest('.dock-container');
  if (inPanel) {
    e.preventDefault();
    showDockAreaContextMenu(e.screenX, e.screenY);
  }
});

async function showDockAreaContextMenu(x, y) {
  const existing = document.querySelector('.dock-context-menu');
  if (existing) closeContextMenu(existing);

  // 先异步获取桌面图标状态，再创建菜单，避免菜单先出现在默认位置导致闪动
  let iconsHidden = false;
  if (window.electronAPI?.getDesktopIconsHidden) {
    try { iconsHidden = await window.electronAPI.getDesktopIconsHidden(); } catch (_) {}
  }

  const menu = document.createElement('div');
  menu.className = 'dock-context-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-action="open-settings">打开设置</div>
    <div class="ctx-item" data-action="toggle-shortcuts">${dockContainer && dockContainer.classList.contains('only-shortcuts') ? '显示全部元素' : '仅显示快捷图标'}</div>
    <div class="ctx-item" data-action="toggle-desktop-icons">${iconsHidden ? '显示桌面图标' : '隐藏桌面图标'}</div>
  `;
  document.body.appendChild(menu);

  // 定位到鼠标位置左上角
  positionMenuAtMouse(menu, x, y);

  menu.addEventListener('click', async (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'open-settings') {
      window.electronAPI.openSettings();
    } else if (action === 'toggle-shortcuts') {
      const settings = await window.electronAPI.getDockSettings();
      const newVal = !(settings.onlyShortcuts === true);
      await window.electronAPI.saveDockSettings({ onlyShortcuts: newVal });
      applyDockStyle({ ...(settings || {}), onlyShortcuts: newVal });
    } else if (action === 'toggle-desktop-icons') {
      if (window.electronAPI?.toggleDesktopIcons) {
        await window.electronAPI.toggleDesktopIcons();
      }
    }
    closeContextMenu(menu);
  });

  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      closeContextMenu(menu);
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/* ========== 拖拽添加 ========== */
let dropInProgress = false;
let lastDropTime = 0;
const pendingPaths = new Set();

async function addPathToDock(name, path) {
  if (!name || !path) return;
  const key = String(path).toLowerCase();
  // 避免重复添加：已存在或正在添加中
  if (navItems.some(i => i.path && i.path.toLowerCase() === key)) return;
  if (pendingPaths.has(key)) return;
  pendingPaths.add(key);
  try {
    const result = await window.electronAPI.addNavItem({
      name: name,
      path: path,
      type: 'application'
    });
    // 即使添加失败（重复），也用返回的 items 更新（清理已有重复项）
    if (result.items) {
      navItems = result.items;
      await renderNavItems();
    }
    if (result.success) {
      // 自动滚动到末尾，让新图标可见
      requestAnimationFrame(() => {
        scrollToOffset(getMaxScrollOffset());
      });
    }
  } finally {
    pendingPaths.delete(key);
  }
}

if (dockItems) {
  dockItems.addEventListener('dragover', (e) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files') || types.includes('text/x-path-item') || types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      dockItems.classList.add('drag-over');
    }
  });
  dockItems.addEventListener('dragleave', () => {
    dockItems.classList.remove('drag-over');
  });
  dockItems.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    dockItems.classList.remove('drag-over');
    // 防止重复处理（标志位 + 时间窗口双重去重）
    const now = Date.now();
    if (dropInProgress || (now - lastDropTime < 800)) return;
    dropInProgress = true;
    lastDropTime = now;
    try {
      const types = Array.from(e.dataTransfer.types);

      // 1) 优先处理系统文件拖拽（避免与 text/plain 重复添加）
      if (types.includes('Files')) {
        const file = e.dataTransfer.files[0];
        if (file && file.path) {
          const name = file.name.replace(/\.[^.]+$/, '');
          await addPathToDock(name, file.path);
          return;
        }
      }

      // 2) 来自文件管理页的路径项
      if (types.includes('text/x-path-item')) {
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/x-path-item') || '{}');
          if (data.path) {
            const baseName = data.name || String(data.path).split(/[\\/]/).pop();
            await addPathToDock(baseName, data.path);
            return;
          }
        } catch (_) {}
      }

      // 3) 普通文本（可能是路径）
      if (types.includes('text/plain')) {
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
          const baseName = text.split(/[\\/]/).pop();
          await addPathToDock(baseName, text);
        }
      }
    } finally {
      dropInProgress = false;
    }
  });
}

function showContextMenu(x, y, itemId) {
  const existing = document.querySelector('.dock-context-menu');
  if (existing) closeContextMenu(existing);

  const menu = document.createElement('div');
  menu.className = 'dock-context-menu';
  document.body.appendChild(menu);

  menu.innerHTML = `
    <div class="ctx-item" data-action="hide">隐藏此图标</div>
    <div class="ctx-item danger" data-action="remove">删除此图标</div>
  `;

  // 定位到鼠标位置左上角
  positionMenuAtMouse(menu, x, y);

  const handleAction = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'hide') {
      const result = await window.electronAPI.updateNavItem(itemId, { visible: false });
      if (result.success) { navItems = result.items; await renderNavItems(); }
    } else if (action === 'remove') {
      const result = await window.electronAPI.removeNavItem(itemId);
      if (result.success) { navItems = result.items; await renderNavItems(); }
    }
    closeContextMenu(menu);
  };

  menu.addEventListener('click', handleAction);
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      closeContextMenu(menu);
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/* ========== 拖动Dock窗口 ========== */
if (dockPanel) {
  dockPanel.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.dock-item') || e.target.closest('.dock-start') || e.target.closest('.dock-tray-item')) return;

    let startX = e.screenX;
    let startY = e.screenY;
    let dragging = false;

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.screenX - startX) < 3 && Math.abs(ev.screenY - startY) < 3) return;
        dragging = true;
        dockDragging = true;
        dockPanel.classList.add('dragging');
      }
      const dx = ev.screenX - startX;
      const dy = ev.screenY - startY;
      startX = ev.screenX;
      startY = ev.screenY;
      window.electronAPI.moveDock(dx, dy);
    };

    const onUp = () => {
      dockPanel.classList.remove('dragging');
      dockDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ========== 外观设置 ========== */
function applyDockStyle(settings) {
  // 保存当前设置供初始化使用
  Object.assign(currentSettings, settings || {});

  const blurMode = settings.blurMode || 'glass';
  const radius = settings.radius ?? 24;
  const iconSize = settings.iconSize ?? 52;
  const itemCount = settings.itemCount ?? MIN_VISIBLE_ITEMS;
  const onlyShortcuts = settings.onlyShortcuts === true;
  const bgColor = settings.bgColor || '#1e1e1e';

  // 各模式独立参数
  const glassBlur = settings.glassBlur ?? 20;
  const glassOpacity = settings.glassOpacity ?? 0.2;
  const gaussianBlur = settings.gaussianBlur ?? 16;
  const acrylicBlur = settings.acrylicBlur ?? 60;
  const acrylicOpacity = settings.acrylicOpacity ?? 0.08;
  const customColor = settings.customColor || bgColor;
  const customOpacity = settings.customOpacity ?? 0.5;
  const customBlur = settings.customBlur ?? 40;

  // 批量设置 CSS 变量（仅设置 dock.css 中真正消费的变量）
  const target = dockContainer || document.documentElement;
  target.style.setProperty('--dock-radius', radius + 'px');
  target.style.setProperty('--dock-bg', bgColor);
  // 玻璃模式
  target.style.setProperty('--dock-glass-blur', glassBlur + 'px');
  target.style.setProperty('--dock-glass-opacity', glassOpacity);
  // 高斯模式
  target.style.setProperty('--dock-gaussian-blur', gaussianBlur + 'px');
  // 亚克力模式
  target.style.setProperty('--dock-acrylic-blur', acrylicBlur + 'px');
  target.style.setProperty('--dock-acrylic-opacity', acrylicOpacity);
  // 自定义模式
  target.style.setProperty('--dock-custom-color', customColor);
  target.style.setProperty('--dock-custom-opacity', customOpacity);
  target.style.setProperty('--dock-custom-blur', customBlur + 'px');
  const sepHeight = Math.max(16, Math.round(iconSize * 0.6));
  target.style.setProperty('--dock-sep-height', sepHeight + 'px');

  // 仅显示快捷图标模式
  if (dockContainer) {
    dockContainer.classList.toggle('only-shortcuts', onlyShortcuts);
  }

  // 切换模糊模式
  if (dockPanel) {
    dockPanel.style.borderRadius = radius + 'px';
    dockPanel.classList.remove('glass-mode', 'gaussian-mode', 'acrylic-mode', 'custom-mode');
    dockPanel.classList.add(blurMode + '-mode');
  }

  // 同时为 dockContainer 添加模式类，使浮层也能跟随切换
  if (dockContainer) {
    dockContainer.classList.remove('glass-mode', 'gaussian-mode', 'acrylic-mode', 'custom-mode');
    dockContainer.classList.add(blurMode + '-mode');
  }

  // 更新所有按钮和图标尺寸
  applyIconSizes(iconSize);

  // 首次加载时窗口尺寸由初始化流程负责，避免与图标渲染竞争；之后跟随设置变化
  if (initialSizeDone) {
    requestAnimationFrame(() => {
      autoFitDockWindow(itemCount, iconSize);
      updateScrollButtons();
    });
  }
}

/* 根据设置自动适配 dock 窗口大小 */
let initialSizeDone = false;

// 上报 dock-panel 真实渲染边界（相对窗口左上角的 client 偏移）
// 供主进程计算真实屏幕边界，用于浮窗吸附到可见的 dock 边框
function reportPanelOffset() {
  if (!dockPanel || !window.electronAPI?.reportDockPanelOffset) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const rect = dockPanel.getBoundingClientRect();
      window.electronAPI.reportDockPanelOffset({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
    });
  });
}

function autoFitDockWindow(itemCount, iconSize) {
  if (!window.electronAPI || !window.electronAPI.resizeDockWindow) return;

  const sz = iconSize || 52;
  const gap = 6;
  const requestedCount = Math.max(itemCount, MIN_VISIBLE_ITEMS);
  // 实际可见的 shortcut 数量
  const actualCount = navItems.filter(i => i && i.visible !== false).length;
  // 当实际 shortcut 数量少于设定数量时，按实际数量显示（最小 MIN_VISIBLE_ITEMS），不显示多余位置
  const effectiveCount = Math.max(MIN_VISIBLE_ITEMS, Math.min(requestedCount, actualCount));

  // 计算可见区域总宽度（每个 item 宽 sz，之间 gap）
  const visibleAreaWidth = effectiveCount * sz + gap * Math.max(0, effectiveCount - 1);

  // 设置dock-items容器宽度为可见数量，使用精确的像素值
  if (dockItems && dockItemsInner) {
    // 外层容器：精确控制宽度，防止堆叠
    dockItems.style.width = visibleAreaWidth + 'px';
    dockItems.style.maxWidth = visibleAreaWidth + 'px';
    dockItems.style.minWidth = visibleAreaWidth + 'px';
    // 使用 flex: none 禁止任何 flex 压缩
    dockItems.style.flex = 'none';
    dockItems.style.flexShrink = '0';
    dockItems.style.flexGrow = '0';
    dockItems.style.flexBasis = visibleAreaWidth + 'px';

    // 内层容器：允许滚动但不小于外层
    dockItemsInner.style.minWidth = visibleAreaWidth + 'px';
    dockItemsInner.style.flexShrink = '0';
    dockItemsInner.style.flex = '0 0 auto';
  }

  // 同步更新 dock-items-wrapper 防止堆叠
  if (dockItemsWrapper) {
    dockItemsWrapper.style.flexShrink = '0';
    dockItemsWrapper.style.flex = 'none';
  }

  requestAnimationFrame(() => {
    // 使用实际渲染尺寸来匹配窗口
    if (dockPanel) {
      // 先重置面板尺寸，让其按内容自适应
      dockPanel.style.width = 'auto';
      dockPanel.style.maxWidth = 'none';

      const panelRect = dockPanel.getBoundingClientRect();
      const winBuffer = 4;
      const hoverBuffer = 14; // 预留 hover 上浮空间
      const totalWidth = Math.max(180, Math.round(panelRect.width + winBuffer));
      const totalHeight = Math.max(60, Math.round(panelRect.height + winBuffer + hoverBuffer));

      window.electronAPI.resizeDockWindow(totalWidth, totalHeight).then(() => {
        // resize 生效后上报真实渲染边界
        reportPanelOffset();
      });
    }
  });
}

async function loadDockSettings() {
  try {
    const settings = await window.electronAPI.getDockSettings();
    applyDockStyle(settings);
  } catch (e) {
    console.warn('Failed to load dock settings', e);
  }
}

// 监听设置窗口推送的样式变化（实时预览）
if (window.electronAPI && window.electronAPI.onDockStyleChanged) {
  window.electronAPI.onDockStyleChanged((style) => {
    applyDockStyle(style || {});
  });
}

// 监听 nav items 变化（设置页或拖拽添加后刷新）
if (window.electronAPI && window.electronAPI.onNavItemsChanged) {
  window.electronAPI.onNavItemsChanged(() => {
    iconCache = {};
    loadNavItems().then(() => {
      if (initialSizeDone) {
        requestAnimationFrame(() => {
          autoFitDockWindow(
            Math.max(currentSettings?.itemCount || 0, MIN_VISIBLE_ITEMS),
            currentSettings?.iconSize || 52
          );
        });
      }
    });
  });
}

// 确保 dock-panel 一定会显示（不再用 visibility:hidden 等待加载）
// 直接显示，样式通过 applyDockStyle 控制
if (dockPanel) {
  dockPanel.style.opacity = '0';
  dockPanel.style.transform = 'translateY(10px)';
  dockPanel.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
}

loadDockSettings();
loadNavItems().then(() => {
  if (!initialSizeDone) {
    autoFitDockWindow(
      Math.max(currentSettings?.itemCount || 0, MIN_VISIBLE_ITEMS),
      currentSettings?.iconSize || 52
    );
    initialSizeDone = true;
  }
}).catch(err => {
  console.warn('loadNavItems 失败，继续显示 dock', err);
}).finally(() => {
  setTimeout(() => {
    if (dockPanel) {
      dockPanel.style.opacity = '1';
      dockPanel.style.transform = 'translateY(0)';
    }
  }, 100);
});

// 兜底：2秒后强制显示 dock-panel，防止任何加载失败导致不可见
setTimeout(() => {
  if (dockPanel && dockPanel.style.opacity !== '1') {
    dockPanel.style.opacity = '1';
    dockPanel.style.transform = 'translateY(0)';
  }
}, 2000);

initNetworkMonitoring();
