/* 自检：主进程日志落盘 src/main/services/logger.js（阶段 9）
   用可注入的 fs / 时间源验证格式化、轮转与 console 镜像。

   重点守住：
   - 时间戳可读（要对齐用户描述现象的时刻）
   - Error 带堆栈、循环引用不炸、undefined 不丢
   - 超过上限才轮转，且轮转后重新计数
   - **日志失败绝不影响主流程**：目录不可写、fs 抛错都只记 failures
   - attach 保留原 console 行为（转发不被吞）；detach 能完全还原 */

const path = require('path');
const assert = require('assert');

const logger = require(path.join(__dirname, '..', 'src', 'main', 'services', 'logger.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 内存 fs 桩 */
function makeFakeFs(initial) {
  const files = Object.assign({}, initial || {});
  const calls = { append: 0, rename: 0, unlink: 0 };
  return {
    files,
    calls,
    statSync(p) {
      if (!(p in files)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return { size: Buffer.byteLength(files[p], 'utf8') };
    },
    readFileSync(p) {
      if (!(p in files)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    },
    existsSync: (p) => p in files,
    appendFileSync(p, data) {
      calls.append++;
      files[p] = (files[p] || '') + data;
    },
    renameSync(a, b) {
      calls.rename++;
      if (!(a in files)) throw new Error('ENOENT');
      files[b] = files[a];
      delete files[a];
    },
    unlinkSync(p) {
      calls.unlink++;
      delete files[p];
    }
  };
}

console.log('\n[1] 时间戳与格式化');
{
  ok('时间戳为可读的「YYYY-MM-DD HH:mm:ss.SSS」', () => {
    const s = logger.formatTimestamp(new Date(2026, 6, 17, 9, 5, 3, 7));
    assert.strictEqual(s, '2026-07-17 09:05:03.007');
  });
  ok('单行含时间戳与级别前缀', () => {
    const line = logger.formatLine('warn', ['出了点事'], new Date(2026, 0, 2, 3, 4, 5, 6));
    assert.strictEqual(line, '[2026-01-02 03:04:05.006] [warn] 出了点事\n');
  });
  ok('多个参数以空格连接', () => {
    assert.strictEqual(logger.formatArgs(['a', 1, true]), 'a 1 true');
  });
  ok('undefined 不丢失（与 null 区分）', () => {
    assert.strictEqual(logger.formatArgs(['x', undefined, null]), 'x undefined null');
  });
  ok('Error 带堆栈', () => {
    const e = new Error('boom');
    const out = logger.formatArgs([e]);
    assert.ok(out.includes('Error: boom'), out);
    assert.ok(out.includes('at '), '应包含堆栈帧');
  });
  ok('对象被 JSON 序列化', () => {
    assert.strictEqual(logger.formatArgs([{ a: 1 }]), '{"a":1}');
  });
  ok('循环引用不抛错（退化为 String）', () => {
    const cyc = { name: 'c' };
    cyc.self = cyc;
    let out;
    assert.doesNotThrow(() => { out = logger.formatArgs([cyc]); });
    assert.ok(typeof out === 'string' && out.length > 0);
  });
  ok('BigInt 等无法 JSON 序列化的值也不抛错', () => {
    let out;
    assert.doesNotThrow(() => { out = logger.formatArgs([BigInt(1)]); });
    assert.ok(typeof out === 'string');
  });
}

console.log('\n[2] 轮转判定');
{
  ok('空文件不轮转（首条日志不该被轮转掉）', () => {
    assert.strictEqual(logger.shouldRotate(0, 100, 1000), false);
  });
  ok('未超上限不轮转', () => {
    assert.strictEqual(logger.shouldRotate(500, 400, 1000), false);
  });
  ok('超过上限则轮转', () => {
    assert.strictEqual(logger.shouldRotate(900, 200, 1000), true);
  });
  ok('恰好等于上限不轮转（用 > 而非 >=）', () => {
    assert.strictEqual(logger.shouldRotate(500, 500, 1000), false);
  });
  ok('不传上限时用默认值', () => {
    assert.strictEqual(logger.shouldRotate(logger.DEFAULT_MAX_BYTES, 1), true);
  });
}

console.log('\n[3] 写入与轮转');
{
  const io = makeFakeFs();
  const log = logger.createLogger({ dir: 'C:\\ud', fsImpl: io, maxBytes: 200 });
  ok('write 返回 true 且内容落盘', () => {
    assert.strictEqual(log.write('info', ['第一条']), true);
    const text = io.files[log.filePath()];
    assert.ok(text.includes('第一条'), text);
  });
  ok('多次写入会追加而不是覆盖', () => {
    log.write('info', ['第二条']);
    const text = io.files[log.filePath()];
    assert.ok(text.includes('第一条') && text.includes('第二条'));
  });
  ok('超过上限后轮转为 .1 并重新开始', () => {
    // 灌入足够多的内容触发轮转
    for (let i = 0; i < 20; i++) log.write('info', ['填充内容填充内容填充内容 ' + i]);
    assert.ok(io.calls.rename >= 1, '应发生轮转');
    assert.ok(io.files[log.filePath() + '.1'], '应存在 .1 备份');
    assert.ok(log.stats().rotations >= 1);
  });
  ok('目录未提供时 write 直接返回 false（不抛错）', () => {
    const l2 = logger.createLogger({ fsImpl: io });
    assert.strictEqual(l2.write('info', ['x']), false);
  });
}

console.log('\n[4] 日志失败不得影响主流程');
{
  const broken = {
    statSync: () => { throw new Error('boom'); },
    existsSync: () => false,
    appendFileSync: () => { throw new Error('disk full'); },
    renameSync: () => { throw new Error('boom'); },
    unlinkSync: () => { throw new Error('boom'); }
  };
  const log = logger.createLogger({ dir: 'C:\\ud', fsImpl: broken });
  ok('写盘抛错时 write 返回 false 且不抛异常', () => {
    let r;
    assert.doesNotThrow(() => { r = log.write('error', ['x']); });
    assert.strictEqual(r, false);
  });
  ok('失败次数被记录', () => assert.ok(log.stats().failures >= 1));
  ok('目录不存在（statSync 抛 ENOENT）时仍能首次写入', () => {
    const io = makeFakeFs();
    const l2 = logger.createLogger({ dir: 'C:\\ud', fsImpl: io, maxBytes: 1000 });
    assert.strictEqual(l2.write('info', ['首次']), true);
  });
}

console.log('\n[5] console 镜像');
{
  const io = makeFakeFs();
  const log = logger.createLogger({ dir: 'C:\\ud', fsImpl: io });
  // 用一个独立的假 console，避免污染测试进程自身的输出
  const seen = [];
  const fake = {
    log: (...a) => seen.push(['log', a]),
    info: (...a) => seen.push(['info', a]),
    warn: (...a) => seen.push(['warn', a]),
    error: (...a) => seen.push(['error', a])
  };
  // 在 attach **之前**留下原始引用：attach 会就地替换 fake 的方法，
  // 之后若再把 fake 拷一份，拿到的已是包装后的版本，断言会失真
  const originals = Object.assign({}, fake);

  ok('attach 返回 true 且只生效一次', () => {
    assert.strictEqual(log.attach(fake), true);
    assert.strictEqual(log.attach(fake), false);
  });
  ok('原 console 行为被保留（转发不被吞）', () => {
    fake.log('hello');
    assert.deepStrictEqual(seen[seen.length - 1], ['log', ['hello']]);
  });
  ok('输出同时镜像进日志文件', () => {
    const text = io.files[log.filePath()];
    assert.ok(text.includes('hello'), text);
  });
  ok('各方法映射到正确级别', () => {
    fake.warn('w');
    fake.error('e');
    const text = io.files[log.filePath()];
    assert.ok(text.includes('[warn] w'), text);
    assert.ok(text.includes('[error] e'), text);
  });
  ok('attach 会写一条启动分隔行', () => {
    assert.ok(io.files[log.filePath()].includes('=== 日志开始'), '缺少启动分隔行');
  });
  ok('detach 完全还原 console', () => {
    assert.strictEqual(log.detach(fake), true);
    assert.strictEqual(fake.log, originals.log);
    assert.strictEqual(fake.warn, originals.warn);
    const before = seen.length;
    fake.log('after-detach');
    assert.strictEqual(seen.length, before + 1);
    assert.ok(!io.files[log.filePath()].includes('after-detach'), 'detach 后不应再落盘');
  });
  ok('未 attach 时 detach 返回 false', () => {
    assert.strictEqual(log.detach(fake), false);
  });
  ok('原 console 抛错时不影响日志（转发失败被吞）', () => {
    const io2 = makeFakeFs();
    const log2 = logger.createLogger({ dir: 'C:\\ud', fsImpl: io2 });
    const throwing = {
      log: () => { throw new Error('console broken'); },
      info: () => {}, warn: () => {}, error: () => {}
    };
    log2.attach(throwing);
    assert.doesNotThrow(() => throwing.log('x'));
    assert.ok(io2.files[log2.filePath()].includes('x'), '日志仍应写下');
  });
}

console.log('\n[6] readTail');
{
  const io = makeFakeFs({ 'C:\\ud\\main.log': 'a\nb\nc\nd\ne\n' });
  ok('返回末尾 N 行', () => {
    assert.deepStrictEqual(logger.readTail('C:\\ud\\main.log', 2, io), ['d', 'e']);
  });
  ok('请求行数超过总量时返回全部', () => {
    assert.deepStrictEqual(logger.readTail('C:\\ud\\main.log', 99, io), ['a', 'b', 'c', 'd', 'e']);
  });
  ok('文件不存在时返回空数组（不抛错）', () => {
    assert.deepStrictEqual(logger.readTail('C:\\nope.log', 5, io), []);
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
