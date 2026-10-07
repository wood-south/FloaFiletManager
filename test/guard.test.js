/* 自检：IPC 安全防线 src/main/security/guard.js（纯函数，无 Electron 依赖） */
const assert = require('assert');
const path = require('path');
const guard = require(path.join(__dirname, '..', 'src', 'main', 'security', 'guard.js'));

let pass = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    console.log('  FAIL  ' + name + '  -> ' + e.message);
    process.exitCode = 1;
  }
}

const cfg = {
  savePath: 'D:\\Docs\\FloatUploads',
  preferredPath: 'D:\\Docs',
  partitions: [
    { id: 'default', paths: [{ name: '桌面', path: 'C:\\Users\\u\\Desktop' }] }
  ]
};
const roots = guard.collectAllowedRoots(cfg, 'C:\\Users\\u\\AppData\\Roaming\\app');

console.log('\n[1] collectAllowedRoots');
ok('收集到 4 个根目录', () => assert.strictEqual(roots.length, 4));
ok('包含 userData', () => assert.ok(roots.includes('C:\\Users\\u\\AppData\\Roaming\\app')));

console.log('\n[2] isPathAllowed');
ok('savePath 自身允许', () => assert.ok(guard.isPathAllowed('D:\\Docs\\FloatUploads', roots)));
ok('savePath 内文件允许', () => assert.ok(guard.isPathAllowed('D:\\Docs\\FloatUploads\\a.txt', roots)));
ok('分区路径内文件允许', () => assert.ok(guard.isPathAllowed('C:\\Users\\u\\Desktop\\x.lnk', roots)));
ok('大小写不敏感（Windows）', () => {
  if (process.platform !== 'win32') return;
  assert.ok(guard.isPathAllowed('d:\\docs\\floatuploads\\a.txt', roots));
});
ok('前缀相似但不同目录被拒绝 (foo vs foobar)', () => {
  const r = ['C:\\foo'];
  assert.strictEqual(guard.isPathAllowed('C:\\foobar\\x.txt', r), false);
});
ok('上级目录穿越被拒绝', () => assert.strictEqual(guard.isPathAllowed('D:\\Docs\\..\\Windows\\x.dll', roots), false));
ok('完全无关路径被拒绝', () => assert.strictEqual(guard.isPathAllowed('C:\\Windows\\System32\\x.dll', roots), false));
ok('空值被拒绝', () => {
  assert.strictEqual(guard.isPathAllowed('', roots), false);
  assert.strictEqual(guard.isPathAllowed(null, roots), false);
  assert.strictEqual(guard.isPathAllowed(undefined, roots), false);
});

console.log('\n[3] sanitizeFileName（目录穿越净化）');
ok('普通文件名通过', () => assert.strictEqual(guard.sanitizeFileName('报告.pdf'), '报告.pdf'));
ok('../ 穿越被剥离为最后一段', () => assert.strictEqual(guard.sanitizeFileName('..\\..\\evil.txt'), 'evil.txt'));
ok('../../ 形式同样被剥离', () => assert.strictEqual(guard.sanitizeFileName('../../evil.txt'), 'evil.txt'));
ok('绝对路径只取文件名', () => assert.strictEqual(guard.sanitizeFileName('C:\\Windows\\System32\\evil.dll'), 'evil.dll'));
ok('裸 .. 被拒绝', () => assert.strictEqual(guard.sanitizeFileName('..'), null));
ok('裸 . 被拒绝', () => assert.strictEqual(guard.sanitizeFileName('.'), null));
ok('空串被拒绝', () => assert.strictEqual(guard.sanitizeFileName(''), null));
ok('Windows 非法字符被拒绝', () => assert.strictEqual(guard.sanitizeFileName('a<b>c.txt'), null));
ok('控制字符被拒绝', () => assert.strictEqual(guard.sanitizeFileName('a\u0000b.txt'), null));

console.log('\n[4] validateSender（构造假 event 验证拒绝分支）');
ok('非 file:// 页面被拒绝', () => {
  const ev = { senderFrame: { parent: null }, sender: { getURL: () => 'https://evil.example/x.html' } };
  assert.strictEqual(guard.validateSender(ev).ok, false);
});
ok('子框架被拒绝', () => {
  const ev = { senderFrame: { parent: {} }, sender: { getURL: () => 'file:///C:/app/renderer/dock.html' } };
  assert.strictEqual(guard.validateSender(ev).ok, false);
});
ok('本地顶层页面通过', () => {
  const ev = { senderFrame: { parent: null }, sender: { getURL: () => 'file:///C:/app/renderer/float.html' } };
  assert.strictEqual(guard.validateSender(ev).ok, true);
});

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
