/* 用 tools/atlas-kit.js 生成内置示例皮肤「小灰猫」的图集与 pet.json。
 *
 * 用法：node tools/gen-demo-cat.js
 *
 * 输出：renderer/pet/skins/demo-cat/{atlas.png,pet.json}
 *   —— 放在 renderer/pet/skins/ 下即成为**内置皮肤**，
 *      会被「设置 → 桌宠」的皮肤列表自动扫描到，无需手动导入。
 *
 * 图集由程序绘制（纯 Node + zlib，不依赖 canvas/electron），
 * 因此随时可以改参数重新生成。 */

const fs = require('fs');
const path = require('path');
const kit = require('./atlas-kit.js');

const { FW, FH, COLS, ROWS, createCanvas, encodePng, drawCat } = kit;

/* ---------- 帧定义：索引必须与最终 pet.json 的 clips 一致 ---------- */

/** 走路一个循环：四足交替抬起（[左后, 右后, 左前, 右前]） */
function walkLegs(phase) {
  const table = [
    [0.0, 0.0, 0.0, 0.0],
    [0.9, 0.0, 0.4, 0.0],
    [0.5, 0.5, 0.9, 0.3],
    [0.0, 0.9, 0.3, 0.9],
    [0.0, 0.5, 0.0, 0.5],
    [0.0, 0.0, 0.0, 0.9]
  ];
  return table[phase % table.length];
}

/** 尾巴：统一走「从身体右后方伸出的低弧线」。
    经验教训：分段胶囊如果起笔离身体太远，看起来就像一条抬起的手臂。
    起点必须**塞进身体轮廓内**（身体中心 48、半径约 19），
    让身体把根部盖住，只露出后半段；同时把半径收细。 */
function tailPts(dy, swing) {
  const s = swing || 0;
  return [
    [58, 70 + dy],
    [72, 72 + dy - s * 0.4],
    [83, 65 + dy - s * 1.0],
    [88, 55 + dy - s * 1.4]
  ];
}

const FRAMES = [];

// 0~5 待机呼吸（末帧眨眼）
for (let i = 0; i < 6; i++) {
  const breathe = [0, 0.8, 1.5, 1.2, 0.5, 0][i];
  FRAMES.push({
    name: 'idle-' + i,
    p: {
      bodyRy: 17 + breathe * 0.5,
      bodyY: 60 + breathe * 0.35,
      earTilt: Math.sin(i * 1.05) * 1.6,
      eyeOpen: i === 5 ? 0.05 : 1,
      pupilX: [0, 0.6, 1.1, 0.5, -0.5, 0][i],
      tailPts: tailPts(breathe * 0.4, i)
    }
  });
}

// 6~11 走路循环
for (let i = 0; i < 6; i++) {
  const bob = [0, -1.6, 0, -1.6, 0, -1.2][i];
  FRAMES.push({
    name: 'walk-' + i,
    p: {
      bodyY: 60 + bob,
      bodyRy: 16.5,
      headY: -22 + bob * 0.5,
      legPhase: walkLegs(i),
      earTilt: [0, -2, 0, 2, 0, 1][i],
      tailPts: tailPts(bob, i)
    }
  });
}

// 12~15 睡觉（蜷着、闭眼、尾巴绕到身前）
for (let i = 0; i < 4; i++) {
  const breathe = [0, 1.2, 0.6, 0][i];
  FRAMES.push({
    name: 'sleep-' + i,
    p: {
      bodyY: 68,
      bodyR: 21,
      bodyRy: 14 + breathe * 0.5,
      headY: -14,
      headX: -6,
      headR: 15,
      earTilt: 3,
      eyeOpen: 0,
      blush: 0.8,
      legPhase: [0.55, 0.55, 0.6, 0.6],
      tailPts: [
        [66, 72],
        [76, 76],
        [66, 78 - breathe * 0.6],
        [56, 74 - breathe * 0.6]
      ]
    }
  });
}

// 16~19 被按（惊一下 → 睁大眼 → 回常态）
for (let i = 0; i < 4; i++) {
  const sq = [1.06, 0.92, 0.98, 1][i];
  FRAMES.push({
    name: 'interact-' + i,
    p: {
      bodyY: 60 + (1 - sq) * -14,
      squash: sq,
      headY: -22,
      earTilt: [0, 5, 2, 0][i],
      eyeOpen: [1, 1.35, 1.1, 1][i],
      pupilX: [0, 1.6, 0.6, 0][i],
      mouthOpen: [0, 1, 0.3, 0][i],
      legPhase: [0, 0.25, 0.1, 0],
      tailPts: tailPts(0, i * 1.4)
    }
  });
}

// 20~25 庆祝（弹跳两次，张嘴）
// 注意：hop 太大会让耳尖被帧上沿裁掉（头心约 38、耳尖再上约 30），故上跳限 -7
for (let i = 0; i < 6; i++) {
  const hop = [0, -5, -2, 0, -4.5, -2][i];
  FRAMES.push({
    name: 'celebrate-' + i,
    p: {
      bodyY: 60 + hop,
      squash: hop < -4 ? 0.96 : 1,
      headY: -22 + hop * 0.2,
      earTilt: [-4, -7, -3, -4, -8, -4][i],
      eyeOpen: 1,
      mouthOpen: [0.4, 1, 1, 0.5, 0.9, 0.6][i],
      blush: 1,
      legPhase: hop < -2 ? [0.7, 0.7, 0.8, 0.8] : [0, 0, 0, 0],
      tailPts: tailPts(hop * 0.7, i * 0.8)
    }
  });
}

// 26~28 贴边（歪头、眯眼、轻摆）
for (let i = 0; i < 3; i++) {
  FRAMES.push({
    name: 'snap-' + i,
    p: {
      bodyY: 60,
      headX: [0, 1.2, -1.2][i],
      earTilt: [0, -2, 2][i],
      eyeOpen: 0.55,
      blush: 1,
      tailPts: tailPts(0, i * 1.5)
    }
  });
}

// 29~31 被拎起（腿垂下、耳朵后贴、尾巴翘起）
for (let i = 0; i < 3; i++) {
  FRAMES.push({
    name: 'drag-' + i,
    p: {
      bodyY: 58,
      bodyRy: 18,
      headY: -23,
      earTilt: [-6, -8, -6][i],
      eyeOpen: 1,
      pupilX: [0, -0.8, 0.8][i],
      mouthOpen: 0.5,
      legPhase: [-0.35, -0.3, -0.4, -0.35],
      tailPts: tailPts(0, 8 + i * 1.5)
    }
  });
}

/* ---------- 渲染并拼图集 ---------- */

const ATLAS_W = FW * COLS;
const ATLAS_H = FH * ROWS;
const atlas = Buffer.alloc(ATLAS_W * ATLAS_H * 4, 0);

console.log('帧数: ' + FRAMES.length + '  图集: ' + ATLAS_W + '×' + ATLAS_H + ' (' + COLS + '列×' + ROWS + '行)');

const stats = [];
FRAMES.forEach((frame, index) => {
  if (index >= COLS * ROWS) throw new Error('帧数超过图集容量: ' + index);
  const cv = createCanvas(FW, FH);
  drawCat(cv, frame.p);
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const ox = col * FW;
  const oy = row * FH;
  for (let y = 0; y < FH; y++) {
    cv.px.copy(atlas, ((oy + y) * ATLAS_W + ox) * 4, y * FW * 4, (y + 1) * FW * 4);
  }
  // 自检：不透明像素占比（用于发现空白帧）+ 是否有像素贴到帧边缘（被裁切）
  let opaque = 0;
  let edge = 0;
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const a = cv.px[(y * FW + x) * 4 + 3];
      if (a > 8) {
        opaque++;
        if (x === 0 || y === 0 || x === FW - 1 || y === FH - 1) edge++;
      }
    }
  }
  stats.push({ index, name: frame.name, coverage: opaque / (FW * FH), edge });
});

const outDir = path.join(__dirname, '..', 'renderer', 'pet', 'skins', 'demo-cat');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'atlas.png'), encodePng(ATLAS_W, ATLAS_H, atlas));

/* ---------- pet.json：clips 与上面的帧号严格对应 ---------- */
const petJson = {
  format: 'pet',
  version: 1,
  id: 'demo-cat',
  name: '小灰猫',
  author: '示例',
  render: {
    kind: 'sprite',
    size: { width: 96, height: 96 },
    atlas: { file: 'atlas.png', frameWidth: FW, frameHeight: FH }
  },
  clips: {
    idle: { frames: [0, 1, 2, 3, 4, 5], fps: 6 },
    walk: { frames: [6, 7, 8, 9, 10, 11], fps: 10 },
    sleep: { frames: [12, 13, 14, 15], fps: 3 },
    interact: { frames: [16, 17, 18, 19], fps: 12 },
    celebrate: { frames: [20, 21, 22, 23, 24, 25], fps: 10 },
    snap: { frames: [26, 27, 28], fps: 5 },
    drag: { frames: [29, 30, 31], fps: 7 }
  }
};
fs.writeFileSync(path.join(outDir, 'pet.json'), JSON.stringify(petJson, null, 2) + '\n');

console.log('\n自检（覆盖率 / 贴边像素）:');
stats.forEach((s) => {
  const flags = [];
  if (s.coverage < 0.03) flags.push('空白?');
  if (s.edge > 0) flags.push('贴边 ' + s.edge + 'px');
  console.log('  ' + String(s.index).padStart(2) + ' ' + s.name.padEnd(14) +
    (s.coverage * 100).toFixed(1) + '%' + (flags.length ? '   <== ' + flags.join(' / ') : ''));
});
console.log('\n空白帧: ' + stats.filter((s) => s.coverage < 0.03).length);
console.log('有贴边像素的帧: ' + stats.filter((s) => s.edge > 0).length);
console.log('输出目录: ' + outDir);
