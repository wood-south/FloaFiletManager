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

| 项 | 内容 |
| --- | --- |
| 1.1 | 新建 `renderer/capabilities/quick-upload/{manifest.js,index.js,style.css}` |
| 1.2 | 迁移 `float.js:304-437`（拖放上传/回收站）、`float.js:239-252`（菜单按钮切换） |
| 1.3 | 新建 `renderer/shared/registry.js`：`window.deskPet.use(cap)` + 事件总线 + manifest 校验 |
| 1.4 | `recycleMode` 裸变量改为 `persistKey: 'capabilities.quick-upload.recycleMode'` 持久化 |

**验收标准（本阶段的核心价值）**：**临时移除 `capabilities/quick-upload/` 目录后，桌宠仍能正常启动、拖动、贴边、开关菜单、退出。**
**检测**：`grep -rn "uploadFile\|deleteFile" renderer/scripts/` 应为空（业务只在 capability 内）。

---

### 阶段 2：壳层定型 + 事件仲裁

| 项 | 内容 |
| --- | --- |
| 2.1 | `float.js` 拆为 `renderer/pet/{shell,interaction,behavior,registry}.js`，`float.js` 仅作装配入口 |
| 2.2 | **穿透仲裁改计数式**：`pet.setInteractive(reason)` / `releaseInteractive(reason)` 取代 `isDragging/menuOpen/quitOpen/modalActive` 四布尔判断 |
| 2.3 | 桌宠对外 API 固定为：`toast / modal / setInteractive / on / playAnimation / getAnchor` |

**检测**：手测穿透边界用例——菜单打开时拖放结束、模态框未关时鼠标移出、右键菜单与退出按钮同时打开，四种组合下穿透状态都正确（现状这几种组合有误开穿透的风险）。

---

### 阶段 3：动画系统 A 层 + 皮肤格式

| 项 | 内容 |
| --- | --- |
| 3.1 | 动画状态表 + 状态机（`idle/walk/sleep/interact/drag/snap/celebrate`），优先级与播完回落 |
| 3.2 | 定义 `pet.json` 皮肤包规范（`clips` / `atlas` / `sounds` / `render.size`） |
| 3.3 | 皮肤加载器：扫描 `userData/pets/` 与内置 `renderer/pet/skins/`，支持热切换 |
| 3.4 | 现有 SVG 猫改造为第一套内置皮肤（支持换色） |
| 3.5 | 删掉 `float.css` 中写死在元素上的无限动画，改由状态表驱动 |
| 3.6 | 补齐 `docs/ANIMATION_SPEC.md`、`docs/THEME_SPEC.md` |

**检测**：切换内置皮肤不闪烁；动作切换时"呼吸/睡觉"不再互相打架；`pet.json` 缺字段时有明确降级而不是白屏。

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

| 项 | 内容 |
| --- | --- |
| 5.1 | `src/main/ipc/{files,config,icons,dialog,system}.js` 迁入 `src/main/capabilities/<id>/` |
| 5.2 | 新建 `src/main/ipc/core.js`：只留 `move-window`、`save-window-position`、`expand/restore-float-window`、`set-ignore-mouse-events`、`report-*-offset`、`report-pet-anchor` |
| 5.3 | `index.js` 按 `config.capabilities` 决定加载哪些能力 |
| 5.4 | 设置窗口页签改为按能力动态挂载（`manifest.settingsPanel`） |
| 5.5 | 补齐 `docs/CAPABILITIES.md` |

**检测**：关闭某能力后其 IPC 通道不再注册、菜单按钮不再出现、设置页签不再渲染。

---

### 阶段 6：配置 v1 → v2 迁移

| 项 | 内容 |
| --- | --- |
| 6.1 | `config.json` 命名空间化：`{ version: 2, core: {...}, capabilities: {...} }` |
| 6.2 | 迁移前**先备份** `config.json.bak`（当前只有 EPERM 兜底，无备份） |
| 6.3 | 保留一个版本的旧字段读取兼容层，避免一次性改爆所有调用点 |

**检测**：用现有 `config.json` 实测迁移（v1 全字段保留、无丢失）；破坏性用例——配置文件损坏/半截时能安全回退到默认值。

---

### 阶段 7：Dock 优化

| 项 | 内容 |
| --- | --- |
| 7.1 | `applyIconSizes` / `autoFitDockWindow` 的内联样式改为 CSS 变量（移除批量行内写） |
| 7.2 | `--dock-*` 变量从 `#dockContainer` 提到 `:root`（主题包换肤前提） |
| 7.3 | 磁贴放大（按距离缩放邻位，现仅一级邻居） |
| 7.4 | 自动隐藏 + 触底唤出；启动跳动动画；通知徽标 |
| 7.5 | 多显示器支持（`screen.getAllDisplays` + `display-metrics-changed` + `display-removed`） |
| 7.6 | 快捷图标拖拽排序 |

**检测**：改图标大小/数量后无布局跳变；拔掉副屏后 Dock 与桌宠位置仍正确。

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
✅ 阶段  0:  refactor: 阶段0 抽取共用 UI 原语（模态框/Toast）
   阶段  1:  refactor: 抽出 quick-upload 能力并引入能力注册表
   阶段  2:  refactor: 桌宠壳层拆分与穿透事件仲裁
   阶段  3:  feat: 桌宠动画状态机与皮肤包格式
   阶段  4:  fix: 重构吸附几何计算与锚点上报
   阶段  5:  refactor: 主进程按能力分家
   阶段  6:  refactor: 配置命名空间化 v1→v2 迁移
   阶段  7:  feat: Dock 变量化、磁贴放大与多屏支持
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
