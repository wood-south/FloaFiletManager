# 问题解决方案文档 - 浮窗文件管理器 v1.1.0

本文档记录开发过程中真实踩过的坑：现象 → 根因 → 解决方案。

> **引用约定**：1.1.0 的模块化重构让旧文档里的行号全部失效，本文一律以「**文件路径 + 函数名 / 通道名 / 事件名**」定位代码，不使用行号。跨节引用直接用节号（如「见第 9 节」），不做锚点跳转。

---

## 目录

1. 配置文件写入 EPERM 权限错误
2. 快捷方式（.lnk / .url）图标缺失或错误
3. 透明窗口拖动失效
4. GPU / 渲染进程崩溃与自愈
5. 任务栏与桌面图标显隐
6. 音量控制 dll 编译被杀软拦截
7. 图标缓存损坏
8. 点击穿透导致按钮点不到
9. 图标提取链路的历史问题（已修复）
10. 浮窗模态框 / Dock 浮层显示不全
11. 浮窗吸附 Dock 位置不准
12. 启动卡顿与图标批量加载
13. 文件操作细节坑
14. 开发环境沙箱限制
- 问题分类汇总
- 最佳实践
- 问题排查流程
- 相关文档

---

## 1. 配置文件写入 EPERM 权限错误

### 问题现象

```
Error: EPERM: operation not permitted, open '...\config.json'
```

拖动浮窗或 Dock 一段时间后配置写入失败，窗口位置/外观设置丢失；杀掉进程后残留 `.tmp` 文件。

### 根本原因

1.0.0 曾在窗口的 `moved` 事件里直接写配置。拖动时 `moved` 每帧触发（每秒可触发数十次），`fs.writeFileSync` 反复打开同一文件，Windows 上会因文件句柄竞争/占用返回 `EPERM`；`transparent: true` 的窗口在高频重绘期间更容易触发该竞争。

### 解决方案

**① 移除高频写入，只在交互结束时保存**

```javascript
// ❌ 错误做法：floatWindow.on('moved', saveWindowPosition)
// ✅ 现在：渲染进程 mouseup 后单次调用
window.electronAPI.saveWindowPosition();      // → src/main/ipc/window.js 的 'save-window-position'
```

Dock 侧同样处理：`move-dock` 不直接写盘，而是走 `scheduleDockPosSave(x, bottom)`（400 ms 防抖，见 `src/main/ipc/window.js`）。

**② 写入加 3 次重试 + 80ms 退避**（`src/main/config.js` 的 `saveConfig`）

```javascript
for (let attempt = 0; attempt < 3; attempt++) {
  try { fs.writeFileSync(configPath, data); return true; }
  catch (e) {
    console.error(`保存配置失败(第${attempt + 1}次):`, e.message);
    if (attempt < 2) { const start = Date.now(); while (Date.now() - start < 80) {} }
  }
}
```

**③ 兜底原子替换**

```javascript
const tmp = configPath + '.tmp';
fs.writeFileSync(tmp, data);
fs.renameSync(tmp, configPath);     // 同目录 rename 是原子操作，不会写坏原文件
```

**④ 引用同一函数**：所有需要写配置的模块（`ipc/config.js`、`ipc/window.js`、`ipc/system.js`、`windows.js` 的 `savePersistedState`）都复用 `config.js` 导出的 `saveConfig`，避免各处各写一套。

### 经验总结

配置写入必须「**低频 + 重试 + 原子替换**」三件套；任何新增的写配置场景先想清楚触发频率。

---

## 2. 快捷方式（.lnk / .url）图标缺失或错误

### 问题现象

- 部分 `.lnk`（如 Trae CN.lnk、Unreal Engine.lnk、Visual Studio Code.lnk）显示为默认空白图标；
- 禁用 GPU 后图标全部加载失败；
- 所有 `.url` 显示同一个图标（含 Steam 游戏快捷方式）；
- 应用日志出现 `Failed to read shortcut link` / `NOTREACHED log messages are omitted`。

### 根本原因

1. `app.getFileIcon()` 在**禁用 GPU** 时不可靠（Electron 在 Windows 的已知问题），而本项目因为透明窗口崩溃问题经常需要 `--disable-gpu` 运行 → 图标链路直接断掉。
2. `.lnk` 的图标并不总来自 `target`，有些快捷方式显式指定了 `icon`（形如 `C:\Windows\System32\shell32.dll,167`），只取 `target` 会拿到错误图标。
3. `.url` 是 INI 文本，图标由 `IconFile` / `IconIndex` 决定；若按扩展名 `.url` 做缓存键，所有 URL 会共用同一个图标。
4. 损坏的快捷方式会让 `shell.readShortcutLink()` 抛异常，未被捕获时表现为整批图标失败。

### 解决方案

**① 建立完整回退链**（`src/main/services/icon-extractor.js` 的 `resolveFileIcon`）

```
.lnk → resolveLnkTarget() 解析 target / icon
.url → parseUrlFile()：IconFile(.ico → readIcoToDataUrl；图片 → 直接读为 data URL；其他 → 当 iconFile 继续)
     → steam:// 时再走 getSteamGameIcon()
     ↓
getFileIconViaPowerShell(iconFile)        ← Windows Shell API，不依赖 GPU
     ↓
getFileIconWithTimeout(iconFile, 3000)    ← Electron app.getFileIcon 兜底（3s 超时）
```

**② `.lnk` 目标解析双方案**（`resolveLnkTarget`）

```javascript
// 方案1：Electron API —— target 不存在时退回快捷方式自带的 icon 路径
const shortcut = shell.readShortcutLink(lnkPath);
if (shortcut) {
  const target = cleanPath(shortcut.target);
  if (target && fs.existsSync(target)) return target;
  const iconPath = parseIconPath(shortcut.icon);   // 处理 "dll,index" 格式
  if (iconPath && fs.existsSync(iconPath)) return iconPath;
}
// 方案2：PowerShell + WScript.Shell
const cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${escapePsSingleQuote(lnkPath)}').TargetPath"`;
```

`cleanPath()` 会去掉首尾引号、`file:///` 前缀并做 `decodeURIComponent`（`%20` → 空格）；`escapePsSingleQuote()` 把 `'` 转义为 `''`，防止路径中的单引号截断命令。

**③ `.url` 专项处理**（`parseUrlFile` + `resolveFileIcon`）

- `IconFile` 指向 `.ico` → `readIcoToDataUrl()` 直接输出 `data:image/x-icon;base64`（浏览器可渲染 `.ico`，不必转 PNG）；
- 指向 `jpg/png/gif/bmp/webp` → 直接读文件转对应 MIME 的 data URL；
- 其他 → 当作 `iconFile` 交给 PowerShell；
- URL 是 `steam://rungameid/<appId>` → `findSteamInstallPath()` 找 Steam 目录，再按 `steam/games/<id>.ico`、`appcache/librarycache/<id>_icon.jpg|png` 顺序取图。

**④ 缓存键区分单个快捷方式**（详见第 9 节与第 7 节）：

```javascript
(ext === '.lnk' || ext === '.url') ? filePath.toLowerCase() : (ext || 'file')
```

**⑤ 噪音异常过滤**（`src/main/index.js`）：

```javascript
process.on('uncaughtException', (err) => {
  if (err.message?.includes('shortcut link')) return;
  if (err.message?.includes('NOTREACHED')) return;
  console.error('未捕获异常:', err);
});
```

### 验证结果

| 快捷方式 | 修复前 | 修复后 |
|---------|--------|--------|
| Trae CN.lnk | ❌ 默认图标 | ✅ 正确图标 |
| Unreal Engine.lnk | ❌ 默认图标 | ✅ 正确图标 |
| Visual Studio Code.lnk | ❌ 默认图标 | ✅ 正确图标 |
| 其他 .lnk | ⚠️ 部分失败 | ✅ 全部成功 |
| 各 .url / Steam 快捷方式 | ❌ 全部同一图标 | ✅ 各自独立图标 |

### 经验总结

- Electron 图标 API 在特定条件（尤其禁用 GPU）下不可靠，**图标提取不要依赖渲染进程**；
- 快捷方式图标来源有 `target` 与 `icon` 两条，必须都尝试；
- 缓存键必须能区分「同名但不同资源」的场景。

---

## 3. 透明窗口拖动失效

### 问题现象

浮窗无法拖动：鼠标按下后移动无反应，或只能拖动极短距离后"脱离"。

### 尝试过的方案

1. 给元素加 CSS `-webkit-app-region: drag` —— 在透明窗口上不可靠；
2. 在整个 `body` 上设置 drag 区域 —— 仍不生效，且会让按钮无法点击（drag 区域吞掉点击）。

### 根本原因

`transparent: true` 的无边框窗口中，Electron/Chromium 的拖动区域命中判定存在缺陷（官方承认的已知问题），drag 区域无法稳定命中透明像素。

### 解决方案

改用**纯 JavaScript 鼠标事件 + IPC 移动窗口**（`renderer/scripts/float.js` ↔ `src/main/ipc/window.js`）：

```javascript
// 渲染进程
petBody.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true; hasMoved = false;
  mouseStartX = e.screenX; mouseStartY = e.screenY;
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const deltaX = e.screenX - mouseStartX, deltaY = e.screenY - mouseStartY;
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {   // 3px 阈值：区分"点击"与"拖动"
    hasMoved = true; mouseStartX = e.screenX; mouseStartY = e.screenY;
    window.electronAPI.moveWindow(deltaX, deltaY);
  }
});
document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  if (hasMoved) { wasSnapped = false; window.electronAPI.saveWindowPosition(); }
  // 未移动 → 单击/双击判定
});
```

```javascript
// 主进程 'move-window'：按增量移动 + 边界保护（minVisible = 60）
const bounds = floatWindow.getBounds();
let newX = bounds.x + deltaX, newY = bounds.y + deltaY;
newX = Math.max(0 - bounds.width + minVisible, Math.min(newX, workArea.width - minVisible));
newY = Math.max(0 - bounds.height + minVisible, Math.min(newY, workArea.height - minVisible));
floatWindow.setPosition(newX, newY);
```

要点：

- 用 `e.screenX/screenY` 而非 `clientX/clientY`——窗口本身在移动，client 坐标会被"自己追自己"抵消；
- 每次 `mousemove` 都用增量（算完立即更新 `mouseStartX/Y`），避免累积误差；
- **3px 阈值**很关键：没有它，单击也会被判定为拖动，双击打开文件管理就会失效；
- 拖动期间禁止恢复点击穿透（`isDragging` 参与 `enableClickThrough()` 的判断），否则拖到一半窗口收不到 `mousemove` 会"断连"。

Dock 的拖动（`renderer/scripts/dock.js` 的 `dockPanel` 监听 + `move-dock`）用同一套思路，并额外用 `dockDragging` 标志阻止拖动中恢复穿透。

---

## 4. GPU / 渲染进程崩溃与自愈

### 问题现象

- 启用 GPU：透明窗口（浮窗 / Dock）偶发闪退，`render-process-gone` 或 GPU 进程崩溃；
- 禁用 GPU：应用稳定，但 `app.getFileIcon()` 图标全部失败（见第 2 节）；
- 崩溃后窗口消失，用户必须手动重启。

### 根本原因

Electron 在「透明 + 无边框 + 置顶」窗口组合下启用 GPU 合成时存在稳定性问题；而关掉 GPU 又会破坏 Electron 的图标提取路径。两者构成一组互斥矛盾。

### 解决方案

**① 崩溃自愈：连续两次崩溃才降级重启**（`src/main/index.js`）

```javascript
let crashCount = 0;
app.on('gpu-process-crashed', () => {
  crashCount++;
  if (crashCount >= 2) {
    console.log('GPU 进程连续崩溃，重启并禁用 GPU');
    app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu'] });
    app.exit(0);
  }
});
app.on('render-process-gone', (event, webContents, details) => {
  if (details.reason === 'crashed') { crashCount++; /* 同样阈值 → 带 --disable-gpu 重启 */ }
});
```

阈值设为 2 是刻意的：单次偶发崩溃不应直接牺牲硬件加速。

**② 图标链路与 GPU 解耦**

既然可能长期以 `--disable-gpu` 运行，图标主链路就必须走 PowerShell + Windows Shell API（`getFileIconViaPowerShell`），仅把 `app.getFileIcon` 留作最后兜底（还加了 3 s 超时，避免拖住 `get-file-icon` 返回的 Promise）。

**③ 提取全程异步、绝不阻塞主进程**

`icon-extractor.js` 中所有拉起外部进程的路径都用异步 `exec(..., { timeout: 8000 }, cb)`（`getFileIconViaPowerShell`），Electron 兜底用带 3 s 定时器的 `getFileIconWithTimeout`；主进程不设置任何并发池，压力控制交给渲染进程的分批加载（每批 3 个 + 50 ms 间隔 + 同批去重，见第 12 节）。

> 历史上曾有一版主进程侧的并发闸门（`iconPending` / `MAX_CONCURRENT` / `drainIconPending`），但它从未被任何代码调用，属死代码，已在 1.1.0 清理中删除。

### 经验总结

- 桌面端"稳定优先"：宁可用软件回退方案（PowerShell）也不要让核心功能依赖 GPU；
- 自愈重启要带阈值与明确日志，否则会掩盖真实问题；
- 外部进程调用一律异步 + 超时；压力控制优先级：渲染侧分批 > 主进程并发池（后者容易变成没人调用的死代码）。

---

## 5. 任务栏与桌面图标显隐

### 问题现象

Dock 提供「隐藏系统任务栏」「隐藏桌面图标」两个开关，但初版实现有两个问题：

1. 任务栏隐藏后如果应用崩溃/被杀，任务栏永久消失，用户只能重启资源管理器；
2. 桌面图标开关用「记住自己点了几次」的方式维护状态，与系统真实状态（用户按 F5、其他软件改动、开机恢复）不同步，出现"按钮显示隐藏、实际已显示"的错乱。

### 根本原因

- 任务栏：`ShowWindow(Shell_TrayWnd, 0)` 是全局系统副作用，进程异常退出时没有恢复机会；
- 桌面图标：`SHELLDLL_DefView` 的真实状态**不在窗口里**，而在注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced\HideIcons`；且 Win11 下 `SHELLDLL_DefView` 是 **WorkerW 的子窗口**（Win10 是 `Progman` 的子窗口），只找 `Progman` 会失败。

### 解决方案

**① 任务栏**（`src/main/ipc/system.js` 的 `toggle-taskbar`）

```powershell
Add-Type -Namespace W -Name T -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
$h = [W.T]::FindWindow("Shell_TrayWnd", $null)
if ($h -ne [IntPtr]::Zero) { [W.T]::ShowWindow($h, 0) }   # 0 = 隐藏，5 = 显示
```

- 状态持久化到 `config.hideSystemTaskbar`（`get-taskbar-hidden` 读取）；
- **无条件兜底恢复**：`src/main/index.js` 的 `restoreTaskbar()` 在 `app.on('will-quit')` 时执行 `ShowWindow(h, 5)`。正常退出、崩溃退出（Electron 仍能走 `will-quit` 时）都会恢复任务栏。

**② 桌面图标**（`toggle-desktop-icons` + `get-desktop-icons-hidden`）

```powershell
# 枚举 WorkerW / Progman，在其子窗口中找 SHELLDLL_DefView
EnumWindows → GetClassName ∈ {WorkerW, Progman} → EnumChildWindows → 找 SHELLDLL_DefView
SendMessage(defView, 0x0111 /* WM_COMMAND */, (IntPtr)0x7402, IntPtr.Zero)   # 切换
```

```javascript
// 真实状态永远从注册表读，而不是自己记账
async function getDesktopIconsHiddenReal() {
  const out = await runPowershell(
    `(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'HideIcons' -ErrorAction SilentlyContinue).HideIcons`
  );
  return out === '1';
}
```

- `toggle-desktop-icons` 切换后**重新读注册表**再返回 `{ success, hidden }`；
- Dock 右键菜单在创建前先 `await getDesktopIconsHidden()`（`renderer/scripts/dock.js` 的 `showDockAreaContextMenu`），菜单文案才是真实状态。

### 经验总结

- 对系统全局状态做「开关」时，一定要有退出兜底；
- 不要自己维护系统状态的影子副本，能读真实来源就读真实来源；
- Windows 同一逻辑窗口在不同版本层级不同（Win10 `Progman` vs Win11 `WorkerW`），枚举要兼容两者。

---

## 6. 音量控制 dll 编译被杀软拦截

### 问题现象

- 早期实现（启动时编译音量 dll）导致：启动明显变慢、`csc.exe` 长时间占用 CPU；
- 部分机器上杀毒软件弹窗告警/直接拦截 `csc.exe` 生成的临时 dll，音量功能永久失效（`compile failed`）；
- 接口改动后仍加载旧 dll，行为与新代码不一致。

### 根本原因

音量功能通过 Windows Core Audio API（`IAudioEndpointVolume`）实现，Node/Electron 侧没有直接绑定，只能在运行时把内联 C# 源码用 `csc.exe` 编译成 dll 再由 PowerShell 加载。而「进程运行时编译并加载代码」正是杀软的启发式敏感行为；若放在应用启动阶段，影响面最大（每次启动都触发）。

### 解决方案

**① 不在启动时编译，改为首次使用时按需编译**（`src/main/ipc/system.js` 的 `compileAudioDllAsync` + `runAudioCommand`）

```javascript
// runAudioCommand 内：仅当 dll 不存在时才编译
if (!fs.existsSync(AUDIO_DLL)) {
  const ok = await compileAudioDllAsync();
  if (!ok) { resolve({ success: false, error: 'compile failed' }); return; }
}
```

`src/main/index.js` 的 `whenReady` 中留了明确注释：启动时不调用 `csc.exe`，避免杀软对「运行时编译代码」的启发式拦截导致启动卡顿/CPU 占满。

**② 编译产物放临时目录并带版本号**

```javascript
const AUDIO_VER = 'v2';
const AUDIO_DLL = path.join(os.tmpdir(), `trae_audio_control_${AUDIO_VER}.dll`);
const AUDIO_CS  = path.join(os.tmpdir(), `trae_audio_control_${AUDIO_VER}.cs`);
// 编译命令：csc /nologo /target:library /out:"<dll>" "<cs>"，timeout 20000
```

版本号参与文件名 → 接口变更只要改 `AUDIO_VER` 就会重新编译，绝不会复用旧 dll。

**③ 编译与调用都异步、不阻塞主进程**

`findCsc()` 依次探测 `Framework64` 与 `Framework` 下的 `v4.0.30319\csc.exe`；编译与执行都是 `exec(..., callback)` 的 Promise 包装。

**④ 调用侧用 base64 下发脚本**（避免引号/中文转义问题）

```javascript
const script = `Add-Type -Path '${AUDIO_DLL}';[AudioVolumeControl]::SetVolume([single]${value})`;
const encoded = Buffer.from(script, 'utf16le').toString('base64');
exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 8000 }, cb);
```

**⑤ 渲染侧节流**：Dock 音量滑块的 `input` 事件做 250 ms 防抖后才真正 `set-volume`，避免拖动时反复拉起 PowerShell 进程。

**⑥ 失败不致命**：编译失败只让音量接口返回 `{ success:false, error:'compile failed' }`，Dock 侧 `loadVolume()` 只 `console.warn`，不影响其他功能。

### 经验总结

- 运行时编译型方案要「懒执行 + 可见失败」；
- 临时产物放 `os.tmpdir()`，用版本号命名实现天然失效；
- 任何会拉起外部进程的功能都必须做防抖与并发控制。

---

## 7. 图标缓存损坏

### 问题现象

- 某些图标显示为破图 / 空白，重启也不恢复；
- `icon-cache.json` 里出现 `null`、空字符串、`undefined` 之类的值；
- 极端情况下 `icon-cache.json` 被写坏（JSON 解析失败），此后**所有**图标都加载不出来；
- 缓存文件体积不断膨胀。

### 根本原因

1. 早期实现直接把提取结果写进缓存，没有校验返回值；提取失败时存进 `null`/空串，之后每次命中都返回无效数据（永远不会重新提取）；
2. 缓存写盘用 `fs.writeFileSync(iconCachePath, ...)` 直写，进程在写一半时被杀就会留下半截 JSON；
3. 没有容量上限。

### 解决方案

**① 读盘时逐条校验，脏数据直接丢弃**（`src/main/services/icon-cache.js` 的 `loadIconCache`）

```javascript
for (const [key, val] of Object.entries(data)) {
  if (val && typeof val === 'string' && val.startsWith('data:image/')) {
    iconCache.set(key, val); loadedCount++;
  } else { filteredCount++; }        // null / 空串 / 半截数据统统过滤
}
console.log('加载图标缓存:', loadedCount, '个, 过滤无效:', filteredCount, '个, 路径:', iconCachePath);
```

**② JSON 解析失败不崩溃**：整个 `try/catch` 包住，失败时只打日志并把 `iconCachePath` 置为 `null`（等于本次运行不再写盘，避免继续污染文件），下次启动重新尝试。

**③ 只缓存成功结果**：写入发生在 `src/main/ipc/icons.js` 的 `get-file-icon` 中，且只有 `resolveFileIcon()` 返回非空才写：

```javascript
const result = await resolveFileIcon(filePath);
if (result) { iconCache.set(cacheKey, result); scheduleSaveIconCache(); broadcastIconUpdated(cacheKey, result); }
return result;                       // 失败返回 null，下次仍会重新提取
```

**④ 原子替换写盘 + 5 MB 上限**

```javascript
if (totalSize + entrySize > 5 * 1024 * 1024) break;   // 超限截断，不再写新条目
const tmp = iconCachePath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
fs.renameSync(tmp, iconCachePath);                    // 原子替换，杜绝半截文件
```

**⑤ 延迟落盘合并写入**：`scheduleSaveIconCache()` 用 `setTimeout(saveIconCache, 5000)` 并重置计时器，一次批量提取只写一次盘；`window-all-closed` / `will-quit` 时再强制 `saveIconCache()` 兜底。

**⑥ 增量通知代替整批重取**：提取成功后 `broadcastIconUpdated()` 向所有窗口发 `icon-updated`，渲染侧只替换命中元素（`renderer/scripts/file-manager.js` 的 `onIconUpdated`），不再清空整批缓存重新拉取。

### 手动清理方式

删除缓存文件即可（下次启动自动重建）：

- 开发环境：`<项目根>\icon-cache.json`
- 打包后：`<exe 所在目录>\icon-cache.json`

也可以用设置窗口的「图标管理 → 重置」调用 `saveNavItems(null)` 重置导航项，或直接删除 `%APPDATA%\floating-file-manager\config.json` 重置全部配置。

### 经验总结

- 缓存必须有**校验**（格式前缀）、**上限**（5 MB）与**原子写**；
- 失败结果绝不能进缓存，否则会形成"永久坏图"。

---

## 8. 点击穿透导致按钮点不到

### 问题现象

启用点击穿透（透明区域鼠标穿透到桌面）后，出现类问题：

- 桌宠上的功能环按钮、模态框按钮点不动，鼠标直接"穿过"到桌面；
- 模态框能弹出来但按钮无响应，只能强行关掉应用；
- Dock 的右键菜单/音量浮层点击就消失；
- 拖动浮窗时鼠标一离开桌宠区域就"断连"，窗口停在半路；
- 拖到边缘贴边后，鼠标移入不弹出。

### 根本原因

点击穿透是**窗口级**状态（`setIgnoreMouseEvents(true)`），而非元素级。一旦开启，整个窗口都不接收鼠标事件；此时任何"元素级"的限制（CSS `pointer-events`、`z-index`）都无效。两个典型踩坑：

1. 只在初始化时开启穿透，却没在「进入内容区」时关闭 → 所有按钮都点不到；
2. 关闭穿透的时机没考虑浮层状态（菜单打开、模态框打开、拖动进行中），出现"刚打开就被恢复穿透"。

### 解决方案

**① 默认穿透，但 `forward: true` 保留鼠标移动事件**

```javascript
// renderer/scripts/float.js / dock.js 初始化
window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
```

`forward: true` 让窗口在穿透状态下**仍能收到 `mousemove`**，这是能判断"鼠标是否进入可见内容区"的前提。

**② 进入内容区立即关闭穿透，离开才恢复**

```javascript
function enableMouseCapture() { window.electronAPI.setIgnoreMouseEvents(false); }
function enableClickThrough() { window.electronAPI.setIgnoreMouseEvents(true, { forward: true }); }

petBody.addEventListener('mouseenter', () => { enableMouseCapture(); /* 贴边弹出逻辑 */ });
petBody.addEventListener('mouseleave', () => {
  if (!menuOpen && !quitOpen && !modalActive && !isDragging) enableClickThrough();
});
```

Dock 侧用 `dockContainer` 的 `mouseover` / `mouseleave`（容器含面板与浮层）。

**③ 用状态标志抑制"误恢复穿透"**（关键修复）

| 页面 | 抑制标志 | 说明 |
|-----|---------|------|
| 浮窗 | `menuOpen` / `quitOpen` | 功能环或退出环打开时不恢复 |
| 浮窗 | `modalActive` | 模态框打开期间保持捕获，确保按钮可点 |
| 浮窗 | `isDragging` | 拖动中不恢复，避免 `mousemove` 丢失导致断连 |
| Dock | `openContextMenus > 0` | 右键菜单打开期间不恢复（菜单定位前先计数，避免竞争） |
| Dock | `activePopup` | 音量/WiFi 浮层显示期间不恢复 |
| Dock | `dockDragging` | 拖动 Dock 期间不恢复 |

**④ 主进程用事件来源窗口，天然隔离**

```javascript
// src/main/ipc/window.js 的 'set-ignore-mouse-events'
const win = BrowserWindow.fromWebContents(event.sender);
win.setIgnoreMouseEvents(ignore, opts);
```

浮窗与 Dock 各自控制自己的窗口状态，互不影响。

**⑤ 浮层/菜单打开期间禁止"鼠标一离开就关"**：Dock 的 `positionMenuAtMouse` 在创建菜单前先 `openContextMenus++` 并 `expandForMenu()`，再 `await 100ms` 等窗口扩展完成；菜单关闭时才 `--` 并 `restoreAfterMenu()`。否则窗口扩容的瞬间 `mouseleave` 会立刻把菜单关掉。

### 经验总结

- 点击穿透是窗口级开关，必须有清晰的"何时开、何时关"状态机；
- 任何异步/延迟操作（弹菜单、扩窗口、模态框）之前，先把穿透**关掉并计数**，操作彻底结束后再恢复；
- 拖动期间永远不要恢复穿透。

---

## 9. 图标提取链路的历史问题（已修复）

这一节记录 1.1.0 中修复的图标相关缺陷，避免二次开发者重踩。

### 9.1 兜底调用不存在的函数

**现象**：PowerShell 提取路径"看起来执行了"，但图标始终走不到。

**根因**：`resolveFileIcon` 的兜底分支调用了一个并不存在的函数 `extractIconToDataUrl`，抛错后整条链路静默失败。

**修复**：统一为 `icon-extractor.js` 中真实导出的 `iconToDataUrl(icon)`（内部用 `icon.toPNG()`，并校验尺寸 ≥ 8×8、buffer ≥ 50 字节）。

### 9.2 `icon-updated` 从未发送 + 缓存键不一致

**现象**：首屏图标加载后，后续提取出的图标永远不刷新；日志显示事件已"发出"但渲染层匹配不上。

**根因**：
1. 主进程从未真正调用广播函数；
2. 两端的缓存键算法不一致（渲染侧曾出现双重转义），即便收到事件也匹配不到元素。

**修复**：
- `src/main/ipc/icons.js` 中新增并在提取成功后调用 `broadcastIconUpdated(cacheKey, dataUrl)`，向 `BrowserWindow.getAllWindows()` 广播 `icon-updated`（目前只有文件管理窗口注册了监听，其余窗口收到即忽略）；
- 明确规定主进程 `getIconCacheKey(filePath)` 与渲染进程 `getIconCacheKeyByName(name, filePath)` **必须严格一致**，并兼容磁盘上既有的 `icon-cache.json` 格式：

```javascript
// 两端一致：.lnk/.url 按完整路径小写，其余按带点扩展名，无扩展名为 'file'
(ext === '.lnk' || ext === '.url') ? filePath.toLowerCase() : (ext || 'file')
```

- 渲染侧 `onIconUpdated` 改为**增量替换命中元素**，不再整批清空缓存重取。

> ⚠️ 维护提醒：以后改动任一端的缓存键逻辑，必须同步另一端，否则会重演"图标不刷新"。

### 9.3 「图标辅助隐藏窗口」子系统的移除

**现象**：早期存在第二条图标提取实现（隐藏的辅助 `BrowserWindow`），但它从未真正工作过，也从未被调用。

**根因**：
1. 该页面的内联 `<script>` 被自身 CSP（`script-src 'self'`）静默拦截 —— `renderer/scripts/icon-helper.js` 的注释里也记录了这一点；
2. 通道 `helper-get-file-icon` / `helper-native-get-file-icon` / `helper-return-file-icon` 全是重复实现，且没有缓存；
3. 全仓库无任何调用方。

**修复（1.1.0）**：整条子系统移除，图标提取**统一走 `get-file-icon`** → `resolveFileIcon`。

**当前仓库中的三个残留文件**（都已废弃、**不再被任何窗口加载，可以安全删除**；保留空壳只是因为该工作区目录权限受限、删除操作被拒）：

| 文件 | 现状 |
|-----|------|
| `renderer/icon-helper.html` | 已废弃，仅剩说明性注释 |
| `renderer/icon-helper-preload.js` | 已废弃，仅剩说明性注释 |
| `renderer/scripts/icon-helper.js` | 已废弃，不再被任何页面加载 |

> 这三个文件都不是可用 API 参考。二次开发者请只看 `src/main/ipc/icons.js`（通道）与 `src/main/services/icon-extractor.js`（实现）。

### 9.4 设置窗口样式回调抛 ReferenceError

**现象**：收到 `opacity` / `blurIntensity` 事件时设置窗口报 `ReferenceError`，预览失效。

**根因**：样式同步回调引用了未定义的变量。

**修复**：设置窗口的样式管线统一为 `buildDockStyle()` → `pushStyleToDock()`（`apply-dock-style` 通道）→ Dock 的 `applyDockStyle()`，参数全部来自显式的 `currentSettings` 对象。

---

## 10. 浮窗模态框 / Dock 浮层显示不全

### 问题现象

- 浮窗只有 160×160，重名覆盖确认框弹出来被裁掉一半，按钮点不到；
- Dock 的右键菜单/音量浮层显示到窗口外面（被裁切），或菜单在窗口扩容后位置错乱。

### 根本原因

两个窗口都是**按最小内容尺寸**创建的透明窗口（浮窗 160×160、Dock 初始 800×200 且随内容自适应）。弹出更大的 UI 时窗口本身没有放大，超出部分直接被裁掉。

### 解决方案

**① 浮窗：临时扩容 + 还原**

```javascript
// 渲染侧（renderer/scripts/float.js 的 showModal）
await window.electronAPI.expandFloatWindow(420, 320);
// ... 模态框交互 ...
window.electronAPI.restoreFloatWindow();
```

```javascript
// 主进程（src/main/ipc/window.js）
// 'expand-float-window'：以浮窗中心为中心扩展，workArea 内钳制；
// setResizable(true) → setBounds → setResizable(false)；
// 用 savedFloatBounds 保存原边界，重复调用直接返回（不覆盖）
// 'restore-float-window'：还原到 savedFloatBounds
```

**② Dock：向上扩展 + 按内容自适应**

- 菜单/浮层：`resizeDockWindow(panelWidth, 380)`（`resize-dock-window` 保持「中心 X + 底部 Y」不变）；
- 浮层专用：`expand-dock-window`（用 `savedDockBounds` 保证**底部不变、向上扩展**）/ `restore-dock-window`；
- 关闭后 `restoreAfterMenu()` → `autoFitDockWindow()` 重新按内容计算窗口尺寸。

**③ 菜单坐标：用 screen 坐标记录 + client 换算**

窗口扩容后 client 坐标会失效，因此右键时记录 `e.screenX/screenY`，再通过 `get-dock-bounds` 换算：

```javascript
// renderer/scripts/dock.js
const bounds = await window.electronAPI.getDockBounds();   // 'get-dock-bounds'
clientX = screenX - bounds.x;  clientY = screenY - bounds.y;
```

并在创建菜单前先 `expandForMenu()` + `await 100ms` 等扩容完成，避免先出现在错误位置再"跳一下"。

### 经验总结

小尺寸透明窗口承载大 UI 必须显式扩容，并且扩容前要保存原边界、扩容后要还原；任何依赖窗口尺寸的坐标计算，都要在扩容**之后**进行。

---

## 11. 浮窗吸附 Dock 位置不准

### 问题现象

浮窗靠近 Dock 后吸附的位置"悬空"或嵌进 Dock 面板里，宠物看起来并没有贴住 Dock 边框；Dock 移动后浮窗停留在原处。

### 根本原因

Dock 是**透明大窗口**（初始 800×200，加载后按内容自适应），可见的 `.dock-panel` 只占窗口的一部分。直接用 `dockWindow.getBounds()` 当作吸附目标，会把透明边距也算进去，导致浮窗吸附到"看不见的窗口边缘"。

### 解决方案

**① 渲染侧上报真实渲染边界**

```javascript
// renderer/scripts/dock.js 的 reportPanelOffset()（在 autoFitDockWindow 之后调用）
const rect = dockPanel.getBoundingClientRect();
window.electronAPI.reportDockPanelOffset({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
```

**② 主进程换算成屏幕坐标**（`src/main/ipc/window.js`）

```javascript
function getDockPanelScreenBounds() {
  const dk = dockWin.getBounds();
  if (!dockPanelOffset) return dk;            // 未上报时回退窗口边界
  return { x: dk.x + (dockPanelOffset.left || 0), y: dk.y + (dockPanelOffset.top || 0),
           width: dockPanelOffset.width, height: dockPanelOffset.height };
}
```

**③ 吸附判定与视觉补偿**（`save-window-position`）

- `snapDist = 50`：浮窗距 Dock 面板边 50px 内触发吸附；
- `snapInsetTop/Bottom/Left/Right = 52`：浮窗窗口 160 与宠物视觉约 90 的差值一半，让**宠物视觉**贴紧边框而不是窗口贴紧；
- 仅在 `x` 方向有重叠时考虑上下吸附、`y` 方向有重叠时考虑左右吸附，避免斜角误吸；
- 屏幕边缘贴边优先级更高：只有未触发贴边时才尝试吸附 Dock。

**④ 记录吸附关系并跟随移动**

```javascript
floatSnapToDock = { side: snapped, offsetX: newX - dk.x, offsetY: newY - dk.y };
// move-dock 中：浮窗按实际位移 actualDx/actualDy 一起移动
```

同时通过 `dock-snap-changed` 把朝向推给渲染进程，让宠物底部朝向 Dock 边框（`dock-top` / `dock-bottom` / `dock-left` / `dock-right` 的旋转动画）。

### 经验总结

透明窗口的"可见边界"必须由渲染进程上报，主进程不能假设窗口边界等于可见边界；视觉补偿量（inset）要与窗口尺寸、宠物视觉尺寸一起标定。

---

## 12. 启动卡顿与图标批量加载

### 问题现象

- 打开文件管理器明显卡顿、滚动不流畅；
- 目录里文件多时，图标"卡住"很久才开始逐个出现；
- 早期版本启动就慢（见第 6 节音量 dll）。

### 根本原因

1. 图标提取曾同步执行（`execSync` 形式阻塞主进程），主进程一卡，所有窗口都失去响应；
2. 一次性把所有文件的图标请求全部发出，同时拉起大量 PowerShell 进程；
3. 没有加载态，用户以为程序卡死。

### 解决方案

**① 提取一律异步、带超时**

- `getFileIconViaPowerShell()` 用 `exec(..., { timeout: 8000 }, cb)`，绝不用 `execSync` 提取图标（仅 `resolveLnkTarget` 的 PowerShell 回退用 `execSync`，且有 3 s 超时）；
- `getFileIconWithTimeout(iconFile, 3000)` 给 Electron 兜底路径加超时，避免 `get-file-icon` 的 Promise 长期悬挂。

**② 压力控制放在渲染进程（每批 3 个 + 50ms 间隔 + 同批去重）**

```javascript
// renderer/scripts/file-manager.js 的 processIconQueue()
while (batch.length < 3 && iconLoadQueue.length > 0) {
  const item = iconLoadQueue.shift();
  if (seen.has(item.iconKey)) continue;               // 同批按缓存键去重（同扩展名只取一次）
  if (iconDataUrlCache.has(item.iconKey)) { /* 直接套用缓存 */ continue; }
  seen.add(item.iconKey); batch.push(item);
}
batch.forEach(item => item.iconEl.classList.add('loading'));    // 加载态
Promise.all(...).finally(() => { if (iconLoadQueue.length) setTimeout(processIconQueue, 50); });
```

> 主进程侧没有并发池。历史上曾有一版 `iconPending` / `MAX_CONCURRENT = 5` / `drainIconPending()`，但它从未被任何代码调用（死代码），已在 1.1.0 清理中删除；真正的节流点是上面的渲染进程队列 + 主进程的 3~8 s 超时。

**③ 加载态动画**（`renderer/styles/file-manager.css` / `float.css`）：

```css
.file-icon.loading { opacity: 0.5; animation: pulse 1s ease-in-out infinite; }
```

**④ 目录项不入队**：`renderFiles()` 只对非目录项请求图标，目录直接用内置 SVG（`getFileIcon()` 中的 folder 分支）。

**⑤ 缓存优先**：命中 `iconDataUrlCache` 或主进程 `iconCache` 的条目直接套用，不发起 IPC。

**⑥ 启动阶段不做重活**：`src/main/index.js` 的 `whenReady` 只做「建保存目录 → 载入图标缓存 → 恢复窗口状态 → 建浮窗 → 按需显示 Dock」，音量 dll 编译推迟到首次使用。

**⑦ Dock 渲染防竞争**：`renderer/scripts/dock.js` 用 `renderingLock` + `pendingRender` 防止并发渲染导致闪烁与重复图标；`autoFitDockWindow()` 在 `requestAnimationFrame` 中读取真实渲染尺寸后再 `resizeDockWindow`。

### 经验总结

主进程禁止同步阻塞（尤其是拉起外部进程）；批量任务要分批 + 去重 + 间隔，并给出加载反馈；压力控制优先放在真正发起请求的一侧。

---

## 13. 文件操作细节坑

### 13.1 复制 `.lnk` 报 EPERM

**现象**：上传/复制快捷方式时 `fs.copyFileSync` 抛 `EPERM`。

**根因**：Windows 对 `.lnk` 有特殊的 shell 处理（部分环境/策略下 Defender 会短暂持有句柄），`copyFileSync` 走的内核复制路径容易失败。

**修复**（`src/main/ipc/files.js` 的 `upload-file` 与 `upload-folder` 的 `copyFolderRecursive`）：

```javascript
const isLnk = fileName.toLowerCase().endsWith('.lnk');
if (isLnk) {
  const content = fs.readFileSync(sourcePath);       // 先读成 Buffer
  fs.writeFileSync(finalDestPath, content);          // 再写出，绕开 copyFileSync
} else {
  fs.copyFileSync(sourcePath, finalDestPath);
}
```

### 13.2 删除/上传后文件列表不刷新

**现象**：从浮窗拖文件上传后，已经打开的文件管理窗口看不到新文件；删除后列表里仍在。

**根因**：文件管理器只在自身操作后重新 `loadFiles()`，浮窗（另一个窗口）的操作它并不知道。

**修复**：主进程在文件变更后主动通知（`src/main/ipc/files.js` 的 `notifyFilesChanged()`）：

```javascript
fmWindow.webContents.send('files-changed', { dir: destDir });
```

渲染侧（`renderer/scripts/file-manager.js` 的 `onFilesChanged`）比较规范化路径（去尾部斜杠 + 小写），一致则清空图标缓存并重新加载。

**删除的额外处理**：`shell.trashItem` 是异步的，删除后先 `await 200ms` 再通知，否则列表可能在回收站操作完成前就刷新，导致已删项仍显示（`delete-file` 中的 `setTimeout` 等待）。

### 13.3 重名覆盖流程

所有上传/移动入口统一用「先探测 duplicate → 弹自定义模态框 → 用户选覆盖时再执行（覆盖 = 带 `overwrite: true` 重传，或先 `delete-file` 再重试）」的模式：

- `upload-file` 返回 `{ success:false, duplicate:true, destPath }`；
- 文件覆盖：`uploadFile({ ..., overwrite: true })`；
- 文件夹/移动覆盖：先 `deleteFile(destPath)` 再重试原操作（`renderer/scripts/file-manager.js` 的多个 `drop` 处理分支）。

### 13.4 移动文件跨盘失败

`move-file` 用 `fs.renameSync(sourcePath, destPath)`，仅支持**同一卷**内的移动；跨盘会抛 `EXDEV` 并被 catch，返回 `{ success:false, error }`（UI 弹「移动失败」）。如需跨盘移动，应改为「复制 + 删除」实现。

### 13.5 不需要图标的地方别请求图标

`get-file-icon` 对目录直接返回 `null`（`isDirectory` 为真时短路），所以即使渲染侧误传目录也只会拿到 `null`，不会白跑一次 PowerShell。

---

## 14. 开发环境沙箱限制

### 问题现象

```
TRAE Sandbox Error: hit restricted
Lock file can not be created! Error code: 5
```

应用启动即失败，或配置无法写入。

### 根本原因

受限环境（沙箱/受管 IDE 终端）不允许向系统目录（如 `%APPDATA%`）写入 Electron 的 userData 与锁文件。

### 解决方案

**① 开发态把 userData 重定向到项目内**（`src/main/config.js` 模块顶层）

```javascript
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(rootDir, '.userdata');
  if (!fs.existsSync(devDataDir)) fs.mkdirSync(devDataDir, { recursive: true });
  app.setPath('userData', devDataDir);
}
```

**② 在外部终端运行**（不受 IDE 沙箱限制）：

```powershell
cd "D:\04project\MyProject\浮窗文件管理1.0.0"
npx electron .            # 或 npm start
npm run build             # 打包
```

**③ 数据目录位置速查**

| 环境 | 配置 | 图标缓存 |
|-----|------|---------|
| 开发 | `<项目根>\.userdata\config.json` | `<项目根>\icon-cache.json` |
| 打包后 | `%APPDATA%\floating-file-manager\config.json` | `<exe 所在目录>\icon-cache.json` |

两者都在 `.gitignore` 中，可以随时删除以恢复默认状态（设置窗口「关于 → 打开配置文件夹」调 `open-config-folder` 也能直接定位）。

**④ 该限制也会影响「删除文件」**：本工作区目录权限受限时，删除操作（包括删除已废弃的 `renderer/icon-helper.*` 三个残留文件）会被拒绝，因此只能保留说明性注释的空壳文件。

---

## 问题分类汇总

| 类别 | 涉及章节 | 关键教训 |
|-----|---------|---------|
| Electron API 限制 | 2、3、4、10 | 透明窗口不用 `-webkit-app-region`；图标不依赖 GPU；小窗口承载大 UI 要扩容 |
| 文件 IO | 1、7、13 | 低频写入 + 重试 + 原子替换；`.lnk` 用 Buffer 复制；删除后延迟再通知 |
| 缓存设计 | 2、7、9 | 缓存键要能区分资源且**两端一致**；校验 + 上限 + 原子写；失败结果不入缓存 |
| 异步与性能 | 4、6、12 | 主进程禁止同步阻塞；外部进程要限并发 + 超时 + 防抖；压力控制放在发起请求的一侧 |
| 系统集成 | 5、6 | 全局开关要有退出兜底；系统状态优先读真实来源；Win10/Win11 窗口层级差异 |
| 交互状态机 | 8、11 | 点击穿透要有明确开关时机与抑制标志；透明窗口的可见边界需渲染进程上报 |
| 开发环境 | 14 | 项目内数据目录 + 外部终端运行；受限目录下删除会被拒（残留文件只能保留空壳） |

---

## 最佳实践

1. **透明窗口**：用 JS 鼠标事件 + IPC 拖动，不用 `-webkit-app-region`；点击穿透按"进入/离开内容区"开关，并用状态标志抑制误恢复。
2. **文件写入**：低频 + 3 次重试 + `.tmp` 原子替换；所有写配置统一走 `src/main/config.js` 的 `saveConfig`。
3. **图标获取**：主链路 PowerShell + Windows Shell API，Electron `app.getFileIcon` 仅作兜底；缓存键两端严格一致，提取成功才写缓存。
4. **性能**：异步 + 超时（3~8s）+ 渲染侧批量（3 个/批、50ms 间隔、同批去重）+ 缓存；不要在两侧都堆并发控制。
5. **系统级操作**：一律通过 base64 `-EncodedCommand` 下发 PowerShell（规避引号/中文转义），路径拼进脚本前必须 `escapePsSingleQuote`。
6. **窗口几何**：所有尺寸/位置变更遵循 `setResizable(true)` → `setBounds` → `setResizable(false)`，并保存原边界以便还原。
7. **外部进程型功能**：懒执行 + 版本化临时产物 + 失败可见但不致命。
8. **IPC 契约**：新增/删除通道时保持 `preload.js` 与主进程 85↔85 的对称，避免出现调用即 reject 的孤立通道。

---

## 问题排查流程

```
发现问题
    │
    ▼
查看控制台输出（主进程 console / DevTools）
    │
    ├─ 有错误信息 → 定位到具体模块（src/main/ipc/*、services/*、renderer/scripts/*）
    │
    └─ 无错误信息 → 在关键分支加 console.log → 复现
    │
    ▼
分类根因
    │
    ├─ Electron/系统 API 限制 → 换实现（如 PowerShell 提取、JS 拖动）
    ├─ 文件/权限问题       → 检查路径、重试与原子替换（EPERM）
    ├─ 进程/生命周期问题    → 检查崩溃自愈、退出兜底、缓存落盘时机
    ├─ 交互状态问题        → 检查穿透开关、标志位、事件时序
    └─ 性能问题            → 检查同步调用、请求批量与缓存
    │
    ▼
实施修复（优先复用已有基础设施：saveConfig / scheduleSaveIconCache / escapePsSingleQuote / 窗口扩容接口）
    │
    ▼
验证
    │
    ├─ 通过 → 清理调试日志 → 更新本文档与 CHANGELOG.md
    └─ 未通过 → 回到"分类根因"
```

---

## 相关文档

- `README.md` — 功能总览与快速开始
- `CHANGELOG.md` — 1.1.0 的修复与移除记录（本文第 9 节的来源）
- `docs/TECHNICAL_GUIDE.md` — 模块划分、IPC 通道、缓存与窗口机制
- `docs/PROJECT_GUIDE.md` — 项目指南与二次开发

> `docs/TROUBLESHOOTING.md` 与 `docs/specs/` 已不存在，其内容已并入本文档。

---

*文档版本：v1.1.0 · 引用方式：文件路径 + 函数名/通道名（不含行号）*
