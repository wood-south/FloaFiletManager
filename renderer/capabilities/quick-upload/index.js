/* ============================================================
   能力：拖放上传 / 回收站（quick-upload）
   ------------------------------------------------------------
   从 renderer/scripts/float.js 迁出（原 dragenter/dragover/dragleave/drop
   四个 document 监听 + 菜单里的「回收站模式」切换）。

   边界划分：
   - 本文件只处理「拿到了哪些路径，要做什么」——上传还是删除、重名怎么问
   - 落点提示的显示/隐藏、路径收集、拖放事件的拦截由壳层
     （renderer/scripts/capabilities.js 的 bindDropCollection）负责
   ============================================================ */

(function (global) {
  'use strict';

  const manifest = global.QUICK_UPLOAD_MANIFEST;
  if (!manifest) {
    console.warn('[quick-upload] 未找到 manifest，能力未注册');
    return;
  }

  if (!global.deskPetRegistry) {
    console.warn('[quick-upload] 未找到能力注册表，能力未注册');
    return;
  }

  /** 回收站模式：持久化在 capabilities.quick-upload.recycleMode */
  let recycleMode = false;

  function register(pet) {
    const api = global.electronAPI || {};

    pet.on('pet:drop', async ({ paths }) => {
      if (recycleMode) {
        await deleteToRecycleBin(pet, api, paths);
      } else {
        await uploadToDest(pet, api, paths);
      }
    });

    pet.on('menubtn', (action) => {
      if (action !== 'recycle') return;
      setRecycleMode(pet, !recycleMode);
      pet.toast(recycleMode ? '回收站模式已开启' : '回收站模式已关闭', 1500);
      // 即改即存：与原先「重启后丢失」的行为不同，这是本阶段明确要修的点
      pet.storage.set('recycleMode', recycleMode);
    });

    // 恢复上次的回收站模式（阶段 1 之前该状态重启即丢）
    pet.storage.get('recycleMode').then((saved) => {
      if (saved === true) setRecycleMode(pet, true);
    });
  }

  /** 切换回收站模式：更新按钮高亮，并通知壳层换用对应的落点提示 */
  function setRecycleMode(pet, on) {
    recycleMode = on;
    applyRecycleUi(pet, on);
    pet.emit('capability:mode', { id: manifest.id, mode: on ? 'recycle' : 'upload' });
  }

  /** 同步菜单按钮的高亮 */
  function applyRecycleUi(pet, on) {
    const btn = pet.root && pet.root.querySelector('[data-action="recycle"]');
    if (btn) btn.classList.toggle('recycle-active', on);
  }

  /** 回收站模式：逐个移入回收站并汇总结果 */
  async function deleteToRecycleBin(pet, api, paths) {
    let successCount = 0;
    for (const filePath of paths) {
      const result = await api.deleteFile(filePath);
      if (result && result.success) successCount++;
    }
    if (successCount > 0) {
      pet.toast('已删除 ' + successCount + ' 个文件到回收站');
      pet.emit('pet:drop-done', { action: 'recycle', succeeded: successCount, total: paths.length });
    } else {
      pet.toast('删除失败');
      pet.emit('pet:drop-done', { action: 'recycle', succeeded: 0, total: paths.length });
    }
  }

  /** 普通模式：上传到「文件管理器当前路径，若未打开则为首选路径」 */
  async function uploadToDest(pet, api, paths) {
    let destDir = null;
    if (api.getUploadDest) {
      destDir = await api.getUploadDest();
    }

    let successCount = 0;
    for (const filePath of paths) {
      const fileName = filePath.split(/[\\/]/).pop();
      const result = await api.uploadFile({
        sourcePath: filePath,
        fileName,
        destDir
      });

      if (result && result.duplicate) {
        const choice = await pet.modal({
          type: 'question',
          title: '文件已存在',
          message: '"' + fileName + '" 已存在，是否覆盖？',
          buttons: [
            { text: '覆盖', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });
        if (choice === 0) {
          const overwriteResult = await api.uploadFile({
            sourcePath: filePath,
            fileName,
            overwrite: true,
            destDir
          });
          if (overwriteResult && overwriteResult.success) successCount++;
        }
      } else if (result && result.success) {
        successCount++;
      }
    }

    if (successCount > 0) {
      pet.toast('成功上传 ' + successCount + ' 个文件');
      /* 通知壳层「这次拖放有实际成果」，由壳层决定怎么表现（桌宠庆祝）。
         刻意不让能力直接操作动画状态：能力只报告事实，表现归壳层 ——
         否则每加一个能力都要各自去改状态机。 */
      pet.emit('pet:drop-done', { action: 'upload', succeeded: successCount, total: paths.length });
    } else {
      pet.toast('上传取消');
      pet.emit('pet:drop-done', { action: 'upload', succeeded: 0, total: paths.length });
    }
  }

  /* 注册：推迟到当前脚本执行结束之后。
     本文件按 <script> 顺序早于 float.js 运行（float.js 稍后调用 registry.attach），
     因此不能在文件顶层直接 use()；同时这样也保证注入的依赖已就绪。
     注册失败不影响桌宠壳层（use() 内部捕获异常并回滚）。 */
  setTimeout(() => {
    global.deskPetRegistry.use({
      id: manifest.id,
      name: manifest.name,
      defaultEnabled: manifest.defaultEnabled,
      menuButtons: manifest.menuButtons,
      dropHint: manifest.dropHint,
      register
    });
  }, 0);
})(typeof window !== 'undefined' ? window : globalThis);
