/* ============================================================
   桌宠皮肤渲染（阶段 8.6）
   ------------------------------------------------------------
   把「皮肤描述」（由主进程 apply-skin / get-active-skin 返回）变成屏幕上的画面：
   - kind=sprite：把 atlas 图集按帧画到 <canvas>
   - kind=svg   ：换成皮肤自带的 SVG（用 data: URL，避开 CSP）
   - 没有皮肤   ：一律走内置 SVG 猫，**默认外观与接入前完全一致**

   与 frames.js 的分工：
   frames.js 只算「此刻该显示第几帧」（纯逻辑，可测）；
   这里负责把那一帧画出来、以及在皮肤不可用时回落。

   回落原则（对应 PET_SPEC.md §4 的校验规则）：
   一个环节失败就退回上一步，绝不白屏 ——
   atlas 图片加载失败 → 保留内置 SVG；clips 缺失 → 用静帧；
   帧号越界 → 跳过本帧绘制而不清空画布。

   播放循环由外部驱动（inject rAF），便于测试与暂停。 */

(function (global) {
  'use strict';

  /**
   * @param {object} opts
   *   - canvas: 桌宠 canvas 元素
   *   - imageLoader(url, onload, onerror): 注入以便测试
   *   - getStates(): 取状态表；不传则用 global.PET_BEHAVIOR.STATES
   *   - onFallback(reason): 皮肤不可用时的回调（壳层据此保留 SVG）
   */
  function createSkinRenderer(opts) {
    const o = opts || {};
    const canvas = o.canvas || null;
    const loadImage = o.imageLoader || defaultImageLoader;

    /* 依赖解析要同时满足两种加载方式：
       浏览器按 <script> 顺序加载 → PET_FRAMES 已在 global 上；
       Node/测试直接 require 本文件 → global 上没有，需要自行 require。
       只读 global 会让「测试里明明加载了 frames.js 却报 frames-unavailable」。 */
    function framesApiOf() {
      if (global.PET_FRAMES) return global.PET_FRAMES;
      /* eslint-disable no-undef */
      if (typeof module !== 'undefined' && module.exports) {
        try {
          const f = require('./frames');
          if (f) {
            global.PET_FRAMES = f;
            return f;
          }
        } catch (_) { /* 落到下面的 null */ }
      }
      /* eslint-enable no-undef */
      return null;
    }

    let ctx = null;
    let atlasImage = null;
    let atlas = null;
    let player = null;
    let clips = null;
    let skin = null;
    let ready = false;
    let lastFrame = -1;
    let drawnCount = 0;

    function getStates() {
      if (typeof o.getStates === 'function') return o.getStates();
      return (global.PET_BEHAVIOR && global.PET_BEHAVIOR.STATES) || {};
    }

    function fallback(reason) {
      ready = false;
      atlasImage = null;
      player = null;
      clips = null;
      if (typeof o.onFallback === 'function') o.onFallback(reason);
    }

    function ensureContext() {
      if (ctx || !canvas || typeof canvas.getContext !== 'function') return ctx;
      try {
        ctx = canvas.getContext('2d');
      } catch (_) {
        ctx = null;
      }
      return ctx;
    }

    /** 尺寸：canvas 的像素尺寸按图集单帧尺寸设置（CSS 负责缩放显示） */
    function sizeCanvas() {
      if (!canvas || !atlas) return;
      if (canvas.width !== atlas.frameWidth) canvas.width = atlas.frameWidth;
      if (canvas.height !== atlas.frameHeight) canvas.height = atlas.frameHeight;
    }

    /** 画指定图集帧号；越界/无上下文则跳过（不清空已有画面） */
    function drawFrame(frameNo) {
      const frames = global.PET_FRAMES;
      if (!ready || !ctx || !atlasImage || !atlas || !frames) return false;
      const cols = frames.columnsOf(atlas, atlasImage.width || atlas.frameWidth);
      const rect = frames.frameRect(atlas, frameNo, cols);
      if (!rect) return false;
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(atlasImage,
          rect.x, rect.y, rect.width, rect.height,
          0, 0, atlas.frameWidth, atlas.frameHeight);
        drawnCount++;
        return true;
      } catch (_) {
        return false;
      }
    }

    return {
      /**
       * 应用一个皮肤描述。
       * @param {object|null} skinData apply-skin / get-active-skin 的返回值
       * @returns {boolean} 是否成功进入帧渲染模式（false 表示应保留内置 SVG）
       */
      apply(skinData) {
        skin = skinData || null;
        ready = false;
        atlasImage = null;
        player = null;
        clips = null;
        atlas = null;

        if (!skin || !skin.render) {
          fallback('no-skin');
          return false;
        }
        // kind=svg：不需要 canvas，交给壳层换 SVG
        if (skin.render.kind !== 'sprite') return false;

        const a = skin.render.atlas;
        if (!a || !a.frameWidth || !a.frameHeight || !a.dataUrl) {
          fallback('atlas-missing');
          return false;
        }
        // 依赖在这里解析一次并缓存，drawFrame 里直接用
        const frames = framesApiOf();
        if (!frames) {
          fallback('frames-unavailable');
          return false;
        }

        atlas = { frameWidth: a.frameWidth, frameHeight: a.frameHeight };
        clips = frames.resolveClips(getStates(), skin.clips);
        player = frames.createFramePlayer({ clips, initialState: o.initialState || 'idle' });
        sizeCanvas();

        // 图集是异步加载的，加载完成前 ready 仍为 false → 保持 SVG 可见
        loadImage(a.dataUrl,
          (img) => {
            atlasImage = img;
            ensureContext();
            ready = true;
            lastFrame = -1;
            if (typeof o.onReady === 'function') o.onReady(skin);
          },
          () => fallback('atlas-load-failed'));
        return true;
      },

      /** 当前皮肤（可能为 null） */
      current() { return skin; },
      isFrameMode() { return ready; },
      /** 供测试/诊断：实际绘制过多少帧 */
      drawnFrames() { return drawnCount; },

      setState(name, nowMs) {
        if (!player) return false;
        const changed = player.setState(name, nowMs);
        /* 切状态后必须清掉「上一帧画的是什么」的记录。
           否则当新状态的第 0 帧号恰好等于上一状态当前帧号时，
           tick 会认为"这一帧刚画过"而跳过重绘 ——
           表现就是**画面停在旧动作上、看起来动画没切换**。 */
        if (changed) lastFrame = -1;
        return changed;
      },
      state() {
        return player ? player.current() : null;
      },
      /** 一次性状态是否播完（壳层据此让状态机回落） */
      finishedAt(nowMs) {
        return player ? player.finishedAt(nowMs) : false;
      },

      /**
       * 按当前时间刷新画面。同一帧不重复绘制（省掉无谓的 drawImage）。
       * @returns {boolean} 本次是否真的画了一帧
       */
      tick(nowMs) {
        if (!ready || !player) return false;
        const frameNo = player.frameAt(nowMs);
        if (frameNo < 0) return false;
        if (frameNo === lastFrame) return false;
        const okDraw = drawFrame(frameNo);
        if (okDraw) lastFrame = frameNo;
        return okDraw;
      },

      /** 彻底复位：回到内置 SVG 外观 */
      reset() {
        skin = null;
        fallback('reset');
        if (ctx && canvas) {
          try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (_) { /* 忽略 */ }
        }
      }
    };
  }

  function defaultImageLoader(url, onload, onerror) {
    try {
      const img = new global.Image();
      img.onload = () => onload(img);
      img.onerror = () => onerror(new Error('image load failed'));
      img.src = url;
    } catch (e) {
      onerror(e);
    }
  }

  /**
   * 加载当前已应用的皮肤（启动时与换肤后调用）。
   * @param {object} deps { api: window.electronAPI, renderer }
   * @returns {Promise<object|null>} 皮肤数据或 null
   */
  async function loadActiveSkin(deps) {
    const d = deps || {};
    const api = d.api;
    const renderer = d.renderer;
    if (!api || typeof api.getActiveSkin !== 'function') {
      if (renderer) renderer.apply(null);
      return null;
    }
    try {
      const res = await api.getActiveSkin();
      const skin = res && res.success ? res.skin : null;
      if (renderer) renderer.apply(skin);
      return skin;
    } catch (e) {
      // 皮肤加载失败不能让桌宠消失：回落到内置外观
      if (renderer) renderer.apply(null);
      return null;
    }
  }

  /**
   * 驱动播放循环。返回 stop()。
   * 与状态机配合：
   *  - onTick(renderer)    每帧一次，无论是否进入帧模式都调用。
   *    壳层用它做「可见性兜底」——只在状态变化时同步显示权是不够的，
   *    任何一条路径漏写就会出现两只猫叠加。
   *  - onFinished(state)   一次性状态播完时通知壳层回落。
   */
  function startLoop(renderer, options) {
    const o = options || {};
    const raf = o.raf || ((fn) => global.requestAnimationFrame(fn));
    const cancel = o.cancel || ((id) => global.cancelAnimationFrame(id));
    const now = o.now || (() => (global.performance ? global.performance.now() : Date.now()));
    let running = true;
    let handle = null;
    let finishedNotified = false;

    function step() {
      if (!running) return;
      const t = now();
      if (renderer.isFrameMode()) {
        renderer.tick(t);
        const done = renderer.finishedAt(t);
        // 只在「刚播完」的那一帧通知一次，否则每帧都会回调
        if (done && !finishedNotified) {
          finishedNotified = true;
          if (typeof o.onFinished === 'function') o.onFinished(renderer.state());
        } else if (!done) {
          finishedNotified = false;
        }
      }
      if (typeof o.onTick === 'function') o.onTick(renderer);
      handle = raf(step);
    }
    handle = raf(step);

    return function stop() {
      running = false;
      if (handle !== null) {
        try { cancel(handle); } catch (_) { /* 忽略 */ }
      }
    };
  }

  const API = { createSkinRenderer, loadActiveSkin, startLoop, defaultImageLoader };

  global.PET_SKIN_RENDER = API;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
