/* ============================================================
   桌宠交互手势（阶段 2）
   ------------------------------------------------------------
   从 float.js 抽出：拖动（含每帧合并位移）、单击/双击判别、右键、
   以及光标命中判定。壳层只负责装配，不再把交互细节写在入口文件里。

   对外不再暴露 isDragging 这类布尔量给外部随意读改，而是：
   - 通过 onDragStart / onDragEnd / onClick / onDoubleClick / onRightClick 回调通知
   - 通过 isDragging() 查询当前是否在拖动（壳层用于穿透仲裁与光标）
   这样「拖动状态」只有一个写入点，避免多处标志互相打架。

   本文件不依赖 DOM，可在 Node 里测试（见 test/interaction.test.js）。
   ============================================================ */

(function (global) {
  'use strict';

  const CURSOR_GRAB = 'grab';
  const CURSOR_GRABBING = 'grabbing';
  const CURSOR_POINTER = 'pointer';

  /** 按下后位移超过该阈值才算拖动（否则视为单击/双击） */
  const DRAG_THRESHOLD = 3;
  /** 单击延迟：等待是否出现第二次点击以判定双击 */
  const CLICK_DELAY = 250;

  /**
   * @param {object} options
   *  - setCursor(cursor)          下发光标（壳层写 CSS 变量）
   *  - moveWindow(dx, dy)         提交窗口位移（每帧一次）
   *  - onSavePosition()           拖动结束保存位置
   *  - onSnapRelease()            拖动开始：通知主进程停止自动吸附
   *  - onSnapRestore()            未发生移动的点击：恢复吸附抑制
   *  - onClearOrientation()       拖动开始时清除 Dock 朝向
   *  - onClick() / onDoubleClick() / onRightClick()
   *  - onDragStateChange(dragging)
   *  - now()                      可注入，便于测试
   *  - scheduleClick(fn, ms)      可注入（默认 setTimeout）
   *  - cancelClick(handle)        可注入（默认 clearTimeout）
   *  - raf(fn)                    可注入（默认 requestAnimationFrame）
   */
  function createInteraction(options) {
    const opts = options || {};
    const scheduleClick = opts.scheduleClick || ((fn, ms) => setTimeout(fn, ms));
    const cancelClick = opts.cancelClick || ((h) => clearTimeout(h));
    const raf = opts.raf || ((fn) => requestAnimationFrame(fn));

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let pendingDx = 0;
    let pendingDy = 0;
    let rafPending = false;
    let clickTimer = null;
    let doubleClickScheduled = false;

    function setCursor(cursor) {
      if (typeof opts.setCursor === 'function') opts.setCursor(cursor);
    }

    function isDragging() {
      return dragging;
    }

    function hasMoved() {
      return moved;
    }

    /** 取消挂起的单击判定（双击到达或菜单被外部关闭时调用） */
    function cancelPendingClick() {
      if (clickTimer) {
        cancelClick(clickTimer);
        clickTimer = null;
      }
    }

    /** 每帧最多提交一次窗口位移：同一帧多次 setPosition 会让透明窗口闪动 */
    function flushMove() {
      rafPending = false;
      const dx = pendingDx;
      const dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      // 注意：这里只按「是否有待提交位移」判断，不能再用 dragging 作为前置条件。
      // 松手时 dragging 已经置 false，若仍要求 dragging 为真，
      // 最后一帧的位移就会被丢弃（松手瞬间「少走一截」）。
      if (dx === 0 && dy === 0) return;
      if (typeof opts.moveWindow === 'function') opts.moveWindow(dx, dy);
    }

    function onPointerDown(e) {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.screenX;
      startY = e.screenY;
      pendingDx = 0;
      pendingDy = 0;
      setCursor(CURSOR_GRABBING); // 拖动期间锁定光标，避免与 hover 判定交替
      if (typeof opts.onClearOrientation === 'function') opts.onClearOrientation();
      // 交互反馈（单击反馈动画）：先于拖动状态生效，若随后真的拖动，
      // 会被更高优先级的 drag 状态打断 —— 优先级由状态机裁决
      if (typeof opts.onInteract === 'function') opts.onInteract();
      // 通知主进程进入「手动拖动」：这期间必须完全停止自动吸附，
      // 否则松手前每一帧都会被拉回吸附位置（表现为吸附后拖不动、会弹回）
      if (typeof opts.onSnapRelease === 'function') opts.onSnapRelease();
      if (typeof opts.onDragStateChange === 'function') opts.onDragStateChange(true);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      pendingDx += e.screenX - startX;
      pendingDy += e.screenY - startY;
      if (Math.abs(pendingDx) > DRAG_THRESHOLD || Math.abs(pendingDy) > DRAG_THRESHOLD) {
        moved = true;
      }
      startX = e.screenX;
      startY = e.screenY;
      if (!rafPending) {
        rafPending = true;
        raf(flushMove);
      }
    }

    function onPointerUp(e) {
      if (!dragging) return;
      // 先提交最后一帧位移，再结束拖动状态：顺序反了会丢掉这段位移
      // （flushMove 只依据「是否有待提交位移」，不受 dragging 影响）
      flushMove();
      dragging = false;
      if (typeof opts.onDragStateChange === 'function') opts.onDragStateChange(false);

      if (moved) {
        if (typeof opts.onSavePosition === 'function') opts.onSavePosition();
      } else if (typeof opts.onSnapRestore === 'function') {
        opts.onSnapRestore();
      }

      if (!moved && e.button === 0) {
        if (clickTimer) {
          // 第二次点击 => 双击
          cancelPendingClick();
          // 双击判定推迟一拍：若在同一 tick 里同步回调，壳层在 onDoubleClick
          // 中关闭菜单等操作会与「单击」路径互相干扰，也让判定结果依赖调用时序。
          // 实际上浏览器的 dblclick 阈值可能短于我们的单击延迟，
          // 因此这里必须能正确处理「定时器已到期但回调还没跑完」的边界。
          doubleClickScheduled = true;
          scheduleClick(() => {
            doubleClickScheduled = false;
            if (typeof opts.onDoubleClick === 'function') opts.onDoubleClick();
          }, 0);
        } else if (!doubleClickScheduled) {
          clickTimer = scheduleClick(() => {
            clickTimer = null;
            if (typeof opts.onClick === 'function') opts.onClick();
          }, CLICK_DELAY);
        }
      }
    }

    /** 鼠标移出内容区时把光标复位为可抓取 */
    function resetCursor() {
      if (!dragging) setCursor(CURSOR_GRAB);
    }

    /**
     * 按命中结果更新光标。
     * 原实现依赖 CSS :hover，而 hover 会触发 scale(1.05) 改变命中区，
     * 窗口移动期间命中测试滞后 → 光标在「箭头 ↔ 手型」之间频繁切换。
     * 这里改为每帧一次 getBoundingClientRect 命中判定。
     * @param {{clientX:number, clientY:number, onButton:boolean}} info
     * @param {DOMRect|null} rect 宠物视觉边界
     * @param {boolean} insideContainer 鼠标是否在容器内
     */
    function updateCursor(info, rect, insideContainer) {
      if (dragging) {
        setCursor(CURSOR_GRABBING);
        return;
      }
      if (info.onButton) {
        setCursor(CURSOR_POINTER);
        return;
      }
      if (!rect || !insideContainer) {
        setCursor('default');
        return;
      }
      const inside = info.clientX >= rect.left && info.clientX <= rect.right &&
        info.clientY >= rect.top && info.clientY <= rect.bottom;
      setCursor(inside ? CURSOR_GRAB : 'default');
    }

    /** 窗口失焦兜底：鼠标在窗口外松开时不会派发 mouseup，必须解除拖动 */
    function abortDrag() {
      if (!dragging) return false;
      dragging = false;
      pendingDx = 0;
      pendingDy = 0;
      if (typeof opts.onDragStateChange === 'function') opts.onDragStateChange(false);
      if (typeof opts.onSnapRestore === 'function') opts.onSnapRestore();
      return true;
    }

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      abortDrag,
      cancelPendingClick,
      resetCursor,
      updateCursor,
      flushMove,
      isDragging,
      hasMoved,
      hasPendingClick: () => !!clickTimer
    };
  }

  global.createInteraction = createInteraction;
  global.PET_CURSORS = { grab: CURSOR_GRAB, grabbing: CURSOR_GRABBING, pointer: CURSOR_POINTER };
})(typeof window !== 'undefined' ? window : globalThis);
