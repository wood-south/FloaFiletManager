# 主进程能力层（CAPABILITIES）

> 阶段 5 引入，阶段 8 扩展。本文档说明「主进程注册了哪些 IPC」这层契约怎么用、怎么扩展。
>
> **单一事实来源是 `src/main/capabilities/index.js`**。
> 本文档中的通道清单由 `test/capabilities-doc.test.js` 与注册表逐项核对，
> 因此不会随代码演进而悄悄过期（改了代码不改文档，测试会失败）。

---

## 1. 它解决什么问题

阶段 5 之前，`src/main/index.js` 里是六个硬编码的 `require` + `register()`：

```js
ipcConfig.register({...}); ipcFiles.register({...}); ipcWindow.register({...});
ipcDialog.register({...}); ipcSystem.register({...});
```

问题：**无法关闭任何一个功能**（只能注释代码），也无法回答「某个通道归谁负责」。
现在改为**能力清单 + 按配置加载**：

```js
capabilities.loadAll({ loadConfig, saveConfig, screen, app, windows, ... });
```

每个能力声明自己的 `channels`、依赖与注册方式；`config.capabilities[id]`
为 `false`（或 `{ enabled: false }`）时，**该能力的通道完全不会被注册**。

---

## 2. 当前能力清单
<!-- CAPABILITIES-TABLE-BEGIN（由 test/capabilities-doc.test.js 核对，勿手改数字） -->

| id | 名称 | 通道数 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `core-window` | 窗口与桌宠壳层 | 34 | 启用 | 窗口移动、贴边/吸附、点击穿透、置顶、Dock 定位与显隐 |
| `file-manager` | 文件管理 | 12 | 启用 | 列表/搜索/上传/移动/删除/原生拖出，含文件图标 |
| `file-dialog` | 目录选择与打开 | 7 | 启用 | 系统目录选择框、打开文件/所在位置、此电脑、消息框 |
| `partitions` | 分区与路径 | 17 | 启用 | 分区 CRUD、快捷路径、首选路径，另含能力配置读写通道 |
| `skins` | 皮肤包 | 9 | 启用 | 列出 / 导入（目录与 zip）/ 导出 / 试穿预览 / 应用 / 查询当前皮肤；另含单向上报的 `renderer-log`（渲染层日志转发给主进程写盘） |
| `system` | 系统能力 | 23 | 启用 | 系统动作、电源、音量、网络/WiFi、电量、任务栏与桌面图标 |
| | **合计** | **102** | | |

> **单向通道**：`renderer-log` 用 `ipcMain.on`（无回执），因此 preload 侧用 `send`
> 而不是 `invoke`，不参与「通道 ↔ preload 方法」的一一对应检查。
> 它在能力声明里单独列在 `oneWayChannels`，由契约测试校验
> 「声明 ↔ 真实注册一致」，但不参与 preload 对齐 ——
> 这样既不放松那条有价值的检查，又能容纳单向上报。


<!-- CAPABILITIES-TABLE-END -->

**全部能力默认启用**；缺省即启用，因此**老配置不需要任何改动**。

---

## 3. 与 preload 的关系（契约）

`preload.js` 通过 `contextBridge` 暴露的每个方法都对应一个通道，
且**主进程注册的通道与 preload 桥接的通道必须一一对应**：

- 没有「preload 调用了但主进程没注册」的**孤立通道**（调用会 reject）；
- 没有「主进程注册了但 preload 未桥接」的**幽灵通道**（白注册）。

这条契约由 `test/ipc-contract.test.js` 强制，它用 stub 的 `electron.ipcMain`
把真实模块跑一遍、收集实际注册的通道再与声明比对。因此：

> **新增一个通道时，必须同时改三处**：`src/main/ipc/*.js` 注册、
> 对应能力的 `channels` 声明、`preload.js` 暴露方法。
> 漏掉任何一处，契约测试都会失败。

---

## 4. 如何新增一个能力

1. 在 `src/main/ipc/` 下写实现，导出 `register(deps)`，内部用 `ipcMain.handle` 注册通道。
2. 在 `src/main/capabilities/index.js` 的 `CAPABILITIES` 数组里加一项：

```js
{
  id: 'my-capability',              // 小写字母/数字/连字符，与配置键一致
  name: '我的能力',
  description: '一句话说明',
  defaultEnabled: true,
  channels: ['my-channel-a', 'my-channel-b'],   // 必须与真实注册完全一致
  build: (deps) => ({ /* 只挑这个能力需要的依赖 */ }),
  register: (deps) => myIpc.register(deps)
}
```

3. 若需要新的依赖（如 `userDataDir`），在 `src/main/index.js` 的 `loadAll({...})`
   里加上 —— 漏了会在启动时抛错，且 `test/ipc-contract.test.js` 会立刻报出来。
4. 在 `preload.js` 暴露对应方法。
5. 跑 `npm test`：契约测试会校验声明 ↔ 真实注册 ↔ preload 三者一致。

---

## 5. 关闭一个能力

编辑 `config.json`（v2 结构）：

```jsonc
{ "version": 2,
  "core": { "capabilities": { "system": false } } }
```

或在设置界面调用 `capabilityEnable(id, false)`（通道已就绪，UI 见 ROADMAP 阶段 8.3）。

**关闭是「重启生效」**：运行中动态卸载已注册的处理器会让 preload 的桥接方法
变成 reject，比"重启后生效"更容易出错，因此不做热卸载。

---

## 6. 设计取舍：为什么没有把文件搬进 `capabilities/<id>/`

ROADMAP 原计划把 `ipc/{files,config,icons,dialog,system}.js` 迁入
`src/main/capabilities/<id>/`。实际只在其上建立了能力层，**没有搬文件**，原因：

- 那六个文件本就按域拆分、职责清晰；搬迁只换路径不换逻辑，却会同时改动
  `require` 路径与依赖注入 —— 与「建立声明 + 开关」是两类风险，
  叠在同一次提交里出问题很难定位。
- 本阶段真正要达成的**可开关**不需要搬文件就能做到，且已被测试锁定。

代价：`ipc/` 与 `capabilities/` 之间多了一层间接，新增通道必须同步更新 `channels`
声明，否则契约测试失败。这是**有意的强约束**，不是遗漏。

---

## 7. 相关文件

| 文件 | 作用 |
| --- | --- |
| `src/main/capabilities/index.js` | 能力清单（**单一事实来源**） |
| `src/main/ipc/*.js` | 各能力的 IPC 实现 |
| `preload.js` | 渲染层桥接（须与通道一一对应） |
| `test/ipc-contract.test.js` | 声明 ↔ 真实注册 ↔ preload 三方契约 |
| `test/capabilities-doc.test.js` | 本文档的清单与注册表一致 |
