/* ============================================================
   桌宠内置配色（阶段 3.4）
   ------------------------------------------------------------
   内置 SVG 猫的颜色不再写死在属性上，而是引用 `var(--cat-*, 兜底值)`：
   `renderer/float.html` 里是 `fill="var(--cat-fur, #f5a623)"`。

   为什么还要这份 JS 清单：CSS 变量写在 `<svg>` 属性上时，兜底值已经够用；
   但当皮肤给出 `colorMap` 时，需要知道「哪些变量可被覆盖」，以及
   「换回内置外观时要把哪些变量清掉」。两者都需要一份权威清单，
   否则会出现「换过皮肤后清不干净、内置猫颜色不对」。

   变量名与 docs/PET_SPEC.md 第 7 节一致（`--cat-fur` / `--cat-ear`），
   其余为内置猫用到的扩展色，皮肤可选覆盖。 */

(function (global) {
  'use strict';

  /** 变量名 → 内置默认值。**值必须与 float.html 里的兜底值一致** */
  const CAT_PALETTE = {
    '--cat-fur': '#f5a623',
    '--cat-ear': '#f8c774',
    '--cat-stripe': '#e8941a',
    '--cat-whisker': '#d4903a',
    '--cat-ink': '#333',
    '--cat-nose': '#e85d5d',
    '--cat-cheek': '#ffb6b6'
  };

  /** 允许皮肤覆盖的变量名白名单 = 内置清单里的键 */
  function isKnownVar(name) {
    return Object.prototype.hasOwnProperty.call(CAT_PALETTE, name);
  }

  /**
   * 把皮肤的 colorMap 应用到桌宠根元素。
   * @param {object} el 目标元素（通常是 .pet-body）
   * @param {object} colorMap { '--cat-fur': '#000' }
   * @returns {{applied:string[], ignored:string[]}}
   *   applied: 真正写入的变量；ignored: 不在白名单内被跳过的
   */
  function applyColorMap(el, colorMap) {
    const applied = [];
    const ignored = [];
    if (!el || !el.style || !colorMap || typeof colorMap !== 'object') {
      return { applied, ignored };
    }
    for (const [name, value] of Object.entries(colorMap)) {
      // 只接受内置清单里的变量：皮肤不能往桌宠上塞任意 CSS 变量
      if (!isKnownVar(name)) {
        ignored.push(name);
        continue;
      }
      if (typeof value !== 'string' || !value.trim()) {
        ignored.push(name);
        continue;
      }
      el.style.setProperty(name, value.trim());
      applied.push(name);
    }
    return { applied, ignored };
  }

  /**
   * 清掉皮肤写入的颜色，回到内置配色。
   * 必须逐个 removeProperty，不能只 removeAttribute('style') ——
   * 桌宠根元素上还挂着 --pet-cursor 等运行时变量，整体清掉会把它们一起弄没。
   */
  function clearColorMap(el) {
    if (!el || !el.style) return false;
    for (const name of Object.keys(CAT_PALETTE)) {
      try {
        el.style.removeProperty(name);
      } catch (_) { /* 忽略 */ }
    }
    return true;
  }

  const API = { CAT_PALETTE, isKnownVar, applyColorMap, clearColorMap };

  global.PET_COLORS = API;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
