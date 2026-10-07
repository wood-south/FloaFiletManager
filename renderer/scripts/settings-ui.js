/* ============================================================
   设置页辅助逻辑（阶段 8 设置页优化 + 8.3/8.4 皮肤页）
   ------------------------------------------------------------
   分成「纯逻辑」与「DOM 装配」两半：
   - 纯逻辑（搜索匹配、皮肤描述、卡片 HTML、试穿媒体选择）不碰 DOM，可完整单测
   - DOM 装配在 settings.js 里调用这些函数

   这样做的原因：设置页的皮肤列表与搜索过滤是最容易出细节 bug 的地方
   （过滤后留下空页签、卡片点击冒泡到删除按钮、试穿显示错误的 kind），
   而它们本身并不需要浏览器就能验证。 */

(function (global) {
  'use strict';

  /**
   * 一条设置项是否匹配搜索词。
   * 大小写不敏感，并支持多关键词（空格分隔，需全部命中）。
   * @param {string} query
   * @param {...string} texts 该项的可读文本（标题/说明/按钮文案等）
   */
  function matchesQuery(query, ...texts) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const hay = texts.filter((t) => typeof t === 'string').join(' ').toLowerCase();
    // 多关键词用「与」：输入「dock 模糊」应同时命中两个词
    return q.split(/\s+/).every((word) => hay.includes(word));
  }

  /** 取元素的可读文本（含 title/placeholder），供搜索匹配 */
  function searchableTextOf(el) {
    if (!el) return '';
    const parts = [];
    const pushAttr = (node, name) => {
      const v = node && node.getAttribute && node.getAttribute(name);
      if (v) parts.push(v);
    };
    pushAttr(el, 'title');
    pushAttr(el, 'placeholder');
    pushAttr(el, 'data-search');
    if (typeof el.textContent === 'string') parts.push(el.textContent);
    // 子元素里的按钮/标签文案也算这一项的一部分（例如「重置为默认图标」）
    if (el.querySelectorAll) {
      el.querySelectorAll('button, label, option, .hint-text').forEach((child) => {
        if (typeof child.textContent === 'string') parts.push(child.textContent);
      });
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 在一个页签内按搜索词过滤「设置项」。
   * 规则：
   * - 页签本身始终保留（避免搜不到时以为设置页坏了）
   * - 只处理直接子元素作为「设置项」单位
   * - 无任何命中时返回 { visible:0 }，调用方据此显示空态提示
   * @returns {{visible:number}}
   */
  function filterTab(tabEl, query, className) {
    const cls = className || 'filtered-out';
    if (!tabEl || !tabEl.children) return { visible: 0 };
    const q = String(query || '').trim();
    let visible = 0;

    // 按「块」分组：section-title 与其后的兄弟元素视为一组，
    // 这样搜「Dock 外观」时标题和内容一起留下或一起隐藏。
    // 标题之前的散落元素各自成组 —— 否则它们会被合并成一组，
    // 只要其中一个命中就整组显示，过滤就不起作用了。
    const children = Array.prototype.slice.call(tabEl.children);
    const groups = [];
    let current = null;
    for (const el of children) {
      const isTitle = el.classList && el.classList.contains('section-title');
      if (isTitle) {
        current = { title: el, items: [] };
        groups.push(current);
      } else if (current) {
        current.items.push(el);
      } else {
        // 还没有遇到标题：这个元素自己一组
        groups.push({ title: null, items: [el] });
      }
    }

    for (const g of groups) {
      const texts = [];
      if (g.title) texts.push(searchableTextOf(g.title));
      g.items.forEach((it) => texts.push(searchableTextOf(it)));
      const hit = !q || matchesQuery(q, ...texts);
      if (g.title) g.title.classList.toggle(cls, !hit);
      g.items.forEach((it) => it.classList.toggle(cls, !hit));
      if (hit) visible += g.items.length + (g.title ? 1 : 0);
    }
    return { visible };
  }

  /** 皮肤的一句话描述（列表卡片副标题） */
  function describeSkin(skin) {
    if (!skin) return '';
    const bits = [];
    const render = skin.render || {};
    if (render.kind === 'sprite') {
      const a = render.atlas || {};
      const cols = a.frameWidth && a.frameHeight ? ` ${a.frameWidth}×${a.frameHeight}` : '';
      bits.push('动画帧' + cols);
    } else {
      bits.push('SVG');
    }
    if (skin.author) bits.push(skin.author);
    if (skin.warnings && skin.warnings.length > 0) bits.push('有 ' + skin.warnings.length + ' 条提示');
    return bits.join(' · ');
  }

  /** 皮肤来源标签 */
  function sourceLabel(source) {
    if (source === 'builtin') return '内置';
    if (source === 'user') return '用户';
    return '未知';
  }

  /**
   * 试穿时该显示什么媒体。
   * sprite 用 atlas 静态图（真正动起来要靠桌宠那边的播放器，
   * 设置页只需要让用户看清长什么样）；svg 直接用其 data URL。
   * @returns {{kind:'img', url:string}|{kind:'none', reason:string}}
   */
  function previewMedia(skin) {
    if (!skin || !skin.render) return { kind: 'none', reason: '没有皮肤信息' };
    const r = skin.render;
    if (r.kind === 'sprite') {
      const url = r.atlas && r.atlas.dataUrl;
      if (!url) return { kind: 'none', reason: '缺少图集图片' };
      return { kind: 'img', url };
    }
    const url = r.svg && r.svg.dataUrl;
    if (!url) return { kind: 'none', reason: '缺少 SVG 图片' };
    return { kind: 'img', url };
  }

  /** HTML 转义（皮肤名/作者来自第三方包，必须转义后再插入 DOM） */
  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 生成一张皮肤卡片的 HTML。
   * @param {object} skin list-skins 返回的条目
   * @param {object} opts { activeId, canExport }
   */
  function skinCardHtml(skin, opts) {
    const o = opts || {};
    const id = escapeHtml(skin.id);
    const isActive = skin.id === o.activeId;
    const canExport = o.canExport !== false && skin.source !== 'builtin';
    const thumb = skin.thumbUrl
      ? `<img src="${escapeHtml(skin.thumbUrl)}" alt="" />`
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle></svg>';

    return (
      `<div class="skin-card${isActive ? ' active' : ''}" data-skin-id="${id}" data-source="${escapeHtml(skin.source || '')}">` +
      `<div class="skin-card-thumb">${thumb}</div>` +
      '<div class="skin-card-info">' +
      `<div class="skin-card-name">${escapeHtml(skin.name || skin.id)}</div>` +
      `<div class="skin-card-meta">${escapeHtml(sourceLabel(skin.source))} · ${escapeHtml(describeSkin(skin))}</div>` +
      '</div>' +
      '<div class="skin-card-actions">' +
      `<button class="skin-card-btn" data-skin-action="preview" data-skin-id="${id}">试穿</button>` +
      `<button class="skin-card-btn primary" data-skin-action="apply" data-skin-id="${id}">应用</button>` +
      (canExport
        ? `<button class="skin-card-btn" data-skin-action="export" data-skin-id="${id}">导出</button>`
        : '') +
      '</div>' +
      '</div>'
    );
  }

  /** 把 list-skins 的返回整理成带 source/缩略图的扁平列表 */
  function flattenSkins(listResult) {
    const res = listResult || {};
    const out = [];
    (res.builtin || []).forEach((s) => out.push(Object.assign({}, s, { source: 'builtin' })));
    (res.user || []).forEach((s) => out.push(Object.assign({}, s, { source: 'user' })));
    return out;
  }

  /** 错误信息汇总成可读文本（导入失败时可能有多条） */
  function describeErrors(res) {
    if (!res) return '未知错误';
    if (typeof res.error === 'string' && res.error) return res.error;
    if (Array.isArray(res.errors) && res.errors.length > 0) return res.errors.join('\n');
    return '未知错误';
  }

  const API = {
    matchesQuery,
    searchableTextOf,
    filterTab,
    describeSkin,
    sourceLabel,
    previewMedia,
    escapeHtml,
    skinCardHtml,
    flattenSkins,
    describeErrors
  };

  global.SETTINGS_UI = API;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
