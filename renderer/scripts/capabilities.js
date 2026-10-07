/* ============================================================
   桌宠能力注册表（Capability Registry）
   ------------------------------------------------------------
   背景（阶段 1）：浮窗原来是一个 725 行的单体脚本，桌宠本身的行为
   （拖动 / 贴边 / 吸附 / 穿透 / 菜单环）与「拖放上传 / 回收站」这类
   业务混在同一份文件里。本文件提供最小可用的能力层契约，让业务能
   以可插拔模块的形式接入。

   本阶段只做「最小验证」：
     - 提供 use / on / emit / toast / modal / 存储 这组对外 API
     - 拖放事件的收集与落点提示由**壳层**负责（这些是窗口级交互），
       能力只实现自己的 drop 处理逻辑
     - 不移动任何既有文件（壳层拆分与穿透计数式仲裁属于阶段 2）

   用法（页面脚本顺序）：
     primitives.js -> registry.js -> float.js（壳层）
     -> capabilities/<id>/index.js（能力，调用 window.deskPet.use）

   约定：
   - manifest.id 必填且唯一；register 会拒绝不合规的 manifest
   - 同一个 id 重复注册会被忽略（避免脚本被重复引入时行为翻倍）
   - 某个能力注册失败不得影响桌宠壳层（use() 内部捕获异常）
   ============================================================ */

(function (global) {
  'use strict';

  /** 能力 manifest 规范（阶段 1 用到 menuButtons / dropHint / register） */
  const REQUIRED_FIELDS = ['id'];

  const capabilities = new Map();
  const handlers = new Map(); // eventName -> handler[]
  let pet = null;             // 由壳层 attach 注入

  function warn(msg, err) {
    if (err) console.warn('[capabilities] ' + msg, err);
    else console.warn('[capabilities] ' + msg);
  }

  /** manifest 校验：只校验本阶段真正依赖的字段，缺字段时报错而不是静默降级 */
  function validate(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      return 'manifest 必须是对象';
    }
    for (const field of REQUIRED_FIELDS) {
      if (!manifest[field] || typeof manifest[field] !== 'string') {
        return '缺少必填字段 ' + field + '（需为非空字符串）';
      }
    }
    if (manifest.menuButtons && !Array.isArray(manifest.menuButtons)) {
      return 'menuButtons 必须是数组';
    }
    if (manifest.register && typeof manifest.register !== 'function') {
      return 'register 必须是函数';
    }
    return null;
  }

  function on(eventName, handler) {
    if (!eventName || typeof handler !== 'function') return function () {};
    if (!handlers.has(eventName)) handlers.set(eventName, []);
    handlers.get(eventName).push(handler);
    return function off() {
      const list = handlers.get(eventName);
      if (!list) return;
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function emit(eventName, payload) {
    const list = handlers.get(eventName);
    if (!list || list.length === 0) return;
    // 复制一份再遍历：处理器里可能 off() 掉自己
    for (const fn of list.slice()) {
      try {
        fn(payload);
      } catch (err) {
        warn('事件 ' + eventName + ' 的处理器抛错', err);
      }
    }
  }

  /**
   * 注册一个能力。返回 true 表示已注册。
   * @param {object} manifest 见文件头说明
   */
  function use(manifest) {
    if (!pet) {
      warn('注册表尚未 attach，能力注册被忽略：' + (manifest && manifest.id));
      return false;
    }
    const invalid = validate(manifest);
    if (invalid) {
      warn('manifest 不合法（' + invalid + '）');
      return false;
    }
    if (capabilities.has(manifest.id)) {
      warn('能力 ' + manifest.id + ' 已注册，忽略重复注册');
      return false;
    }

    const cap = {
      id: manifest.id,
      manifest,
      disposers: []
    };
    capabilities.set(cap.id, cap);

    // 注入受限的桌宠 API + 该能力自己的存储命名空间。
    // 注意 ctx.pet 指向 ctx 自身：能力通过 pet.root / pet.toast / pet.modal /
    // pet.storage 访问壳层能力（根元素、提示、模态、命名空间存储）。
    // 早期写成 ctx.pet = 原始 API 对象，导致能力里 pet.root 为 undefined，
    // 菜单按钮高亮等依赖根元素的功能静默失效。
    const ctx = {
      id: cap.id,
      on: (eventName, handler) => {
        const off = on(eventName, handler);
        cap.disposers.push(off);
        return off;
      },
      emit: (eventName, payload) => emit(eventName, payload),
      toast: (message, duration) => pet.toast(message, duration),
      modal: (config) => pet.modal(config),
      root: pet.root,
      storage: {
        get: (key) => pet.storage.get(cap.id, key),
        set: (key, value) => pet.storage.set(cap.id, key, value)
      }
    };
    ctx.pet = ctx;

    try {
      if (typeof manifest.register === 'function') {
        manifest.register(ctx);
      }
    } catch (err) {
      warn('能力 ' + cap.id + ' 注册时抛错，已回滚', err);
      capabilities.delete(cap.id);
      for (const off of cap.disposers) {
        try { off(); } catch (_) { /* 回滚时的清理失败无需上报 */ }
      }
      return false;
    }
    return true;
  }

  function unuse(id) {
    const cap = capabilities.get(id);
    if (!cap) return false;
    for (const off of cap.disposers) {
      try { off(); } catch (_) { /* 同上 */ }
    }
    capabilities.delete(id);
    return true;
  }

  /** 列出已注册能力（设置页/调试用） */
  function list() {
    return Array.from(capabilities.keys());
  }

  /** 列出已注册能力的 manifest（壳层据此渲染落点提示等） */
  function manifests() {
    return Array.from(capabilities.values()).map((cap) => cap.manifest);
  }

  /**
   * 由壳层调用：注入桌宠 API 实现并接管拖放收集。
   * @param {object} api {root, toast, modal, storage, getDropHint}
   */
  function attach(api) {
    pet = api;
    bindDropCollection(api);
  }

  /* ---------- 拖放收集（窗口级交互，属壳层职责） ----------
     壳层负责：拦截默认行为、显示落点提示、把路径收集好；
     能力负责：拿到路径后做什么（上传 / 删除 / …）。
     这样能力完全不需要知道 overlay 的 DOM 结构。 */

  let dragDepth = 0;

  function collectPaths(dataTransfer) {
    const paths = [];
    if (!dataTransfer) return paths;
    const types = Array.from(dataTransfer.types || []);
    if (types.includes('Files') || types.includes('application/x-moz-file')) {
      const files = dataTransfer.files;
      for (const file of files) {
        if (file && file.path) paths.push(file.path);
      }
    }
    if (types.includes('text/plain')) {
      const text = dataTransfer.getData('text/plain');
      if (text) {
        text.split('\n').map((p) => p.trim()).filter(Boolean).forEach((p) => paths.push(p));
      }
    }
    return paths;
  }

  function bindDropCollection(api) {
    const overlay = api.dropOverlay;

    function showOverlay() {
      if (!overlay) return;
      overlay.classList.add('drag-over');
      const hint = typeof api.getDropHint === 'function' ? api.getDropHint() : null;
      if (hint) {
        const textEl = overlay.querySelector('span');
        if (textEl && hint.text) textEl.textContent = hint.text;
        const svgEl = overlay.querySelector('svg');
        if (svgEl && hint.icon) svgEl.innerHTML = hint.icon;
        overlay.classList.toggle('recycle-mode', hint.mode === 'recycle');
      }
    }

    function hideOverlay() {
      if (!overlay) return;
      overlay.classList.remove('drag-over');
      overlay.classList.remove('recycle-mode');
    }

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth++;
      showOverlay();
    }, true);

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showOverlay();
    }, true);

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = Math.max(0, dragDepth - 1);
      // 拖到窗口外才算离开（dragleave 在子元素间移动时也会触发）
      if (dragDepth === 0 || e.clientX <= 0 || e.clientY <= 0 ||
          e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        dragDepth = 0;
        hideOverlay();
      }
    }, true);

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      hideOverlay();
      const paths = collectPaths(e.dataTransfer);
      if (paths.length === 0) return;
      emit('pet:drop', { paths });
    }, true);
  }

  global.deskPetRegistry = {
    attach,
    use,
    unuse,
    list,
    manifests,
    on,
    emit
  };
})(typeof window !== 'undefined' ? window : globalThis);
