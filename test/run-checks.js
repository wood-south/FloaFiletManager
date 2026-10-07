/* 测试运行器
   说明：不使用 `node --test`，因为它依赖子进程 stdio 管道；
   在受限环境（如 DSH 沙箱）下 spawn 会因命名管道不可用而 EPERM 失败。
   这里用顺序 spawnSync（stdio: inherit）逐个运行自检脚本，兼容性更好。 */

const { spawnSync } = require('child_process');
const path = require('path');

const checks = require('./index.js');
let failed = 0;

console.log('运行 ' + checks.length + ' 个自检脚本\n');

for (const check of checks) {
  const file = path.join(__dirname, check.file);
  console.log('=== ' + check.name + ' ===');
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed++;
    console.log('  ✗ 失败（退出码 ' + result.status + '）\n');
  } else {
    console.log('  ✓ 通过\n');
  }
}

if (failed > 0) {
  console.error(failed + '/' + checks.length + ' 个自检脚本失败');
  process.exit(1);
}
console.log('全部 ' + checks.length + ' 个自检脚本通过');
