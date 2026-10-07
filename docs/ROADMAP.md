# 改造方案（ROADMAP）

> 目标：把「浮窗」升级为**完整的桌宠系统 + 可插拔能力层 + 样式商城基础**，同时把 Dock 栏做扎实。
>
> 工作方式：**一个阶段 → 一次检测 → 一次提交**，绝不跨阶段混提。每个阶段结束都必须能独立运行、可回滚。

---

## 一、锁定决策（有异议随时改）

| # | 决策 | 取值 |
| --- | --- | --- |
| 1 | 优先方向 | 先止损 → 地基 → 桌宠 → 商城 → Dock 优化 |
| 2 | 桌宠形态 | **两代兼容**：新增 sprite 序列帧，保留现有 SVG 猫并支持换色 |
| 3 | 商城程度 | 第一期**本地皮肤包导入/导出 + 内置 2~3 套**，在线索引留接口 |
| 4 | 动画系统 | **A 层（视觉状态）必做**；B 层（序列帧）、C 层（窗口运动）后置 |
| 5 | 拆分方案 | **A 方案**（同窗口内按能力拆模块 + manifest 注册）；契约按 B 标准设计，便于将来升级 |
| 6 | 文档 | 每阶段补齐对应规范文档，并在阶段 8 统一校对 |

---

## 二、分阶段执行计划

### 阶段 −1：止损（安全与可用性）

| 项 | 内容 | 文件 |
| --- | --- | --- |
| −1.1 | **文件管理窗口无法拖动**（`.fm-header` 的 `-webkit-app-region: drag` 在透明窗口失效，且无 IPC 拖动实现）→ 照 settings 模式补拖动 | `preload.js`、`src/main/ipc/window.js`、`renderer/scripts/file-manager.js` |
| −1.2 | **图标缓存写入 exe 同目录**，安装到 `Program Files` 必失败 → 改 `userData` | `src/main/services/icon-cache.js` |
| −1.3 | **IPC 无鉴权、路径无校验**（`delete-file`/`list-files`/`upload-file`/`move-file` 接受任意路径）→ 加调用方校验 + 路径范围校验 + `path.basename` 净化 | 新增 `src/main/security/guard.js`，改 `ipc/files.js`、`ipc/dialog.js` |
| −1.4 | **CHANGELOG 领先于代码** → 标注未落地项 | `CHANGELOG.md` |

**检测**：`npm run lint` 全绿；启动应用手测 6 条（见第五节 A 组）。
**提交**：`fix: 阶段-1 止损（文件管理器拖动、图标缓存位置、IPC 路径校验）` — ✅ 已提交（`5f62f03`）

---

### 阶段 −1.5：修复陈旧文件列表与 Dock 失效图标反馈

首轮手测后追加的缺陷修复（对应"文件不存在却弹删除窗口"的反馈）。

| 项 | 内容 | 状态 |
| --- | --- | --- |
| −1.5.1 | **根因**：`file-manager.js` 的 `onFilesChanged` 用字符串完全相等判断目录变化，注释声称支持"子路径"但从未实现 → 子目录内的删除/移动不刷新列表，界面残留失效条目。新增 `isSameOrSubPath()` 做双向判断 | ✅ |
| −1.5.2 | `loadFiles` 失败时补清空 `currentFiles`/`currentPath` 并禁用删除按钮 | ✅ |
| −1.5.3 | 新增 `check-paths-exist` 通道，删除前校验存在性；全部失效直接提示并刷新，部分失效提示跳过数量并二次确认 | ✅ |
| −1.5.4 | 删除错误区分"文件不存在"与其他失败，分别给出准确文案 | ✅ |
| −1.5.5 | **Dock**：启动路径已不存在的图标此前静默无反应（`system-action` 对不存在路径仍 `openPath` 且返回 `success`）→ 明确返回 `{success:false, code:'ENOENT'}`，Dock 侧 toast 提示 | ✅ |
| −1.5.6 | **Dock**：右键"删除此图标"补确认框；toast/对话框期间临时扩展 Dock 窗口防止提示被裁剪 | ✅ |
| −1.5.7 | `show-message-box` 以调用方窗口为父窗口，避免置顶无边框窗口遮挡原生对话框 | ✅ |

**检测**：ESLint 全绿；`node --check` 7 个文件全部通过；从 `file-manager.js` **真实抽取**的 `isSameOrSubPath` 跑 13 项断言全部通过（含 `ab` vs `abc` 前缀陷阱、正反斜杠混用、大小写、中文路径，以及原 bug 场景的复现与修复验证）；`guard.js` 22 项断言仍全绿。
**提交**：`fix: 阶段-1.5 修复文件列表陈旧与 Dock 失效图标无反馈` — ✅ 已提交（`38bc848`）


---

### 阶段 0：共用原语（消除重复）

把三处重复的 UI 实现收敛为一份。

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 0.1 | 新建 `renderer/scripts/primitives.js`：`createPrimitives()` 工厂，导出 `modal` / `inputModal` / `toast`（原计划放 `renderer/shared/`，因 HTML 目前直接引 `scripts/` 与 `styles/`，放在同级更省改动） | ✅ |
| 0.2 | 新建 `renderer/styles/primitives.css`：合并两份 `.modal-*` 与 `.toast`，共 27 条规则 | ✅ |
| 0.3 | `float.js`、`file-manager.js` 改为引用共用实现；删除各自副本（`MODAL_ICONS`、`ICONS`、重复 CSS 共约 330 行） | ✅ |
| 0.4 | `package.json` 增加 `"test"` 与 `"check"` 脚本 | ✅ |
| 0.5 | 建立 `test/` 自检体系（`test/run-checks.js` + `test/index.js` + 各模块 `*.test.js`） | ✅ |

**统一取值（原先两处不一致，现为单值）**：`.modal-dialog` 宽高取 320/420；`.modal-message` 下边距取 20px；`.modal-overlay` 统一 `position: absolute`；遮罩底色抽为 CSS 变量 `--modal-overlay-bg`（默认透明＝原浮窗行为，文件管理器覆盖为 `rgba(0,0,0,0.35)`）；补 `.modal-icon.success` 配色（图标表本就含 `success`，但原 CSS 缺该变体）。

**检测**：ESLint 全绿；页面 CSS 中 `.modal`/`.toast` 规则数 **0**，`primitives.css` **27**；脚本中重复的 `showModal` 定义 **0**；`npm test` 运行 2 个自检脚本、**46 项断言全部通过**（guard 22 + primitives 24），其中 primitives 用最小 DOM 桩加载**真实源码**，重点守住取消语义（`modal` 取消 resolve **-1**、`inputModal` 取消/空值 resolve **null**，避免与调用方的 `choice !== 0` 判断反向）。

**关于测试运行器**：`node --test` 依赖子进程 stdio 管道，在受限环境下 spawn 会 EPERM，故改用 `test/run-checks.js` 顺序 `spawnSync(stdio: inherit)` 逐个执行自检脚本，兼容性更好。

**提交**：`refactor: 阶段0 抽取共用 UI 原语（模态框/Toast）`

---

### 测试体系（从阶段 0 起持续积累）

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | ESLint 全量检查（main / preload / renderer / src） |
| `npm test` | 顺序运行 `test/index.js` 中登记的所有自检脚本 |
| `npm run check` | lint + test，阶段收尾必跑 |

**当前自检脚本**：`test/guard.test.js`（22 项）、`test/primitives.test.js`（24 项）、`test/dock-geometry.test.js`（17 项）、`test/system-encoding.test.js`（6 项）。
**约定**：后续每个阶段新增的纯逻辑（吸附几何 `snap.js`、配置迁移、路径处理等）都要补对应 `*.test.js` 并登记到 `test/index.js`。

---

### 阶段 0.5：Dock 闪动、网络浮层裁剪与乱码（手测反馈修复）

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| **右键/开合 Dock 闪动** | 每次弹出/关闭都 resize 透明窗口；且 `expandForMenu` 用「面板宽度」`resizeDockWindow(panelW, 380)`，而 `autoFitDockWindow` 用 `panelW + 4`（`winBuffer`），窗口宽在 704↔700 间跳、面板抖动 2px | 窗口高度改为**启动时一次性预留**（`DOCK_RESERVED_HEIGHT = 420`）；常态下 `expandForMenu` **完全不做窗口操作**；`restoreAfterMenu` 受 `dockWindowOverflowed` 保护；`nextFrame()` 取代固定 `setTimeout(100)` |
| **WiFi 浮层被裁剪** | 浮层高度随网络列表变化（约 200–340px），此前用固定高度扩展窗口 | 新增 `syncPopupWindowHeight()`，按浮层 `offsetHeight` **实测**计算所需高度 |
| **网络信息乱码** | `chcp 65001` 让子进程输出 UTF-8，但 Node `exec` 未指定 encoding 时按系统代码页（GBK）解码 | 5 处 `chcp 65001` 调用统一补 `encoding: 'utf8'` |

**检测**：ESLint 全绿；`npm test` 4 个脚本全部通过。新增的 `system-encoding.test.js` 当场又抓出 `connect`/`disconnect` 两处漏网编码问题。

**提交**：`fix: 修复 Dock 开合闪动、网络浮层被裁剪与网络信息乱码`（`b81979d`）

---

### 阶段 4（提前完成）：吸附系统重构 + 光标稳定

原计划在阶段 4 处理，因用户手测反馈「有时候会吸附位置不对」「光标在桌宠上频繁切换」而提前完成。

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| **吸附位置不对** | `ipc/window.js` 用四个手调常数 `snapInset{Top,Bottom,Left,Right} = 52`，注释自称「浮窗(160)与宠物视觉(90)差值一半」（应为 35，差 17px）；而宠物视觉框是**姿态相关**的：SVG 内容约占 90×80，贴边旋转 90° 后视觉宽变 80，hover 还有 1.05 倍缩放 | 新增 `src/main/snap.js`（`computeDockSnap`/`computeSnapRelation` 纯几何），吸附位置一律由渲染进程上报的**真实视觉框**推导 |
| **旋转/移动后仍停在旧位置** | 早期只在拖动结束（mouseup）算一次吸附 | 新增 `resetDockSnap()`：锚点或 Dock 几何变化后沿**当前吸附边**重算；Dock 移动改为按关系重算而非 delta 累加 |
| **光标箭头 ↔ 手型频繁切换** | 光标依赖 `.pet-body:hover` 命中测试，而 hover 触发 `transform: scale(1.05)` 改变命中区；窗口移动/缩放期间命中测试滞后形成 enter/leave 抖动 | 光标改由 JS 按一次 `getBoundingClientRect` 命中判定统一控制，经 CSS 变量 `--pet-cursor` 下发；`.menu-btn` 改 `cursor: inherit` |

**检测**：`npm test` 5 个脚本全部通过；新增 `test/snap.test.js` **17 项断言**，其中专门断言「按 90 宽硬算会偏 10px」，锁住"必须使用真实视觉框"这一根本原因。

**另注**：拖动结束时的**屏幕边缘贴边**行为未改动（用户确认该部分正常）。

**提交**：`fix: 吸附改用真实视觉框推导，光标不再频繁切换`（`1ce8b13`）

### 阶段 4 补充修复（Dock 顶部受限 + 吸附空隙/不跟随）

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| **Dock 拖不到屏幕上方** | `move-dock` 按**窗口边界**钳制，而窗口为预留菜单/浮层空间高达 420px → 面板最低只能到 `workArea.y + (窗口高 − 面板高)` | 改按**面板可见边界**钳制：`minY = workArea.y − (窗口高 − 面板高)`，允许透明部分移出工作区上沿 |
| **吸附后差一截（约 40px）** | `report-pet-anchor` 只走"保持"逻辑，而它在吸附关系为空时直接返回。若首次吸附发生在锚点上报之前，会用整个 160 窗口代替 90×80 的宠物视觉框，偏差 `(160−80)/2 = 40px` **永远不会被纠正** | 拆成 `searchDockSnap()`（搜索+建关系）与 `maintainDockSnap()`（沿当前边保持）；锚点上报后无关系则 search、有关系则 maintain。并移除"锚点缺失回退为窗口边界"的旧写法（那正是偏差来源），改为锚点未就绪时不吸附 |
| **拖 Dock 时桌宠不跟随** | 同一根因：首次吸附后从未建立跟随关系 | 同上；`move-dock`/`resize-dock-window`/`report-dock-panel-offset` 统一调用 `maintainDockSnap`，并加 `SNAP_SETTLE_TOLERANCE = 2` 静止容差防抖动 |

**排查手段**：设置环境变量 `DSH_DEBUG_SNAP=1` 启动，主进程会输出 `[snap]` 日志（面板/锚点/浮窗/视觉框坐标），
在无法启动 GUI 的环境下也能核对吸附数值：

```powershell
$env:DSH_DEBUG_SNAP=1; npx electron .
```

**检测**：`npm test` 6 个脚本全部通过；新增 `test/snap-contract.test.js`（10 项源码级契约断言）。

**提交**：`fix: Dock 可拖到屏幕顶部，吸附不再有空隙且跟随移动`（`4ac9a0d`）

### 阶段 4 再补充：吸附状态机化 + 全流程仿真（方法改进）

连续两轮「凭猜测修吸附」效果不佳，改为**把吸附抽成可在 Node 完整模拟的状态机**，
用仿真跑「拖动 → 吸附 → 移动 Dock」全过程。仿真一次定位到两个真实 bug：

| 真实 bug | 影响 | 修复 |
| --- | --- | --- |
| `positionForSide` 只重算吸附轴，非吸附轴沿用当前坐标 | 贴在上/下方时 x 永远不动 → **Dock 横向移动后桌宠不跟随** | 传入 `relation`，非吸附轴按 `offsetX/offsetY` 跟随面板 |
| `searchDockSnap` 先算位置再无条件 `setPosition` | 搜索失败时窗口已被改坏、跟随关系丢失 | 改为**先判定、后移动**：仅 `action === 'snap'` 才移动 |

另外两处凭经验就能定位的问题：

- **吸附差约 7px**：`readPetAnchor` 量的是 `.pet-avatar` 容器（90×90），而 SVG 内容在
  viewBox 中只占 `x 15..85 / y 10..95`，真实画面约 63×76.5 → 改用 SVG `getBBox()` +
  `getScreenCTM()` 测量真实绘制边界（保留容器矩形作回退）
- **拖动闪动**：浮窗与 Dock 每次 `mousemove` 都移动一次窗口，一帧内可能多次
  `setPosition` → 改为累积位移 + `requestAnimationFrame` 每帧提交一次，松手前 flush

**结构整理**：`snap.js` 重构为状态机（`computeDockSnap` / `positionForSide` / `decide`），
search 与 maintain 统一走 `decide()` 消除公式分叉。

**检测**：`npm test` 6 个脚本全部通过；新增 `test/snap-flow.test.js`（17 项全流程仿真），
`snap-contract.test.js` 扩至 15 项。

**提交**：`fix: 吸附状态机化并修复跟随/间隙/拖动闪动（含全流程仿真）`（`906fcc8`）

### 阶段 4 三补充：吸附后拖不动、会弹回

| 根因 | 说明 |
| --- | --- |
| 松手时用 60px 阈值重新搜索 | 用户拖动不足 60px 仍被判定"还在 Dock 附近"，立刻吸回 |
| 拖动期间无抑制 | 视觉框上报或 Dock 几何变化触发 `maintain` 时，会把浮窗逐帧拉回吸附位置，手动位移被持续抹掉 |

**修复**：新增 `set-pet-dragging` 通道与 `petDragging` 标记 —— 开始拖动即解除吸附关系，
拖动期间 `searchDockSnap`/`maintainDockSnap` 一律直接返回；松手由 `save-window-position`
**先清标记再搜索**。同时 `SNAP_DISTANCE` 由 60 收紧到 **26**（吸附要贴得足够近才触发，
往外拖即脱离）。浮窗补 `window blur` 兜底，避免鼠标在窗口外松开导致抑制永久生效。

**检测**：`snap-flow.test.js` 增至 20 项（含拖动抑制三例：拖动期间不移动、拖开超阈值不回吸、
拖开 <26px 仍正常吸附），`snap-contract.test.js` 增至 20 项。

**提交**：`fix: 修复吸附后拖不动、会弹回`（`fe26da2`）

---

### 阶段 1：抽出第一个能力 `quick-upload`（最小验证）

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 1.1 | 新建 `renderer/scripts/capabilities.js`（注册表）+ `renderer/capabilities/quick-upload/{manifest.js,index.js,style.css}` | ✅ |
| 1.2 | 迁移 `float.js` 的拖放上传/回收站（原 dragenter/dragover/dragleave/drop 四个 document 监听）与菜单「回收站模式」切换 | ✅ |
| 1.3 | 新建能力注册表：`window.deskPetRegistry`（`attach` / `use` / `on` / `emit` / `manifests`）+ `window.deskPet` 壳层 API | ✅ |
| 1.4 | `recycleMode` 裸变量改为 `pet.storage`（`config.capabilities['quick-upload'].recycleMode`）持久化 | ✅ |

**边界划分（本阶段确立的契约）**

| 关注点 | 归属 |
| --- | --- |
| 拖放事件拦截、落点提示显示/隐藏、路径收集 | **壳层**（`capabilities.js` 的 `bindDropCollection`） |
| 拿到路径后做什么（上传 / 删除回收站 / 重名询问） | **能力**（`capabilities/quick-upload/index.js`） |
| 落点提示的文案与图标 | 能力通过 `manifest.dropHint` 提供，壳层按当前模式渲染 |
| 菜单开合、穿透仲裁、窗口扩容 | **壳层**（阶段 2 再计数式化） |

**新增 IPC**：`capability-get` / `capability-set`（`src/main/ipc/config.js`，落盘在 `config.capabilities[<id>]`，
带 id/键名白名单与「只接受 JSON 基本类型」校验）。

**验收标准（本阶段的核心价值）**：**临时移除 `capabilities/quick-upload/` 目录后，桌宠仍能正常启动、拖动、贴边、开关菜单、退出。**
→ 已由 `test/capabilities.test.js` 第 [11] 组守住：未注册任何能力时 `manifests()` 为空数组、
`getDropHint()` 返回 null、`pet:drop` 无人处理也不抛错；页面侧靠 `float.html` 的 `onerror` 兜底。

**检测**：
- `float.js` 中不再出现 `uploadFile` / `deleteFile` / `getUploadDest`（业务只在能力目录内）；
  ⚠️ 注意 ROADMAP 原稿此处写的是 `grep -rn "uploadFile|deleteFile" renderer/scripts/`，
  该范围过宽 —— `file-manager.js` 是**文件管理窗口**，它本来就该有自己的上传/删除调用。
  正确范围是 `renderer/scripts/float.js`（桌宠壳层）。
- `float.js` 725 → 587 行；`capabilities.js` 252 行 + 能力 3 个文件共 170 行。
- `npm test` 由 6 个脚本增至 **7 个**，新增 `test/capabilities.test.js` **31 项断言**。
- `npm run lint` 全绿。

**过程中发现并修掉的两个真实缺陷（都在新增的能力层里，测试当场抓出）**：

1. `capabilities.js` 注入的 `ctx.pet` 原先指向原始 API 对象，能力里 `pet.root` 为 `undefined`
   → 菜单按钮高亮静默失效。改为 `ctx.pet = ctx`（自身引用）。
2. `float.js` 的 `deskPet.storage.get/set` 原先按 `(key[, value])` 两参实现，而注册表按
   `(capabilityId, key[, value])` 调用 → 能力 id 落进 key 槽、值被丢弃，持久化会**静默写错**。
   已统一为三参壳层签名，并在测试里逐参断言。

**提交**：`refactor: 阶段1 抽出 quick-upload 能力并引入能力注册表`

---

### 阶段 2：壳层定型 + 事件仲裁

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 2.1 | 浮窗拆分：`renderer/pet/penetration.js`（穿透仲裁）、`renderer/pet/interaction.js`（拖动/单击/双击/右键/光标），`float.js` 只做装配与回调注入 | ✅ |
| 2.2 | **穿透仲裁改计数式**：`penetration.acquire(reason)` / `release(reason)` 取代 `isDragging/menuOpen/quitOpen/modalActive` 四布尔组合 | ✅ |
| 2.3 | 桌宠对外 API：`toast / modal / storage / root / getDropHint / refreshDropHint`（阶段 1 已定），加 `penetration` | ✅ |

**为什么必须改计数式**：原实现是

```js
if (!menuOpen && !quitOpen && !modalActive && !isDragging) enableClickThrough();
```

它与**执行顺序**相关。最典型的翻车场景：菜单开着时结束一次拖动 —— 拖动分支认为自己结束
了就调用恢复穿透，把菜单的可点击性一起关掉（菜单点不到）。此外每新增一个阻塞来源
（阶段 1 的能力、阶段 3 的动画/气泡）都要回头改所有判断点，且重复调用不安全。

现在改为**交互原因集合**：只有集合为空才恢复穿透。add/delete 幂等、与调用顺序无关、
可无限扩展。测试 `test/penetration.test.js` 第 [4] 组专门覆盖「多原因叠加 + 释放顺序无关」。

**顺带修掉的两个真实缺陷（都在新抽出的模块里，测试当场抓出）**：

1. `interaction.js` 的 `flushMove()` 原先以 `dragging` 作为前置条件，而 `onPointerUp`
   先置 `dragging = false` 再 flush → **松手时最后一帧位移被丢弃**（表现为松手瞬间少走一截）。
   已改为「先 flush、再结束拖动状态」，并且 `flushMove` 只依据是否有待提交位移。
2. 双击判定原先依赖「单击定时器仍在挂起」这一同步条件，若浏览器 dblclick 阈值短于
   250ms 单击延迟就会失效。现改为**推迟一拍**判定（`scheduleClick(..., 0)`），
   判定结果不再依赖同 tick 时序。

**检测**：
- `float.js` 595 → 547 行；新增 `pet/penetration.js` 87 行、`pet/interaction.js` 194 行
- 自检脚本 7 → **9 个**，断言 155 → **210 项**（新增 penetration 27 + interaction 32）
- `test/snap-contract.test.js` 的两条源码级断言随逻辑迁移更新指向
  （`rafPending` 与「开始拖动清朝向」现在位于 `pet/interaction.js`），断言意图不变
- `npm test` 9 个脚本全绿；`npm run lint` 全绿

**尚未完成（原计划里的 2.1 后半）**：`renderer/pet/{shell,behavior}.js` 未拆 ——
`float.js` 仍保留菜单/退出/贴边的一小组状态（`menuOpen` / `quitOpen` / `wasSnapped` /
`snapLock`）。它们与 DOM 事件与穿透仲裁调用点交织，且各自都有测试覆盖，
为控制单阶段风险暂不强行拆分；`behavior.js` 则留给阶段 3 的动画状态机。

**阶段 2 补完（视觉框测量抽离）**

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 2.4 | 抽出 `renderer/pet/anchor.js`：宠物真实视觉框的测量、稳定帧节流与上报 | ✅ |

把约 150 行「视觉框测量 + 稳定帧节流 + 调试框」从 `float.js` 抽成可注入 DOM 的模块。
这是吸附是否准确的根基，但此前完全没有测试覆盖（只有源码级正则断言）。

- `float.js` 551 → 414 行（相对阶段 2 起点 595 共 −181 行）
- 新增 `test/anchor.test.js` **35 项断言**：取并集排除阴影、CTM 坐标变换（含旋转矩阵）、
  异常与空值、容器回退、稳定帧节流、start/stop/reset 生命周期、调试框默认关闭
- 稳定语义刻意与原实现保持一致（连续 3 次「与上帧相同」才上报，即第 4 帧；
  第 1 帧只建立基准）—— 测试初稿按「第 3 帧」写，被实测纠正

**检测（补完后）**：自检脚本 9 → **10 个**，断言 210 → **245 项**；`npm test` 全绿、`npm run lint` 全绿。

**提交**：`refactor: 阶段2 抽离穿透仲裁与交互手势（穿透改原因集合）`

---

### 阶段 3：动画系统 A 层 + 皮肤格式

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 3.1 | 动画状态表 + 状态机（`idle/sleep/walk/celebrate/interact/snap/drag`），优先级与一次性状态回落 | ✅ `renderer/pet/behavior.js` |
| 3.2 | 定义 `pet.json` 皮肤包规范（`render` / `clips` / `sounds` / `colorMap`） | ✅ `docs/PET_SPEC.md` |
| 3.3 | 皮肤校验与合并（`validatePetSkin` / `mergeClips`） | ✅ `renderer/pet/skin.js` |
| 3.4 | 现有 SVG 猫改造为第一套内置皮肤（支持换色） | ⬜ 见下方说明 |
| 3.5 | 把写死在元素上的无限动画改为状态类驱动 | ✅（见下） |
| 3.6 | 补齐 `docs/ANIMATION_SPEC.md`、`docs/THEME_SPEC.md` | ⬜ 见下方说明 |

**3.5 的做法与「默认值等于现状」原则**

原先 4 个无限动画（呼吸 / 阴影脉动 / 眨眼 / 瞳孔移动）**直接写死在元素上、永远在跑**。
一旦加入睡觉、走动、点击反馈，就会出现两个动画争抢同一个 transform
（例如睡觉与呼吸同时缩放）。现在收敛到 `.pet-body.state-*` 状态类，
同一时刻只有一个状态生效。

关键取舍：`state-idle` 一条不差地**沿用**原先那四条动画（同样的时长与缓动），
因此接入状态机不改变默认外观。其余状态才去覆盖它们（拖动/吸附时停掉呼吸，
睡觉放慢到 5s，被点击播一次性 `pet-interact`）。

**状态驱动来源**（谁把「正在发生的事」翻译成状态）：

| 状态 | 驱动源 |
| --- | --- |
| `idle` | 默认；松手后、离开吸附后 |
| `drag` | `interaction.onDragStateChange(true)`（优先级最高，可打断一切） |
| `snap` | `onSnapEdgeChanged` / `onDockSnapChanged` → `syncSnapState()` |
| `interact` | `interaction.onInteract`（按下桌宠时的一次性反馈，600ms 后回落） |
| `walk` / `sleep` / `celebrate` | **仅定义了状态与视觉，暂无驱动源**（见下） |

**明确未完成的部分（不夸大）**

- **3.4 内置皮肤改造未做**：现有 SVG 猫的颜色仍写死在 SVG 属性上（`fill="#f5a623"`），
  尚未改成 `var(--cat-*)` 引用，因此 `colorMap` 换色目前**只是规范、
  没有实际生效**。规范第 7 节已写明换色需要「变量映射 + SVG 改用 var()」两步。
- **3.3 只做了校验与合并，没有做文件系统加载器**：`userData/pets/` 扫描、
  热切换、atlas 帧绘制属于阶段 8（商城导入导出）。当前 `skin.js` 是纯校验/合并逻辑，
  可在 Node 里完整测试，正好作为阶段 8 的第一道闸。
- **`walk` / `sleep` / `celebrate` 无驱动源**：`celebrate` 的自然触发点是
  「上传成功」，但那需要 `quick-upload` 能力产出事件、壳层再驱动状态 ——
  属于跨能力的接线，按「一个阶段一个主题」的原则留给后续，避免本阶段
  同时改动能力层与动画层。

**检测**：
- 自检脚本 10 → **12 个**，断言 245 → **317 项**
  （新增 `behavior.test.js` 31 项、`skin.test.js` 41 项）
- `behavior.test.js` 覆盖：状态表完整性、优先级（高可打断低、低不得打断高）、
  未知状态名拒绝、一次性状态到点回落、变化通知与订阅者异常隔离
- `skin.test.js` 覆盖：致命问题 → `ok:false`（含循环引用不抛错）、
  可自愈问题 → `ok:true` + warning、路径安全（绝对路径/`..`/协议前缀）、
  未知状态名忽略、**皮肤不得覆盖 loop/duration/class**（否则一次性状态被改成循环，
  状态机永远回落不到 idle）
- `npm test` 12 个脚本全绿；`npm run lint` 全绿；`node --check` 45 个文件通过

**提交**：`feat: 阶段3 桌宠动画状态机与 pet.json 皮肤格式`

---

### 阶段 4：吸附系统重构（独立可做）

| 项 | 内容 |
| --- | --- |
| 4.1 | 抽出 `src/main/snap.js` 纯几何函数 `resolveSnapPosition(bounds, dockRect, petRect)` |
| 4.2 | 浮窗侧新增 `reportPetAnchor`（报宠物视觉框，含旋转/缩放） |
| 4.3 | **Dock 几何变化时重新上报**（改样式、切仅快捷图标、右键菜单展开、显示/隐藏） |
| 4.4 | `inset = (windowW − petW)/2 − gap` 公式替换四个写死的 `52` |
| 4.5 | 统一三处不一致的可见尺寸（100 / 100 / 45） |
| 4.6 | 吸附判定改用宠物锚点投影 + 方向迟滞；Dock 移动时按关系重算而非 delta 累加 |
| 4.7 | 处理 `expand/restore-float-window` 后重算吸附关系 |

**检测**：`node --test` 覆盖 `snap.js` 边界用例（贴边+吸附同时触发、膨胀后还原、旋转姿态）；手测"改完 Dock 设置后吸附仍准确"（这是当前 bug 的主因）。

---

### 阶段 5：能力层骨架 + 主进程分家

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 5.1 | `src/main/capabilities/index.js`：把「主进程注册了哪些 IPC」变成**可声明、可开关** | ✅ |
| 5.2 | 六个 `ipc/*.js` 的实现**保持原位**，迁移到 `capabilities/<id>/` | ⬜ 见下 |
| 5.3 | `index.js` 按 `config.capabilities` 决定加载哪些能力（关闭则不注册其通道） | ✅ |
| 5.4 | 设置窗口页签按能力动态挂载（`manifest.settingsPanel`） | ⬜ 见下 |
| 5.5 | 补齐 `docs/CAPABILITIES.md` | ⬜ 见下 |

**本阶段的实际做法（有意保守）**

原计划把 `ipc/{files,config,icons,dialog,system}.js` 搬进 `capabilities/<id>/`。
实际只做了**在其上建立能力层**，没有搬文件，原因：

- 那六个文件本就按域拆分、职责清晰，搬迁只换路径不换逻辑；而搬迁会同时改动
  `require` 路径、`index.js` 依赖注入、以及每个模块的相对引用 ——
  与「建立声明 + 开关」是两类风险，叠在同一次提交里会难以定位问题。
- 本阶段真正要达成的是**可开关**，这一点不需要搬文件就能做到，且已由测试锁定。

因此能力层是这样组织的：

```
src/main/capabilities/index.js
  CAPABILITIES = [
    { id, name, description, defaultEnabled, channels: [...], build(deps), register(deps) }
  ]
```

- `channels` 是**声明的单一事实来源**：`test/ipc-contract.test.js` 断言
  「声明集合」与「真实模块注册的集合」逐一相等，因此声明不会悄悄过期。
- `loadAll(deps)` 按 `config.capabilities[id]`（布尔，或 `{enabled:boolean}`）
  决定是否注册；关闭的能力**不会注册任何通道**，加载失败也只用日志记录、
  不拖垮应用启动。
- 新增通道 `capability-list` / `capability-enable`，并同步 `preload.js`
  （`capabilityList` / `capabilityEnable`），使开关可由界面驱动。
- `config.js` 的 `migrateConfig` 只保证 `capabilities` 是对象；
  缺省值由能力层按 `defaultEnabled` 判定 —— **老配置无需任何改动**。

**当前六个能力与其通道数**

| id | 名称 | 通道数 |
| --- | --- | --- |
| `core-window` | 窗口与桌宠壳层 | 34 |
| `file-manager` | 文件管理（含图标） | 12 |
| `file-dialog` | 目录选择与打开 | 7 |
| `partitions` | 分区与路径 + 能力配置通道 | 17 |
| `system` | 系统能力（音量/网络/电源/任务栏等） | 23 |
| | **合计** | **93** |

**检测**：
- 新增 `test/ipc-contract.test.js` **18 项断言**，锁定三条契约：
  ① 声明 ↔ 真实注册（逐能力集合相等）；② 能力间不重复声明、并集覆盖全部；
  ③ 能力层 ↔ preload 一一对应（无孤立、无幽灵）。
  另覆盖启停语义：缺省全启用、`false` 关闭、`{enabled:false}` 关闭、
  配置缺失不崩、`loadAll` 真的跳过被关闭的能力。
- 自检脚本 12 → **13 个**，断言 317 → **340 项**
- `npm test` 13 个脚本全绿；`npm run lint` 全绿；`node --check` 47 个文件通过

**明确未完成**

- **5.2 文件搬迁未做**（理由见上）。这让 `ipc/` 与 `capabilities/` 之间多了一层
  间接：新增通道时必须同时更新 `capabilities/index.js` 的 `channels` 声明，
  否则契约测试会失败 —— 这是**有意的强约束**，不是遗漏。
- **5.4 设置页的能力管理界面未做**：通道（`capabilityList` / `capabilityEnable`）
  已经就绪且可测，但界面未接。因此「关闭某能力」目前需要手改 config.json。
- **5.1 未把 `ipc/window.js` 中的壳层通道单独拆成 `ipc/core.js`**：
  34 个通道里只有 `get-window-bounds` 渲染层未使用，其余全部在用，
  拆出一个 `core.js` 只是文件划分、不产生行为差异，故与搬迁一并留到后续。
- **5.5 `docs/CAPABILITIES.md` 未写**：规范内容目前以
  `src/main/capabilities/index.js` 的文件头注释形式存在。

**提交**：`refactor: 阶段5 主进程能力层（声明式通道 + 可开关）加契约自检`

---

### 阶段 6：配置 v1 → v2 迁移

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 6.1 | `config.json` 命名空间化：`{ version:2, core:{...}, capabilities:{...}, legacy:{...} }` | ✅ `src/main/config-schema.js` |
| 6.2 | 迁移前**先备份** `config.json.bak`（只写一次，绝不覆盖已有备份） | ✅ |
| 6.3 | 保留旧字段读取兼容层，避免一次性改爆所有调用点 | ✅ |

**v2 结构**

```jsonc
{
  "version": 2,
  "core":       { savePath, floatPosition, snapEdges, dockVisible, floatAlwaysOnTop,
                  dockAlwaysOnTop, dockX, dockBottom, hideSystemTaskbar,
                  capabilities: { <主进程能力开关>: true|false } },
  "capabilities": {
    "file-manager": { partitions, preferredPath, navItems },
    "dock":         { dockSettings },
    "<渲染侧能力id>": { ... }
  },
  "legacy":     { 已废弃但**不删除**的字段 }
}
```

**三条硬约束**

1. **绝不丢字段**：迁移是字段搬家而非清理。未识别字段进 `legacy` 保留 ——
   连 `snapEdge` / `desktopIconsHidden` 这类当前无人读取的废弃键也一并留着。
   测试用**真实的 `.userdata/config.json`**（15 个顶层字段、2 个分区、
   12 个导航项）断言逐字段值相等，一个不丢。
2. **内部视图保持 v1 形状**：`decodeV2()` 把 v2 摊平回扁平对象，
   因此 `loadConfig()` 的约 20 个调用点**一行都不用改**；
   `saveConfig()` 始终写 v2 文档（内存扁平 / 磁盘 v2 两个视图）。
3. **纯函数 + 不抛错**：编解码不碰文件系统，对 null/数组/字符串/自引用
   等畸形输入返回空值或警告而不抛异常（配置损坏时应用必须能起来）。
   写盘失败也不影响本次运行（内存中数据正确，下次启动重试）。

**过程中被测试抓出的两个真实缺陷（都在本阶段新增的 schema 里）**

1. **分组名泄漏进能力命名空间**：`decodeV2` 把 `file-manager`/`dock` 等分组
   写回了 `flat.capabilities`，导致「读盘→写盘」每次都会再嵌一层、配置持续膨胀。
   已把分组名设为结构保留字，并补了**幂等性断言**（连续 5 次编解码结果不变）。
   这是最危险的一类回归 —— 单次运行看不出来，配置会悄悄变大。
2. **`decodeV2` 覆盖主进程能力开关**：它用 `flat.capabilities` 直接赋值，
   把先前从 `core.capabilities` 读入的开关整体覆盖掉了。已改为合并。

**一个真实存在的命名冲突（已解决并固定）**：主进程能力层（阶段 5）有一个能力
id 就叫 `dock`，而 v2 又用 `dock` 作为 `dockSettings` 的分组名。两者同名会让
`capabilities.dock` 既像分组又像能力配置。处理：撞名的能力配置存到保留键
`_caps` 下（按 id 再分一层），绝不与分组混淆。

**已知的有损点（显式固定，不当回归）**：v1 把「能力开关 `enabled`」与「能力配置」
压进同一个键，扁平视图无法同时表示两者。因此撞名 id 摊平后只保留配置对象、
不含 `enabled`；实际生效值由「无 `enabled` → 用 defaultEnabled」决定，
与迁移前等效。已在测试中显式断言这一行为。

**检测**：
- 新增 `test/config-migration.test.js` **44 项断言**：真实 config.json 零丢失、
  往返一致、畸形输入不抛错（含自引用）、未识别字段进 legacy、能力开关与能力配置
  分家、`isV2` 判定、`encodeForDisk` 幂等
- 自检脚本 13 → **14 个**，断言 340 → **379 项**
- `npm test` 14 个脚本全绿；`npm run lint` 全绿；`node --check` 49 个文件通过

**未完成 / 注意**

- 真实 `.userdata/config.json` 在本次会话中**未被改写**（迁移只在应用启动时发生）。
  实际迁移效果需 `npm start` 触发，届时会生成 `config.json.bak`。
- 兼容层（可读 v1）计划保留一个版本；一个版本之后可移除 v1 读取分支。

**提交**：`refactor: 阶段6 配置结构 v1→v2 命名空间化（含强制备份与兼容层）`

---

### 阶段 7：Dock 优化

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 7.5 | **多显示器支持**（`getAllDisplays` + 按窗口所在屏钳制 + 拔屏收回窗口） | ✅ `src/main/display.js` |
| 7.2 | `--dock-*` 变量从 `#dockContainer` 提到 `:root`（主题包换肤前提） | ✅ |
| 7.1 | `applyIconSizes` 的逐元素内联样式改为 CSS 变量 | ✅ |
| 7.1b | `autoFitDockWindow` 的**容器宽度**内联样式改为 CSS 变量 | ⬜ 见下 |
| 7.3 | 磁贴放大（按距离缩放邻位，现仅一级邻居） | ⬜ |
| 7.4 | 自动隐藏 + 触底唤出；启动跳动动画；通知徽标 | ⬜ |
| 7.6 | 快捷图标拖拽排序 | ⬜ |

**7.2 外观变量提到 `:root`（本轮）**

原先 `applyDockStyle` 把 11 个外观变量写在 `#dockContainer` 上。提到 `:root` 有两个理由：
1. 音量/WiFi 浮层与右键菜单**挂在 body 下**，写在容器上它们继承不到；
2. 阶段 8 的主题包只需覆盖 `:root` 上一组变量即可换肤，不必知道 Dock 的 DOM 结构。

`:root` 里显式声明了全部 13 个变量的**默认值（= 接入前现状）**，
因此不换主题时外观完全不变，也让「有哪些变量可覆盖」变成可读的清单。

**7.1 图标尺寸变量化（本轮）**

`applyIconSizes` 原先做 3 次 `querySelectorAll` + 约 20 次内联 `width/height` 写入
（每次新图标插入都要重跑一遍）。现在只写两个变量，尺寸由 CSS 选择器消费：

```
--dock-item-size   按钮容器尺寸     ← 由 .dock-start/.dock-power/.dock-item/.dock-tray-item 消费
--dock-icon-size   按钮内图标尺寸   ← 由 三处 svg/img 规则消费
```

好处：新增图标**自动继承**（CSS 直接命中，无需再遍历），主题包也能覆盖。

顺带发现并修掉一处重复：`applyDockStyle` 还在写 `dockPanel.style.borderRadius`，
而 dock.css 的 `.dock-panel` 已经消费 `var(--dock-radius)` —— 两者同值、纯属冗余，
已删除。内联样式写入实测变化：

| 模式 | 旧 → 新 |
| --- | --- |
| `style.width` | 5 → 2 |
| `style.height` | 3 → 0 |
| `style.borderRadius` | 1 → 0 |
| `style.setProperty` | 13 → 15 |

**检测**：`test/dock-geometry.test.js` 扩至 **32 项断言**，新增两组源码级契约：
`:root` 声明了全部 13 个变量、`dock.js` 不再以 `#dockContainer` 为变量宿主、
`applyIconSizes` 只写变量（断言其函数体内**不再有** `style.width/height`
与 `querySelectorAll`）、CSS 里不再硬编码 52px、圆角只由变量驱动。
自检脚本仍 15 个，断言 427 → **435 项**；`npm test` 全绿、`npm run lint` 全绿。

**明确未完成**：`autoFitDockWindow` 里仍有 2 处 `dockItems.style.width`
（可见区宽度）与一处 `dockPanel.style.width` 重置 —— 这是**每个 item 宽度累加出来的
容器宽度**，不是固定尺寸，且与滚动/溢出裁剪逻辑耦合，改动需要重新回归滚动行为，
故与 7.3/7.4/7.6 一并留到后续。

**7.5 多显示器（本轮完成，也是 ROADMAP 所指「当前的明显缺口」）**

原先 **16 处**几何钳制全都基于 `screen.getPrimaryDisplay().workArea`，双屏下就是错的：
把 Dock/浮窗拖到副屏后，仍按主屏工作区钳制，位置会被拉回主屏。

新增 `src/main/display.js`，把「用哪块屏」收敛到一处，规则：
1. 有窗口/矩形 → 取与其**交叠面积最大**的显示器（`getDisplayMatching`，含自实现退化版）
2. 无矩形 → 取**鼠标所在**显示器
3. 都不行 → 主显示器（兜底，保证永远有返回值）

替换了 `windows.js` 的 4 处与 `ipc/window.js` 的 12 处（前者用 `forBounds` / 后者用
`workAreaOfWin(窗口)`），并新增 `watchDisplayChanges()`：监听
`display-metrics-changed` / `display-removed` / `display-added`，
**把完全落在所有屏幕之外的窗口收回可视区**（副屏被拔掉时的典型场景），
应用退出时 `dispose()`。

**顺带修掉两个既有缺陷**：

1. **`ipc/window.js` 里 `screen` 未定义**：`screen` 是 `register()` 的入参而非模块级变量，
   初版把 `createDisplayOps(screen)` 写在模块顶层会直接 `ReferenceError`。
   由 ESLint 的 `no-undef` 当场抓出（这正是阶段 2 开启该规则的收益）。
2. **Dock 兜底位置在副屏上算错**：`createDockWindow` 回退到底部居中时用的是
   `workArea.height - dockHeight + 20`，漏了 `workArea.y` ——
   在副屏（`workArea.y ≠ 0`）上会把 Dock 放到错误高度。已改为
   `workArea.y + workArea.height - …`。

**检测**：新增 `test/display.test.js` **28 项断言**，覆盖选屏三档优先级、
跨屏取交叠更大者、`screen` 抛错兜底、钳制用 `workArea` 而非 `bounds`、
`allowAbove`（Dock 高预留区越出上沿的既有修复）、可见性判定、
以及「副屏拔掉后只收回真正越界的窗口、仍在屏内的不动」。
自检脚本 14 → **15 个**，断言 379 → **427 项**；
`npm test` 全绿、`npm run lint` 全绿（`node --check` 51 个文件）。

**明确未完成**：7.1 / 7.2（内联样式变量化、`--dock-*` 提到 `:root`）——
渲染侧改动，`dock.js` 目前有 33 处内联样式写入；7.3 / 7.4 / 7.6 未做。
本轮优先做 7.5 是因为它是**功能性缺口**（多屏下位置算错），
而 7.1/7.2 是**可维护性改造**（为阶段 8 主题包铺路），可以安全地留到后续。

**提交**：`feat: 阶段7 多显示器支持（按窗口所在屏钳制 + 拔屏收回窗口）`

---

### 阶段 8：样式商城（第一期）

| 项 | 内容 |
| --- | --- |
| 8.1 | 皮肤包导入/导出（本地 `.zip` 或目录），`userData/pets/`、`userData/themes/` |
| 8.2 | 校验 `pet.json`/`theme.json` 必需字段 + 资源大小与格式白名单 |
| 8.3 | 设置新增 `data-tab="pet"`（桌宠）与 `data-tab="store"`（皮肤商城） |
| 8.4 | 试穿预览（复用 `settings.html` 的 `.preview-dock` 思路做桌宠预览） |
| 8.5 | 在线索引接口预留（不下发网络权限给渲染进程） |

**检测**：导入非法包（缺字段/超尺寸/非法扩展名）被拒绝且有明确提示；导入导出往返一致。

---

### 阶段 9：工程质量与文档收口

| 项 | 内容 |
| --- | --- |
| 9.1 | 为 `snap.js`、路径校验、配置迁移补 `node:test` 单测 |
| 9.2 | `lint` 脚本纳入 HTML/CSS（`prettier --check`） |
| 9.3 | 主进程日志落盘 `userData/logs/` |
| 9.4 | `docs/` 统一校对：`ARCHITECTURE.md` 重构、`IPC_REFERENCE.md` 生成、README 补皮肤章节 |
| 9.5 | 发布前加"文档声称 vs 工作区实际"核对步骤，杜绝再次漂移 |

---

## 三、界面外观不会被改坏

本方案所有改动**不替换现有视觉风格**：Dock 的四模式材质、桌宠造型、文件管理器布局、设置窗口配色全部保留。新增能力（皮肤、动画）都以"默认值等于现状"为原则接入。

---

## 四、提交规范

每个阶段一个提交，格式沿用仓库现有风格（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`）：

```
✅ 阶段 −1:  fix: 阶段-1 止损（文件管理器拖动、图标缓存位置、IPC 路径校验）      [5f62f03]
✅ 阶段 −1.5: fix: 阶段-1.5 修复文件列表陈旧与 Dock 失效图标无反馈              [38bc848]
✅ 阶段  0:  refactor: 阶段0 抽取共用 UI 原语（模态框/Toast）                   [6eda6a9]
✅ 阶段  1:  refactor: 抽出 quick-upload 能力并引入能力注册表                   [0861cba]
✅ 阶段  2:  refactor: 桌宠壳层拆分与穿透事件仲裁                               [733b907] [737c987]
✅ 阶段  3:  feat: 桌宠动画状态机与皮肤包格式                                   [5db2e0a]
   阶段  4:  fix: 重构吸附几何计算与锚点上报
✅ 阶段  5:  refactor: 主进程按能力分家                                         [887aa1e]
✅ 阶段  6:  refactor: 配置命名空间化 v1→v2 迁移                               [e801aa9]
✅ 阶段  7:  feat: 多显示器支持（7.5，其余项待续）                              [待提交]
   阶段  8:  feat: 本地皮肤包导入导出与商城页
   阶段  8:  feat: 本地皮肤包导入导出与商城页
   阶段  9:  chore: 测试、日志与文档收口
```

**验证脚本**：`.userdata/stage-minus1-check.js`（22 项）与 `.userdata/stage-minus15-check.js`（13 项）为纯 Node 断言脚本，
不依赖 Electron，可随时重跑：`node .userdata/stage-minus1-check.js`。
（`.userdata/` 已被 `.gitignore` 忽略，属开发环境数据。）

**约定**：只提交本地，不 `push`（推送时机由你决定）。当前本地领先 `origin/main` 6 个提交。

---

## 五、每阶段通用检测清单

**A 组 · 核心交互（每阶段都要过）**

- [ ] 拖动桌宠到四边 → 贴边隐藏；鼠标移入弹出、移出收回
- [ ] 拖到 Dock 附近 → 吸附到**真实面板**边框，Dock 移动时跟随
- [ ] 单击开菜单环 / 双击开文件管理 / 右键开退出 / 点空白关闭
- [ ] `nav` 按钮切 Dock、`pin` 按钮切置顶，`active` 态正确
- [ ] 文件管理窗口**可拖动**（阶段 −1 修复项）
- [ ] 窗口扩容（模态 420×320）后能正确还原

**B 组 · 业务**

- [ ] 拖文件到桌宠 → 上传到"文件管理器当前路径（若开）否则首选路径"
- [ ] 回收站模式：图标变红、文案变"释放删除到回收站"、走 `shell.trashItem`、**重启后保持**
- [ ] 重名弹出覆盖确认；覆盖与取消都正确
- [ ] 文件管理：双视图、搜索、分区拖拽、右键菜单（含危险色）
- [ ] 设置：四页签、预览实时同步、应用/确定

**C 组 · 稳定性**

- [ ] 单实例；重复启动聚焦已有窗口
- [ ] GPU/渲染进程崩溃自愈
- [ ] 配置：正常读写、损坏时回退、EPERM 时可恢复
- [ ] 副屏插拔后位置不越界

**D 组 · 命令**

```bash
npm run lint      # 必须全绿
npm test          # 阶段 4 起必须有测试
npm start         # 人工过 A/B/C 组
```

---

## 六、风险与回滚

| 阶段 | 风险 | 回滚方式 |
| --- | --- | --- |
| −1 | 路径校验过严会误伤正常操作 | 校验函数集中一处，放宽即改一个白名单 |
| 2 | 穿透计数化改错会导致「点不到」或「穿透失灵」 | 保留旧布尔版本的 Git 历史，必要时 revert |
| 4 | 吸附公式改错会让桌宠吸不上 | `snap.js` 为纯函数，可先跑测试再启用 |
| 6 | 配置迁移不可逆 | **强制备份** `config.json.bak` + 版本号判定，绝不覆盖 |
| 8 | 导入第三方包引入安全面 | 主进程校验 + 渲染层不拿网络权限 + 大小/格式白名单 |

任何阶段出问题，`git revert <该阶段提交>` 即可回到上一个可用状态。
