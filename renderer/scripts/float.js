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

let menuOpen = false;
let quitOpen = false;
let wasSnapped = false;
let snapLock = false;

/* ========== 动画状态机（阶段 3 · A 层） ==========
   实现见 renderer/pet/behavior.js。壳层把「正在发生的事」翻译成状态，
   并把状态类贴到 petBody 上；CSS 按状态决定播哪个动画。
   默认状态 idle 对应的动画与接入前完全一致（呼吸 / 阴影脉动 / 眨眼 / 瞳孔移动），
   因此接入状态机不改变默认外观。 */
const behavior = window.PET_BEHAVIOR.createBehavior({
  onChange: (info) => {
    applyBehaviorState(info);
  }
});

/** 上一次贴上的状态类，避免残留多个 state-* 导致动画互相打架 */
let appliedStateClass = null;

function applyBehaviorState(info) {
  if (!petBody) return;
  if (appliedStateClass) petBody.classList.remove(appliedStateClass);
  petBody.classList.add(info.class);
  appliedStateClass = info.class;
}

// 初始化：显式贴上初始状态类（不能只等 onChange —— 初始状态没有「变化」事件）
applyBehaviorState(behavior.describe());

/* ========== 点击穿透：透明区域允许鼠标穿透到桌面 ==========
   仲裁实现见 renderer/pet/penetration.js：以「交互原因集合」取代原先
   !menuOpen && !quitOpen && !modalActive && !isDragging 的布尔链。
   后者与执行顺序相关（菜单开着时拖放结束会误开穿透），且每加一个阻塞来源
   都要改所有判断点。现在只在需要时 acquire/release 自己的原因。 */
const penetration = window.createPenetration({
  setIgnore: (ignore, opts) => {
    if (window.electronAPI?.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(ignore, opts);
    }
  }
});

const PEN_REASON = {
  menu: 'menu',
  quit: 'quit',
  modal: 'modal',
  drag: 'drag',
  pointerInside: 'pointer-inside'
};

function enableMouseCapture() {
  penetration.acquire(PEN_REASON.pointerInside);
}
function enableClickThrough() {
  penetration.release(PEN_REASON.pointerInside);
}
// 初始化：窗口加载后启用点击穿透
penetration.init();

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
    penetration.acquire(PEN_REASON.modal); // 模态框期间必须捕获鼠标，否则按钮点不到
  },
  onClose: () => {
    // 关闭后恢复浮窗原尺寸
    if (window.electronAPI.restoreFloatWindow) {
      window.electronAPI.restoreFloatWindow();
    }
    // 只撤销「模态」这一个原因：菜单/退出是否仍开着由它们自己维护，
    // 不再需要在这里重复判断（原实现正是在这里漏判导致误开穿透）
    penetration.release(PEN_REASON.modal);
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
  penetration.acquire(PEN_REASON.menu); // 菜单打开：保持鼠标捕获
  menuRing.classList.add('open');
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menuRing.classList.remove('open');
  penetration.release(PEN_REASON.menu);
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
  penetration.release(PEN_REASON.quit);
}

/* ========== 交互手势（拖动 / 单击 / 双击 / 右键） ==========
   实现见 renderer/pet/interaction.js。壳层只提供回调与查询，
   「是否在拖动」只有一个写入点，穿透仲裁据此 acquire/release。

   注意：回调里用箭头函数包装，避免在 clearDockOrientation 等函数声明之前
   取其函数值（const/let 的 TDZ 会抛错，而函数声明虽会提升、但直接传引用
   仍可能读到尚未初始化的绑定）。 */
const interaction = window.createInteraction({
  setCursor: (cursor) => setPetCursor(cursor),
  moveWindow: (dx, dy) => window.electronAPI.moveWindow(dx, dy),
  onSavePosition: () => {
    wasSnapped = false; // 拖动过，离开时不弹回贴边
    window.electronAPI.saveWindowPosition();
  },
  onSnapRelease: () => {
    // 进入手动拖动：主进程需完全停止自动吸附
    if (window.electronAPI?.setPetDragging) window.electronAPI.setPetDragging(true);
  },
  onSnapRestore: () => {
    // 只是点击（没移动）：同样要解除拖动抑制
    if (window.electronAPI?.setPetDragging) window.electronAPI.setPetDragging(false);
  },
  onClearOrientation: () => clearDockOrientation(),
  onDragStateChange: (dragging) => {
    if (dragging) {
      penetration.acquire(PEN_REASON.drag); // 拖动期间不得恢复穿透，否则 mousemove 会丢
      petBody.classList.add('dragging');
      behavior.set('drag'); // 拖动优先级最高，会打断其它状态
    } else {
      penetration.release(PEN_REASON.drag);
      petBody.classList.remove('dragging');
      // 松手后回落到 idle，随后由贴边/吸附事件按需切到 snap
      behavior.set('idle');
      syncSnapState();
    }
  },
  onInteract: () => {
    // 按下桌宠 = 一次交互反馈；随后若移动会立刻被 drag 打断（优先级更高）
    behavior.set('interact');
  },
  onClick: () => toggleMenu(),
  onDoubleClick: () => {
    closeMenu();
    closeQuit();
    window.electronAPI.openFileManager();
  }
});

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
  if (interaction.isDragging() || snapLock) return;
  if (hasSnapClass()) {
    wasSnapped = true;
    snapLock = true;
    window.electronAPI.unsnapWindow().then(() => {
      setTimeout(() => { snapLock = false; }, 200);
    });
  }
});

petBody.addEventListener('mouseleave', () => {
  if (snapLock) return;
  // 菜单/退出按钮打开时不收回，避免操作中断
  if (wasSnapped && !interaction.isDragging() && !interaction.hasMoved() && !menuOpen && !quitOpen) {
    snapLock = true;
    window.electronAPI.resnapWindow().then(() => {
      setTimeout(() => { snapLock = false; }, 200);
    });
  }
  wasSnapped = false;
  // 离开内容区只撤销「鼠标在内容区内」这一个原因；
  // 菜单/退出/模态/拖动各自的原因仍需保留（这正是原布尔链会误开穿透的场景）
  enableClickThrough();
});

// 兜底：拖动中若窗口失焦（例如鼠标在窗口外松开），
// 必须解除拖动抑制，否则吸附会被永久禁用
window.addEventListener('blur', () => {
  if (interaction.abortDrag()) {
    petBody.classList.remove('dragging');
  }
});

// 拖动逻辑
petBody.addEventListener('mousedown', (e) => {
  interaction.onPointerDown(e);
});

document.addEventListener('mousemove', (e) => {
  interaction.onPointerMove(e);
});

document.addEventListener('mouseup', (e) => {
  interaction.onPointerUp(e);
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
  syncSnapState();
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
  syncSnapState();
});

/**
 * 把「当前是否贴边/吸附」同步进动画状态机。
 * 贴边与 Dock 吸附都可能独立发生，因此每次事件后统一重算：
 * 任一为真 → snap 状态；都为假 → 回落到 idle。
 * （拖动中不动它 —— drag 优先级高于 snap，由状态机自行拒绝。）
 */
function syncSnapState() {
  if (!petBody || typeof behavior === 'undefined') return;
  const snapped = hasSnapClass() ||
    petBody.classList.contains('dock-top') ||
    petBody.classList.contains('dock-bottom') ||
    petBody.classList.contains('dock-left') ||
    petBody.classList.contains('dock-right');
  behavior.set(snapped ? 'snap' : 'idle');
}

/* ========== 宠物真实视觉框上报 ==========
   实现见 renderer/pet/anchor.js（测量原理与「为什么不能量窗口/容器/整体包围盒」
   都在该文件头部说明）。壳层只负责：注入 DOM、判定是否开启调试框、接上上报通道。

   调试可视化：把「吸附所用的锚点框」画出来（宠物画面内的红色矩形）。
   用途：吸附贴合出现肉眼可见的偏差时，难以判断是"度量错误"还是"视觉模型错误"。
   打开后截图即可确认锚点框是否正好包住猫本体。
   开启方式：HTML 根元素加 `debug-anchor` 类，或 localStorage 置 dsh_debug_anchor=1。 */
const debugAnchorEnabled = (() => {
  try {
    if (document.documentElement.classList.contains('debug-anchor')) return true;
    return localStorage.getItem('dsh_debug_anchor') === '1';
  } catch (_) {
    return false;
  }
})();

const anchorWatcher = window.createAnchorWatcher({
  svg: document.querySelector('.pet-svg'),
  container: document.querySelector('.pet-avatar'),
  report: (anchor) => {
    if (window.electronAPI?.reportPetAnchor) window.electronAPI.reportPetAnchor(anchor);
  },
  debug: debugAnchorEnabled
});

function startAnchorWatch() {
  anchorWatcher.start();
}

function stopAnchorWatch() {
  anchorWatcher.stop();
}

// 窗口隐藏时无需上报（轮询本身开销很低，但没必要空转）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAnchorWatch();
  else startAnchorWatch();
});

startAnchorWatch();

/* ========== 光标稳定 ==========
   原先依赖 `.pet-body:hover` 等元素的 CSS 命中测试来切换光标，但 hover 会触发
   transform: scale(1.05)，命中区随之变化；窗口移动/缩放期间命中测试滞后会形成
   enter/leave 来回触发，表现为光标在「箭头 ↔ 手型」之间频繁切换。
   现在由 renderer/pet/interaction.js 统一按 getBoundingClientRect 命中判定，
   壳层只把它写进 CSS 变量（函数声明会被提升，供上方 createInteraction 直接引用）。 */

function setPetCursor(cursor) {
  if (petBody && petBody.style.getPropertyValue('--pet-cursor') !== cursor) {
    petBody.style.setProperty('--pet-cursor', cursor);
  }
}

document.addEventListener('mousemove', (e) => {
  const target = e.target;
  const onButton = !!(target && target.closest && target.closest('.menu-btn, .quit-btn'));
  // 复用锚点测量（量的是猫本体而非窗口/容器），保证光标命中区与吸附用的视觉框一致
  const rect = anchorWatcher.read();
  const insideContainer = !!petBody && e.clientX >= 0 && e.clientY >= 0 &&
    e.clientX <= window.innerWidth && e.clientY <= window.innerHeight;
  interaction.updateCursor(
    { clientX: e.clientX, clientY: e.clientY, onButton },
    rect,
    insideContainer
  );
});

document.addEventListener('mouseleave', () => {
  interaction.resetCursor();
});


