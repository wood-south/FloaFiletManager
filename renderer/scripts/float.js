const petBody = document.getElementById('petBody');
const menuRing = document.getElementById('menuRing');
const quitRing = document.getElementById('quitRing');
const dropOverlay = document.getElementById('dropOverlay');
const toast = document.getElementById('toast');
const modalOverlay = document.getElementById('modalOverlay');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalButtons = document.getElementById('modalButtons');

let isDragging = false;
let mouseStartX = 0;
let mouseStartY = 0;
let hasMoved = false;
let menuOpen = false;
let quitOpen = false;
let clickTimer = null;
let wasSnapped = false;
let snapLock = false;
let snapTimer = null;
let recycleMode = false;

const MODAL_ICONS = {
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
};

async function showModal({ type = 'question', title, message, buttons }) {
  // 浮窗默认仅 160x160，需先临时扩容以完整显示模态框
  if (window.electronAPI.expandFloatWindow) {
    await window.electronAPI.expandFloatWindow(420, 320);
  }

  return new Promise((resolve) => {
    modalIcon.className = 'modal-icon ' + type;
    modalIcon.innerHTML = MODAL_ICONS[type] || MODAL_ICONS.question;
    modalTitle.textContent = title || '';
    modalMessage.textContent = message || '';
    modalButtons.innerHTML = '';

    buttons.forEach((btn, index) => {
      const el = document.createElement('button');
      el.className = 'modal-btn ' + (btn.style || 'secondary');
      el.textContent = btn.text;
      el.onclick = () => {
        modalOverlay.classList.remove('active');
        // 关闭后恢复浮窗原尺寸
        if (window.electronAPI.restoreFloatWindow) {
          window.electronAPI.restoreFloatWindow();
        }
        resolve(index);
      };
      modalButtons.appendChild(el);
    });

    modalOverlay.classList.add('active');
  });
}

function showToast(message, duration = 2000) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function toggleMenu() {
  if (menuOpen) {
    closeMenu();
    return;
  }
  closeQuit();
  menuOpen = true;
  menuRing.classList.add('open');
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menuRing.classList.remove('open');
}

function toggleQuit() {
  if (quitOpen) {
    closeQuit();
    return;
  }
  closeMenu();
  quitOpen = true;
  quitRing.classList.add('open');
}

function closeQuit() {
  if (!quitOpen) return;
  quitOpen = false;
  quitRing.classList.remove('open');
}

// 检查是否处于贴边状态
function hasSnapClass() {
  return petBody.classList.contains('snap-left') ||
         petBody.classList.contains('snap-right') ||
         petBody.classList.contains('snap-top') ||
         petBody.classList.contains('snap-bottom');
}

// 贴边时鼠标悬停 → 弹出显示；离开 → 收回贴边
petBody.addEventListener('mouseenter', () => {
  if (isDragging || snapLock) return;
  if (hasSnapClass()) {
    wasSnapped = true;
    hasMoved = false;
    snapLock = true;
    window.electronAPI.unsnapWindow().then(() => {
      setTimeout(() => { snapLock = false; }, 200);
    });
  }
});

petBody.addEventListener('mouseleave', () => {
  if (snapLock) return;
  // 菜单/退出按钮打开时不收回，避免操作中断
  if (wasSnapped && !isDragging && !hasMoved && !menuOpen && !quitOpen) {
    snapLock = true;
    window.electronAPI.resnapWindow().then(() => {
      setTimeout(() => { snapLock = false; }, 200);
    });
  }
  wasSnapped = false;
});

// 拖动逻辑
petBody.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  hasMoved = false;
  mouseStartX = e.screenX;
  mouseStartY = e.screenY;
  petBody.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const deltaX = e.screenX - mouseStartX;
  const deltaY = e.screenY - mouseStartY;
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
    hasMoved = true;
    mouseStartX = e.screenX;
    mouseStartY = e.screenY;
    window.electronAPI.moveWindow(deltaX, deltaY);
  }
});

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  petBody.classList.remove('dragging');

  // 拖动结束后单次保存位置
  if (hasMoved) {
    wasSnapped = false; // 拖动过，离开时不弹回贴边
    window.electronAPI.saveWindowPosition();
  }

  // 没有移动 => 单击或双击
  if (!hasMoved && e.button === 0) {
    // 等待判断是否双击
    if (clickTimer) {
      // 双击 → 打开文件管理
      clearTimeout(clickTimer);
      clickTimer = null;
      closeMenu();
      closeQuit();
      window.electronAPI.openFileManager();
    } else {
      clickTimer = setTimeout(() => {
        // 单击 → 切换菜单
        clickTimer = null;
        toggleMenu();
      }, 250);
    }
  }
});

// 右键 → 显示/收起退出按钮
petBody.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  toggleQuit();
});

// 功能菜单按钮点击
menuRing.addEventListener('click', async (e) => {
  const btn = e.target.closest('.menu-btn');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;

  switch (action) {
    case 'nav':
      closeMenu();
      window.electronAPI.toggleDock();
      break;
    case 'folder':
      closeMenu();
      recycleMode = !recycleMode;
      const folderBtn = menuRing.querySelector('[data-action="folder"]');
      if (folderBtn) {
        folderBtn.classList.toggle('recycle-active', recycleMode);
      }
      showToast(recycleMode ? '回收站模式已开启' : '回收站模式已关闭', 1500);
      // 更新拖放提示
      const dropOverlayText = dropOverlay.querySelector('span');
      if (dropOverlayText) {
        dropOverlayText.textContent = recycleMode ? '释放删除到回收站' : '释放上传';
      }
      break;
    case 'computer':
      closeMenu();
      window.electronAPI.openThisComputer();
      break;
    case 'pin':
      // 不关闭菜单，切换置顶状态
      const newState = await window.electronAPI.toggleAlwaysOnTop();
      btn.classList.toggle('active', newState);
      showToast(newState ? '已开启置顶' : '已关闭置顶', 1500);
      break;
  }
});

// 初始化置顶按钮状态
async function initPinState() {
  const pinBtn = document.getElementById('pinBtn');
  if (pinBtn) {
    const enabled = await window.electronAPI.getAlwaysOnTop();
    pinBtn.classList.toggle('active', enabled);
  }
}
initPinState();

// 退出按钮点击
quitRing.addEventListener('click', (e) => {
  const btn = e.target.closest('.menu-btn');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  if (action === 'quit') {
    closeQuit();
    window.electronAPI.quitApp();
  }
});

// 点击菜单外区域关闭
document.addEventListener('click', (e) => {
  if (menuOpen && !petBody.contains(e.target) && !menuRing.contains(e.target)) {
    closeMenu();
  }
  if (quitOpen && !petBody.contains(e.target) && !quitRing.contains(e.target)) {
    closeQuit();
  }
});

// 拖放上传/删除
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropOverlay.classList.add('drag-over');
  const dropOverlayText = dropOverlay.querySelector('span');
  const dropOverlaySvg = dropOverlay.querySelector('svg');
  if (dropOverlayText) {
    dropOverlayText.textContent = recycleMode ? '释放删除到回收站' : '释放上传';
  }
  if (dropOverlaySvg) {
    if (recycleMode) {
      dropOverlaySvg.innerHTML = `
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      `;
    } else {
      dropOverlaySvg.innerHTML = `
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      `;
    }
  }
  if (recycleMode) {
    dropOverlay.classList.add('recycle-mode');
  } else {
    dropOverlay.classList.remove('recycle-mode');
  }
}, true);

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropOverlay.classList.add('drag-over');
}, true);

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.clientX <= 0 || e.clientY <= 0 ||
      e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
    dropOverlay.classList.remove('drag-over');
    dropOverlay.classList.remove('recycle-mode');
  }
}, true);

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropOverlay.classList.remove('drag-over');
  dropOverlay.classList.remove('recycle-mode');

  const types = Array.from(e.dataTransfer.types);

  // 收集文件路径：支持系统拖放(Files)和文件管理页拖放(text/plain)
  let filePaths = [];
  if (types.includes('Files') || types.includes('application/x-moz-file')) {
    const files = e.dataTransfer.files;
    for (const file of files) {
      if (file.path) filePaths.push(file.path);
    }
  }
  if (types.includes('text/plain')) {
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      text.split('\n').filter(p => p.trim()).forEach(p => filePaths.push(p.trim()));
    }
  }

  if (filePaths.length === 0) return;

  if (recycleMode) {
    // 回收站模式：删除文件
    let successCount = 0;
    for (const filePath of filePaths) {
      const result = await window.electronAPI.deleteFile(filePath);
      if (result.success) successCount++;
    }
    if (successCount > 0) {
      showToast(`已删除 ${successCount} 个文件到回收站`);
    } else {
      showToast('删除失败');
    }
  } else {
    // 普通模式：上传文件
    // 文件管理器打开则上传到当前路径，否则上传到首选路径
    let destDir = null;
    if (window.electronAPI.getUploadDest) {
      destDir = await window.electronAPI.getUploadDest();
    }
    let successCount = 0;
    for (const filePath of filePaths) {
      const fileName = filePath.split(/[\\/]/).pop();
      const result = await window.electronAPI.uploadFile({
        sourcePath: filePath,
        fileName: fileName,
        destDir: destDir
      });

      if (result.duplicate) {
        const choice = await showModal({
          type: 'question',
          title: '文件已存在',
          message: `"${fileName}" 已存在，是否覆盖？`,
          buttons: [
            { text: '覆盖', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });

        if (choice === 0) {
          const overwriteResult = await window.electronAPI.uploadFile({
            sourcePath: filePath,
            fileName: fileName,
            overwrite: true,
            destDir: destDir
          });
          if (overwriteResult.success) successCount++;
        }
      } else if (result.success) {
        successCount++;
      }
    }

    if (successCount > 0) {
      showToast(`成功上传 ${successCount} 个文件`);
    } else {
      showToast('上传取消');
    }
  }
}, true);

// 贴边方向变化时移动桌宠位置
window.electronAPI.onSnapEdgeChanged((edges) => {
  petBody.classList.remove('snap-left', 'snap-right', 'snap-top', 'snap-bottom');
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      petBody.classList.add('snap-' + edge);
    }
  }
});


