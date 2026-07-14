const petBody = document.getElementById('petBody');
const menuRing = document.getElementById('menuRing');
const quitRing = document.getElementById('quitRing');
const dropOverlay = document.getElementById('dropOverlay');
const toast = document.getElementById('toast');

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

function showToast(message, duration = 2000) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function debounceSnap(action) {
  if (snapLock) return;
  snapLock = true;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    snapLock = false;
    if (action) action();
  }, 350);
}

async function doUnsnap() {
  const snapEdge = await window.electronAPI.unsnapWindow();
  wasSnapped = !!snapEdge;
}

function doResnap() {
  window.electronAPI.resnapWindow();
}

function toggleMenu() {
  if (menuOpen) {
    closeMenu();
    return;
  }
  closeQuit();
  menuOpen = true;
  menuRing.classList.add('open');
  debounceSnap(() => doUnsnap());
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menuRing.classList.remove('open');
  if (wasSnapped) {
    wasSnapped = false;
    debounceSnap(() => doResnap());
  }
}

function toggleQuit() {
  if (quitOpen) {
    closeQuit();
    return;
  }
  closeMenu();
  quitOpen = true;
  quitRing.classList.add('open');
  debounceSnap(() => doUnsnap());
}

function closeQuit() {
  if (!quitOpen) return;
  quitOpen = false;
  quitRing.classList.remove('open');
  if (wasSnapped) {
    wasSnapped = false;
    debounceSnap(() => doResnap());
  }
}

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
    case 'search':
      closeMenu();
      window.electronAPI.openFileManager();
      setTimeout(() => {
        window.electronAPI.focusSearch();
      }, 300);
      break;
    case 'folder':
      closeMenu();
      window.electronAPI.openFileManager();
      break;
    case 'settings':
      closeMenu();
      window.electronAPI.openSettings();
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

// 拖放上传
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dropOverlay.classList.add('drag-over');
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropOverlay.classList.add('drag-over');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (e.clientX <= 0 || e.clientY <= 0 ||
      e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
    dropOverlay.classList.remove('drag-over');
  }
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  let successCount = 0;
  for (const file of files) {
    const result = await window.electronAPI.uploadFile({
      sourcePath: file.path,
      fileName: file.name
    });

    if (result.duplicate) {
      // 弹出确认对话框
      const choice = await window.electronAPI.showMessageBox({
        type: 'question',
        buttons: ['覆盖', '取消'],
        defaultId: 1,
        title: '文件已存在',
        message: `文件 "${file.name}" 已存在，是否覆盖？`
      });

      if (choice.response === 0) {
        // 选择覆盖
        const overwriteResult = await window.electronAPI.uploadFile({
          sourcePath: file.path,
          fileName: file.name,
          overwrite: true
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
});

// 贴边方向变化时移动桌宠位置
window.electronAPI.onSnapEdgeChanged((edges) => {
  petBody.classList.remove('snap-left', 'snap-right', 'snap-top', 'snap-bottom');
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      petBody.classList.add('snap-' + edge);
    }
  }
});
