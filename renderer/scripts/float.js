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
  // 一旦开始手动拖动就清除 Dock 朝向：宠物被拿起后应恢复正立，
  // 不必等到松手才复位（否则拖动过程中一直是侧躺/倒立姿态）
  clearDockOrientation();
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
    default:
      // 能力注册的自定义菜单按钮（如 quick-upload 的「回收站模式」）：
      // 菜单开合属壳层状态，具体切换与提示由能力自己处理
      closeMenu();
      deskPet.emit('menubtn', action);
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

/* ========== 能力层（可插拔业务） ==========
   拖放上传 / 回收站已抽成 renderer/capabilities/quick-upload 能力。
   壳层在这里：
   1) 把桌宠 API 与「落点提示」的渲染方式交给能力注册表
   2) 转发拖放收集（拦截、显示提示、收集路径都在 capabilities.js 内完成）
   3) 通过 capability:mode 事件获知提示应显示「上传」还是「回收站」形态

   本文件不再直接调用 uploadFile / deleteFile —— 业务只存在于能力目录内。
   移除 capabilities/quick-upload/ 后，桌宠的拖动/贴边/吸附/菜单/退出仍然可用。 */
let dropHintMode = 'upload'; // 'upload' | 'recycle'，由能力通过事件同步

const deskPet = {
  root: document.body,
  toast: (message, duration) => showToast(message, duration),
  modal: (config) => showModal(config),
  on: (eventName, handler) => window.deskPetRegistry.on(eventName, handler),
  emit: (eventName, payload) => window.deskPetRegistry.emit(eventName, payload),
  storage: {
    // 壳层存储 API 的签名是 (capabilityId, key[, value])：
    // 注册表按能力隔离命名空间，能力侧只写自己的 key。
    // 早期写成 (key, value)，会让能力 id 落进 key 槽、值被丢弃（静默写错）。
    get: (capabilityId, key) => window.electronAPI.capabilityGet(capabilityId, key),
    set: (capabilityId, key, value) => window.electronAPI.capabilitySet(capabilityId, key, value)
  },
  dropOverlay,
  /**
   * 当前落点提示：取第一个提供 dropHint 的能力的对应形态。
   * 没有任何能力注册 dropHint 时返回 null，壳层便不显示业务提示。
   */
  getDropHint: () => {
    const caps = window.deskPetRegistry.manifests();
    for (const m of caps) {
      if (m.dropHint && m.dropHint[dropHintMode]) return m.dropHint[dropHintMode];
    }
    return null;
  },
  /** 能力切换模式后主动刷新提示（拖放进行中才有视觉变化） */
  refreshDropHint: () => {
    const overlay = dropOverlay;
    if (!overlay || !overlay.classList.contains('drag-over')) return;
    const hint = deskPet.getDropHint();
    if (!hint) return;
    const textEl = overlay.querySelector('span');
    if (textEl && hint.text) textEl.textContent = hint.text;
    const svgEl = overlay.querySelector('svg');
    if (svgEl && hint.icon) svgEl.innerHTML = hint.icon;
    overlay.classList.toggle('recycle-mode', hint.mode === 'recycle');
  }
};

window.deskPetRegistry.attach({
  root: deskPet.root,
  toast: deskPet.toast,
  modal: deskPet.modal,
  storage: deskPet.storage,
  dropOverlay,
  getDropHint: () => deskPet.getDropHint()
});

// 能力切换工作模式（如进入回收站模式）→ 同步落点提示形态
window.deskPetRegistry.on('capability:mode', (payload) => {
  if (!payload || payload.mode === undefined) return;
  dropHintMode = payload.mode === 'recycle' ? 'recycle' : 'upload';
  deskPet.refreshDropHint();
});

window.deskPet = deskPet;

// 贴边方向变化时移动桌宠位置
window.electronAPI.onSnapEdgeChanged((edges) => {
  petBody.classList.remove('snap-left', 'snap-right', 'snap-top', 'snap-bottom');
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      petBody.classList.add('snap-' + edge);
    }
  }
});

/**
 * 清除 Dock 吸附朝向（旋转类）。
 * 用户手动拖动、或脱离 Dock 吸附时必须调用：否则 pet-avatar 的旋转会残留，
 * 宠物会以侧躺/倒立姿态留在桌面上（用户反馈的异常姿态问题）。
 */
function clearDockOrientation() {
  if (petBody) {
    petBody.classList.remove('dock-top', 'dock-bottom', 'dock-left', 'dock-right');
  }
}

// Dock 吸附朝向：仅旋转宠物使其底部朝向 dock 边框（不改变窗口内位置）
window.electronAPI.onDockSnapChanged((side) => {
  clearDockOrientation();
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
 * 反复试错后的结论：不要用「整体包围盒 + 阴影补偿」的思路。
 * 地面阴影 `<ellipse class="pet-shadow">` 是个外切椭圆，它在四条边都超出猫本体，
 * 但超出量各不相同（下约 5、左右各约 5、上 0），任何"统一内缩/逐边扣除"的近似
 * 都会在某个方向偏掉 —— 表现为「上/左/右覆盖边框、下方又太远」。
 *
 * 现在改为**直接量猫自己的图形**：遍历 SVG 可见子元素，
 * 跳过 .pet-shadow，把其余元素（头、耳、眼、爪、胡须…）的包围盒取并集。
 * 这样锚点边界就是用户真正看到的轮廓，新增部件也会自动纳入。
 */
const SHADOW_SELECTOR = '.pet-shadow';

function readPetAnchor() {
  if (petSvg && typeof petSvg.getBBox === 'function' && typeof petSvg.getScreenCTM === 'function') {
    try {
      const ctm = petSvg.getScreenCTM();
      const union = readVisibleUnion(ctm);
      if (union) {
        const width = union.right - union.left;
        const height = union.bottom - union.top;
        if (width >= 1 && height >= 1) {
          return {
            left: Math.round(union.left),
            top: Math.round(union.top),
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

/**
 * 猫本体（排除地面阴影）在客户端坐标下的并集边界。
 * @returns {{left:number,top:number,right:number,bottom:number}|null}
 */
function readVisibleUnion(ctm) {
  const children = petSvg.children ? Array.from(petSvg.children) : [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const el of children) {
    if (el.classList && el.classList.contains(SHADOW_SELECTOR.slice(1))) continue;
    if (typeof el.getBBox !== 'function') continue;
    let b;
    try {
      b = el.getBBox();
    } catch (_) {
      continue;
    }
    if (!b || !b.width || !b.height) continue;
    [[b.x, b.y], [b.x + b.width, b.y],
      [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]
    ].forEach(([ux, uy]) => {
      const x = ctm.a * ux + ctm.c * uy + ctm.e;
      const y = ctm.b * ux + ctm.d * uy + ctm.f;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    });
  }

  if (!Number.isFinite(left) || !Number.isFinite(top) ||
      !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null;
  }
  return { left, top, right, bottom };
}

function isSameAnchor(a, b) {
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top &&
    a.width === b.width && a.height === b.height;
}

/**
 * 调试可视化：把「吸附所用的锚点框」画出来（宠物画面内的红色矩形）。
 * 用途：吸附贴合出现肉眼可见的偏差时，难以判断是"度量错误"还是"视觉模型错误"。
 * 打开后截图即可确认锚点框是否正好包住猫本体，从而定位问题。
 * 开启方式：HTML 根元素加 `debug-anchor` 类，或 localStorage 置 dsh_debug_anchor=1。
 */
const debugAnchorEnabled = (() => {
  try {
    if (document.documentElement.classList.contains('debug-anchor')) return true;
    return localStorage.getItem('dsh_debug_anchor') === '1';
  } catch (_) {
    return false;
  }
})();

let debugAnchorBox = null;

function renderDebugAnchor(anchor) {
  if (!debugAnchorEnabled) return;
  if (!debugAnchorBox) {
    debugAnchorBox = document.createElement('div');
    debugAnchorBox.style.cssText = [
      'position:absolute',
      'border:1px solid rgba(255,0,0,0.9)',
      'background:rgba(255,0,0,0.08)',
      'pointer-events:none',
      'z-index:9999'
    ].join(';');
    document.body.appendChild(debugAnchorBox);
  }
  if (!anchor) {
    debugAnchorBox.style.display = 'none';
    return;
  }
  debugAnchorBox.style.display = 'block';
  debugAnchorBox.style.left = anchor.left + 'px';
  debugAnchorBox.style.top = anchor.top + 'px';
  debugAnchorBox.style.width = anchor.width + 'px';
  debugAnchorBox.style.height = anchor.height + 'px';
}

function startAnchorWatch() {
  let last = readPetAnchor();
  anchorStableFrames = 0;
  const tick = () => {
    const cur = readPetAnchor();
    renderDebugAnchor(cur);
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


