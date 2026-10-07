/* ============================================================
   桌宠动画帧播放器（阶段 8.6）
   ------------------------------------------------------------
   把「状态机决定播哪个动作」与「这个动作长什么样」连起来：
   状态机给出状态名（idle / walk / interact …），皮肤给出该状态的帧序列
   （atlas 图集里的帧序号），本模块负责**按时间推进帧号**。

   规范见 docs/PET_SPEC.md §5：
   - 皮肤只能覆盖 `frames` 与 `fps`；
   - `loop` / `duration` 一律以**状态表**为准
     （否则皮肤能把一次性状态改成循环，状态机就永远回落不了）。

   本文件与 renderer/pet/behavior.js、skin.js 同风格：浏览器挂 window，
   Node 下 module.exports，因此可在 test/ 里直接 require 测试。

   纯逻辑（帧推进、帧矩形换算）与 DOM/画布绘制分开：
   前者是行为正确性的所在，必须能脱离浏览器测。 */

(function (global) {
  'use strict';

  const DEFAULT_FPS = 8;

  /** 按状态表与皮肤 clips 合并出「可播放的 clip 表」
   *  @param {object} states 状态表（behavior.js 的 STATES）
   *  @param {object} clips  皮肤声明的 clips（可为空）
   *  @param {number} [fallbackFrameCount] 皮肤未声明某状态时的帧数（默认 1，即静帧）
   */
  function resolveClips(states, clips, fallbackFrameCount) {
    const out = {};
    const table = states || {};
    const src = clips || {};
    const fallbackCount = fallbackFrameCount && fallbackFrameCount > 0 ? fallbackFrameCount : 1;

    for (const name of Object.keys(table)) {
      const state = table[name] || {};
      const given = src[name];
      let frames = null;
      if (given && Array.isArray(given.frames) && given.frames.length > 0) {
        frames = given.frames.filter((f) => Number.isInteger(f) && f >= 0);
        if (frames.length === 0) frames = null;
      }
      if (!frames) {
        // 皮肤没给这个状态：用第 0 帧当静帧，保证任何状态都有画面
        frames = [];
        for (let i = 0; i < fallbackCount; i++) frames.push(i);
      }

      const fpsRaw = given && typeof given.fps === 'number' && isFinite(given.fps) && given.fps > 0
        ? given.fps
        : DEFAULT_FPS;

      out[name] = {
        frames,
        fps: fpsRaw,
        // 以下三项**永远**取自状态表，皮肤无法覆盖
        loop: state.loop !== false,
        duration: typeof state.duration === 'number' ? state.duration : null,
        priority: typeof state.priority === 'number' ? state.priority : 0
      };
    }
    return out;
  }

  /**
   * 由「已经播放了多久」推算当前帧下标。
   * @param {object} clip { frames, fps, loop, duration }
   * @param {number} elapsedMs
   * @returns {number} 帧下标（对应 clip.frames 的下标，不是图集帧号）
   */
  function frameIndexAt(clip, elapsedMs) {
    if (!clip || !Array.isArray(clip.frames) || clip.frames.length === 0) return -1;
    const n = clip.frames.length;
    const t = typeof elapsedMs === 'number' && isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
    const fps = clip.fps > 0 ? clip.fps : DEFAULT_FPS;
    const step = Math.floor((t / 1000) * fps);
    if (clip.loop) {
      return ((step % n) + n) % n;
    }
    // 一次性状态：停在最后一帧，避免"播完回到第 0 帧"造成视觉跳变
    return Math.min(step, n - 1);
  }

  /** 一次性状态是否已经播完（状态机据此回落到 fallback） */
  function isFinished(clip, elapsedMs, atMs) {
    if (!clip || clip.loop) return false;
    const now = Number.isFinite(atMs) ? atMs : Date.now();
    /* 判定用 Number.isFinite，不能用 `typeof x === 'number'`：
       后者对 null 为 false（typeof null === 'object'），
       于是 `duration: null` 会掉进「按帧放完」的分支；
       而曾经的写法是 `typeof duration === 'number' ? … : return false`，
       使**声明了 duration: null 的一次性状态永远不结束**，
       桌宠会卡在该状态再也回不到 idle。
       这是被 test/frames.test.js 的「无 duration 时按帧放完判定」抓出来的。 */
    if (Number.isFinite(clip.duration) && clip.duration > 0) {
      return (now - elapsedMs) >= clip.duration;
    }
    // 没有 duration 时按「帧放完」判定
    const n = Array.isArray(clip.frames) ? clip.frames.length : 0;
    if (n === 0) return true;
    const fps = clip.fps > 0 ? clip.fps : DEFAULT_FPS;
    return (now - elapsedMs) >= (n / fps) * 1000;
  }

  /**
   * 图集里第 frame 号帧的矩形。
   * @param {object} atlas { frameWidth, frameHeight }
   * @param {number} frame
   * @param {number} [columns] 图集每行帧数；不传则按单行排列
   */
  function frameRect(atlas, frame, columns) {
    const fw = atlas && atlas.frameWidth > 0 ? atlas.frameWidth : 0;
    const fh = atlas && atlas.frameHeight > 0 ? atlas.frameHeight : 0;
    if (fw <= 0 || fh <= 0 || !Number.isInteger(frame) || frame < 0) return null;
    const cols = columns && columns > 0 ? columns : null;
    if (cols) {
      return { x: (frame % cols) * fw, y: Math.floor(frame / cols) * fh, width: fw, height: fh };
    }
    return { x: frame * fw, y: 0, width: fw, height: fh };
  }

  /** 由图集像素尺寸推出每行帧数（单行排列时等于总帧数） */
  function columnsOf(atlas, imageWidth) {
    if (!atlas || !(atlas.frameWidth > 0) || !(imageWidth > 0)) return 1;
    return Math.max(1, Math.floor(imageWidth / atlas.frameWidth));
  }

  /**
   * 帧播放器：按外部注入的时钟推进，不自己持有定时器
   * （便于测试与「由动画循环驱动」两种用法）。
   */
  function createFramePlayer(options) {
    const opts = options || {};
    const clips = opts.clips || {};
    let state = opts.initialState && clips[opts.initialState] ? opts.initialState : Object.keys(clips)[0];
    let startedAt = 0;

    function clipOf(name) {
      return clips[name] || null;
    }

    return {
      /** 切到某状态；同一状态重复设置不会重置播放进度 */
      setState(name, nowMs) {
        if (!clips[name]) return false;
        if (name === state) return false;
        state = name;
        startedAt = typeof nowMs === 'number' ? nowMs : 0;
        return true;
      },
      current() {
        return state;
      },
      clip() {
        return clipOf(state);
      },
      /** 当前应显示的图集帧号（不是下标）；无 clip 时返回 -1 */
      frameAt(nowMs) {
        const clip = clipOf(state);
        if (!clip) return -1;
        const idx = frameIndexAt(clip, nowMs - startedAt);
        if (idx < 0) return -1;
        return clip.frames[idx];
      },
      /** 一次性状态是否播完 */
      finishedAt(nowMs) {
        const clip = clipOf(state);
        if (!clip) return false;
        return isFinished(clip, startedAt, nowMs);
      },
      /** 已播时长（毫秒） */
      elapsedAt(nowMs) {
        return Math.max(0, nowMs - startedAt);
      }
    };
  }

  const API = {
    DEFAULT_FPS,
    resolveClips,
    frameIndexAt,
    isFinished,
    frameRect,
    columnsOf,
    createFramePlayer
  };

  global.PET_FRAMES = API;
  /* Node（主进程/测试）：同一份实现通过 require 复用 —— 校验与播放必须一致，
     否则会出现「校验通过但播不出来」或反之。 */
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
