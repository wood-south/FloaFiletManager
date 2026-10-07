/* ============================================================
   桌宠皮肤包校验与合并（阶段 3）
   ------------------------------------------------------------
   规范见 docs/PET_SPEC.md。本文件只做两件事：

   1. **校验**：把一个来路不明的 pet.json 归一化成「可安全使用」的皮肤对象。
      红线：校验层绝不抛错 —— 任何异常都转成 errors + ok:false，
      调用方据此回落到内置皮肤并提示用户（阶段 8 导入第三方包时的第一道闸）。
   2. **合并**：把皮肤的 clips 叠到内置状态表上，产出每个状态最终的
      「帧序列 + 帧率」。**loop 与 duration 一律以状态表为准**，
      优先级/可打断关系不可被皮肤覆盖 —— 否则皮肤能把一次性状态改成循环，
      状态机就再也回落不到 idle 了。

   设计原则：缺字段可降级（回落内置默认），未知内容忽略并记 warning，
   而不是白屏或报错。
   ============================================================ */

(function (global) {
  'use strict';

  const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
  const VAR_RE = /^--[a-zA-Z0-9-]+$/;
  const SOUND_EXT = ['.ogg', '.mp3', '.wav', '.m4a'];
  const DEFAULT_FPS = 8;
  const DEFAULT_SIZE = { width: 90, height: 90 };

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function isPositiveNumber(v) {
    return typeof v === 'number' && isFinite(v) && v > 0;
  }

  /** 相对资源路径是否安全（禁止绝对路径与向上跳出） */
  function isSafeRelPath(p) {
    if (typeof p !== 'string' || !p.trim()) return false;
    if (/^[a-zA-Z]:[\\/]/.test(p)) return false;   // Windows 绝对路径
    if (p.startsWith('/') || p.startsWith('\\')) return false;
    if (p.includes('..')) return false;
    if (/^[a-z]+:\/\//i.test(p)) return false;     // 任何协议前缀
    return true;
  }

  /** 合法状态名集合；优先用调用方显式传入的列表（主进程用它替代状态表），
      其次读状态表模块（Node 下 require、浏览器下读全局），最后用内置清单兜底 */
  const FALLBACK_STATES = ['idle', 'sleep', 'walk', 'celebrate', 'interact', 'snap', 'drag'];

  /* 方向后缀（阶段 8.7）：`drag-up`、`walk-left` 这类是**状态的方向变体**，
     不是独立状态，必须被接受 —— 否则皮肤作者画的四向拖拽会被整片忽略，
     反而报一堆"未知状态名"。归一化规则与 renderer/pet/direction.js 一致
     （top/bottom 与 up/down 等价）。 */
  const DIRECTION_SUFFIXES = ['-up', '-down', '-left', '-right', '-top', '-bottom'];

  /** 把 `drag-up` 拆成 { state:'drag', dir:'up' }；不带方向时 dir 为 null */
  function splitVariant(name) {
    for (const sfx of DIRECTION_SUFFIXES) {
      if (name.length > sfx.length && name.endsWith(sfx)) {
        return { state: name.slice(0, -sfx.length), dir: sfx.slice(1) };
      }
    }
    return { state: name, dir: null };
  }

  /** 名字是否是「合法状态」或「合法状态的方向变体」 */
  function isKnownClipName(name, states) {
    if (states.includes(name)) return true;
    const v = splitVariant(name);
    return v.dir !== null && states.includes(v.state);
  }
  function knownStates(override) {
    if (Array.isArray(override) && override.length > 0) return override;
    // Node：状态表与本校验器在同一目录，直接 require，避免依赖全局副作用顺序
    /* eslint-disable no-undef */
    if (typeof module !== 'undefined' && module.exports) {
      try {
        const b = require('./behavior');
        if (b && b.STATES) return Object.keys(b.STATES);
      } catch (_) { /* 落到下面的回退 */ }
    }
    /* eslint-enable no-undef */
    const table = global.PET_BEHAVIOR && global.PET_BEHAVIOR.STATES;
    if (table) return Object.keys(table);
    return FALLBACK_STATES.slice();
  }

  /**
   * 校验并归一化一个皮肤对象。
   * @param {object} raw 解析后的 pet.json
   * @param {object} [options]
   *   - states: 合法状态名数组。主进程没有渲染侧的状态表，用它显式传入，
   *     避免把状态表复制一份到主进程（单一事实来源仍在 pet/behavior.js）。
   * @returns {{ok:boolean, errors:string[], warnings:string[], skin:object|null}}
   */
  function validatePetSkin(raw, options) {
    const opts = options || {};
    const errors = [];
    const warnings = [];

    if (!isPlainObject(raw)) {
      return { ok: false, errors: ['皮肤文件不是一个 JSON 对象'], warnings, skin: null };
    }

    // ---- 必填字段 ----
    if (raw.format !== 'pet') errors.push('format 必须为 "pet"');
    if (raw.version !== 1) {
      // 只支持 v1：更高版本宁可拒绝也不要误读
      if (typeof raw.version === 'number' && raw.version > 1) {
        errors.push('不支持的规范版本: ' + raw.version);
      } else {
        errors.push('version 必须为 1');
      }
    }
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
      errors.push('id 非法（需匹配 ' + ID_RE.source + '）');
    }
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      errors.push('name 不能为空');
    }
    if (!isPlainObject(raw.render)) {
      errors.push('缺少 render 对象');
    }

    if (errors.length > 0) {
      return { ok: false, errors, warnings, skin: null };
    }

    // ---- render ----
    const rawRender = raw.render;
    let kind = rawRender.kind;
    if (kind !== 'svg' && kind !== 'sprite') {
      warnings.push('render.kind 非法（' + kind + '），回落到 svg');
      kind = 'svg';
    }

    let size = DEFAULT_SIZE;
    if (isPlainObject(rawRender.size)) {
      const w = rawRender.size.width;
      const h = rawRender.size.height;
      if (isPositiveNumber(w) && isPositiveNumber(h)) {
        size = { width: w, height: h };
      } else {
        warnings.push('render.size 非正数，使用内置设计尺寸 90×90');
      }
    } else if (rawRender.size !== undefined) {
      warnings.push('render.size 格式非法，使用内置设计尺寸');
    }

    const render = { kind, size };

    if (kind === 'svg') {
      const svg = isPlainObject(rawRender.svg) ? rawRender.svg : null;
      if (!svg || !isSafeRelPath(svg.file)) {
        warnings.push('svg.file 缺失或路径不安全，将使用内置 SVG 猫');
        render.svg = null;
      } else {
        const colorMap = {};
        if (isPlainObject(svg.colorMap)) {
          for (const [k, v] of Object.entries(svg.colorMap)) {
            if (!VAR_RE.test(k)) {
              warnings.push('colorMap 变量名非法，已忽略: ' + k);
              continue;
            }
            if (typeof v !== 'string' || !v.trim()) {
              warnings.push('colorMap 颜色值非法，已忽略: ' + k);
              continue;
            }
            colorMap[k] = v.trim();
          }
        } else if (svg.colorMap !== undefined) {
          warnings.push('svg.colorMap 格式非法，已忽略');
        }
        render.svg = { file: svg.file, colorMap };
      }
    } else {
      const atlas = isPlainObject(rawRender.atlas) ? rawRender.atlas : null;
      const usable = atlas && isSafeRelPath(atlas.file) &&
        isPositiveNumber(atlas.frameWidth) && isPositiveNumber(atlas.frameHeight);
      if (!usable) {
        warnings.push('atlas 缺失/非法（需要 file + 正数 frameWidth/frameHeight），回落到 svg');
        render.kind = 'svg';
        const svg = isPlainObject(rawRender.svg) && isSafeRelPath(rawRender.svg.file)
          ? { file: rawRender.svg.file, colorMap: {} }
          : null;
        render.svg = svg;
      } else {
        render.atlas = {
          file: atlas.file,
          frameWidth: atlas.frameWidth,
          frameHeight: atlas.frameHeight
        };
        if (isPlainObject(rawRender.svg) && isSafeRelPath(rawRender.svg.file)) {
          render.svg = { file: rawRender.svg.file, colorMap: {} }; // 供无 frames 时兜底
        }
      }
    }

    // ---- clips ----
    const states = knownStates(opts.states);
    const clips = {};
    if (raw.clips !== undefined && !isPlainObject(raw.clips)) {
      warnings.push('clips 不是对象，已忽略全部动作覆盖');
    } else if (isPlainObject(raw.clips)) {
      for (const [name, clip] of Object.entries(raw.clips)) {
        if (!isKnownClipName(name, states)) {
          warnings.push('未知状态名，已忽略: ' + name);
          continue;
        }
        if (!isPlainObject(clip)) {
          warnings.push('clip 不是对象，已忽略: ' + name);
          continue;
        }
        const frames = Array.isArray(clip.frames) ? clip.frames : null;
        const validFrames = frames && frames.length > 0 &&
          frames.every((n) => Number.isInteger(n) && n >= 0);
        if (!validFrames) {
          warnings.push('frames 非法或为空，已忽略: ' + name);
          continue;
        }
        const fps = isPositiveNumber(clip.fps) ? clip.fps : DEFAULT_FPS;
        if (clip.fps !== undefined && !isPositiveNumber(clip.fps)) {
          warnings.push('fps 非法，使用默认 ' + DEFAULT_FPS + ': ' + name);
        }
        clips[name] = { frames: frames.slice(), fps };
      }
    }

    // ---- sounds ----
    const sounds = {};
    if (raw.sounds !== undefined && !isPlainObject(raw.sounds)) {
      warnings.push('sounds 不是对象，已忽略');
    } else if (isPlainObject(raw.sounds)) {
      for (const [name, file] of Object.entries(raw.sounds)) {
        if (!isKnownClipName(name, states)) {
          warnings.push('sounds 含未知状态名，已忽略: ' + name);
          continue;
        }
        if (!isSafeRelPath(file)) {
          warnings.push('音效路径不安全，已忽略: ' + name);
          continue;
        }
        const lower = String(file).toLowerCase();
        if (!SOUND_EXT.some((e) => lower.endsWith(e))) {
          warnings.push('音效扩展名不在白名单，已忽略: ' + name);
          continue;
        }
        sounds[name] = file;
      }
    }

    return {
      ok: true,
      errors,
      warnings,
      skin: {
        format: 'pet',
        version: 1,
        id: raw.id,
        name: raw.name.trim(),
        author: typeof raw.author === 'string' ? raw.author : '',
        render,
        clips,
        sounds
      }
    };
  }

  /**
   * 把皮肤的动作覆盖合并到内置状态表上。
   * loop 与 duration 一律以状态表为准（皮肤不得改变状态机语义）。
   * @param {object|null} skin validatePetSkin 产出的 skin
   * @returns {Object<string, {frames:number[]|null, fps:number, loop:boolean, duration:number|null, class:string}>}
   */
  function mergeClips(skin) {
    const table = (global.PET_BEHAVIOR && global.PET_BEHAVIOR.STATES) || {};
    const clips = (skin && skin.clips) || {};
    const out = {};

    for (const [name, def] of Object.entries(table)) {
      const override = clips[name];
      out[name] = {
        // 没有覆盖帧序列时为 null —— 表示「用内置 SVG 表现」，而不是「没有动作」
        frames: override ? override.frames.slice() : null,
        fps: override ? override.fps : DEFAULT_FPS,
        // 以下两项以状态表为准
        loop: def.loop,
        duration: def.loop ? null : (def.duration || null),
        class: def.class
      };
    }
    return out;
  }

  const API = {
    validatePetSkin,
    mergeClips,
    isSafeRelPath,
    FALLBACK_STATES: FALLBACK_STATES.slice(),
    DEFAULTS: { fps: DEFAULT_FPS, size: DEFAULT_SIZE, soundExt: SOUND_EXT }
  };

  // 浏览器：挂到 window，供渲染脚本直接使用
  global.PET_SKIN = API;

  /* Node（主进程）：同一份实现通过 require 复用。
     阶段 8 的皮肤导入校验跑在主进程（安全边界），如果为此再写一份校验逻辑，
     两处迟早会分叉 —— 因此这里让同一份代码同时支持两种加载方式。
     主进程没有渲染侧的状态表，调用方通过 options.states 显式传入。 */
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
