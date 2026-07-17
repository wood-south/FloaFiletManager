const dockItems = document.getElementById('dockItems');
const dockTime = document.getElementById('dockTime');
const dockPanel = document.getElementById('dockPanel');
const dockClose = document.getElementById('dockClose');
const dockSettings = document.getElementById('dockSettings');
const dockSettingsPanel = document.getElementById('dockSettingsPanel');
const settingsClose = document.getElementById('settingsClose');
const settingAlwaysOnTop = document.getElementById('settingAlwaysOnTop');
const settingHideSystemTaskbar = document.getElementById('settingHideSystemTaskbar');
const btnResetIcons = document.getElementById('btnResetIcons');
const btnShowHidden = document.getElementById('btnShowHidden');
const settingOpacity = document.getElementById('settingOpacity');
const settingBlur = document.getElementById('settingBlur');
const opacityValue = document.getElementById('opacityValue');
const blurValue = document.getElementById('blurValue');

const NAV_ICONS = {
  explorer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 2 12 12 16 14"></polyline></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
  taskview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
  default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
};

let navItems = [];
let iconCache = {};

/* ========== 时间 ========== */
function updateDockTime() {
  if (!dockTime) return;
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  dockTime.innerHTML = `<span>${h}:${m}</span>`;
}
setInterval(updateDockTime, 1000);
updateDockTime();

/* ========== 加载图标 ========== */
async function loadNavItems() {
  if (!dockItems) return;
  navItems = await window.electronAPI.getNavItems();
  renderNavItems();
}

async function renderNavItems() {
  if (!dockItems) return;
  dockItems.innerHTML = '';
  
  for (const item of navItems) {
    if (!item.visible) continue;
    
    const el = document.createElement('div');
    el.className = 'dock-item';
    el.dataset.navId = item.id;
    el.dataset.navAction = item.action || item.path;
    el.title = item.name;

    const tooltip = document.createElement('div');
    tooltip.className = 'dock-tooltip';
    tooltip.textContent = item.name;

    if (item.type === 'system') {
      el.innerHTML = NAV_ICONS[item.icon] || NAV_ICONS[item.action] || NAV_ICONS.default;
    } else {
      const iconUrl = await getAppIcon(item.path);
      if (iconUrl) {
        el.innerHTML = `<img src="${iconUrl}" alt="${item.name}" />`;
      } else {
        el.innerHTML = NAV_ICONS.default;
      }
    }

    el.appendChild(tooltip);
    dockItems.appendChild(el);
  }
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

/* ========== 点击启动 ========== */
document.addEventListener('click', (e) => {
  const item = e.target.closest('[data-nav-action]');
  if (!item) return;
  const action = item.dataset.navAction;
  window.electronAPI.systemAction(action);
});

/* ========== 关闭Dock ========== */
if (dockClose) {
  dockClose.addEventListener('click', () => {
    window.electronAPI.hideDock();
  });
}

/* ========== 设置面板 ========== */
function toggleSettings() {
  const isActive = dockSettingsPanel.classList.contains('active');
  if (isActive) {
    dockSettingsPanel.classList.remove('active');
  } else {
    dockSettingsPanel.classList.add('active');
  }
}

if (dockSettings) {
  dockSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettings();
  });
}

if (settingsClose) {
  settingsClose.addEventListener('click', () => {
    dockSettingsPanel.classList.remove('active');
  });
}

document.addEventListener('click', (e) => {
  if (!dockSettingsPanel.contains(e.target) && !dockSettings.contains(e.target)) {
    dockSettingsPanel.classList.remove('active');
  }
});

if (settingAlwaysOnTop) {
  settingAlwaysOnTop.addEventListener('change', async (e) => {
    await window.electronAPI.toggleAlwaysOnTop();
  });
}

if (settingHideSystemTaskbar) {
  settingHideSystemTaskbar.addEventListener('change', (e) => {
    window.electronAPI.toggleTaskbar(e.target.checked);
  });
}

if (btnResetIcons) {
  btnResetIcons.addEventListener('click', async () => {
    await window.electronAPI.saveNavItems(null);
    iconCache = {};
    await loadNavItems();
    dockSettingsPanel.classList.remove('active');
  });
}

if (btnShowHidden) {
  btnShowHidden.addEventListener('click', async () => {
    for (const item of navItems) {
      item.visible = true;
    }
    await window.electronAPI.saveNavItems(navItems);
    await loadNavItems();
  });
}

/* ========== 右键菜单 ========== */
document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.dock-item');
  if (item) {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, item.dataset.navId);
  }
});

/* ========== 拖拽添加 ========== */
if (dockItems) {
  dockItems.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dockItems.classList.add('drag-over');
  });
  dockItems.addEventListener('dragleave', () => {
    dockItems.classList.remove('drag-over');
  });
  dockItems.addEventListener('drop', async (e) => {
    e.preventDefault();
    dockItems.classList.remove('drag-over');
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files')) {
      const file = e.dataTransfer.files[0];
      if (file && file.path) {
        const name = file.name.replace(/\.[^.]+$/, '');
        const result = await window.electronAPI.addNavItem({
          name: name,
          path: file.path,
          type: 'application'
        });
        if (result.success) {
          navItems = result.items;
          await renderNavItems();
        }
      }
    }
  });
}

function showContextMenu(x, y, itemId) {
  const existing = document.querySelector('.dock-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'dock-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.innerHTML = `
    <div class="ctx-item" data-action="hide">隐藏此图标</div>
    <div class="ctx-item danger" data-action="remove">删除此图标</div>
  `;
  document.body.appendChild(menu);

  const handleAction = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'hide') {
      const result = await window.electronAPI.updateNavItem(itemId, { visible: false });
      if (result.success) { navItems = result.items; await renderNavItems(); }
    } else if (action === 'remove') {
      const result = await window.electronAPI.removeNavItem(itemId);
      if (result.success) { navItems = result.items; await renderNavItems(); }
    }
    menu.remove();
  };

  menu.addEventListener('click', handleAction);
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
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

    let startX = e.clientX;
    let startY = e.clientY;
    let dragging = false;

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        dragging = true;
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
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ========== 外观设置 ========== */
function applyDockStyle(opacity, blur) {
  if (dockPanel) {
    dockPanel.style.setProperty('--dock-opacity', opacity);
    dockPanel.style.setProperty('--dock-blur', blur + 'px');
  }
}

async function loadDockSettings() {
  try {
    const settings = await window.electronAPI.getDockSettings();
    const opacity = Math.round((settings.opacity || 0.72) * 100);
    const blur = settings.blur || 30;

    if (settingOpacity) {
      settingOpacity.value = opacity;
      opacityValue.textContent = opacity + '%';
    }
    if (settingBlur) {
      settingBlur.value = blur;
      blurValue.textContent = blur + 'px';
    }
    applyDockStyle(settings.opacity || 0.72, blur);
  } catch (e) {
    console.warn('Failed to load dock settings', e);
  }
}

if (settingOpacity) {
  settingOpacity.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    opacityValue.textContent = val + '%';
    applyDockStyle(val / 100, parseInt(settingBlur?.value || 30));
  });
  settingOpacity.addEventListener('change', async (e) => {
    await window.electronAPI.saveDockSettings({
      opacity: parseInt(e.target.value) / 100,
      blur: parseInt(settingBlur?.value || 30)
    });
  });
}

if (settingBlur) {
  settingBlur.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    blurValue.textContent = val + 'px';
    applyDockStyle(parseInt(settingOpacity?.value || 72) / 100, val);
  });
  settingBlur.addEventListener('change', async (e) => {
    await window.electronAPI.saveDockSettings({
      opacity: parseInt(settingOpacity?.value || 72) / 100,
      blur: parseInt(e.target.value)
    });
  });
}

loadDockSettings();
loadNavItems();
