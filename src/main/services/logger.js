/* ============================================================
   主进程日志落盘（阶段 9）
   ------------------------------------------------------------
   背景：主进程有近百处 `console.*`，但**没有任何落盘**。打包后用户遇到问题
   （例如「图标不显示」「Dock 位置不对」）时，我们拿不到任何现场信息 ——
   看不到控制台，也没有日志文件可要。

   设计取舍：
   - **不改动那 91 处调用点**：给 console 打补丁，把输出镜像到文件。
     逐个改成 logger.xxx 会造出一大批无价值的 diff，也更容易漏改。
   - **同步写入**：主进程日志量很低（启动/异常/失败路径），
     异步写会引入「进程崩溃时最后几条丢失」的问题，而这恰恰是日志最该留下的部分。
     为控制风险，单条写入异常一律吞掉，绝不让日志把主流程弄挂。
   - **大小轮转**：超过上限后改名成 `.1` 并重新开始，避免无限增长。
   - **纯逻辑与 IO 分离**：格式化与轮转判定是可测纯函数，落盘在 IO 层。

   调用点：`src/main/index.js` 在拿到 userData 路径后立刻 `attach()`。
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = 'main.log';
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1MB

/** 本地时间戳，精确到毫秒（日志用于对齐用户描述的现象，时间必须可读） */
function formatTimestamp(d) {
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    '.' + pad(d.getMilliseconds(), 3);
}

/** 把任意参数安全地转成一行文本（Error 要带堆栈，循环引用不能炸） */
function formatArgs(args) {
  const parts = [];
  for (const a of args) {
    try {
      if (a instanceof Error) {
        parts.push(a.stack || (a.name + ': ' + a.message));
      } else if (typeof a === 'string') {
        parts.push(a);
      } else if (a === undefined) {
        parts.push('undefined');
      } else {
        parts.push(JSON.stringify(a));
      }
    } catch (_) {
      // 循环引用等：退化为 String()，不要因为日志本身抛错
      try {
        parts.push(String(a));
      } catch (_e) {
        parts.push('[unserializable]');
      }
    }
  }
  return parts.join(' ');
}

/** 组装一整行（含级别前缀与换行） */
function formatLine(level, args, now) {
  return '[' + formatTimestamp(now || new Date()) + '] [' + level + '] ' +
    formatArgs(args) + '\n';
}

/** 是否需要在写入前轮转（当前大小 + 本次长度 超过上限） */
function shouldRotate(currentBytes, incomingBytes, maxBytes) {
  const limit = maxBytes || DEFAULT_MAX_BYTES;
  return currentBytes > 0 && currentBytes + incomingBytes > limit;
}

/**
 * 创建日志写入器。
 * @param {object} options
 *   - dir: 日志目录（通常是 userData）
 *   - fileName / maxBytes
 *   - fsImpl: 可注入的 fs（测试用）
 *   - now: 可注入的时间源（测试用）
 */
function createLogger(options) {
  const opts = options || {};
  const io = opts.fsImpl || fs;
  const now = opts.now || (() => new Date());
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  const dir = opts.dir;
  const file = path.join(dir || '.', opts.fileName || LOG_FILE);

  let attached = false;
  let original = null;
  const state = { bytes: 0, writes: 0, failures: 0, rotations: 0 };

  function currentSize() {
    try {
      return io.statSync(file).size;
    } catch (_) {
      return 0;
    }
  }

  function rotate() {
    try {
      const bak = file + '.1';
      if (io.existsSync(bak)) io.unlinkSync(bak);
      io.renameSync(file, bak);
      state.bytes = 0;
      state.rotations++;
    } catch (_) {
      // 轮转失败不影响继续写（下一次写入仍会尝试）
    }
  }

  /** 写一行到日志文件；任何异常都被吞掉（日志不得影响主流程） */
  function write(level, args) {
    if (!dir) return false;
    const line = formatLine(level, args, now());
    const incoming = Buffer.byteLength(line, 'utf8');
    try {
      const size = state.bytes || currentSize();
      if (shouldRotate(size, incoming, maxBytes)) rotate();
      io.appendFileSync(file, line, 'utf8');
      state.bytes = (state.bytes || size) + incoming;
      state.writes++;
      return true;
    } catch (_) {
      state.failures++;
      return false;
    }
  }

  /** 把 console 的输出镜像到日志文件（保留原有行为） */
  function attach(target) {
    if (attached) return false;
    const con = target || console;
    original = {
      log: con.log,
      info: con.info,
      warn: con.warn,
      error: con.error
    };

    /* 日志里的级别做归一化（log/info 都记 info），但**转发必须按原方法名**：
       本模块的承诺是「保留原有 console 行为」，不能把 log 悄悄变成 info。 */
    const wrap = (logLevel, methodName) => function () {
      const args = Array.prototype.slice.call(arguments);
      // 先落盘再原样转发：即使原 console 被重定向，日志也已经写下了
      write(logLevel, args);
      try {
        return original[methodName].apply(con, args);
      } catch (_) {
        return undefined;
      }
    };

    con.log = wrap('info', 'log');
    con.info = wrap('info', 'info');
    con.warn = wrap('warn', 'warn');
    con.error = wrap('error', 'error');
    attached = true;

    write('info', ['=== 日志开始 ' + formatTimestamp(now()) + ' ===']);
    return true;
  }

  /** 还原 console（测试与「关闭日志」场景用） */
  function detach(target) {
    if (!attached || !original) return false;
    const con = target || console;
    con.log = original.log;
    con.info = original.info;
    con.warn = original.warn;
    con.error = original.error;
    attached = false;
    return true;
  }

  return {
    attach,
    detach,
    write,
    rotate,
    filePath: () => file,
    stats: () => Object.assign({ attached }, state)
  };
}

/** 当前日志（尾部 N 行），供「关于」页或反馈时附上 */
function readTail(file, maxLines, fsImpl) {
  const io = fsImpl || fs;
  try {
    const text = io.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter((l) => l !== '');
    const n = maxLines || 200;
    return lines.slice(Math.max(0, lines.length - n));
  } catch (_) {
    return [];
  }
}

module.exports = {
  LOG_FILE,
  DEFAULT_MAX_BYTES,
  formatTimestamp,
  formatArgs,
  formatLine,
  shouldRotate,
  createLogger,
  readTail
};
