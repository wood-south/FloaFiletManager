/* 自检：PowerShell 输出编码契约
   回归背景（用户反馈「网络信息显示乱码」）：
   调用方用 `chcp 65001 >nul & ...` 让子进程按 UTF-8 输出，但 Node 的 child_process.exec
   在未指定 encoding 时按**系统代码页**解码（中文 Windows 为 GBK/936），
   于是 UTF-8 字节被按 GBK 解读，中文适配器名/SSID/网络状态全部变成乱码，
   连 parseNetworkAdapters 里 `/适配器/`、`/无线/` 这类匹配也会失效。

   契约：凡是以 `chcp 65001` 执行的命令，必须显式声明 encoding: 'utf8'。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const systemSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main', 'ipc', 'system.js'), 'utf8'
);

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 取出所有 exec( 调用中带 chcp 65001 的整条语句 */
const execCalls = systemSrc.match(/exec\([^;]*?chcp 65001[^;]*?;\s*\}\)?/gs) ||
  systemSrc.match(/exec\('chcp 65001[^\n]*/g) || [];

console.log('\n[1] chcp 65001 的 exec 调用必须声明 utf8 解码');
ok('至少找到 3 个 chcp 65001 调用（ipconfig / wlan interfaces / wlan networks）', () => {
  assert.ok(execCalls.length >= 3, '实际找到 ' + execCalls.length + ' 个');
});
ok('每个调用都带 encoding: \'utf8\'', () => {
  const missing = execCalls.filter((c) => !/encoding:\s*'utf8'/.test(c));
  assert.strictEqual(missing.length, 0,
    '有 ' + missing.length + ' 个 chcp 65001 调用未声明 utf8 解码，会导致中文乱码：\n' +
    missing.map((m) => '    ' + m.slice(0, 80)).join('\n'));
});

console.log('\n[2] 解析函数支持中文 netsh/ipconfig 输出');
ok('parseNetworkAdapters 匹配「适配器」', () => {
  assert.ok(/适配器/.test(systemSrc), '缺少中文适配器行匹配');
});
ok('parseNetworkAdapters 识别「以太网」「无线」', () => {
  assert.ok(/以太网/.test(systemSrc) && /无线/.test(systemSrc), '缺少中文类型的判别关键字');
});
ok('parseWifiInterfaces 匹配中文状态字段', () => {
  assert.ok(/状态/.test(systemSrc) && /信号/.test(systemSrc), '缺少中文 State/Signal 匹配');
});
ok('parseWifiNetworks 匹配中文身份验证', () => {
  assert.ok(/身份验证/.test(systemSrc), '缺少中文 Authentication 匹配');
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
