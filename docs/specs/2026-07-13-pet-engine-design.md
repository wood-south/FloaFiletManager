# 桌宠动画引擎 — 可编程 SVG 宠物框架

## 概述

将当前硬编码在 `float.html` 中的橘猫 SVG 桌面宠物改造为**可编程的通用框架**。

- 宠物形象和动画行为通过 SVG 文件 + JSON 配置定义
- 引擎根据配置将"触发条件"映射到"动画序列"
- 支持 CSS class 驱动和 JS Web Animations API 驱动两种动画方式
- 更换宠物只需替换 SVG + JSON，无需改代码
- 支持 10+ 种精细的鼠标交互和空闲动画

---

## 文件结构

```
renderer/
├── float.html                    ← 精简：仅保留容器 + 菜单
├── pets/
│   ├── cat.svg                   ← 橘猫 SVG（从 float.html 抽取，加 data-part 属性）
│   ├── cat.json                  ← 橘猫动画配置
│   ├── dog.svg                   ← 未来新增
│   └── dog.json                  ← 未来新增
├── pet-engine/
│   ├── pet-engine.js             ← 核心引擎：初始化、事件绑定、空闲调度
│   ├── pet-animations.js         ← 动画原语库（shake/rotate/jump/blink/...）
│   └── pet-renderer.js           ← SVG 加载器：解析 data-part → 注入 DOM
├── styles/
│   └── pet-animations.css        ← CSS 动画 keyframes（引擎通过 class 触发）
├── scripts/
│   └── float.js                  ← 精简：只处理拖动/菜单/IPC，动画交给引擎
└── styles/
    └── float.css                 ← 精简：布局/贴边/菜单样式
```

---

## JSON 配置 Schema

```json
{
  "name": "橘猫",
  "defaultSize": 90,
  "parts": [
    "head", "left-ear", "right-ear", "eyes", "left-eye", "right-eye",
    "nose", "mouth", "left-cheek", "right-cheek", "whiskers",
    "left-paw", "right-paw", "shadow", "tail"
  ],
  "animations": {
    "hover": {
      "sequence": [
        { "part": "left-ear",  "action": "rotate", "to": -15, "duration": 200, "easing": "ease-out" },
        { "part": "right-ear", "action": "rotate", "to":  15, "duration": 200, "easing": "ease-out" },
        { "part": "body",      "action": "scaleY", "to": 1.05, "duration": 300 }
      ]
    },
    "click": { ... },
    "dblclick": { ... },
    "dragStart": { ... },
    "dragEnd": { ... },
    "rightClick": { ... },
    "drop": { ... },
    "attach": { ... },
    "detach": { ... }
  },
  "idle": {
    "interval": 5000,
    "pool": ["yawn", "wag-tail", "look-around", "sit-still"]
  },
  "idleAnimations": {
    "yawn": { "sequence": [...] },
    "wag-tail": { "loop": [...] },
    "look-around": { "sequence": [...] }
  },
  "cssAnimations": ["blink-once", "squint", "pout", "happy",
                    "yawn-open", "yawn-close", "close-tight"]
}
```

### 序列配置字段

| 字段 | 说明 |
|---|---|
| `part` | 目标部件名（对应 SVG `data-part`），或 `null` 表示应用到整个 pet |
| `action` | `"css"` 表示 CSS class 驱动；其他为 JS 动画原语名 |
| `class` | 当 action="css" 时生效，要添加的 CSS class |
| `to` | 目标值（rotate 角度、scaleY 比例、move 距离） |
| `from` | 起始值（rotate/scale/move 的起始点） |
| `duration` | 动画时长（毫秒） |
| `delay` | 延迟启动（毫秒） |
| `easing` | 缓动函数 |
| `repeat` | 重复次数（loop 模式下用） |
| `alternate` | 来回播放（loop 模式下用） |
| `onComplete` | 完成后的回调动画名 |

### 触发类型

| 触发 | 说明 |
|---|---|
| `hover` | 鼠标悬停在桌宠上 |
| `click` | 单击桌宠 |
| `dblclick` | 双击桌宠 |
| `dragStart` | 开始拖动 |
| `dragEnd` | 拖动结束松手 |
| `rightClick` | 右键点击 |
| `drop` | 文件拖放到桌宠上 |
| `attach` | 桌宠贴边吸附 |
| `detach` | 桌宠从边缘脱开 |
| `idle` | 空闲（按 interval 间隔随机池子里的动作） |

---

## 引擎架构

```
┌──────────────────────────────────────────────────┐
│                  PetEngine                        │
│                                                   │
│  init(petName)                                    │
│    │                                              │
│    ├─ PetRenderer.loadSVG() → 解析 data-part      │
│    ├─ 加载 petName.json 配置                      │
│    ├─ 注册事件监听（click/hover/drag...）          │
│    ├─ 启动空闲动画定时器                          │
│    └─ 加载 CSS 动画表                             │
│                                                   │
│  trigger(eventType)                               │
│    │                                              │
│    └─ AnimationPlayer.play(sequence)              │
│         │                                         │
│         ├─ action:"css"  → addClass  → CSS驱动    │
│         ├─ action:"shake"→ animate() → JS驱动     │
│         ├─ action:"jump" → animate() → JS驱动     │
│         └─ delay/onComplete → 链式调度            │
└──────────────────────────────────────────────────┘
```

### 核心类职责

| 模块 | 职责 | 输入 | 输出 |
|---|---|---|---|
| `PetEngine` | 顶层入口：初始化、事件绑定、空闲调度 | petName 字符串 | 无 |
| `PetRenderer` | 加载 SVG 文件，解析 `data-part` 注册部件 | SVG 文件路径 | 部件 Map |
| `AnimationPlayer` | 接收序列配置，按时序调度动画 | sequence/loop 数组 | Promise<void> |
| `PetAnimations` | 动画原语库，每个函数返回 Promise | 目标部件 + 参数 | Promise<void> |

---

## SVG 部件规范

每个宠物 SVG 使用 `data-part="xxx"` 标记可动画部件：

```xml
<svg viewBox="0 0 100 100">
  <g data-part="head">
    <ellipse data-part="left-eye" cx="38" cy="48" rx="6" ry="7"/>
    <ellipse data-part="right-eye" cx="62" cy="48" rx="6" ry="7"/>
    <polygon data-part="left-ear" points="30,28 25,10 40,22"/>
    <polygon data-part="right-ear" points="70,28 75,10 60,22"/>
  </g>
  <g data-part="left-paw">...</g>
  <g data-part="right-paw">...</g>
  <ellipse data-part="shadow" cx="50" cy="90" rx="25" ry="5"/>
</svg>
```

`data-part` 的值必须与 JSON `parts` 数组中的名称一致。嵌套时（如 `head` 包裹 `eyes`），引擎优先查找最内层匹配的元素。

动画配置中 `part: null` 等同于整体容器（`pet-body`），用于晃动/跳跃等整体动作。

---

## JS 动画原语库

| 原语 | 参数 | 说明 |
|---|---|---|
| `shake(part, {amplitude, duration})` | amplitude: 摆动幅度(px) | 左右快速摇摆 |
| `rotate(part, {from, to, duration})` | from/to: 角度 | 旋转部件 |
| `scale(part, {from, to, duration})` | from/to: 比例 | 缩放到指定大小 |
| `scaleY(part, {from, to, duration})` | from/to: 比例 | Y轴伸缩（压扁/拉长） |
| `jump(part, {height, duration})` | height: 跳起距离(px,负向上) | 垂直跳跃 |
| `move(part, {x, y, duration})` | x/y: 位移像素 | 部件平移 |
| `css(part, {className, duration})` | className: CSS类名 | 触达 CSS 动画 |
| `idleBlink(part, {interval})` | interval: 间隔(ms) | 随机眨眼 |

每个原语返回 `Promise<void>`，动画完成时 resolve。

---

## CSS 动画 class 规范

每个 class 在 `pet-animations.css` 中定义一个 `@keyframes`：

| class | 效果 | 典型时长 |
|---|---|---|
| `blink-once` | 快速眨眼一次 | 300ms |
| `close-tight` | 眼睛紧闭 | 持续到 class 移除 |
| `squint` | 眯眯眼 | 持续到 class 移除 |
| `happy` | 开心表情（眼弯、嘴翘） | 持续 |
| `pout` | 委屈表情 | 持续 |
| `yawn-open` | 嘴巴张大大 | 600ms |
| `yawn-close` | 嘴巴合拢 | 400ms |
| `angry` | 生气（眉毛倒竖） | 持续 |
| `dizzy` | 晕眩（眼睛打转） | 800ms |
| `sleepy` | 困倦（半闭眼） | 持续 |

---

## 与现有代码的集成方式

| 文件 | 改动 |
|---|---|
| `float.html` | SVG 块移到 `pets/cat.svg`；容器只保留 `<div id="petContainer">`；引入 `pet-engine.js` |
| `float.css` | 剥离所有 `@keyframes` 宠物动画到 `pet-animations.css`；保留布局/snap/菜单 |
| `float.js` | 删除单击/双击中的 pet 动画逻辑；新增 `new PetEngine('cat')` 初始化 |
| `main.js` | 不变 |
| `preload.js` | 不变 |

---

## 优先级

| P0 | P1 |
|---|---|---|
| 框架核心（引擎 + 渲染器 + 动画播放器） | 更多空闲动画 |
| cat.svg + cat.json（从现有代码抽取） | 第二套宠物（dog） |
| 10 种鼠标交互触发 | JSON 编辑器/可视化预览 |
| 空闲动画定时器 + 随机池 | |
| 与现有 float.js 的无缝集成 | |

---

## 不做的

- 不引入任何第三方动画库（完全基于 Web Animations API + CSS keyframes）
- 不做可视化 JSON 编辑器（通过手写 JSON 配置）
- 不做 pet 运行时动态下载/商店系统
