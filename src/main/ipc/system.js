const { ipcMain, shell } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 音量控制辅助：首次编译C#到临时dll缓存，后续直接加载dll，避免每次重新编译
// 使用版本号避免接口变更后使用旧的dll
const AUDIO_VER = 'v2';
const AUDIO_DLL = path.join(os.tmpdir(), `trae_audio_control_${AUDIO_VER}.dll`);
const AUDIO_CS = path.join(os.tmpdir(), `trae_audio_control_${AUDIO_VER}.cs`);

const AUDIO_CS_CODE = `
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF7407826A7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out uint pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute(bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}

[ComImport, Guid("D667063F-1597-4e43-80BE-AC4025E6FB4D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int dwStateMask, out object ppCollection);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorClass {}

public static class AudioVolumeControl {
  static IAudioEndpointVolume GetEndpoint() {
    IMMDeviceEnumerator devEnum = (IMMDeviceEnumerator)new MMDeviceEnumeratorClass();
    IMMDevice dev;
    devEnum.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object obj;
    dev.Activate(ref iid, 0, IntPtr.Zero, out obj);
    return (IAudioEndpointVolume)obj;
  }
  public static float GetVolume() {
    IAudioEndpointVolume ep = GetEndpoint();
    float vol; ep.GetMasterVolumeLevelScalar(out vol); return vol;
  }
  public static void SetVolume(float vol) {
    IAudioEndpointVolume ep = GetEndpoint();
    ep.SetMasterVolumeLevelScalar(vol, Guid.Empty);
  }
  public static bool GetMute() {
    IAudioEndpointVolume ep = GetEndpoint();
    bool mute; ep.GetMute(out mute); return mute;
  }
  public static void SetMute(bool mute) {
    IAudioEndpointVolume ep = GetEndpoint();
    ep.SetMute(mute, Guid.Empty);
  }
}
`;

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

// 异步编译dll，不阻塞主进程
function compileAudioDllAsync() {
  return new Promise((resolve) => {
    const csc = findCsc();
    if (!csc) { resolve(false); return; }
    try { fs.writeFileSync(AUDIO_CS, AUDIO_CS_CODE, 'utf8'); } catch (e) { resolve(false); return; }
    exec('"' + csc + '" /nologo /target:library /out:"' + AUDIO_DLL + '" "' + AUDIO_CS + '"', { timeout: 20000 }, (err) => {
      resolve(!err && fs.existsSync(AUDIO_DLL));
    });
  });
}

function runAudioCommand(action, value) {
  return new Promise(async (resolve) => {
    // 如果dll不存在，先异步编译（不阻塞主进程）
    if (!fs.existsSync(AUDIO_DLL)) {
      const ok = await compileAudioDllAsync();
      if (!ok) { resolve({ success: false, error: 'compile failed' }); return; }
    }

    let script;
    if (action === 'get') {
      script = `Add-Type -Path '${AUDIO_DLL}';$v=[int][Math]::Round([AudioVolumeControl]::GetVolume()*100);$m=[AudioVolumeControl]::GetMute();Write-Output "$v|$m"`;
    } else if (action === 'set') {
      script = `Add-Type -Path '${AUDIO_DLL}';[AudioVolumeControl]::SetVolume([single]${value})`;
    } else if (action === 'mute') {
      script = `Add-Type -Path '${AUDIO_DLL}';[AudioVolumeControl]::SetMute([bool]::Parse('${value}'))`;
    } else if (action === 'toggle') {
      script = `Add-Type -Path '${AUDIO_DLL}';$m=[AudioVolumeControl]::GetMute();[AudioVolumeControl]::SetMute(-not $m);Write-Output ((-not $m).ToString())`;
    } else {
      resolve({ success: false, error: 'unknown action' });
      return;
    }
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 8000 }, (err, stdout) => {
      if (err) { resolve({ success: false, error: err.message }); return; }
      const out = (stdout || '').trim();
      if (action === 'get' && out.includes('|')) {
        const [volStr, muteStr] = out.split('|');
        const vol = parseInt(volStr, 10);
        resolve({ success: true, volume: isNaN(vol) ? 0 : vol, muted: muteStr === 'True' || muteStr === 'true' });
      } else if (action === 'toggle') {
        resolve({ success: true, muted: out === 'True' || out === 'true' });
      } else {
        resolve({ success: true });
      }
    });
  });
}

function notifyDockChanged(getDockWindow) {
  try {
    const dock = getDockWindow && getDockWindow();
    if (dock && !dock.isDestroyed()) {
      dock.webContents.send('nav-items-changed');
    }
  } catch (_) {}
}

function register({ loadConfig, saveConfig, getDockWindow }) {
  ipcMain.handle('system-action', async (event, action) => {
    try {
      // 处理空值
      if (!action) return { success: false, error: '无操作路径' };

      // 系统内置动作
      switch (action) {
        case 'start':
          exec('explorer shell:::{2559a1f8-21d7-11d4-bdaf-00c04f60b9f0}');
          return { success: true };
        case 'taskview':
          exec('powershell -Command "(New-Object -ComObject Shell.Application).ToggleDesktop()"');
          return { success: true };
        case 'explorer':
          shell.openPath('C:\\');
          return { success: true };
        case 'browser':
          shell.openExternal('https://www.google.com');
          return { success: true };
        case 'settings':
          exec('ms-settings:');
          return { success: true };
        case 'terminal':
          exec('wt');
          return { success: true };
        case 'wifi':
          exec('ms-settings:network-wifi');
          return { success: true };
        case 'volume':
          exec('ms-settings:sound');
          return { success: true };
        case 'battery':
          exec('ms-settings:batterysaver');
          return { success: true };
        case 'calendar':
          exec('explorer ms-clock:');
          return { success: true };
        case 'actioncenter':
          exec('explorer ms-actioncenter:');
          return { success: true };
        case 'shutdown':
          exec('shutdown /s /t 0');
          return { success: true };
      }

      // 处理自定义路径
      // URL → openExternal
      if (/^https?:\/\//i.test(action)) {
        shell.openExternal(action);
        return { success: true };
      }
      // mailto → openExternal
      if (/^mailto:/i.test(action)) {
        shell.openExternal(action);
        return { success: true };
      }

      // 文件/文件夹/快捷方式 → openPath
      // openPath 会自动处理 .exe, .lnk, 文件等
      if (fs.existsSync(action)) {
        const openResult = await shell.openPath(action);
        if (openResult) {
          // openPath 返回非空字符串即为系统给出的失败原因
          return { success: false, error: openResult };
        }
        return { success: true };
      }

      // 路径已不存在（应用被卸载/文件被删除）：明确返回错误，由调用方给出反馈。
      // 早期实现仍调用 openPath 并返回 success，导致点击失效图标毫无反应且无任何提示。
      return { success: false, error: '目标已不存在', code: 'ENOENT' };
    } catch (e) {
      console.error('System action failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  // 电量状态
  ipcMain.handle('get-battery-status', () => {
    return new Promise((resolve) => {
      // 多行 PowerShell 内含双引号与 \n，用模板字符串最清晰（转成单引号需逐处转义）
      // eslint-disable-next-line quotes
      const script = `$b = Get-WmiObject Win32_Battery -ErrorAction SilentlyContinue\nif ($b) {\n  $p = [int]$b.EstimatedChargeRemaining\n  $s = [int]$b.BatteryStatus\n  $charging = ($s -eq 2 -or $s -eq 6 -or $s -eq 8 -or $s -eq 9)\n  "$p|$charging"\n} else {\n  "0|False"\n}`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 4000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve({ percent: null, charging: false });
          return;
        }
        const [pStr, cStr] = stdout.trim().split('|');
        const percent = parseInt(pStr, 10);
        resolve({
          percent: isNaN(percent) ? null : percent,
          charging: cStr === 'True' || cStr === 'true'
        });
      });
    });
  });

  ipcMain.handle('get-dock-settings', () => {
    const config = loadConfig();
    return config.dockSettings || { blurMode: 'glass', radius: 24, iconSize: 52, itemCount: 10, onlyShortcuts: false, bgColor: '#1e1e1e', glassBlur: 20, glassOpacity: 0.2, gaussianBlur: 16, acrylicBlur: 60, acrylicOpacity: 0.08, customColor: '#1e1e1e', customOpacity: 0.5, customBlur: 40 };
  });

  ipcMain.handle('save-dock-settings', (event, settings) => {
    const config = loadConfig();
    config.dockSettings = { ...(config.dockSettings || {}), ...settings };
    saveConfig(config);
    return { success: true };
  });

  ipcMain.handle('toggle-taskbar', async (event, hide) => {
    try {
      const script = hide
        ? `Add-Type -Namespace W -Name T -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
$h = [W.T]::FindWindow("Shell_TrayWnd", $null)
if ($h -ne [IntPtr]::Zero) { [W.T]::ShowWindow($h, 0) }`
        : `Add-Type -Namespace W -Name T -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
$h = [W.T]::FindWindow("Shell_TrayWnd", $null)
if ($h -ne [IntPtr]::Zero) { [W.T]::ShowWindow($h, 5) }`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 5000 });
      // 持久化状态
      const config = loadConfig();
      config.hideSystemTaskbar = !!hide;
      saveConfig(config);
      return { success: true };
    } catch (e) {
      console.error('Toggle taskbar failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-taskbar-hidden', () => {
    const config = loadConfig();
    return !!config.hideSystemTaskbar;
  });

  /* ========== 桌面图标显示/隐藏 ========== */
  // 通过 SHELLDLL_DefView 窗口发送 WM_COMMAND 0x7402 切换桌面图标显示状态。
  // 注意：Win11 下 SHELLDLL_DefView 是 WorkerW 的子窗口（而非 Progman 的子窗口），
  // 因此必须枚举 WorkerW/Progman 找到 SHELLDLL_DefView 再发送消息。
  // 实际状态从注册表 HideIcons 读取，避免与系统真实状态不同步
  function runPowershell(script) {
    return new Promise((resolve, reject) => {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout || '').trim());
      });
    });
  }

  async function getDesktopIconsHiddenReal() {
    try {
      // 注册表路径含反斜杠，模板字符串可读性更好
      const out = await runPowershell(
        // eslint-disable-next-line quotes
        `(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'HideIcons' -ErrorAction SilentlyContinue).HideIcons`
      );
      return out === '1';
    } catch (_) {
      return false;
    }
  }

  ipcMain.handle('toggle-desktop-icons', async () => {
    try {
      const script = `Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DeskIcons {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    public static IntPtr FindDefView() {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr top, IntPtr l) {
            var sb = new StringBuilder(256);
            GetClassName(top, sb, 256);
            string cls = sb.ToString();
            if (cls == "WorkerW" || cls == "Progman") {
                EnumChildWindows(top, delegate(IntPtr child, IntPtr l2) {
                    var cb = new StringBuilder(256);
                    GetClassName(child, cb, 256);
                    if (cb.ToString() == "SHELLDLL_DefView") { result = child; return false; }
                    return true;
                }, IntPtr.Zero);
            }
            return result == IntPtr.Zero;
        }, IntPtr.Zero);
        return result;
    }
    public static bool Toggle() {
        IntPtr defView = FindDefView();
        if (defView == IntPtr.Zero) return false;
        SendMessage(defView, 0x0111, (IntPtr)0x7402, IntPtr.Zero);
        return true;
    }
}
'@
[void][DeskIcons]::Toggle()`;
      await runPowershell(script);
      const hidden = await getDesktopIconsHiddenReal();
      return { success: true, hidden };
    } catch (e) {
      console.error('Toggle desktop icons failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-desktop-icons-hidden', async () => {
    return await getDesktopIconsHiddenReal();
  });

  /* ========== 电源操作 ========== */
  ipcMain.handle('power-action', async (event, action) => {
    try {
      let cmd = '';
      switch (action) {
        case 'shutdown': cmd = 'shutdown /s /t 0'; break;
        case 'restart': cmd = 'shutdown /r /t 0'; break;
        case 'sleep': cmd = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'; break;
        case 'hibernate': cmd = 'rundll32.exe powrprof.dll,SetSuspendState Hibernate'; break;
        default: return { success: false, error: '未知操作' };
      }
      if (!cmd) return { success: false, error: '无对应命令' };
      exec(cmd, { timeout: 5000, windowsHide: true });
      return { success: true };
    } catch (e) {
      console.error('Power action failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  /* ========== 音量控制 ========== */
  ipcMain.handle('get-volume', async () => {
    const r = await runAudioCommand('get');
    return r;
  });

  ipcMain.handle('set-volume', async (event, volume) => {
    const v = Math.max(0, Math.min(100, parseInt(volume, 10) || 0));
    return await runAudioCommand('set', (v / 100).toFixed(3));
  });

  ipcMain.handle('toggle-mute', async () => {
    return await runAudioCommand('toggle');
  });

  ipcMain.handle('set-mute', async (event, mute) => {
    return await runAudioCommand('mute', mute ? 'True' : 'False');
  });

  /* ========== 网络状态（有线+无线） ========== */
  function parseNetworkAdapters(output) {
    const lines = (output || '').split(/\r?\n/);
    const adapters = [];
    let cur = null;
    for (const line of lines) {
      // 匹配适配器行，兼容中英文和全/半角冒号
      const m = line.match(/^(.+?)\s+adapter\s+(.+?)[：:]\s*$/i) || line.match(/^(.+?)\s+适配器\s+(.+?)[：:]\s*$/);
      if (m) {
        if (cur) adapters.push(cur);
        const typeRaw = (m[1] || '').toLowerCase();
        const name = m[2] || '';
        let type = 'other';
        if (typeRaw.includes('ethernet') || typeRaw.includes('以太网') || typeRaw.includes('以太')) type = 'wired';
        else if (typeRaw.includes('wireless') || typeRaw.includes('wlan') || typeRaw.includes('wi-fi') || typeRaw.includes('无线')) type = 'wireless';
        cur = { type, name, ip: '', connected: false };
        continue;
      }
      if (cur) {
        // 匹配IPv4地址行（中英文系统都可能出现点号填充）
        const ipMatch = line.match(/IPv4[^\d]*[:：]\s*([\d.]+)/i) || line.match(/IP\s*Address[^\d]*[:：]\s*([\d.]+)/i);
        if (ipMatch && ipMatch[1]) { cur.ip = ipMatch[1].trim(); cur.connected = true; }
      }
    }
    if (cur) adapters.push(cur);
    return adapters;
  }

  ipcMain.handle('get-network-status', async () => {
    return new Promise((resolve) => {
      exec('chcp 65001 >nul & ipconfig', { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
        const out = stdout || stderr || '';
        const result = { wired: null, wireless: null };
        if (err && !out) { resolve(result); return; }
        try {
          const adapters = parseNetworkAdapters(out);
          result.wired = adapters.find(a => a.type === 'wired' && a.connected) || null;
          result.wireless = adapters.find(a => a.type === 'wireless' && a.connected) || null;
          // 如果没有已连接的适配器，也检查是否有对应类型的适配器
          if (!result.wired) result.wired = adapters.find(a => a.type === 'wired') || null;
          if (!result.wireless) result.wireless = adapters.find(a => a.type === 'wireless') || null;
        } catch (e) {}
        resolve(result);
      });
    });
  });

  /* ========== WiFi 控制 ========== */
  function parseWifiInterfaces(output) {
    const lines = (output || '').split(/\r?\n/);
    const info = { connected: false, ssid: '', state: '', signal: '', interface: '' };
    let inInfo = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^There is \d+ interface/i.test(line) || /^接口/i.test(line) || /^接口信息/i.test(line) || /^Interface:/i.test(line)) { inInfo = true; continue; }
      if (inInfo) {
        const mSsid = line.match(/^\s*SSID\s*[:：]\s*(.+)$/i) || line.match(/^\s*SSID\s*:?\s*(.+)$/i);
        const mState = line.match(/^\s*State\s*[:：]\s*(.+)$/i) || line.match(/^\s*状态\s*[:：]\s*(.+)$/i);
        const mSignal = line.match(/^\s*Signal\s*[:：]\s*(.+)$/i) || line.match(/^\s*信号\s*[:：]\s*(.+)$/i);
        const mIf = line.match(/^\s*Name\s*[:：]\s*(.+)$/i) || line.match(/^\s*名称\s*[:：]\s*(.+)$/i);
        if (mSsid && mSsid[1].trim() && mSsid[1].trim() !== 'N/A' && !info.ssid) { info.ssid = mSsid[1].trim(); info.connected = true; }
        if (mState && !info.state) info.state = mState[1].trim();
        if (mSignal && !info.signal) info.signal = mSignal[1].trim();
        if (mIf && !info.interface) info.interface = mIf[1].trim();
      }
    }
    if (info.state && /disconnected|断开/i.test(info.state)) { info.connected = false; info.ssid = ''; }
    return info;
  }

  function parseWifiNetworks(output) {
    const lines = (output || '').split(/\r?\n/);
    const nets = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^\s*SSID\s*\d+\s*[:：]\s*(.*)$/i);
      if (m) {
        if (cur) nets.push(cur);
        const ssid = m[1].trim();
        cur = ssid && ssid !== 'N/A' && ssid !== '' ? { ssid, signal: '', security: '', bssid: false } : null;
        continue;
      }
      if (cur) {
        const sSig = line.match(/^\s*Signal\s*[:：]\s*(\d+)%/i) || line.match(/^\s*信号\s*[:：]\s*(\d+)%/i);
        const sSec = line.match(/^\s*Authentication\s*[:：]\s*(.+)$/i) || line.match(/^\s*身份验证\s*[:：]\s*(.+)$/i);
        const sBssid = line.match(/^\s*BSSID\s*\d+\s*[:：]\s*([0-9a-fA-F:]+)/i);
        if (sSig) cur.signal = sSig[1] + '%';
        if (sSec) cur.security = sSec[1].trim();
        if (sBssid) cur.bssid = true;
      }
    }
    if (cur) nets.push(cur);
    return nets.filter(n => n.ssid);
  }

  ipcMain.handle('get-wifi-status', async () => {
    return new Promise((resolve) => {
      exec('chcp 65001 >nul & netsh wlan show interfaces', { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
        const out = stdout || stderr || '';
        if (err && !out) { resolve({ connected: false, ssid: '', state: '', signal: '', error: err.message }); return; }
        try {
          const info = parseWifiInterfaces(out);
          resolve(info);
        } catch (e) {
          resolve({ connected: false, ssid: '', state: '', signal: '', error: e.message });
        }
      });
    });
  });

  ipcMain.handle('get-wifi-networks', async () => {
    return new Promise((resolve) => {
      exec('chcp 65001 >nul & netsh wlan show networks mode=bssid', { timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
        const out = stdout || stderr || '';
        if (err && !out) { resolve({ success: false, networks: [], error: err.message }); return; }
        try {
          const nets = parseWifiNetworks(out);
          resolve({ success: true, networks: nets });
        } catch (e) {
          resolve({ success: false, networks: [], error: e.message });
        }
      });
    });
  });

  ipcMain.handle('connect-wifi', async (event, ssid) => {
    return new Promise((resolve) => {
      exec(`chcp 65001 >nul & netsh wlan connect name="${ssid.replace(/"/g, '\\"')}"`, { timeout: 8000, windowsHide: true, encoding: 'utf8' }, (err) => {
        if (err) { resolve({ success: false, error: err.message }); return; }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('disconnect-wifi', async () => {
    return new Promise((resolve) => {
      exec('chcp 65001 >nul & netsh wlan disconnect', { timeout: 5000, windowsHide: true, encoding: 'utf8' }, (err) => {
        if (err) { resolve({ success: false, error: err.message }); return; }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('get-nav-items', () => {
    const config = loadConfig();
    return config.navItems || getDefaultNavItems();
  });

  ipcMain.handle('save-nav-items', async (event, items) => {
    try {
      const config = loadConfig();
      config.navItems = items === null ? getDefaultNavItems() : items;
      saveConfig(config);
      notifyDockChanged(getDockWindow);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Save nav items failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-nav-item', async (event, item) => {
    try {
      const config = loadConfig();
      if (!config.navItems) {
        config.navItems = getDefaultNavItems();
      }
      // 清理配置中可能已存在的重复项（按路径去重，保留第一个）
      const seen = new Set();
      config.navItems = config.navItems.filter(i => {
        if (i.type === 'system') return true;
        const k = (i.path || '').toLowerCase();
        if (!k) return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // 避免重复添加：路径或名称重复都视为已存在
      const itemPathKey = String(item.path || '').toLowerCase();
      const itemNameKey = String(item.name || '').toLowerCase();
      const exists = config.navItems.some(i => {
        const iPath = String(i.path || '').toLowerCase();
        const iName = String(i.name || '').toLowerCase();
        // 路径相同
        if (iPath && iPath === itemPathKey) return true;
        // 无路径但名称相同（且都是应用类型）
        if (!iPath && !itemPathKey && i.type !== 'system' && iName === itemNameKey) return true;
        return false;
      });
      if (exists) {
        // 返回当前的 navItems，让前端刷新（去重后的）
        notifyDockChanged(getDockWindow);
        return { success: false, error: '该快捷方式已存在', items: config.navItems };
      }
      config.navItems.push({
        id: 'nav_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: item.name,
        path: item.path,
        type: item.type || 'application',
        visible: true
      });
      saveConfig(config);
      notifyDockChanged(getDockWindow);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Add nav item failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update-nav-item', async (event, { id, updates }) => {
    try {
      const config = loadConfig();
      if (!config.navItems) config.navItems = getDefaultNavItems();
      const idx = config.navItems.findIndex(i => i.id === id);
      if (idx !== -1) {
        config.navItems[idx] = { ...config.navItems[idx], ...updates };
        saveConfig(config);
      }
      notifyDockChanged(getDockWindow);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Update nav item failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-nav-item', async (event, id) => {
    try {
      const config = loadConfig();
      if (!config.navItems) config.navItems = getDefaultNavItems();
      config.navItems = config.navItems.filter(i => i.id !== id);
      saveConfig(config);
      notifyDockChanged(getDockWindow);
      return { success: true, items: config.navItems };
    } catch (e) {
      console.error('Remove nav item failed:', e.message);
      return { success: false, error: e.message };
    }
  });
}

function getDefaultNavItems() {
  return [
    { id: 'nav_explorer', name: '资源管理器', action: 'explorer', type: 'system', icon: 'explorer', visible: true },
    { id: 'nav_terminal', name: '终端', action: 'terminal', type: 'system', icon: 'terminal', visible: true },
    { id: 'nav_taskview', name: '任务视图', action: 'taskview', type: 'system', icon: 'taskview', visible: true }
  ];
}

module.exports = { register, compileAudioDllAsync };
