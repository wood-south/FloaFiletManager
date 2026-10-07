/* 能力清单：拖放上传 / 回收站
   字段说明见 renderer/scripts/capabilities.js 文件头。 */
(function (global) {
  'use strict';

  /** 落点提示的两种形态（壳层按 mode 选用，能力不直接操作 overlay DOM） */
  const ICON_UPLOAD = [
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>',
    '<polyline points="17 8 12 3 7 8"></polyline>',
    '<line x1="12" y1="3" x2="12" y2="15"></line>'
  ].join('');

  const ICON_RECYCLE = [
    '<polyline points="3 6 5 6 21 6"></polyline>',
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    '<line x1="10" y1="11" x2="10" y2="17"></line>',
    '<line x1="14" y1="11" x2="14" y2="17"></line>'
  ].join('');

  global.QUICK_UPLOAD_MANIFEST = {
    id: 'quick-upload',
    name: '拖放上传',
    defaultEnabled: true,

    /* 回收站模式开关：菜单按钮上的切换项。
       title 用于提示；toggle 为真表示这是可开关的按钮。 */
    menuButtons: [
      {
        action: 'recycle',
        title: '回收站模式',
        toggle: true,
        persistKey: 'recycleMode'
      }
    ],

    /* 落点提示文案/图标由能力提供，壳层负责渲染 */
    dropHint: {
      upload: { text: '释放上传', icon: ICON_UPLOAD, mode: 'upload' },
      recycle: { text: '释放删除到回收站', icon: ICON_RECYCLE, mode: 'recycle' }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
