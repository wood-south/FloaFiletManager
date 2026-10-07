/* ============================================================
   示例皮肤「小灰猫」图集生成器
   ------------------------------------------------------------
   纯 Node 实现（zlib + 自写 PNG 编码），不依赖 canvas/electron，
   因此可以在本环境直接跑出成品图集。

   画法：用有符号距离函数（SDF）描述椭圆 / 椭圆环 / 多边形 / 胶囊，
   再 3×3 超采样做抗锯齿。比手写逐像素判断清晰得多，也便于调参。

   输出遵循 docs/PET_ANIMATION_SPEC.md：
     - 96×96 等大网格
     - 行优先编号
     - 8 列 × 4 行 = 32 帧（留余量，实际用 0~31）
     - 静态 PNG（不是动图）
   ============================================================ */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const FW = 96;              // 帧宽
const FH = 96;              // 帧高
const COLS = 8;             // 图集列数
const ROWS = 6;             // 图集行数（阶段 8.7 由 4 扩到 6，容 48 帧）
const SS = 3;               // 超采样倍数（抗锯齿）

/* ---------------- PNG 编码 ---------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 6;   // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 颜色 ---------------- */

const C = {
  fur: [143, 152, 168],       // 主体：蓝灰
  furDark: [116, 125, 141],   // 暗部
  furLight: [176, 184, 198],  // 亮部
  belly: [240, 238, 234],     // 肚皮/口鼻
  ear: [224, 152, 158],       // 耳内
  ink: [54, 58, 68],          // 眼睛/嘴线
  nose: [235, 138, 148],      // 鼻子
  cheek: [240, 170, 176],     // 腮红
  white: [255, 255, 255]
};

/* ---------------- 几何 ---------------- */

/** 椭圆 SDF：<0 内部。rx/ry 为半径 */
function sdEllipse(px, py, cx, cy, rx, ry) {
  // 归一化到单位圆再乘回平均半径，近似但足够平滑
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  return (d - 1) * Math.min(rx, ry);
}

/** 椭圆环：外椭圆减去内椭圆 */
function sdEllipseRing(px, py, cx, cy, rx, ry, thick) {
  const outer = sdEllipse(px, py, cx, cy, rx, ry);
  const inner = sdEllipse(px, py, cx, cy, Math.max(1, rx - thick), Math.max(1, ry - thick));
  return Math.max(outer, -inner);
}

/** 凸多边形 SDF（点按顺序给出） */
function sdPolygon(px, py, pts) {
  const n = pts.length;
  let d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const [ix, iy] = pts[i];
    const [jx, jy] = pts[j];
    const ex = jx - ix;
    const ey = jy - iy;
    const wx = px - ix;
    const wy = py - iy;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= iy;
    const c2 = py < jy;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** 胶囊（线段加圆头），用于腿、尾巴、胡须 */
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const ex = bx - ax;
  const ey = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
  const dx = wx - ex * t;
  const dy = wy - ey * t;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

/* ---------------- 画布 ---------------- */

function createCanvas(w, h) {
  const px = Buffer.alloc(w * h * 4, 0);
  /** 用 SDF 填充：sdf(x,y) < 0 的区域涂色，边缘 1px 做柔化 */
  function fill(sdf, color, alpha) {
    const a0 = alpha === undefined ? 1 : alpha;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let cov = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const fx = x + (sx + 0.5) / SS;
            const fy = y + (sy + 0.5) / SS;
            if (sdf(fx, fy) < 0) cov++;
          }
        }
        if (cov === 0) continue;
        const a = (cov / (SS * SS)) * a0;
        blend(x, y, color, a);
      }
    }
  }
  function blend(x, y, color, a) {
    const i = (y * w + x) * 4;
    const dstA = px[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    for (let c = 0; c < 3; c++) {
      const src = color[c];
      const dst = px[i + c];
      px[i + c] = Math.round((src * a + dst * dstA * (1 - a)) / outA);
    }
    px[i + 3] = Math.round(outA * 255);
  }
  return { px, w, h, fill };
}

/* ---------------- 画一只猫 ----------------
   坐标以帧内 96×96 为基准，脚尖大约在 y=84。
   t 为各关节的动画参数。 */

/** 画一条腿（上段+下段+爪） */
function leg(cv, color, hipX, hipY, kneeX, kneeY, footX, footY, w) {
  cv.fill((x, y) => sdCapsule(x, y, hipX, hipY, kneeX, kneeY, w), color);
  cv.fill((x, y) => sdCapsule(x, y, kneeX, kneeY, footX, footY, w * 0.9), color);
  cv.fill((x, y) => sdEllipse(x, y, footX, footY + w * 0.35, w * 1.25, w * 0.8), color);
}

/** 画一条尾巴（沿二次曲线分若干段胶囊） */
function tail(cv, color, pts, w) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const r = w * (1 - i / (pts.length * 1.6));
    cv.fill((x, y) => sdCapsule(x, y, ax, ay, bx, by, r), color);
  }
}

/**
 * 返回一个「绕中心旋转 + 缩放」的画布视图：把传入的坐标先反向旋转/缩放回
 * 原始空间，再交给原画布。这样所有既有图元都能整体倾斜与缩放，不必逐个改公式。
 *
 * 用途：横向被拎起 / 贴在侧边时的姿态 —— 身体要整体倾斜，
 * 而猫本身偏宽（x 约 26~90），纯倾斜会直接顶出帧外，必须同时缩小。
 *
 * @param {object} cv 原画布
 * @param {number} deg 旋转角度（度，正=顺时针）
 * @param {number} cx/cy 旋转中心
 * @param {number} [scale] 缩放倍数（<1 缩小）
 */
function rotatedView(cv, deg, cx, cy, scale) {
  const s = (typeof scale === 'number' && scale > 0) ? scale : 1;
  if (!deg && s === 1) return cv;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    w: cv.w,
    h: cv.h,
    fill(sdf, color, alpha) {
      // 目标点 (x,y) → 反向缩放再反向旋转到原始空间 (sx,sy)
      cv.fill((x, y) => {
        const dx = (x - cx) / s;
        const dy = (y - cy) / s;
        const sx = cx + dx * cos + dy * sin;
        const sy = cy - dx * sin + dy * cos;
        return sdf(sx, sy);
      }, color, alpha);
    }
  };
}

/**
 * 画猫。参数都用显式命名，便于逐帧微调。
 * @param {object} p 关节参数
 */
function drawCat(cv, p) {
  const o = Object.assign({
    bodyY: 60,        // 身体中心 y
    bodyR: 19,        // 身体半径 x
    bodyRy: 17,       // 身体半径 y
    headX: 0,         // 头部整体偏移
    headY: -22,       // 头部中心相对身体中心的偏移
    headR: 17,
    earTilt: 0,       // 耳朵摆动
    eyeOpen: 1,       // 0 闭眼 1 睁眼
    pupilX: 0,        // 瞳孔偏移
    legPhase: null,   // [左下,右下,左上,右上] 抬腿高度 0~1
    tailPts: null,
    squash: 1,        // 纵向压缩（跳跃/落地）
    blush: 1,         // 腮红
    mouthOpen: 0,     // 张嘴程度
    tilt: 0,          // 整体倾斜角度（度，正=顺时针）；用于横向被拎起的姿态
    poseScale: 1      // 姿态整体缩放（贴在侧边时需要缩小，否则倾斜会顶出帧外）
  }, p || {});

  // 整体倾斜 + 缩放：后面所有图元都画在这个（可能旋转/缩小的）视图上
  const base = cv;
  cv = rotatedView(base, o.tilt, 48, 60, o.poseScale);

  const cx = 48 + o.headX;
  const by = o.bodyY;
  const hy = by + o.headY;

  // 落地阴影（固定在地面；不随身体倾斜，否则会跟着转）
  // 注意：用 base 而不是 cv —— 阴影属于"地面"，不该被姿态倾斜带走。
  // y 由 86 提到 82：给「拖拽时 bodyY 抬高 + 整体倾斜」留出帧内余量。
  base.fill((x, y) => sdEllipse(x, y, 48, 82, 20 * o.squash, 4.2), [0, 0, 0], 0.16);

  // ---- 尾巴（在身体后面，先画） ----
  // 起点要落在身体轮廓内，由身体盖住根部，否则会看起来像一条抬起的手臂
  const tpts = o.tailPts || [
    [58, 70], [72, 72], [83, 65], [88, 55]
  ];
  tail(cv, C.furDark, tpts, 4.4);

  // ---- 后腿 ----
  const lp = o.legPhase || [0, 0, 0, 0];
  const backHipY = by + 8;
  /* 脚下沿与阴影都留出余量（阶段 8.7）：
     原先脚尖到 82/83、阴影在 86，而拖拽姿态用 bodyY=58，
     阴影底沿会到 y≈95，几乎贴死帧边（96 高）。
     阴影与脚尖高度是**固定值**（不随 bodyY 移动），
     所以抬高 bodyY 时阴影会浮起来 —— 余量必须在这里留。 */
  leg(cv, C.furDark,
    40, backHipY, 39, backHipY + 10 - lp[0] * 7, 40, 79 - lp[0] * 12, 4.6);
  leg(cv, C.furDark,
    56, backHipY, 57, backHipY + 10 - lp[1] * 7, 56, 79 - lp[1] * 12, 4.6);

  // ---- 身体 ----
  const bodyCy = by;
  cv.fill((x, y) => sdEllipse(x, y, 48, bodyCy, o.bodyR, o.bodyRy * o.squash), C.fur);
  // 肚皮
  cv.fill((x, y) => sdEllipse(x, y, 48, bodyCy + 4, o.bodyR * 0.55, o.bodyRy * 0.62), C.belly);

  // ---- 前腿（在身体前面） ----
  const frontHipY = by + 6;
  leg(cv, C.fur,
    42, frontHipY, 41, frontHipY + 11 - lp[2] * 7, 42, 80 - lp[2] * 13, 4.9);
  leg(cv, C.fur,
    54, frontHipY, 55, frontHipY + 11 - lp[3] * 7, 54, 80 - lp[3] * 13, 4.9);

  // ---- 头（含耳朵，整体可压缩） ----
  const hR = o.headR;
  // 耳朵（三角形，在头之前画）
  const earT = o.earTilt;
  cv.fill((x, y) => sdPolygon(x, y, [
    [cx - hR + 1, hy - hR + 5],
    [cx - hR - 4 + earT, hy - hR - 13],
    [cx - hR + 12, hy - hR - 1]
  ]), C.fur);
  cv.fill((x, y) => sdPolygon(x, y, [
    [cx - hR + 4, hy - hR + 4],
    [cx - hR - 1 + earT, hy - hR - 8],
    [cx - hR + 9, hy - hR + 1]
  ]), C.ear);
  cv.fill((x, y) => sdPolygon(x, y, [
    [cx + hR - 1, hy - hR + 5],
    [cx + hR + 4 + earT, hy - hR - 13],
    [cx + hR - 12, hy - hR - 1]
  ]), C.fur);
  cv.fill((x, y) => sdPolygon(x, y, [
    [cx + hR - 4, hy - hR + 4],
    [cx + hR + 1 + earT, hy - hR - 8],
    [cx + hR - 9, hy - hR + 1]
  ]), C.ear);

  // 脸
  cv.fill((x, y) => sdEllipse(x, y, cx, hy, hR, hR * 0.92 * o.squash), C.fur);
  // 口鼻区
  cv.fill((x, y) => sdEllipse(x, y, cx, hy + 7, hR * 0.5, hR * 0.33), C.belly);

  // 眼睛
  const eyeDx = 6.4;
  const eyeRy = 4.6 * o.eyeOpen;
  if (o.eyeOpen > 0.12) {
    cv.fill((x, y) => sdEllipse(x, y, cx - eyeDx, hy - 1.5, 3.6, eyeRy), C.ink);
    cv.fill((x, y) => sdEllipse(x, y, cx + eyeDx, hy - 1.5, 3.6, eyeRy), C.ink);
    // 高光
    cv.fill((x, y) => sdEllipse(x, y,
      cx - eyeDx + 1.2 + o.pupilX * 0.5, hy - 2.8 + o.pupilX * 0.3, 1.25, 1.25), C.white);
    cv.fill((x, y) => sdEllipse(x, y,
      cx + eyeDx + 1.2 + o.pupilX * 0.5, hy - 2.8 + o.pupilX * 0.3, 1.25, 1.25), C.white);
  } else {
    // 闭眼：一条弧线（用椭圆环的上半段近似）
    cv.fill((x, y) => sdEllipseRing(x, y, cx - eyeDx, hy + 1.2, 3.8, 3.4, 1.5), C.ink);
    cv.fill((x, y) => sdEllipseRing(x, y, cx + eyeDx, hy + 1.2, 3.8, 3.4, 1.5), C.ink);
  }

  // 鼻子（三角）
  cv.fill((x, y) => sdPolygon(x, y, [
    [cx - 3, hy + 4.5], [cx + 3, hy + 4.5], [cx, hy + 7.6]
  ]), C.nose);

  // 嘴（两条弧）
  cv.fill((x, y) => sdEllipseRing(x, y, cx - 3.4, hy + 8.6, 3.6, 3.2 + o.mouthOpen * 2, 1.25), C.ink);
  cv.fill((x, y) => sdEllipseRing(x, y, cx + 3.4, hy + 8.6, 3.6, 3.2 + o.mouthOpen * 2, 1.25), C.ink);

  // 腮红
  if (o.blush > 0) {
    cv.fill((x, y) => sdEllipse(x, y, cx - 11.5, hy + 5, 3.4, 2.3), C.cheek, 0.75 * o.blush);
    cv.fill((x, y) => sdEllipse(x, y, cx + 11.5, hy + 5, 3.4, 2.3), C.cheek, 0.75 * o.blush);
  }

  // 胡须
  const wk = (y1, y2) => (x, y) => sdCapsule(x, y, cx - 13, hy + y1, cx - 21, hy + y2, 0.7);
  cv.fill(wk(6, 3.5), C.furLight, 0.9);
  cv.fill(wk(8.5, 8.5), C.furLight, 0.9);
  cv.fill(wk(11, 13.5), C.furLight, 0.9);
  const wkR = (y1, y2) => (x, y) => sdCapsule(x, y, cx + 13, hy + y1, cx + 21, hy + y2, 0.7);
  cv.fill(wkR(6, 3.5), C.furLight, 0.9);
  cv.fill(wkR(8.5, 8.5), C.furLight, 0.9);
  cv.fill(wkR(11, 13.5), C.furLight, 0.9);
}

module.exports = {
  FW, FH, COLS, ROWS, SS,
  C, createCanvas, encodePng, drawCat, leg, tail, rotatedView,
  sdEllipse, sdEllipseRing, sdPolygon, sdCapsule
};
