/* 自检：吸附全流程仿真（无需 Electron / GUI）
   目的：在没有图形环境的情况下验证「拖动 → 吸附 → 移动 Dock → 跟随」整条链路的坐标。

   为什么需要仿真：用户反馈的三个现象（吸附差一点、不跟随移动、拖动闪动）都涉及
   状态与坐标的时序，单点断言容易漏。这里用一个模拟器按真实调用顺序推进状态，
   每步都断言「宠物视觉边框与面板边缘的间隙」。

   真实实现对应关系：
     window.js  move-dock            → sim.moveDock()
     window.js  save-window-position → sim.endDrag()
     window.js  report-pet-anchor    → sim.reportAnchor()
     window.js  searchDockSnap / maintainDockSnap → decide(mode) */

const assert = require('assert');
const path = require('path');
const { decide, positionForSide } = require(path.join(__dirname, '..', 'src', 'main', 'snap.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/* ---------- 模拟器 ---------- */
const WIN = 160;
// 宠物视觉框：SVG 内容在 100×100 viewBox 中占 x 15..85 / y 10..95
// 缩放 0.9 → 宽 63、高 76.5，相对窗口居中
const ANCHOR = { left: 48, top: 38, width: 63, height: 77 };

/**
 * 按「希望宠物视觉框与面板留出多少间隙」构造浮窗位置。
 * 手算坐标太易错（本文件第一版就因此让多数用例失效），这里统一由此函数推导。
 * @param {string} side 目标吸附边
 * @param {number} gap 视觉框与面板边缘的初始间隙（可为负，表示已重叠）
 */
function floatFor(side, gap = 10, panel = { x: 400, y: 900, width: 1000, height: 64 }) {
  const visual = { left: panel.x + 200, top: 0 };
  switch (side) {
    case 'top':
      visual.top = panel.y - ANCHOR.height - gap;
      break;
    case 'bottom':
      visual.top = panel.y + panel.height + gap;
      break;
    case 'left':
      visual.left = panel.x - ANCHOR.width - gap;
      visual.top = panel.y;
      break;
    case 'right':
      visual.left = panel.x + panel.width + gap;
      visual.top = panel.y;
      break;
    default:
      break;
  }
  return { x: Math.round(visual.left - ANCHOR.left), y: Math.round(visual.top - ANCHOR.top) };
}

function createSim({ panel = { x: 400, y: 900, width: 1000, height: 64 }, float = { x: 600, y: 300 } } = {}) {
  const sim = {
    panel: { ...panel },
    float: { x: float.x, y: float.y, width: WIN, height: WIN },
    relation: null,
    anchor: null,
    visualGap: 0,
    // 与生产代码 src/main/ipc/window.js 的 SNAP_DISTANCE 保持一致
    snapDistance: 26,
    // 已上报过锚点
    // 忠实映射生产代码：report-pet-anchor 里「有则 maintain、无则 search」
    reportAnchor(anchor = ANCHOR) {
      this.anchor = anchor;
      this._evaluate(this.relation ? 'maintain' : 'search');
    },
    // 拖动结束（对应 save-window-position）
    endDrag() {
      this._evaluate('search');
    },
    // 移动 Dock（对应 move-dock）
    moveDock(dx, dy) {
      this.panel.x += dx;
      this.panel.y += dy;
      this._evaluate('maintain');
    },
    // 改变面板几何（改图标大小/数量等）
    setPanelSize(w, h) {
      this.panel.width = w;
      this.panel.height = h;
      this._evaluate('maintain');
    },
    _evaluate(mode) {
      if (mode) this.mode = mode;
      const d = decide({
        floatBounds: this.float,
        anchor: this.anchor,
        panelBounds: this.panel,
        relation: this.relation,
        mode: this.mode || 'maintain',
        visualGap: this.visualGap,
        snapDistance: this.snapDistance
      });
      if (d.action === 'snap') {
        this.float.x = d.x;
        this.float.y = d.y;
        this.relation = d.relation;
      } else if (d.action === 'release') {
        // 生产代码在 release 时也不移动窗口
        this.relation = null;
      }
      return d;
    },
    /** 宠物视觉框在屏幕上的位置 */
    visual() {
      return {
        left: this.float.x + ANCHOR.left,
        top: this.float.y + ANCHOR.top,
        right: this.float.x + ANCHOR.left + ANCHOR.width,
        bottom: this.float.y + ANCHOR.top + ANCHOR.height
      };
    },
    /** 视觉边框与面板的间隙（正值=有空隙，0=紧贴，负值=重叠） */
    gapTo(side) {
      const v = this.visual();
      switch (side) {
        case 'top': return this.panel.y - v.bottom;
        case 'bottom': return v.top - (this.panel.y + this.panel.height);
        case 'left': return this.panel.x - v.right;
        case 'right': return v.left - (this.panel.x + this.panel.width);
        default: return NaN;
      }
    }
  };
  return sim;
}

console.log('\n[1] 锚点未上报时不得吸附（避免 40px 级偏差）');
ok('搜索模式下 anchor 为空 → 不做任何动作', () => {
  const sim = createSim({ float: { x: 600, y: 700 } });
  sim.mode = 'search';
  const d = sim._evaluate();
  assert.strictEqual(d.action, 'none');
  assert.strictEqual(sim.relation, null);
});
ok('锚点上报后才吸附，且间隙为 0', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.mode = 'search';
  sim._evaluate();              // 未上报 → 无动作
  assert.strictEqual(sim.relation, null, '锚点缺失却建立了关系');
  sim.reportAnchor();           // 上报触发搜索
  assert.ok(sim.relation, '锚点上报后仍未吸附');
  assert.strictEqual(sim.relation.side, 'top');
  assert.strictEqual(sim.gapTo('top'), 0, '宠物视觉下沿未紧贴面板上沿');
});

console.log('\n[2] 四个方向的吸附间隙都必须是 0');
[['top', floatFor('top')],
  ['bottom', floatFor('bottom')],
  ['left', floatFor('left')],
  ['right', floatFor('right')]
].forEach(([side, float]) => {
  ok('吸附到 ' + side + ' 后间隙为 0', () => {
    const sim = createSim({ float });
    sim.reportAnchor();
    assert.ok(sim.relation, '未吸附');
    assert.strictEqual(sim.relation.side, side);
    assert.strictEqual(sim.gapTo(side), 0);
  });
});

console.log('\n[3] 移动 Dock 时桌宠跟随（这是用户反馈的核心问题）');
ok('横向移动 Dock 200px 后仍紧贴', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  assert.strictEqual(sim.gapTo('top'), 0);
  const relX = sim.relation.offsetX;
  sim.moveDock(200, 0);
  assert.strictEqual(sim.gapTo('top'), 0, '横向移动后出现间隙');
  assert.strictEqual(sim.float.x - sim.panel.x, relX, '浮窗未跟随横向位移');
});
ok('纵向移动 Dock 100px 后仍紧贴', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  sim.moveDock(0, -100);
  assert.strictEqual(sim.gapTo('top'), 0, '纵向移动后出现间隙');
  assert.strictEqual(sim.float.y, (900 - 100) - 38 - 77);
});
ok('连续移动 10 次不累积误差', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  for (let i = 0; i < 10; i++) {
    sim.moveDock(7, -5);
    assert.strictEqual(sim.gapTo('top'), 0, '第 ' + (i + 1) + ' 次移动后出现间隙');
  }
});
ok('横向移动后浮窗 x 偏移与面板一致（不漂移）', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  const relX = sim.relation.offsetX;
  sim.moveDock(137, 0);
  assert.strictEqual(sim.relation.offsetX, relX, '横向关系偏移发生变化（漂移）');
  assert.strictEqual(sim.float.x - sim.panel.x, relX);
});

console.log('\n[4] 保持模式下不重新挑方向');
ok('Dock 移到浮窗侧面时仍保持 top 关系', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  assert.strictEqual(sim.relation.side, 'top');
  // 把 Dock 挪到浮窗右侧很远处：若 maintain 重新挑方向就会变成 left/right
  sim.moveDock(600, 0);
  assert.strictEqual(sim.relation.side, 'top', 'maintain 重新挑了方向');
});

console.log('\n[5] 静止容差：微小位移不产生移动（防抖动）');
ok('面板移动 1px（低于 2px 容差）时浮窗保持不动', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  const before = { x: sim.float.x, y: sim.float.y };
  sim.moveDock(1, 0);
  assert.deepStrictEqual({ x: sim.float.x, y: sim.float.y }, before,
    '1px 级移动被应用，会产生反复微调抖动');
});
ok('面板移动 10px（超过容差）时浮窗跟随', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  const beforeX = sim.float.x;
  sim.moveDock(10, 0);
  assert.strictEqual(sim.float.x, beforeX + 10);
  assert.strictEqual(sim.gapTo('top'), 0);
});

console.log('\n[6] 面板尺寸变化后重新贴合');
ok('面板变高后仍有 0 间隙', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  sim.setPanelSize(1000, 80);
  assert.strictEqual(sim.gapTo('top'), 0, '面板变高后出现间隙');
});

console.log('\n[7] Dock 不可用');
ok('面板为 null 且已吸附 → 解除关系', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  assert.ok(sim.relation);
  sim.panel = null;
  const d = sim._evaluate('maintain');
  assert.strictEqual(d.action, 'release');
  assert.strictEqual(sim.relation, null);
});

console.log('\n[8] 拖离 Dock 后解除吸附');
ok('搜索模式下超出阈值 → release 且不移动', () => {
  const sim = createSim({ float: floatFor('top') });
  sim.reportAnchor();
  assert.ok(sim.relation);
  // 拖到远处
  sim.float.y = 100;
  const before = { x: sim.float.x, y: sim.float.y };
  const d = sim._evaluate('search');
  assert.strictEqual(d.action, 'release');
  assert.strictEqual(sim.relation, null);
  assert.deepStrictEqual({ x: sim.float.x, y: sim.float.y }, before, '解除吸附时不应移动窗口');
});

console.log('\n[9] positionForSide 与 decide 结果一致（公式未分叉）');
ok('同一 side 下两处计算结果相同', () => {
  const floatBounds = { x: 600, y: 700, width: WIN, height: WIN };
  const panel = { x: 400, y: 900, width: 1000, height: 64 };
  // 关系偏移取自首个方向的计算结果，之后两处必须一致
  const relation = { side: 'top', offsetX: 200, offsetY: -100 };
  ['top', 'bottom', 'left', 'right'].forEach((side) => {
    const rel = { ...relation, side };
    const a = positionForSide({
      side, floatBounds, anchor: ANCHOR, panelBounds: panel, visualGap: 0, relation: rel
    });
    const b = decide({
      // 故意从一个偏移的位置出发，确保会返回 snap 而不是 none
      floatBounds: { x: a.x + 20, y: a.y + 20, width: WIN, height: WIN },
      anchor: ANCHOR,
      panelBounds: panel,
      relation: rel,
      mode: 'maintain',
      settleTolerance: 0
    });
    assert.strictEqual(b.action, 'snap', side + ' 未返回 snap');
    assert.strictEqual(b.x, a.x, side + ' x 不一致');
    assert.strictEqual(b.y, a.y, side + ' y 不一致');
  });
});

console.log('\n[10] 拖动抑制：手动拖动期间不得回吸（修复「吸附后拖不动、会弹回」）');
/** 带拖动抑制的模拟：对应主进程的 petDragging 标记 */
function createSimWithDrag(simOpts) {
  const sim = createSim(simOpts);
  sim.dragging = false;
  const baseEvaluate = sim._evaluate.bind(sim);
  sim._evaluate = (mode) => {
    if (sim.dragging) return { action: 'none' };
    return baseEvaluate(mode);
  };
  sim.beginDrag = () => { sim.dragging = true; sim.relation = null; };
  sim.dragTo = (dx, dy) => { sim.float.x += dx; sim.float.y += dy; };
  sim.endDrag = () => { sim.dragging = false; sim._evaluate('search'); };
  return sim;
}
ok('拖动期间不吸附（即使仍在阈值内）', () => {
  const sim = createSimWithDrag({ float: floatFor('top') });
  sim.reportAnchor();
  assert.ok(sim.relation, '初始未吸附');
  sim.beginDrag();
  // 只拖开 10px（旧实现会被 60px 阈值重新吸回）
  sim.dragTo(0, 10);
  const afterDragFloat = { x: sim.float.x, y: sim.float.y };
  // 拖动中即使触发评估也不应移动
  sim._evaluate('maintain');
  assert.deepStrictEqual({ x: sim.float.x, y: sim.float.y }, afterDragFloat,
    '拖动期间被自动吸附拉回');
});
ok('拖开超过阈值后松手不回吸', () => {
  const sim = createSimWithDrag({ float: floatFor('top') });
  sim.reportAnchor();
  sim.beginDrag();
  // 吸附后视觉下沿正好在 panel.y；向下拖 40px 会越过面板（间隙变负），
  // 因此向**远离面板**的方向拖：向上拖 40px，使间隙变为 +40 > SNAP_DISTANCE(26)
  sim.dragTo(0, -40);
  sim.endDrag();
  assert.strictEqual(sim.relation, null, '松手后仍被吸回');
  assert.ok(sim.gapTo('top') > 26, '间隙未超过阈值，测试前提不成立');
});
ok('拖开很小距离后松手仍会吸附（贴得够近才吸）', () => {
  const sim = createSimWithDrag({ float: floatFor('top') });
  sim.reportAnchor();
  sim.beginDrag();
  sim.dragTo(0, 8);    // 仅拖离 8px，仍在 26px 内
  sim.endDrag();
  assert.ok(sim.relation, '近距离松手应重新吸附');
  assert.strictEqual(sim.gapTo('top'), 0);
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
