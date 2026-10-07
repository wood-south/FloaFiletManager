/* ========== DOM 引用 ========== */
const settingsHeader = document.getElementById('settingsHeader');
const settingsClose = document.getElementById('settingsClose');
const settingsNav = document.getElementById('settingsNav');

const settingRadius = document.getElementById('settingRadius');
const settingIconSize = document.getElementById('settingIconSize');
const settingItemCount = document.getElementById('settingItemCount');
const settingOnlyShortcuts = document.getElementById('settingOnlyShortcuts');
// 自定义模式
const settingCustomBlur = document.getElementById('settingCustomBlur');
const settingCustomOpacity = document.getElementById('settingCustomOpacity');
const customBlurValue = document.getElementById('customBlurValue');
const customOpacityValue = document.getElementById('customOpacityValue');
// 模式参数容器
const customParams = document.getElementById('customParams');

const radiusValue = document.getElementById('radiusValue');
const iconSizeValue = document.getElementById('iconSizeValue');
const itemCountValue = document.getElementById('itemCountValue');
const colorOptions = document.getElementById('colorOptions');
const customColorPicker = document.getElementById('customColorPicker');
const blurModeOptions = document.getElementById('blurModeOptions');
const previewDock = document.getElementById('previewDock');

const settingAlwaysOnTop = document.getElementById('settingAlwaysOnTop');
const settingHideSystemTaskbar = document.getElementById('settingHideSystemTaskbar');
const btnResetDockPos = document.getElementById('btnResetDockPos');
const btnCenterDock = document.getElementById('btnCenterDock');

const btnResetIcons = document.getElementById('btnResetIcons');
const btnShowHidden = document.getElementById('btnShowHidden');
const iconList = document.getElementById('iconList');

const aboutLinks = document.querySelector('.about-links');
const btnApply = document.getElementById('btnApply');
const btnOK = document.getElementById('btnOK');

const DEFAULT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

const SYSTEM_ICON_SVG = {
  explorer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 2 12 12 16 14"></polyline></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
  taskview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
  start: '<svg viewBox="0 0 24 24" fill="#0078d4"><path d="M0 0h12v12H0z"/><path d="M12 0h12v12H12z" fill="#107c10"/><path d="M0 12h12v12H0z" fill="#ffb900"/><path d="M12 12h12v12H12z" fill="#e81123"/></svg>'
};

function getSystemIconSvg(item) {
  return SYSTEM_ICON_SVG[item.icon] || SYSTEM_ICON_SVG[item.action] || DEFAULT_ICON_SVG;
}

let currentSettings = {
  blurMode: 'glass',
  radius: 24,
  iconSize: 52,
  itemCount: 10,
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
let navItems = [];

/* ========== 工具函数 ========== */
function buildDockStyle(s) {
  return {
    blurMode: s.blurMode,
    radius: s.radius,
    iconSize: s.iconSize,
    itemCount: s.itemCount,
    onlyShortcuts: s.onlyShortcuts,
    bgColor: s.bgColor,
    glassBlur: s.glassBlur ?? 20,
    glassOpacity: s.glassOpacity ?? 0.2,
    gaussianBlur: s.gaussianBlur ?? 16,
    acrylicBlur: s.acrylicBlur ?? 60,
    acrylicOpacity: s.acrylicOpacity ?? 0.08,
    customColor: s.customColor || s.bgColor,
    customOpacity: s.customOpacity ?? 0.5,
    customBlur: s.customBlur ?? 40
  };
}

/* ========== 实时预览 ========== */
function updatePreview() {
  if (!previewDock) return;
  previewDock.style.setProperty('--preview-radius', currentSettings.radius + 'px');
  const iconPx = Math.max(28, Math.round(currentSettings.iconSize * 0.85));
  previewDock.style.setProperty('--preview-icon-size', iconPx + 'px');

  // 各模式独立预览变量
  previewDock.style.setProperty('--preview-glass-blur', (currentSettings.glassBlur ?? 20) + 'px');
  previewDock.style.setProperty('--preview-glass-opacity', currentSettings.glassOpacity ?? 0.2);
  previewDock.style.setProperty('--preview-gaussian-blur', (currentSettings.gaussianBlur ?? 16) + 'px');
  previewDock.style.setProperty('--preview-acrylic-blur', (currentSettings.acrylicBlur ?? 60) + 'px');
  previewDock.style.setProperty('--preview-acrylic-opacity', currentSettings.acrylicOpacity ?? 0.08);
  previewDock.style.setProperty('--preview-custom-color', currentSettings.customColor || currentSettings.bgColor);
  previewDock.style.setProperty('--preview-custom-opacity', currentSettings.customOpacity);
  previewDock.style.setProperty('--preview-custom-blur', currentSettings.customBlur + 'px');

  previewDock.classList.remove('glass-mode', 'gaussian-mode', 'acrylic-mode', 'custom-mode');
  previewDock.classList.add(currentSettings.blurMode + '-mode');

  // 仅自定义模式显示参数面板
  if (customParams) customParams.style.display = currentSettings.blurMode === 'custom' ? 'block' : 'none';
}

/* ========== 推送到 Dock 主窗口 ========== */
function pushStyleToDock() {
  if (window.electronAPI && window.electronAPI.applyDockStyle) {
    window.electronAPI.applyDockStyle(buildDockStyle(currentSettings));
  }
}

/* ========== 保存设置 ========== */
async function saveSettings() {
  if (!window.electronAPI || !window.electronAPI.saveDockSettings) return;
  await window.electronAPI.saveDockSettings({
    blurMode: currentSettings.blurMode,
    radius: currentSettings.radius,
    iconSize: currentSettings.iconSize,
    itemCount: currentSettings.itemCount,
    onlyShortcuts: currentSettings.onlyShortcuts,
    bgColor: currentSettings.bgColor,
    glassBlur: currentSettings.glassBlur,
    glassOpacity: currentSettings.glassOpacity,
    gaussianBlur: currentSettings.gaussianBlur,
    acrylicBlur: currentSettings.acrylicBlur,
    acrylicOpacity: currentSettings.acrylicOpacity,
    customColor: currentSettings.customColor || currentSettings.bgColor,
    customOpacity: currentSettings.customOpacity,
    customBlur: currentSettings.customBlur
  });
}

/* ========== 加载设置 ========== */
async function loadSettings() {
  try {
    if (!window.electronAPI || !window.electronAPI.getDockSettings) return;
    const s = await window.electronAPI.getDockSettings();
    currentSettings = {
      blurMode: s.blurMode || 'glass',
      radius: s.radius ?? 24,
      iconSize: s.iconSize ?? 52,
      itemCount: s.itemCount ?? 10,
      onlyShortcuts: s.onlyShortcuts === true,
      bgColor: s.bgColor || '#1e1e1e',
      glassBlur: s.glassBlur ?? 20,
      glassOpacity: s.glassOpacity ?? 0.2,
      gaussianBlur: s.gaussianBlur ?? 16,
      acrylicBlur: s.acrylicBlur ?? 60,
      acrylicOpacity: s.acrylicOpacity ?? 0.08,
      customColor: s.customColor || s.bgColor || '#1e1e1e',
      customOpacity: s.customOpacity ?? 0.5,
      customBlur: s.customBlur ?? 40
    };

    settingRadius.value = currentSettings.radius;
    radiusValue.textContent = currentSettings.radius + 'px';
    settingIconSize.value = currentSettings.iconSize;
    iconSizeValue.textContent = currentSettings.iconSize + 'px';
    if (settingItemCount) {
      settingItemCount.value = currentSettings.itemCount;
      itemCountValue.textContent = currentSettings.itemCount;
    }
    if (settingOnlyShortcuts) {
      settingOnlyShortcuts.checked = currentSettings.onlyShortcuts;
    }
    // 自定义模式
    if (settingCustomBlur) {
      settingCustomBlur.value = currentSettings.customBlur;
      customBlurValue.textContent = currentSettings.customBlur + 'px';
    }
    if (settingCustomOpacity) {
      const opPct = Math.round(currentSettings.customOpacity * 100);
      settingCustomOpacity.value = opPct;
      customOpacityValue.textContent = opPct + '%';
    }

    // 更新模糊模式选择器
    if (blurModeOptions) {
      blurModeOptions.querySelectorAll('.blur-mode-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === currentSettings.blurMode);
      });
    }

    document.querySelectorAll('.color-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color.toLowerCase() === currentSettings.bgColor.toLowerCase());
    });

    if (customColorPicker) {
      customColorPicker.value = currentSettings.bgColor;
    }

    updatePreview();
  } catch (e) {
    console.warn('加载设置失败', e);
  }
}

/* ========== 加载常规设置 ========== */
async function loadGeneralSettings() {
  try {
    const onTop = await window.electronAPI.getDockAlwaysOnTop();
    settingAlwaysOnTop.checked = !!onTop;
    const hideTaskbar = await window.electronAPI.getTaskbarHidden();
    settingHideSystemTaskbar.checked = !!hideTaskbar;
  } catch (e) {
    console.warn('加载常规设置失败', e);
  }
}

/* ========== 滑块事件 ========== */
if (blurModeOptions) {
  blurModeOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.blur-mode-opt');
    if (!btn) return;
    blurModeOptions.querySelectorAll('.blur-mode-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSettings.blurMode = btn.dataset.mode;
    updatePreview();
    pushStyleToDock();
    saveSettings();
  });
}

/* 自定义模式 */
if (settingCustomBlur) {
  settingCustomBlur.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    customBlurValue.textContent = val + 'px';
    currentSettings.customBlur = val;
    updatePreview();
    pushStyleToDock();
  });
  settingCustomBlur.addEventListener('change', saveSettings);
}
if (settingCustomOpacity) {
  settingCustomOpacity.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    customOpacityValue.textContent = val + '%';
    currentSettings.customOpacity = val / 100;
    updatePreview();
    pushStyleToDock();
  });
  settingCustomOpacity.addEventListener('change', saveSettings);
}

if (settingRadius) {
  settingRadius.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    radiusValue.textContent = val + 'px';
    currentSettings.radius = val;
    updatePreview();
    pushStyleToDock();
  });
  settingRadius.addEventListener('change', saveSettings);
}

if (settingIconSize) {
  settingIconSize.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    iconSizeValue.textContent = val + 'px';
    currentSettings.iconSize = val;
    updatePreview();
    pushStyleToDock();
  });
  settingIconSize.addEventListener('change', saveSettings);
}

if (settingItemCount) {
  settingItemCount.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    itemCountValue.textContent = val;
    currentSettings.itemCount = val;
    pushStyleToDock();
  });
  settingItemCount.addEventListener('change', saveSettings);
}

if (settingOnlyShortcuts) {
  settingOnlyShortcuts.addEventListener('change', (e) => {
    currentSettings.onlyShortcuts = e.target.checked;
    pushStyleToDock();
    saveSettings();
  });
}

/* ========== 颜色选择 ========== */
if (colorOptions) {
  colorOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-opt');
    if (!btn) return;
    document.querySelectorAll('.color-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSettings.bgColor = btn.dataset.color;
    currentSettings.customColor = btn.dataset.color;
    if (customColorPicker) customColorPicker.value = btn.dataset.color;
    updatePreview();
    pushStyleToDock();
    saveSettings();
  });
}

/* ========== 自定义调色盘 ========== */
if (customColorPicker) {
  customColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    currentSettings.bgColor = color;
    currentSettings.customColor = color;
    document.querySelectorAll('.color-opt').forEach(b => b.classList.remove('active'));
    updatePreview();
    pushStyleToDock();
  });
  customColorPicker.addEventListener('change', saveSettings);
}

/* ========== 常规设置 ========== */
if (settingAlwaysOnTop) {
  settingAlwaysOnTop.addEventListener('change', async () => {
    await window.electronAPI.toggleDockAlwaysOnTop();
    const state = await window.electronAPI.getDockAlwaysOnTop();
    settingAlwaysOnTop.checked = !!state;
  });
}

if (settingHideSystemTaskbar) {
  settingHideSystemTaskbar.addEventListener('change', (e) => {
    window.electronAPI.toggleTaskbar(e.target.checked);
  });
}

if (btnResetDockPos) {
  btnResetDockPos.addEventListener('click', () => {
    if (window.electronAPI.resetDockPos) window.electronAPI.resetDockPos();
  });
}

if (btnCenterDock) {
  btnCenterDock.addEventListener('click', () => {
    if (window.electronAPI.centerDock) window.electronAPI.centerDock();
  });
}

/* ========== 图标管理 ========== */
async function loadNavItems() {
  try {
    navItems = await window.electronAPI.getNavItems();
    await renderIconList();
  } catch (e) {
    console.warn('加载图标列表失败', e);
    iconList.innerHTML = '<div class="empty-tip">加载失败</div>';
  }
}

async function renderIconList() {
  if (!iconList) return;
  if (!navItems || navItems.length === 0) {
    iconList.innerHTML = '<div class="empty-tip">暂无图标，拖拽应用到 Dock 即可添加</div>';
    return;
  }

  iconList.innerHTML = '';
  for (const item of navItems) {
    const row = document.createElement('div');
    row.className = 'icon-list-item';
    row.dataset.id = item.id;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'icon-list-img';
    if (item.type === 'system') {
      imgWrap.innerHTML = getSystemIconSvg(item);
    } else {
      let iconUrl = null;
      try {
        if (item.path && window.electronAPI.getFileIcon) {
          iconUrl = await window.electronAPI.getFileIcon(item.path, false);
        }
      } catch (_) {}
      if (iconUrl) {
        imgWrap.innerHTML = `<img src="${iconUrl}" alt="">`;
      } else {
        imgWrap.innerHTML = DEFAULT_ICON_SVG;
      }
    }

    const name = document.createElement('div');
    name.className = 'icon-list-name' + (item.visible === false ? ' hidden-icon' : '');
    name.textContent = item.name;

    const actions = document.createElement('div');
    actions.className = 'icon-list-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'icon-action-btn';
    toggleBtn.title = item.visible === false ? '显示' : '隐藏';
    toggleBtn.innerHTML = item.visible === false
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    toggleBtn.addEventListener('click', async () => {
      const result = await window.electronAPI.updateNavItem(item.id, { visible: item.visible === false });
      if (result && result.success) {
        navItems = result.items;
        await renderIconList();
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-action-btn danger';
    removeBtn.title = '删除';
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    removeBtn.addEventListener('click', async () => {
      const result = await window.electronAPI.removeNavItem(item.id);
      if (result && result.success) {
        navItems = result.items;
        await renderIconList();
      }
    });

    actions.appendChild(toggleBtn);
    actions.appendChild(removeBtn);
    row.appendChild(imgWrap);
    row.appendChild(name);
    row.appendChild(actions);
    iconList.appendChild(row);
  }
}

if (btnResetIcons) {
  btnResetIcons.addEventListener('click', async () => {
    await window.electronAPI.saveNavItems(null);
    await loadNavItems();
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

/* ========== 关于 ========== */
if (aboutLinks) {
  aboutLinks.addEventListener('click', (e) => {
    const link = e.target.closest('.about-link');
    if (!link) return;
    const action = link.dataset.action;
    if (action === 'open-config' && window.electronAPI.openConfigFolder) {
      window.electronAPI.openConfigFolder();
    }
  });
}

/* ========== Tab 切换 ========== */
if (settingsNav) {
  settingsNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.settings-tab').forEach(s => {
      s.classList.toggle('active', s.dataset.tab === tab);
    });
    if (tab === 'icons') loadNavItems();
  });
}

/* ========== 关闭窗口 ========== */
function closeWindow() {
  if (window.electronAPI && window.electronAPI.closeSettings) {
    window.electronAPI.closeSettings();
  }
}

if (settingsClose) {
  settingsClose.addEventListener('click', closeWindow);
}

if (btnApply) {
  btnApply.addEventListener('click', async () => {
    pushStyleToDock();
    await saveSettings();
  });
}

if (btnOK) {
  btnOK.addEventListener('click', async () => {
    pushStyleToDock();
    await saveSettings();
    closeWindow();
  });
}

/* ========== 窗口拖动 ========== */
if (settingsHeader) {
  settingsHeader.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.settings-close')) return;

    let startX = e.clientX;
    let startY = e.clientY;
    let dragging = false;

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        dragging = true;
        settingsHeader.style.cursor = 'grabbing';
      }
      const dx = ev.screenX - startX;
      const dy = ev.screenY - startY;
      startX = ev.screenX;
      startY = ev.screenY;
      window.electronAPI.moveSettings(dx, dy);
    };

    const onUp = () => {
      settingsHeader.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ========== 键盘快捷键 ========== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeWindow();
  }
});

/* ========== 监听 Dock 样式变化（外部修改同步） ========== */
if (window.electronAPI && window.electronAPI.onDockStyleChanged) {
  window.electronAPI.onDockStyleChanged((style) => {
    if (!style) return;
    // 只同步本页面真实存在的控件，避免引用不存在的元素导致报错
    if (typeof style.blurMode === 'string') {
      currentSettings.blurMode = style.blurMode;
      if (blurModeOptions) {
        blurModeOptions.querySelectorAll('.blur-mode-opt').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === style.blurMode);
        });
      }
      if (customParams) customParams.style.display = style.blurMode === 'custom' ? 'block' : 'none';
    }
    if (typeof style.radius === 'number') {
      currentSettings.radius = style.radius;
      if (settingRadius) settingRadius.value = style.radius;
      if (radiusValue) radiusValue.textContent = style.radius + 'px';
    }
    if (typeof style.iconSize === 'number') {
      currentSettings.iconSize = style.iconSize;
      if (settingIconSize) settingIconSize.value = style.iconSize;
      if (iconSizeValue) iconSizeValue.textContent = style.iconSize + 'px';
    }
    if (typeof style.itemCount === 'number') {
      currentSettings.itemCount = style.itemCount;
      if (settingItemCount) {
        settingItemCount.value = style.itemCount;
        itemCountValue.textContent = style.itemCount;
      }
    }
    if (typeof style.onlyShortcuts === 'boolean') {
      currentSettings.onlyShortcuts = style.onlyShortcuts;
      if (settingOnlyShortcuts) settingOnlyShortcuts.checked = style.onlyShortcuts;
    }
    if (typeof style.glassBlur === 'number') currentSettings.glassBlur = style.glassBlur;
    if (typeof style.glassOpacity === 'number') currentSettings.glassOpacity = style.glassOpacity;
    if (typeof style.gaussianBlur === 'number') currentSettings.gaussianBlur = style.gaussianBlur;
    if (typeof style.acrylicBlur === 'number') currentSettings.acrylicBlur = style.acrylicBlur;
    if (typeof style.acrylicOpacity === 'number') currentSettings.acrylicOpacity = style.acrylicOpacity;
    if (typeof style.customColor === 'string') currentSettings.customColor = style.customColor;
    if (typeof style.customBlur === 'number') {
      currentSettings.customBlur = style.customBlur;
      if (settingCustomBlur) {
        settingCustomBlur.value = style.customBlur;
        if (customBlurValue) customBlurValue.textContent = style.customBlur + 'px';
      }
    }
    if (typeof style.customOpacity === 'number') {
      currentSettings.customOpacity = style.customOpacity;
      if (settingCustomOpacity) {
        const opPct = Math.round(style.customOpacity * 100);
        settingCustomOpacity.value = opPct;
        if (customOpacityValue) customOpacityValue.textContent = opPct + '%';
      }
    }
    if (typeof style.bgColor === 'string') {
      currentSettings.bgColor = style.bgColor;
      if (customColorPicker) customColorPicker.value = style.bgColor;
      document.querySelectorAll('.color-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color.toLowerCase() === style.bgColor.toLowerCase());
      });
    }
    updatePreview();
  });
}

/* ========== 初始化 ========== */
loadSettings();
loadGeneralSettings();
updatePreview();
