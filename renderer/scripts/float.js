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
let recycleMode = false;
let modalActive = false; // 模态框打开时禁止点击穿透
// 拖动的窗口移动合并到每帧一次（避免同一帧多次 setPosition 造成闪动）
let dragPendingDx = 0;
let dragPendingDy = 0;
let dragRafPending = false;

/* ========== 点击穿透：透明区域允许鼠标穿透到桌面 ========== */
function enableMouseCapture() {
  if (window.electronAPI?.setIgnoreMouseEvents) {
    window.electronAPI.setIgnoreMouseEvents(false);
  }
}
function enableClickThrough() {
  if (window.electronAPI?.setIgnoreMouseEvents) {
    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
  }
}
// 初始化：窗口加载后启用点击穿透
enableClickThrough();

/* ========== 共用 UI 原语（模态框 / Toast） ==========
   实现见 renderer/scripts/primitives.js，避免与文件管理器各写一份。
   浮窗特有行为通过钩子注入：
   - onOpen：模态打开前扩容窗口（浮窗默认仅 160x160，放不下模态框）
   - onClose：恢复窗口尺寸，并在菜单/退出按钮都关闭时恢复点击穿透 */
const ui = window.createPrimitives({
  overlay: modalOverlay,
  icon: modalIcon,
  title: modalTitle,
  message: modalMessage,
  buttons: modalButtons,
  toast,
  onOpen: () => {
    // 浮窗默认仅 160x160，需先临时扩容以完整显示模态框
    if (window.electronAPI.expandFloatWindow) {
      window.electronAPI.expandFloatWindow(420, 320);
    }
    modalActive = true;
    enableMouseCapture(); // 模态框打开期间关闭穿透，确保按钮可点击
  },
  onClose: () => {
    modalActive = false;
    // 关闭后恢复浮窗原尺寸
    if (window.electronAPI.restoreFloatWindow) {
      window.electronAPI.restoreFloatWindow();
    }
    // 恢复穿透：仅当菜单/退出按钮也都关闭时
    if (!menuOpen && !quitOpen) enableClickThrough();
  }
});

// 语义化包装：保持原有调用点（showModal / showToast）
const showModal = (config) => ui.modal(config);
const showToast = (message, duration = 2000) => ui.toast(message, duration);

function toggleMenu() {
  if (menuOpen) {
    closeMenu();
    return;
  }
  closeQuit();
  menuOpen = true;
  enableMouseCapture(); // 菜单打开：保持鼠标捕获
  menuRing.classList.add('open');
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menuRing.classList.remove('open');
  if (!quitOpen && !modalActive) enableClickThrough(); // 菜单关闭：恢复穿透
}

function toggleQuit() {
  if (quitOpen) {
    closeQuit();
    return;
  }
  closeMenu();
  quitOpen = true;
  enableMouseCapture(); // 退出按钮打开：保持鼠标捕获
  quitRing.classList.add('open');
}

function closeQuit() {
  if (!quitOpen) return;
  quitOpen = false;
  quitRing.classList.remove('open');
  if (!menuOpen && !modalActive) enableClickThrough(); // 退出按钮关闭：恢复穿透
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
  enableMouseCapture(); // 进入内容区域：关闭穿透，捕获鼠标
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
  // 离开内容区域：恢复穿透（菜单/退出按钮/模态框/拖动中不穿透，避免拖动断连）
  if (!menuOpen && !quitOpen && !modalActive && !isDragging) enableClickThrough();
});

// 兜底：拖动中若窗口失焦（例如鼠标在窗口外松开），
// 必须解除拖动抑制，否则吸附会被永久禁用
window.addEventListener('blur', () => {
  if (isDragging) {
    isDragging = false;
    petBody.classList.remove('dragging');
    if (window.electronAPI?.setPetDragging) {
      window.electronAPI.setPetDragging(false);
    }
  }
});

// 拖动逻辑
petBody.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  hasMoved = false;
  mouseStartX = e.screenX;
  mouseStartY = e.screenY;
  dragPendingDx = 0;
  dragPendingDy = 0;
  petBody.classList.add('dragging');
  setPetCursor(CURSOR_GRABBING); // 拖动期间锁定光标，避免与 hover 判定交替
  // 通知主进程进入"手动拖动"状态：这期间必须完全停止自动吸附，
  // 否则松手前的每一帧都会被拉回吸附位置（表现为吸附后拖不动、会弹回）
  if (window.electronAPI?.setPetDragging) {
    window.electronAPI.setPetDragging(true);
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  dragPendingDx += e.screenX - mouseStartX;
  dragPendingDy += e.screenY - mouseStartY;
  if (Math.abs(dragPendingDx) > 3 || Math.abs(dragPendingDy) > 3) {
    hasMoved = true;
  }
  mouseStartX = e.screenX;
  mouseStartY = e.screenY;
  // 合并到每帧一次窗口移动：早期实现每次 mousemove 都调 moveWindow，
  // 同一帧内可能触发多次 setPosition（透明窗口每次都是合成层重排），表现为拖动闪动、跟手性差
  if (!dragRafPending) {
    dragRafPending = true;
    requestAnimationFrame(flushDragMove);
  }
});

function flushDragMove() {
  dragRafPending = false;
  if (!isDragging) {
    dragPendingDx = 0;
    dragPendingDy = 0;
    return;
  }
  const dx = dragPendingDx;
  const dy = dragPendingDy;
  dragPendingDx = 0;
  dragPendingDy = 0;
  if (dx === 0 && dy === 0) return;
  window.electronAPI.moveWindow(dx, dy);
}

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  petBody.classList.remove('dragging');

  // 拖动结束后单次保存位置
  if (hasMoved) {
    // 先把最后一帧尚未提交的位移发出去，避免松手瞬间「少走一截」
    flushDragMove();
    wasSnapped = false; // 拖动过，离开时不弹回贴边
    // 结束手动拖动状态，随后 saveWindowPosition 会按新位置重新评估吸附
    window.electronAPI.saveWindowPosition();
  } else if (window.electronAPI?.setPetDragging) {
    // 只是点击（没移动）：同样要解除拖动抑制
    window.electronAPI.setPetDragging(false);
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
      // 不关闭菜单，切换 Dock 显示并更新按钮颜色
      const dockVisible = await window.electronAPI.toggleDock();
      const navBtn = menuRing.querySelector('[data-action="nav"]');
      if (navBtn) {
        navBtn.classList.toggle('active', dockVisible);
      }
      showToast(dockVisible ? 'Dock 已开启' : 'Dock 已关闭', 1500);
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
  // 初始化 Dock 开关按钮状态
  const navBtn = menuRing?.querySelector('[data-action="nav"]');
  if (navBtn && window.electronAPI?.getDockVisible) {
    const dockVisible = await window.electronAPI.getDockVisible();
    navBtn.classList.toggle('active', dockVisible);
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
  const filePaths = [];
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

// Dock 吸附朝向：仅旋转宠物使其底部朝向 dock 边框（不改变窗口内位置）
window.electronAPI.onDockSnapChanged((side) => {
  petBody.classList.remove('dock-top', 'dock-bottom', 'dock-left', 'dock-right');
  if (side) {
    petBody.classList.add('dock-' + side);
  }
});

/* ========== 宠物真实视觉框上报 ==========
   吸附位置不能再依赖手调的像素补偿常数：宠物在 100×100 viewBox 中实际约占 90×80，
   贴边旋转 90° 后视觉宽变成 80，hover 时还有 1.05 倍缩放 —— 任何固定值都只在单一
   姿态下正确。这里持续上报真实视觉框（含 transform），主进程据此推导吸附位置。

   为避免过渡动画期间频繁触发重算，采用「变化后连续稳定 N 帧才上报」的策略。 */
const visualBox = document.querySelector('.pet-avatar');
const petSvg = document.querySelector('.pet-svg');
let anchorReportTimer = null;
let anchorStableFrames = 0;
let anchorLastReport = null;

/**
 * 读取宠物的**真实视觉框**（相对窗口左上角）。
 *
 * 关键点一：不能用 `.pet-avatar` 的 getBoundingClientRect() —— 它是 90×90 的容器，
 * 而 SVG 内容在 100×100 viewBox 中只占一部分，容器四周留有空边。
 * 因此用 SVG 的 getBBox()（用户单位）经 getScreenCTM() 转客户端坐标。
 *
 * 关键点二：`<ellipse class="pet-shadow">`（地面阴影，cy=90/ry=5）几乎不可见，
 * 却位于猫本体（爪子 cy=78）下方。若把它算进外接框，吸附时贴住面板的是「阴影下沿」，
 * 视觉上猫的爪子就会离面板空出约 10px（用户反馈的「距离边框还有间隙」）。
 * 因此把底部收紧到阴影上沿，让爪子成为真正的贴合边。
 */
function readPetAnchor() {
  if (petSvg && typeof petSvg.getBBox === 'function' && typeof petSvg.getScreenCTM === 'function') {
    try {
      const box = petSvg.getBBox();
      const ctm = petSvg.getScreenCTM();
      if (box && ctm && box.width > 0 && box.height > 0) {
        // 用 CTM 把用户单位包围盒的四个角映射到客户端坐标，取外接矩形
        const xs = [];
        const ys = [];
        [[box.x, box.y], [box.x + box.width, box.y],
          [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]
        ].forEach(([ux, uy]) => {
          xs.push(ctm.a * ux + ctm.c * uy + ctm.e);
          ys.push(ctm.b * ux + ctm.d * uy + ctm.f);
        });
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        const width = Math.max(...xs) - left;
        let height = Math.max(...ys) - top;

        // 排除地面阴影：把底边收到阴影上沿（阴影为透明椭圆，不应作为贴合边）
        const shadowTop = readShadowTopClient(ctm);
        if (shadowTop !== null) {
          const bottomNoShadow = shadowTop;
          if (bottomNoShadow > top && bottomNoShadow < top + height) {
            height = bottomNoShadow - top;
          }
        }

        if (width >= 1 && height >= 1) {
          return {
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(width),
            height: Math.round(height)
          };
        }
      }
    } catch (_) {
      // getBBox 在元素不可见时可能抛错，回退到容器矩形
    }
  }
  const rect = visualBox ? visualBox.getBoundingClientRect() : null;
  if (!rect || !rect.width || !rect.height) return null;
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

/** 地面阴影在客户端坐标下的上沿；无阴影或不可测量时返回 null */
function readShadowTopClient(ctm) {
  const shadow = petSvg && petSvg.querySelector ? petSvg.querySelector('.pet-shadow') : null;
  if (!shadow || typeof shadow.getBBox !== 'function') return null;
  try {
    const sBox = shadow.getBBox();
    if (!sBox || !sBox.height) return null;
    // 阴影为水平椭圆，取包围盒顶边（y 方向最上端）作为收紧基准
    const ys = [sBox.y, sBox.y + sBox.height].map((uy) => ctm.b * sBox.x + ctm.d * uy + ctm.f);
    return Math.min(...ys);
  } catch (_) {
    return null;
  }
}

function isSameAnchor(a, b) {
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top &&
    a.width === b.width && a.height === b.height;
}

function startAnchorWatch() {
  let last = readPetAnchor();
  anchorStableFrames = 0;
  const tick = () => {
    const cur = readPetAnchor();
    if (cur) {
      if (isSameAnchor(cur, last)) {
        anchorStableFrames++;
        // 连续 3 帧无变化视为过渡结束，此时才上报（避免中途触发吸附重算）
        if (anchorStableFrames === 3 && !isSameAnchor(cur, anchorLastReport)) {
          anchorLastReport = cur;
          if (window.electronAPI?.reportPetAnchor) {
            window.electronAPI.reportPetAnchor(cur);
          }
        }
      } else {
        anchorStableFrames = 0;
        last = cur;
      }
    }
    anchorReportTimer = requestAnimationFrame(tick);
  };
  anchorReportTimer = requestAnimationFrame(tick);
}

function stopAnchorWatch() {
  if (anchorReportTimer) {
    cancelAnimationFrame(anchorReportTimer);
    anchorReportTimer = null;
  }
}

// 窗口隐藏时无需上报（轮询本身开销很低，但没必要空转）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAnchorWatch();
  else startAnchorWatch();
});

startAnchorWatch();

/* ========== 光标稳定 ==========
   原先依赖 `.pet-body:hover` 与 `.drag-overlay` 等元素的 CSS 命中测试来切换光标，
   但 hover 会触发 transform: scale(1.05)，命中区随之变化；在窗口移动/缩放期间
   命中测试滞后会形成 enter/leave 来回触发，表现为光标在「箭头 ↔ 手型」之间频繁切换。
   这里改为用一次 getBoundingClientRect 命中判定来决定光标，不再依赖 hover 状态。 */
const CURSOR_GRAB = 'grab';
const CURSOR_GRABBING = 'grabbing';
const CURSOR_POINTER = 'pointer';

function setPetCursor(cursor) {
  if (petBody && petBody.style.getPropertyValue('--pet-cursor') !== cursor) {
    petBody.style.setProperty('--pet-cursor', cursor);
  }
}

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    setPetCursor(CURSOR_GRABBING);
    return;
  }
  const target = e.target;
  // 菜单按钮/退出按钮上显示手型
  if (target && target.closest && target.closest('.menu-btn, .quit-btn')) {
    setPetCursor(CURSOR_POINTER);
    return;
  }
  const rect = visualBox ? visualBox.getBoundingClientRect() : null;
  if (!rect) return;
  const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
    e.clientY >= rect.top && e.clientY <= rect.bottom;
  setPetCursor(inside ? CURSOR_GRAB : 'default');
});

document.addEventListener('mouseleave', () => {
  setPetCursor(CURSOR_GRAB);
});


