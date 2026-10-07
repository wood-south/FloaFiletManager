/* ============================================================
   共用 UI 原语（模态框 / Toast）
   ------------------------------------------------------------
   背景：`float.js` 与 `file-manager.js` 各实现了一份几乎相同的
   `showModal`，图标表与 DOM 操作逻辑完全重复。本文件为唯一实现。

   用法（在页面脚本之前引入）：
     <script src="scripts/primitives.js"></script>
     const ui = createPrimitives({
       overlay: '#modalOverlay', icon: '#modalIcon', title: '#modalTitle',
       message: '#modalMessage', buttons: '#modalButtons',
       input: '#modalInput',      // 可选：仅需要输入型模态时传
       toast: '#toast',           // 可选：不传则按需自动创建
       onOpen:  () => {},         // 可选：模态打开前后钩子
       onClose: () => {}          //        （浮窗用于扩容与点击穿透）
     });
     await ui.modal({ type: 'warning', title: '删除', message: '…', buttons: [...] });
     await ui.inputModal({ title: '重命名', defaultValue: '旧名' });
     ui.toast('已上传');

   设计要点：
   - 通过选择器延迟取元素，兼容脚本在 body 末尾执行的情况
   - 所有模态返回 Promise：普通模态 resolve(按钮下标)，取消 resolve(-1)，
     输入型模态确认 resolve(字符串)，取消 resolve(null)
     → 调用方原先用 `choice !== 0` 判断取消，因此取消必须解析为 -1 而非 0，
       否则"点取消"会被误判为"点了第一个按钮"
   - 同时只允许一个模态存在，重复调用会先关闭上一个
   ============================================================ */

(function (global) {
  'use strict';

  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
  };

  function resolveEl(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return document.querySelector(ref);
    return ref;
  }

  function createPrimitives(options) {
    const opts = options || {};
    const els = {
      overlay: resolveEl(opts.overlay),
      icon: resolveEl(opts.icon),
      title: resolveEl(opts.title),
      message: resolveEl(opts.message),
      buttons: resolveEl(opts.buttons),
      input: resolveEl(opts.input)
    };

    let activeResolve = null;
    let toastEl = resolveEl(opts.toast);
    let toastTimer = null;

    function ensureToast() {
      if (toastEl && toastEl.isConnected) return toastEl;
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
      return toastEl;
    }

    /** 关闭当前模态并清理输入型键盘监听 */
    function closeModal(result) {
      const resolve = activeResolve;
      activeResolve = null;
      if (els.input && els.keyHandler) {
        els.input.removeEventListener('keydown', els.keyHandler);
        els.keyHandler = null;
      }
      if (els.overlay) els.overlay.classList.remove('active');
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (_) {}
      }
      if (resolve) resolve(result);
    }

    function fill(type, title, message) {
      if (els.icon) {
        els.icon.className = 'modal-icon ' + type;
        els.icon.innerHTML = ICONS[type] || ICONS.question;
      }
      if (els.title) els.title.textContent = title || '';
      if (els.message) els.message.textContent = message || '';
      if (els.buttons) els.buttons.innerHTML = '';
    }

    function makeButton(text, style, onClick) {
      const el = document.createElement('button');
      el.className = 'modal-btn ' + (style || 'secondary');
      el.textContent = text;
      el.addEventListener('click', onClick);
      return el;
    }

    /**
     * 普通模态：resolve 被点击按钮的下标；用户按 Esc / 关闭 时 resolve(-1)。
     * @returns {Promise<number>}
     */
    function modal(config) {
      const { type = 'question', title, message, buttons = [] } = config || {};
      if (activeResolve) closeModal(-1);

      if (typeof opts.onOpen === 'function') {
        try { opts.onOpen(); } catch (_) {}
      }

      return new Promise((resolve) => {
        activeResolve = resolve;
        fill(type, title, message);
        if (els.input) els.input.style.display = 'none';

        buttons.forEach((btn, index) => {
          els.buttons.appendChild(makeButton(btn.text, btn.style, () => closeModal(index)));
        });

        // Esc 关闭 → 视为取消
        if (els.overlay) {
          els.overlay.classList.add('active');
          els.keyHandler = null;
          if (!els.overlay.dataset.escBound) {
            els.overlay.dataset.escBound = '1';
            els.overlay.addEventListener('keydown', (e) => {
              if (e.key === 'Escape' && activeResolve) {
                e.preventDefault();
                closeModal(-1);
              }
            });
          }
          els.overlay.tabIndex = -1;
          els.overlay.focus();
        }
      });
    }

    /**
     * 输入型模态：确认 resolve(去除首尾空白的字符串)，空输入或取消 resolve(null)。
     * @returns {Promise<string|null>}
     */
    function inputModal(config) {
      const {
        type = 'question', title, message, defaultValue = '',
        placeholder = '', confirmText = '确定', cancelText = '取消'
      } = config || {};

      if (!els.input) {
        // 页面未提供输入框时降级为普通模态
        return modal({ type, title, message, buttons: [{ text: confirmText, style: 'primary' }] })
          .then((idx) => (idx === 0 ? defaultValue || null : null));
      }

      if (activeResolve) closeModal(-1);

      if (typeof opts.onOpen === 'function') {
        try { opts.onOpen(); } catch (_) {}
      }

      return new Promise((resolve) => {
        activeResolve = resolve;
        fill(type, title, message);
        els.input.value = defaultValue || '';
        els.input.placeholder = placeholder || '';
        els.input.style.display = 'block';

        els.buttons.appendChild(makeButton(cancelText, 'secondary', () => closeModal(null)));
        els.buttons.appendChild(makeButton(confirmText, 'primary', () => {
          const val = els.input.value.trim();
          closeModal(val || null);
        }));

        if (els.overlay) els.overlay.classList.add('active');

        setTimeout(() => els.input.focus(), 50);

        const keyHandler = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const val = els.input.value.trim();
            closeModal(val || null);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal(null);
          }
        };
        els.keyHandler = keyHandler;
        els.input.addEventListener('keydown', keyHandler);
      });
    }

    /** 轻量提示条 */
    function toast(message, duration = 2000) {
      const el = ensureToast();
      el.textContent = message;
      el.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.classList.remove('show');
        toastTimer = null;
      }, duration);
    }

    return { modal, inputModal, toast, close: () => closeModal(-1) };
  }

  global.createPrimitives = createPrimitives;
  global.PRIMITIVE_ICONS = ICONS;
})(typeof window !== 'undefined' ? window : globalThis);
