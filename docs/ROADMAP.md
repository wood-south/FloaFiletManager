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

---

### 阶段 0：共用原语（消除重复）

把三处重复的 UI 实现收敛为一份。

| 项 | 内容 |
| --- | --- |
| 0.1 | 新建 `renderer/shared/primitives.js`：`showModal` / `showInputModal` / `showToast` 工厂 |
| 0.2 | 新建 `renderer/shared/primitives.css`：合并 `float.css:309-452` 与 `file-manager.css:651-813` 的 `.modal-*` |
| 0.3 | `float.js`、`file-manager.js` 改为引用共用实现；删除各自副本（`MODAL_ICONS`、`ICONS`、重复 CSS） |
| 0.4 | `package.json` 增加 `"test": "node --test test/"` 与 `"check": "npm run lint && npm test"` 脚本 |

**检测**：文件管理器的模态框（含 `#modalInput` 输入型）与桌宠的确认框行为完全一致；CSS 中 `.modal-` 规则只存在于 `shared/primitives.css`。

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
阶段 −1:  fix: 修复文件管理器无法拖动与图标缓存写入位置
阶段  0:  refactor: 抽取共用模态框与 Toast 原语
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

**约定**：只提交本地，不 `push`（当前本地领先 `origin/main` 4 个提交，推送时机由你决定）。

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
