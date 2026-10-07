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

/* 皮肤帧渲染器（阶段 8.6）。**必须先声明**：applyBehaviorState 会在下面的
   behavior 初始化时就被调用一次，而那时渲染器尚未创建 ——
   若用 const 在后面声明，这里会因暂时性死区直接抛错。 */
let skinRenderer = null;

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
  // 皮肤帧渲染也要跟着状态走（无皮肤时是 no-op）
  if (skinRenderer) skinRenderer.setState(info.state, performance.now());
}

// 初始化：显式贴上初始状态类（不能只等 onChange —— 初始状态没有「变化」事件）
applyBehaviorState(behavior.describe());

/* ========== 自主行为驱动（阶段 3 收尾） ==========
   状态机只回答「能不能切」，driver 回答「什么时候切」：
   - 用户长时间不操作 → sleep
   - 空闲期间随机漫游 → walk（自己走一小段再回 idle）
   - 上传成功等事件 → celebrate

   刻意**只在用户确实空闲时**动作，且用户一操作就重置计时；
   另外 driver 不会抢占 drag / snap / interact（用户操作永远优先）。 */
const behaviorDriver = window.PET_DRIVER
  ? window.PET_DRIVER.createBehaviorDriver({
    behavior,
    onStateChange: (name, reason) => {
      // 便于排查"桌宠为什么自己睡了/走了"
      console.log('[pet] 自主状态 ->', name, '(' + reason + ')');
    }
  })
  : null;

if (behaviorDriver) behaviorDriver.enable();

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
  // 用户来了：唤醒（若在睡）并重置空闲计时
  if (behaviorDriver) behaviorDriver.notifyActivity('hover');
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
  // 用户操作：唤醒并重置空闲计时（拖拽期间 driver 也不会抢占，见 driver.js）
  if (behaviorDriver) behaviorDriver.notifyActivity('pointer');
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
  } else if (action === 'settings') {
    // 设置入口与「退出」同在右键环里（右键弹出），
    // 与 Dock 右键的「打开设置」走同一通道
    closeQuit();
    if (window.electronAPI?.openSettings) {
      window.electronAPI.openSettings();
    }
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

/* 有实际成果时庆祝一下（上传成功 / 删除成功）。
   能力只报告事实（pet:drop-done），表现由壳层决定 ——
   这样以后新增能力不必各自去碰状态机。
   位置必须在 deskPet 声明之后：提到前面会踩暂时性死区。 */
deskPet.on('pet:drop-done', (info) => {
  if (behaviorDriver && info && info.succeeded > 0) {
    behaviorDriver.celebrate(info.action === 'recycle' ? 'recycle-ok' : 'upload-ok');
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

/* ========== 皮肤与动画帧渲染（阶段 8.6） ==========
   皮肤由主进程管理（导入/校验/落盘），这里只负责把它画出来：
   - kind=sprite：用 canvas 播 atlas 帧序列
   - kind=svg   ：换成皮肤自带的 SVG
   - 没装皮肤   ：保持内置 SVG 猫，外观与接入前完全一致

   渲染器内部对「图片加载失败 / atlas 缺失 / frames.js 不存在」都做了回落，
   因此这里不需要再判断 —— 只要看 isFrameMode() 决定 canvas 与 SVG 谁显示。 */
const petCanvas = document.getElementById('petCanvas');
const petSvg = document.querySelector('.pet-svg');

// 注意：skinRenderer 已在文件顶部声明（let），这里只赋值 ——
// applyBehaviorState 可能在更早的初始化中被调用
skinRenderer = window.PET_SKIN_RENDER
  ? window.PET_SKIN_RENDER.createSkinRenderer({
    canvas: petCanvas,
    // 加载失败/不可用时回调：确保内置 SVG 回到可见状态，绝不白屏
    onFallback: () => {
      const img = petSvg?.parentElement?.querySelector('.pet-skin-img');
      if (img) img.remove();
      syncPetVisuals();
    },
    onReady: () => syncPetVisuals()
  })
  : null;

/** 按渲染器当前模式统一决定「画布 / 内置 SVG / 皮肤 SVG」谁显示。
 *
 *  实现方式：在 petBody 上写一个**显式模式属性**，显示规则全部交给
 *  float.css 里的 `[data-pet-visual=...]` 选择器。
 *
 *  为什么不用 hidden 属性：hidden 只提供一条 UA 的 `display:none`，
 *  任何带 display 的规则都能压过它；一旦某处给 .pet-svg 写了 display，
 *  就会出现「内置 SVG 与画布同时显示」的叠加（用户实测过两次）。
 *  属性选择器是一条唯一且带优先级的规则，且 js 里只有这一个写入点。 */
function syncPetVisuals() {
  if (!petBody) return;
  let mode = 'builtin';
  if (skinRenderer && skinRenderer.isFrameMode()) {
    mode = 'sprite';
  } else if (petSvg) {
    const img = petSvg.parentElement?.querySelector('.pet-skin-img');
    if (img && !img.hidden) mode = 'skin';
  }
  if (petBody.dataset.petVisual !== mode) {
    petBody.dataset.petVisual = mode;
  }
}

/** 把皮肤自带的 SVG 装进画面（用 data: URL，受 CSP 限制不能直读本地文件） */
function applySvgSkin(skin) {
  if (!petSvg || !skin || !skin.render || !skin.render.svg) return false;
  const url = skin.render.svg.dataUrl;
  if (!url) return false;
  try {
    // 用 <img> 承载皮肤 SVG：不把外部 SVG 标记注入 DOM，
    // 避免皮肤携带的脚本/事件属性在页面上下文里执行
    let img = petSvg.parentElement?.querySelector('.pet-skin-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'pet-skin-img';
      img.alt = skin.name || '皮肤';
      petSvg.parentElement?.insertBefore(img, petSvg);
    }
    img.src = url;
    img.hidden = false;
    // 内置 SVG 的隐藏交给 syncPetVisuals 统一处理（这里不直接写 hidden，
    // 否则又多了一处需要同步的地方，正是叠加 bug 的来源）
    return true;
  } catch (_) {
    return false;
  }
}

function applySkinToShell(skin) {
  // 配色先处理：无论哪个 kind，colorMap 都要生效（阶段 3.4）
  applySkinColors(skin);

  if (!skinRenderer) return;

  // 先清掉上一次可能留下的皮肤 SVG，避免「换了皮肤但旧图还在」
  const staleImg = petSvg?.parentElement?.querySelector('.pet-skin-img');
  if (staleImg) staleImg.remove();

  // 依次尝试：帧动画 → 皮肤 SVG → 内置 SVG
  const frameMode = skinRenderer.apply(skin);
  if (frameMode) {
    // 帧模式：等图集解码完成由 onReady 切显示；这里先别让旧画面留着
    syncPetVisuals();
    return;
  }

  if (skin && skin.render && skin.render.kind === 'svg' && applySvgSkin(skin)) {
    syncPetVisuals();
    return;
  }

  syncPetVisuals();
}

/** 应用皮肤的 colorMap 换色；无皮肤或换回内置时清掉，恢复内置配色 */
function applySkinColors(skin) {
  if (!window.PET_COLORS || !petBody) return;
  const colorMap = skin && skin.render && skin.render.svg && skin.render.svg.colorMap;
  if (colorMap && Object.keys(colorMap).length > 0) {
    const res = window.PET_COLORS.applyColorMap(petBody, colorMap);
    if (res.ignored.length > 0) {
      // 皮肤想改不在白名单里的变量：忽略并留痕，便于排查"换了色没效果"
      console.warn('[pet] colorMap 忽略了未知变量:', res.ignored.join(', '));
    }
    return;
  }
  window.PET_COLORS.clearColorMap(petBody);
}

if (skinRenderer && window.PET_SKIN_RENDER) {
  window.PET_SKIN_RENDER
    .loadActiveSkin({ api: window.electronAPI, renderer: { apply: applySkinToShell } })
    .catch(() => { /* 皮肤加载失败不影响桌宠：内置外观继续用 */ });

  /* 播放循环 + 每帧兜底。
     可见性同步放在这里而不是只靠回调：回调只会在「状态刚变化」时跑一次，
     一旦有任何路径漏写，就会出现两只猫叠加（用户实测过）。
     每帧同步一次的成本极低（两个布尔比较），换来的是"永远不会叠加"。 */
  window.PET_SKIN_RENDER.startLoop(skinRenderer, {
    onTick: () => syncPetVisuals(),
    onFinished: () => {
      // 一次性状态（celebrate / interact）播完，让状态机回落，避免停在最后一帧。
      // idle 优先级最低、打断不了它们，所以这里必须走 reset() 语义 ——
      // behavior.set('idle') 会被状态机正确拒绝。
      if (typeof behavior !== 'undefined' && behavior &&
        typeof behavior.reset === 'function') {
        const cur = behavior.get();
        if (cur === 'celebrate' || cur === 'interact') behavior.reset();
      }
    }
  });

  /* 诊断出口：控制台执行 pitDebug() 可查看皮肤到底有没有生效 */
  window.petDebug = () => {
    const info = {
      皮肤ID: skinRenderer.current() ? skinRenderer.current().id : null,
      帧模式已就绪: skinRenderer.isFrameMode(),
      渲染器当前状态: skinRenderer.state(),
      状态机状态: behavior.describe().state,
      已绘制帧数: skinRenderer.drawnFrames(),
      画布尺寸: petCanvas ? petCanvas.width + 'x' + petCanvas.height : null,
      画布可见: petCanvas ? !petCanvas.hidden : null,
      内置SVG可见: petSvg ? !petSvg.hidden : null,
      皮肤SVG存在: !!(petSvg && petSvg.parentElement &&
        petSvg.parentElement.querySelector('.pet-skin-img')),
      驱动已启用: behaviorDriver ? behaviorDriver.isEnabled() : null
    };
    console.log('[petDebug]', info);
    return info;
  };
  console.log('[pet] 皮肤渲染已启动，控制台执行 petDebug() 可查看状态');

  /* 逐个动作试播：控制台执行 petTest() 会依次切到七个状态、各停 1.6 秒。
     用途：肉眼确认「每个动画都能播」，把「皮肤没生效」和「状态没切换」区分开。 */
  window.petTest = () => {
    const states = ['idle', 'walk', 'sleep', 'interact', 'celebrate', 'snap', 'drag'];
    window.__petTestRunning = true;
    console.log('[petTest] 依次试播: ' + states.join(' → '));
    states.forEach((name, i) => {
      setTimeout(() => {
        // 直接驱动渲染器与状态机，绕过优先级限制，保证每个动作都看得到
        if (skinRenderer) skinRenderer.setState(name, performance.now());
        if (typeof behavior !== 'undefined' && behavior) {
          // 低优先级状态（如 idle）用 reset 才能从高优先级切回
          if (!behavior.set(name)) behavior.reset();
        }
        console.log('[petTest] ' + name);
        if (i === states.length - 1) {
          setTimeout(() => {
            window.__petTestRunning = false;
            console.log('[petTest] 结束，回到 idle');
          }, 1600);
        }
      }, i * 1600);
    });
  };
}

/* 设置窗口换肤后通知浮窗（用户可能在设置里改了皮肤） */
if (window.electronAPI?.onSkinChanged) {
  window.electronAPI.onSkinChanged((skin) => applySkinToShell(skin || null));
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


