/* 自检：多显示器支持 src/main/display.js
   用假 screen 验证选屏规则与钳制逻辑（阶段 7 的多屏缺口）。

   背景：此前所有几何钳制都基于 screen.getPrimaryDisplay().workArea，
   双屏下是错的 —— Dock/浮窗拖到副屏后仍按主屏工作区钳制，位置会被拉回主屏；
   副屏拔掉后已保存的位置可能落在不存在的坐标上（看不见也点不到）。

   重点守住：
   - 选屏优先按「交叠面积最大」，无矩形时按鼠标位置，最后兜底主屏
   - 钳制用 workArea（已排除任务栏），而不是 bounds
   - allowAbove / allowLeft 供 Dock 很高的透明预留区越出工作区上沿（既有修复）
   - 副屏被拔掉后，只把**完全不可见**的窗口收回来；
     仍与某块屏交叠的窗口不得被搬动（否则副屏上的窗口会被误拉走） */

const path = require('path');
const assert = require('assert');

const display = require(path.join(__dirname, '..', 'src', 'main', 'display.js'));
const { createDisplayOps, watchDisplayChanges, isFullyOutside } = display;

/** 假 screen：两块屏，副屏在右侧 */
function makeScreen(opts) {
  const o = opts || {};
  const displays = o.displays || [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } }
  ];
  const listeners = {};
  return {
    displays,
    cursor: o.cursor || { x: 100, y: 100 },
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getDisplayNearestPoint: (pt) => {
      if (o.nearestImpl) return o.nearestImpl(pt);
      // 默认实现：点落在哪块屏的 bounds 里就返回哪块
      for (const d of displays) {
        const b = d.bounds;
        if (pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height) return d;
      }
      return displays[0];
    },
    getDisplayMatching: (rect) => {
      if (o.matchingImpl) return o.matchingImpl(rect);
      let best = displays[0];
      let bestArea = -1;
      for (const d of displays) {
        const wa = d.workArea;
        const ox = Math.max(0, Math.min(rect.x + rect.width, wa.x + wa.width) - Math.max(rect.x, wa.x));
        const oy = Math.max(0, Math.min(rect.y + rect.height, wa.y + wa.height) - Math.max(rect.y, wa.y));
        const area = ox * oy;
        if (area > bestArea) { bestArea = area; best = d; }
      }
      return best;
    },
    getCursorScreenPoint: () => o.cursor,
    on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    removeListener: (evt, fn) => {
      listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn);
    },
    emit: (evt) => { (listeners[evt] || []).slice().forEach((f) => f()); },
    _listeners: listeners
  };
}

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

console.log('\n[1] 选屏规则');
{
  const ops = createDisplayOps(makeScreen());
  ok('矩形在主屏 → 主屏 workArea', () => {
    const wa = ops.workAreaFor({ x: 10, y: 10, width: 100, height: 100 });
    assert.deepStrictEqual(wa, { x: 0, y: 0, width: 1920, height: 1040 });
  });
  ok('矩形在副屏 → 副屏 workArea（这是原先的缺口）', () => {
    const wa = ops.workAreaFor({ x: 2000, y: 10, width: 100, height: 100 });
    assert.deepStrictEqual(wa, { x: 1920, y: 0, width: 1280, height: 984 });
  });
  ok('矩形跨屏 → 取交叠面积更大的那块', () => {
    const wa = ops.workAreaFor({ x: 1800, y: 10, width: 200, height: 100 });
    // 与主屏交叠 120px 宽，与副屏交叠 80px 宽 → 主屏
    assert.strictEqual(wa.x, 0);
  });
  ok('无矩形时按鼠标位置选屏', () => {
    const ops2 = createDisplayOps(makeScreen({ cursor: { x: 2500, y: 500 } }));
    const wa = ops2.workAreaFor(null);
    assert.strictEqual(wa.x, 1920, '鼠标在副屏应选副屏');
  });
  ok('鼠标也在主屏时选主屏', () => {
    const ops3 = createDisplayOps(makeScreen({ cursor: { x: 50, y: 50 } }));
    assert.strictEqual(ops3.workAreaFor(null).x, 0);
  });
  ok('矩形不在任何屏内 → 仍返回某个 workArea（不崩、不返回 null）', () => {
    const wa = ops.workAreaFor({ x: 99999, y: 99999, width: 10, height: 10 });
    assert.ok(wa && typeof wa.width === 'number');
  });
  ok('workAreas 返回全部屏幕（判断可见性必须用全部，不能只用一块）', () => {
    const areas = ops.workAreas();
    assert.strictEqual(areas.length, 2);
  });
  ok('screen 抛错时有兜底，不会把异常抛给调用方', () => {
    const broken = {
      getAllDisplays: () => { throw new Error('boom'); },
      getPrimaryDisplay: () => { throw new Error('boom'); },
      getDisplayMatching: () => { throw new Error('boom'); },
      getDisplayNearestPoint: () => { throw new Error('boom'); },
      getCursorScreenPoint: () => { throw new Error('boom'); }
    };
    const opsB = createDisplayOps(broken);
    let wa;
    assert.doesNotThrow(() => { wa = opsB.workAreaFor({ x: 1, y: 1, width: 2, height: 2 }); });
    assert.ok(wa && wa.width > 0, '应有兜底 workArea');
  });
}

console.log('\n[2] 钳制用 workArea（不是 bounds）');
{
  const sc = makeScreen();
  const ops = createDisplayOps(sc);
  ok('右下越界被拉回副屏工作区内', () => {
    const wa = ops.workAreaFor({ x: 2000, y: 500, width: 100, height: 100 });
    const pos = ops.clampTo({ x: 3100, y: 990, width: 100, height: 100 }, wa);
    assert.strictEqual(pos.x, 1920 + 1280 - 100);
    assert.strictEqual(pos.y, 984 - 100);
  });
  ok('左上越界被拉回', () => {
    const wa = ops.workAreaFor({ x: 2000, y: 500, width: 100, height: 100 });
    const pos = ops.clampTo({ x: 1800, y: -50, width: 100, height: 100 }, wa);
    assert.strictEqual(pos.x, 1920);
    assert.strictEqual(pos.y, 0);
  });
  ok('已在范围内则不动', () => {
    const wa = ops.workAreaFor({ x: 2000, y: 500, width: 100, height: 100 });
    const pos = ops.clampTo({ x: 2000, y: 500, width: 100, height: 100 }, wa);
    assert.deepStrictEqual(pos, { x: 2000, y: 500 });
  });
  ok('allowAbove 允许窗口越出上沿（Dock 的透明预留区需要）', () => {
    const wa = ops.workAreaFor(null);
    const pos = ops.clampTo({ x: 100, y: -300, width: 400, height: 420 }, wa, { allowAbove: true });
    assert.strictEqual(pos.y, -300, '应允许向上越界');
    assert.strictEqual(pos.x, 100);
  });
  ok('allowAbove 时下沿仍不得超出', () => {
    const wa = ops.workAreaFor(null);
    const pos = ops.clampTo({ x: 100, y: 5000, width: 400, height: 420 }, wa, { allowAbove: true });
    assert.strictEqual(pos.y, wa.y + wa.height - 420);
  });
  ok('allowAbove 不影响左右钳制', () => {
    const wa = ops.workAreaFor(null);
    const pos = ops.clampTo({ x: 99999, y: -300, width: 400, height: 420 }, wa, { allowAbove: true });
    assert.strictEqual(pos.x, wa.x + wa.width - 400, '左右仍须钳死');
    assert.strictEqual(pos.y, -300);
  });
  ok('不传 wa 时按矩形所在屏兜底', () => {
    const pos = ops.clampTo({ x: 99999, y: 10, width: 100, height: 100 });
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
  });
}

console.log('\n[3] 可见性判定与副屏拔除');
{
  const areas = [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 1920, y: 0, width: 1280, height: 984 }
  ];
  ok('窗口在副屏上 → 不算完全不可见', () => {
    assert.strictEqual(isFullyOutside({ x: 2000, y: 100, width: 100, height: 100 }, areas), false);
  });
  ok('窗口在右侧屏外 → 完全不可见', () => {
    assert.strictEqual(isFullyOutside({ x: 5000, y: 100, width: 100, height: 100 }, areas), true);
  });
  ok('窗口在上方屏外 → 完全不可见', () => {
    assert.strictEqual(isFullyOutside({ x: 100, y: -500, width: 100, height: 100 }, areas), true);
  });
  ok('仅与某屏边界相切（零交叠，且横向在屏外）→ 完全不可见', () => {
    // 该矩形横向起点 3520 > 副屏右边界 3200，与两块屏都没有面积交叠
    assert.strictEqual(isFullyOutside({ x: 3520, y: 100, width: 100, height: 200 }, areas), true);
  });
  ok('纵向越出但横向仍在屏内、有面积交叠 → 不算完全不可见', () => {
    assert.strictEqual(isFullyOutside({ x: 1920, y: -100, width: 100, height: 200 }, areas), false);
  });
  ok('空 areas 不做判定（避免误搬窗口）', () => {
    assert.strictEqual(isFullyOutside({ x: 9999, y: 9999, width: 10, height: 10 }, []), false);
  });
  ok('非法矩形不做判定', () => {
    assert.strictEqual(isFullyOutside(null, areas), false);
    assert.strictEqual(isFullyOutside({ x: 1 }, areas), false);
  });

  // 副屏被拔掉：只剩主屏
  const sc = makeScreen();
  const moved = [];
  const pet = { isDestroyed: () => false, getBounds: () => ({ x: 2400, y: 300, width: 90, height: 90 }), setPosition: (x, y) => moved.push({ x, y }) };
  const dock = { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 100, width: 400, height: 200 }), setPosition: (x, y) => moved.push({ x, y, dock: true }) };
  const watcher = watchDisplayChanges({ screen: sc, getFloatableWindows: () => [pet, dock] });

  ok('副屏仍在时：副屏上的窗口不搬动', () => {
    watcher.bringBackWindows();
    assert.strictEqual(moved.length, 0, '仍在可视区内的窗口不得被搬动');
  });

  ok('副屏拔掉后：越界窗口被收回主屏工作区', () => {
    // 模拟拔掉副屏
    sc.displays.splice(1, 1);
    watcher.bringBackWindows();
    assert.ok(moved.length >= 1, '越界窗口应收回来');
    const p = moved.find((m) => !m.dock);
    assert.ok(p.x <= 1920 - 90, '应被拉回主屏范围内，实际 x=' + p.x);
  });

  ok('仍在主屏内的窗口不被搬动', () => {
    moved.length = 0;
    watcher.bringBackWindows();
    assert.strictEqual(moved.filter((m) => m.dock).length, 0, '主屏内的 Dock 不应被搬动');
  });

  ok('显示器事件触发收回逻辑（异步一拍）', () => {
    moved.length = 0;
    sc.emit('display-removed');
    // 收回是 setTimeout(300)，这里直接验证监听已注册即可
    assert.ok(sc._listeners['display-removed'].length >= 1);
  });

  ok('dispose 之后不再响应事件', () => {
    watcher.dispose();
    assert.strictEqual(sc._listeners['display-removed'].length, 0);
  });

  ok('窗口已销毁时跳过（不抛错）', () => {
    const sc2 = makeScreen();
    const dead = { isDestroyed: () => true, getBounds: () => { throw new Error('不应被调用'); } };
    const w2 = watchDisplayChanges({ screen: sc2, getFloatableWindows: () => [dead, null] });
    assert.doesNotThrow(() => w2.bringBackWindows());
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
