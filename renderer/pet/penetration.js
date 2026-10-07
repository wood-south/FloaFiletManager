/* ============================================================
   点击穿透仲裁（阶段 2）
   ------------------------------------------------------------
   透明窗口默认让鼠标穿透到桌面，只有在「内容可交互」时才捕获鼠标。
   原实现用四个布尔量的组合判断是否恢复穿透：

     if (!menuOpen && !quitOpen && !modalActive && !isDragging) enableClickThrough();

   这种写法有三个问题：
   1. **顺序相关**：谁能恢复穿透取决于最后执行的是哪段代码。例如菜单开着时
      拖放结束，拖动分支认为自己结束了就恢复穿透，把菜单的可点击性一起关掉。
   2. **不可扩展**：每新增一个阻塞来源就要改动所有已有判断点（阶段 1 加能力、
      阶段 3 加动画/气泡都会引入新的来源）。
   3. **重复调用不安全**：同一原因被「关闭」两次就会误开穿透。

   现在改为**原因集合**：谁需要交互就 add 自己的原因，不需要就 delete，
   只有集合为空时才恢复穿透。add/delete 幂等、与调用顺序无关、可无限扩展。

   本文件不依赖 DOM，可在 Node 里直接测试（见 test/penetration.test.js）。
   ============================================================ */

(function (global) {
  'use strict';

  /**
   * @param {object} options
   *   - setIgnore(ignore, opts)  实际下发穿透状态的函数（壳层注入 electronAPI 调用）
   *   - log(...)                 可选：日志
   */
  function createPenetration(options) {
    const opts = options || {};
    const setIgnore = opts.setIgnore;
    const reasons = new Set();
    let ignoring = null; // 当前已下发的状态，避免重复 IPC

    function has(reason) {
      return reasons.has(reason);
    }

    function list() {
      return Array.from(reasons);
    }

    /** 按当前原因集合下发穿透状态：有原因 => 捕获(false)，无原因 => 穿透(true) */
    function apply() {
      const shouldIgnore = reasons.size === 0;
      if (ignoring === shouldIgnore) return shouldIgnore;
      ignoring = shouldIgnore;
      if (typeof setIgnore === 'function') {
        // forward: true 让窗口在穿透状态下仍能收到 mousemove，
        // 这是「鼠标是否能进入内容区」的前提（见原实现注释）
        setIgnore(shouldIgnore, shouldIgnore ? { forward: true } : undefined);
      }
      return shouldIgnore;
    }

    /** 声明「此期间需要交互」，返回 true 表示本次是新增（便于调试/断言） */
    function acquire(reason) {
      if (!reason) return false;
      const added = !reasons.has(reason);
      reasons.add(reason);
      apply();
      return added;
    }

    /** 撤销某个交互需求；重复撤销无副作用 */
    function release(reason) {
      if (!reason) return false;
      const removed = reasons.delete(reason);
      apply();
      return removed;
    }

    /** 撤销全部原因（窗口失焦等兜底场景用），并强制恢复穿透 */
    function releaseAll() {
      const had = reasons.size > 0;
      reasons.clear();
      ignoring = null; // 强制重新下发，避免兜底时被去重逻辑挡掉
      apply();
      return had;
    }

    /** 初始化：默认穿透到桌面 */
    function init() {
      reasons.clear();
      ignoring = null;
      return apply();
    }

    /** 当前是否处于穿透状态（未下发过时为 null） */
    function isIgnoring() {
      return ignoring;
    }

    return { init, acquire, release, releaseAll, has, list, isIgnoring };
  }

  global.createPenetration = createPenetration;
})(typeof window !== 'undefined' ? window : globalThis);
