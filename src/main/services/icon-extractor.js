const path = require('path');
const fs = require('fs');
// electron 仅在 getFileIconWithTimeout 中按需 require，这里无需顶层绑定

/**
 * 转义 PowerShell 单引号字符串中的特殊字符，防止命令注入
 * PowerShell 单引号字符串中唯一需要转义的是单引号本身（用 '' 替代）
 */
function escapePsSingleQuote(str) {
  return str.replace(/'/g, "''");
}

function cleanPath(rawPath) {
  if (!rawPath) return null;
  // 去除首尾引号和空白
  let p = rawPath.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  // 去除 file:/// 前缀
  if (p.startsWith('file:///')) {
    p = p.slice(8);
  }
  // URL 编码的路径可能需要解码（如 %20 -> 空格）
  try {
    p = decodeURIComponent(p);
  } catch (e) {
    // 解码失败，保持原样
  }
  return p || null;
}

function parseIconPath(iconPath) {
  if (!iconPath) return null;
  // icon 可能是 "path,index" 格式，如 "C:\Windows\System32\shell32.dll,167"
  const parts = iconPath.split(',');
  const pathPart = cleanPath(parts[0]);
  if (pathPart && fs.existsSync(pathPart)) {
    return pathPart;
  }
  return null;
}

function resolveLnkTarget(lnkPath) {
  try {
    const { shell } = require('electron');
    const shortcut = shell.readShortcutLink(lnkPath);
    if (shortcut) {
      const target = cleanPath(shortcut.target);
      if (target && fs.existsSync(target)) {
        return target;
      }
      const iconPath = parseIconPath(shortcut.icon);
      if (iconPath && fs.existsSync(iconPath)) {
        return iconPath;
      }
    }
  } catch (e) {
    console.error('readShortcutLink 失败:', e.message);
  }

  try {
    const { execSync } = require('child_process');
    const cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${escapePsSingleQuote(lnkPath)}').TargetPath"`;
    const target = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
    if (target && fs.existsSync(target)) {
      return cleanPath(target);
    }
  } catch (e) {
    console.error('PowerShell解析lnk失败:', e.message);
  }

  return null;
}

function parseUrlFile(urlPath) {
  // 解析 .url 文件（INI格式），返回 { url, iconFile, iconIndex }
  try {
    const content = fs.readFileSync(urlPath, 'utf-8');
    const result = {};
    for (const line of content.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key === 'URL') result.url = val;
        if (key === 'IconFile') result.iconFile = val;
        if (key === 'IconIndex') result.iconIndex = parseInt(val, 10) || 0;
      }
    }
    return result;
  } catch (e) {
    console.error('解析 .url 文件失败:', e.message);
    return {};
  }
}

function findSteamInstallPath() {
  // 尝试多个常见 Steam 安装位置
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Steam'),
    path.join(process.env['ProgramFiles'] || '', 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function getSteamGameIcon(steamUrl) {
  // steam://rungameid/431960 -> 尝试从 Steam 目录找图标
  const match = steamUrl.match(/rungameid\/(\d+)/);
  if (!match) return null;
  const appId = match[1];
  const steamPath = findSteamInstallPath();
  if (!steamPath) return null;
  // 尝试多个可能的图标位置
  const candidates = [
    path.join(steamPath, 'steam', 'games', `${appId}.ico`),
    path.join(steamPath, 'appcache', 'librarycache', `${appId}_icon.jpg`),
    path.join(steamPath, 'appcache', 'librarycache', `${appId}_icon.png`),
    path.join(steamPath, 'steam', 'games', `${appId}.jpg`),
    path.join(steamPath, 'steam', 'games', `${appId}.png`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getFileIconViaPowerShell(filePath) {
  return new Promise((resolve) => {
    try {
      const os = require('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffm-icon-ext-'));
      const outFile = path.join(tmpDir, 'icon.png');

      const psScript = `
Add-Type -AssemblyName System.Drawing
$code = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class IconExtractor {
    [StructLayout(LayoutKind.Sequential)]
    public struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon GetFileIcon(string filePath) {
        SHFILEINFO shfi = new SHFILEINFO();
        const uint SHGFI_ICON = 0x100;
        const uint SHGFI_LARGEICON = 0x0;
        const uint SHGFI_USEFILEATTRIBUTES = 0x10;

        IntPtr res = SHGetFileInfo(filePath, 0, ref shfi, (uint)Marshal.SizeOf(shfi), SHGFI_ICON | SHGFI_LARGEICON);
        if (shfi.hIcon != IntPtr.Zero) {
            Icon icon = Icon.FromHandle(shfi.hIcon);
            Icon result = (Icon)icon.Clone();
            DestroyIcon(shfi.hIcon);
            return result;
        }
        return null;
    }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$filePath = '${escapePsSingleQuote(filePath)}'
$icon = [IconExtractor]::GetFileIcon($filePath)

if (-not $icon) {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($filePath)
}

if ($icon) {
    $bmp = New-Object System.Drawing.Bitmap(64, 64)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $rect = New-Object System.Drawing.Rectangle(0, 0, 64, 64)
    $g.DrawIcon($icon, $rect)
    $bmp.Save('${escapePsSingleQuote(outFile)}', [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $icon.Dispose()
    Write-Output "SUCCESS"
} else {
    Write-Output "NO_ICON"
}
`;

      const psPath = path.join(tmpDir, 'extract-icon.ps1');
      fs.writeFileSync(psPath, '\ufeff' + psScript, 'utf8');

      const { exec } = require('child_process');
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 8000 }, (err, stdout) => {
        fs.rmSync(psPath, { force: true });
        if (!err && stdout.trim() === 'SUCCESS' && fs.existsSync(outFile)) {
          try {
            const buffer = fs.readFileSync(outFile);
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve('data:image/png;base64,' + buffer.toString('base64'));
            return;
          } catch (e) {
            console.error('读取图标文件失败:', e.message);
          }
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve(null);
      });
    } catch (e) {
      console.error('PowerShell图标提取失败:', e.message);
      resolve(null);
    }
  });
}

function iconToDataUrl(icon) {
  // 用 toPNG 获取实际 buffer，比 toDataURL 更可靠
  if (!icon || icon.isEmpty()) return null;
  const size = icon.getSize();
  if (size.width < 8 || size.height < 8) return null;
  const png = icon.toPNG();
  if (!png || png.length < 50) return null;
  return 'data:image/png;base64,' + png.toString('base64');
}

function readIcoToDataUrl(icoPath) {
  // .ico 文件直接读 base64，浏览器支持直接显示
  try {
    const buf = fs.readFileSync(icoPath);
    if (buf.length < 10) return null;
    return 'data:image/x-icon;base64,' + buf.toString('base64');
  } catch (e) {
    console.error('读取 .ico 失败:', e.message);
    return null;
  }
}

function getFileIconWithTimeout(iconFile, timeoutMs = 3000) {
  const { app } = require('electron');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
    app.getFileIcon(iconFile, { size: 'normal' }).then((icon) => {
      clearTimeout(timer);
      resolve(icon);
    }).catch(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function resolveFileIcon(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isLnk = ext === '.lnk';
  const isUrl = ext === '.url';
  let result = null;
  let iconFile = filePath;

  if (isLnk) {
    const targetPath = resolveLnkTarget(filePath);
    if (targetPath) {
      iconFile = targetPath;
    }
  }

  if (isUrl) {
    const urlInfo = parseUrlFile(filePath);
    if (urlInfo.iconFile) {
      const p = cleanPath(urlInfo.iconFile);
      if (p && fs.existsSync(p)) {
        const e = path.extname(p).toLowerCase();
        if (e === '.ico') { result = readIcoToDataUrl(p); }
        else if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(e)) {
          try {
            const buf = fs.readFileSync(p);
            result = 'data:' + (e==='.jpg'?'image/jpeg':'image/'+e.slice(1)) + ';base64,' + buf.toString('base64');
          } catch (er) { console.error('url图标读取失败:', er.message); }
        } else {
          iconFile = p;
        }
      }
    }
    if (!result && urlInfo.url && urlInfo.url.startsWith('steam://')) {
      const si = getSteamGameIcon(urlInfo.url);
      if (si) {
        const se = path.extname(si).toLowerCase();
        if (se === '.ico') result = readIcoToDataUrl(si);
        else {
          try {
            const buf = fs.readFileSync(si);
            result = 'data:' + (se==='.jpg'?'image/jpeg':'image/'+se.slice(1)) + ';base64,' + buf.toString('base64');
          } catch (er) { console.error('Steam图标读取失败:', er.message); }
        }
      }
    }
  }

  if (!result) {
    result = await getFileIconViaPowerShell(iconFile);
    if (result) {
      console.log('PowerShell API提取图标成功:', filePath);
    }
  }

  if (!result) {
    try {
      const icon = await getFileIconWithTimeout(iconFile, 3000);
      if (icon) {
        result = iconToDataUrl(icon);
        console.log('Electron getFileIcon提取图标成功:', filePath);
      }
    } catch (e) {
      console.error('getFileIcon失败:', e.message);
    }
  }

  return result;
}

module.exports = {
  cleanPath,
  parseIconPath,
  resolveLnkTarget,
  parseUrlFile,
  findSteamInstallPath,
  getSteamGameIcon,
  getFileIconViaPowerShell,
  iconToDataUrl,
  readIcoToDataUrl,
  getFileIconWithTimeout,
  resolveFileIcon
};
