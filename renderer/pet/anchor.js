/* ============================================================
   宠物视觉框（锚点）测量与上报（阶段 2 补完）
   ------------------------------------------------------------
   从 float.js 抽出。这块逻辑是「吸附位置是否准」的根基：主进程不做任何像素
   猜测，一切吸附位置都由渲染进程上报的**真实视觉框**推导。

   为什么不能图省事：
   1. 不能量窗口（160×160）—— 宠物画面只占其中约 90×80，贴边旋转 90° 后视觉宽
      变成 80，hover 还有 1.05 倍缩放。任何固定值都只在单一姿态下正确。
   2. 不能量 `.pet-avatar` 容器（90×90）—— SVG 内容在 viewBox 中只占一部分。
   3. 不能用「整体包围盒 + 阴影补偿」—— 地面阴影是外切椭圆，四边超出量各不相同
      （下约 5、左右各约 5、上 0），任何统一内缩/逐边扣除都会在某个方向偏掉，
      表现为「上/左/右覆盖边框、下方又太远」。

   因此最终做法是**直接量猫本体**：遍历 SVG 可见子元素，跳过 .pet-shadow，
   把其余元素（头、耳、眼、爪、胡须…）的包围盒取并集，再经 getScreenCTM
   映射到客户端坐标。这样边界就是用户真正看到的轮廓，新增部件也会自动纳入。

   DOM 通过参数注入，纯几何部分可独立测试（见 test/anchor.test.js）。
   ============================================================ */

(function (global) {
  'use strict';

  const SHADOW_CLASS = 'pet-shadow';

  /**
   * 猫本体（排除地面阴影）在客户端坐标下的并集边界。
   * @param {SVGSVGElement} svg
   * @param {DOMMatrix} ctm getScreenCTM() 的结果
   * @returns {{left:number,top:number,right:number,bottom:number}|null}
   */
  function readVisibleUnion(svg, ctm) {
    if (!svg || !ctm) return null;
    const children = svg.children ? Array.from(svg.children) : [];
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const el of children) {
      // 跳过地面阴影：它是外切椭圆，会让锚点四边同时外扩且外扩量不等
      if (el.classList && el.classList.contains(SHADOW_CLASS)) continue;
      if (typeof el.getBBox !== 'function') continue;
      let b;
      try {
        b = el.getBBox();
      } catch (_) {
        continue; // 元素不可见时 getBBox 可能抛错，跳过该子元素
      }
      if (!b || !b.width || !b.height) continue;
      // 只取四个角：仿射变换下凸四边形四角映射后取包围盒即可
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

  /** 两次锚点是否相同（用于「连续 N 帧无变化才上报」的稳定性判定） */
  function isSameAnchor(a, b) {
    if (!a || !b) return false;
    return a.left === b.left && a.top === b.top &&
      a.width === b.width && a.height === b.height;
  }

  function roundRect(rect) {
    if (!rect || !rect.width || !rect.height) return null;
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  /**
   * 创建锚点测量/上报器。
   * @param {object} options
   *   - svg           .pet-svg 元素（量本体）
   *   - container     .pet-avatar 元素（回退量容器）
   *   - report(anchor) 上报函数（壳层注入 electronAPI.reportPetAnchor）
   *   - raf / cancelRaf  可注入，便于测试
   *   - stableFrames  需要连续稳定的帧数，默认 3
   *   - debug         是否绘制调试框（默认 false）
   *   - debugHost     调试框挂载的容器，默认 document.body
   */
  function createAnchorWatcher(options) {
    const opts = options || {};
    const svg = opts.svg || null;
    const container = opts.container || null;
    const report = opts.report || null;
    const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
    const cancelRaf = opts.cancelRaf || ((h) => cancelAnimationFrame(h));
    const stableTarget = opts.stableFrames || 3;

    let timer = null;
    let stableFrames = 0;
    let previous = null;   // 上一帧锚点，用于「本帧与上帧是否相同」的稳定判定
    let lastReport = null;
    let debugBox = null;
    let running = false;

    /**
     * 读取宠物真实视觉框（相对窗口左上角）。
     * 优先量 SVG 本体；不可用时回退到容器矩形。
     */
    function read() {
      if (svg && typeof svg.getBBox === 'function' && typeof svg.getScreenCTM === 'function') {
        try {
          const union = readVisibleUnion(svg, svg.getScreenCTM());
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
      return roundRect(container ? container.getBoundingClientRect() : null);
    }

    /** 调试可视化：把吸附所用的锚点框画出来，便于截图确认度量是否正确 */
    function renderDebug(anchor) {
      if (!opts.debug) return;
      if (!debugBox) {
        const host = opts.debugHost || (typeof document !== 'undefined' ? document.body : null);
        if (!host) return;
        debugBox = document.createElement('div');
        debugBox.style.cssText = [
          'position:absolute',
          'border:1px solid rgba(255,0,0,0.9)',
          'background:rgba(255,0,0,0.08)',
          'pointer-events:none',
          'z-index:9999'
        ].join(';');
        host.appendChild(debugBox);
      }
      if (!anchor) {
        debugBox.style.display = 'none';
        return;
      }
      debugBox.style.display = 'block';
      debugBox.style.left = anchor.left + 'px';
      debugBox.style.top = anchor.top + 'px';
      debugBox.style.width = anchor.width + 'px';
      debugBox.style.height = anchor.height + 'px';
    }

    /**
     * 单次采样：返回本次是否真的上报了（测试与调试都用得上）。
     * 稳定判定沿用原实现语义：**与上一帧相同**才累加，连续 stableTarget 帧相同才上报。
     * （若改成「采样次数」计数会差一帧，且过渡期间的抖动会污染计数。）
     */
    function sample() {
      const cur = read();
      renderDebug(cur);
      if (!cur) {
        previous = null;
        stableFrames = 0;
        return false;
      }
      if (isSameAnchor(cur, previous)) {
        stableFrames++;
      } else {
        stableFrames = 0;
        previous = cur;
      }
      if (stableFrames < stableTarget) return false;
      if (isSameAnchor(cur, lastReport)) return false;
      lastReport = cur;
      if (typeof report === 'function') report(cur);
      return true;
    }

    /**
     * 启动轮询。
     * 采用「变化后连续稳定 N 帧才上报」：过渡动画期间视觉框每帧都在变，
     * 逐帧上报会让主进程反复重算吸附位置（表现为吸附抖动）。
     */
    function start() {
      if (running) return;
      running = true;
      stableFrames = 0;
      previous = null;
      const tick = () => {
        if (!running) return;
        sample();
        timer = raf(tick);
      };
      timer = raf(tick);
    }

    function stop() {
      running = false;
      if (timer !== null) {
        cancelRaf(timer);
        timer = null;
      }
    }

    function isRunning() {
      return running;
    }

    /** 最近一次成功上报的锚点（调试/测试用） */
    function last() {
      return lastReport;
    }

    /** 重置基准（例如窗口尺寸变化后需要重新建立锚点） */
    function reset() {
      lastReport = null;
      stableFrames = 0;
    }

    return { read, sample, start, stop, isRunning, last, reset };
  }

  global.createAnchorWatcher = createAnchorWatcher;
  global.PET_ANCHOR = { readVisibleUnion, isSameAnchor, SHADOW_CLASS };
})(typeof window !== 'undefined' ? window : globalThis);
