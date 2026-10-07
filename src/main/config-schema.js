/* ============================================================
   配置文件结构 v1 → v2 命名空间化（阶段 6）
   ------------------------------------------------------------
   v1 是扁平结构（savePath / partitions / dockSettings / dockX ... 全在顶层），
   v2 按归属分组：

     {
       "version": 2,
       "core":       { 窗口状态、路径、外观开关、能力开关 },
       "capabilities": {
         "file-manager": { partitions, preferredPath, navItems },
         "dock":         { dockSettings },
         "quick-upload": { ... 渲染侧能力自己的 switch（recycleMode 等）}
       },
       "legacy":     { 已废弃但**不删除**的字段 }
     }

   三条硬约束（本阶段风险最高，故写死在代码里）：
   1. **绝不丢字段**：迁移是字段搬家，不是清理。未知字段进 `legacy` 保留。
      连 `snapEdge` / `desktopIconsHidden` 这类当前无人读取的废弃键也一并留着 ——
      迁移的职责不是删数据，清理应当是独立的一次改动。
   2. **内部视图保持 v1 形状**：`decode()` 把 v2 摊平回扁平对象，因此
      `loadConfig()` 的约 20 个调用点一行都不用改（兼容层）。
   3. **纯函数 + 不抛错**：编解码与迁移都不碰文件系统，且对畸形输入返回
      空值/警告而不是抛异常（配置文件损坏时应用要能起来）。
   ============================================================ */

'use strict';

const FORMAT_VERSION = 2;

/** v1 顶层字段 → v2 归属。未列出的字段一律进 legacy。 */
const MAPPING = [
  { group: 'core', keys: [
    'savePath', 'floatPosition', 'snapEdges', 'dockVisible',
    'floatAlwaysOnTop', 'dockAlwaysOnTop', 'dockX', 'dockBottom',
    'hideSystemTaskbar', 'capabilities'
  ] },
  { group: 'file-manager', keys: ['partitions', 'preferredPath', 'navItems'] },
  { group: 'dock', keys: ['dockSettings'] }
];

const CORE_KEYS = MAPPING.find((m) => m.group === 'core').keys;
const CAPABILITY_GROUPS = MAPPING.filter((m) => m.group !== 'core');
/** 分组名是结构保留字：不得与"能力 id"重名，否则扁平视图会与分组打架 */
const GROUP_NAMES = new Set(CAPABILITY_GROUPS.map((m) => m.group));

/* 能力 id 与分组名撞名时的处理。
   现实里已经发生：主进程能力层（阶段 5）有一个能力 id 就叫 `dock`，
   而 v2 又用 `dock` 作为 dockSettings 的分组名。两者同名会让
   「capabilities.dock」既像分组又像能力配置 —— 摊平回来时无法区分。
   解决办法：撞名的能力配置改存到保留键 `_caps` 下，绝不与分组混淆。 */
const RESERVED_CAPS_KEY = '_caps';

/** 某个能力 id 是否与分组名冲突 */
function collidesWithGroup(id) {
  return GROUP_NAMES.has(id);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * v1（扁平） → v2（命名空间化）。纯函数。
 * @returns {{ok:boolean, config:object|null, warnings:string[]}}
 */
function migrateToV2(flat) {
  const warnings = [];
  if (!isPlainObject(flat)) {
    return { ok: false, config: null, warnings: ['配置不是一个对象，无法迁移'] };
  }

  const core = {};
  const capabilities = {};
  const legacy = {};
  const handled = new Set(['version']);

  for (const key of CORE_KEYS) {
    if (key in flat) {
      core[key] = flat[key];
      handled.add(key);
    }
  }

  for (const group of CAPABILITY_GROUPS) {
    const bucket = {};
    let has = false;
    for (const key of group.keys) {
      if (key in flat) {
        bucket[key] = flat[key];
        handled.add(key);
        has = true;
      }
    }
    if (has) capabilities[group.group] = bucket;
  }

  // 渲染侧能力（quick-upload 等）自己的配置：v1 与主进程能力开关共用
  // config.capabilities。展开时必须区分：
  //   - { enabled: boolean }  → 主进程能力开关，留在 core.capabilities
  //   - 其它字段              → 渲染侧能力配置，进 capabilities['<id>']
  const capStore = core.capabilities;
  if (isPlainObject(capStore)) {
    const mainFlags = {};
    for (const [id, entry] of Object.entries(capStore)) {
      if (isPlainObject(entry)) {
        const { enabled, ...rest } = entry;
        if (enabled !== undefined) mainFlags[id] = enabled;
        if (Object.keys(rest).length > 0) {
          if (collidesWithGroup(id)) {
            // 与分组名撞名：存到保留命名空间 `_caps` 下，且**按能力 id 再分一层**，
            // 与 decode 的读取方式严格对称（否则数据会落到错误的键上）
            if (!isPlainObject(capabilities[RESERVED_CAPS_KEY])) {
              capabilities[RESERVED_CAPS_KEY] = {};
            }
            capabilities[RESERVED_CAPS_KEY][id] = Object.assign(
              {}, capabilities[RESERVED_CAPS_KEY][id], rest);
          } else {
            capabilities[id] = Object.assign({}, capabilities[id], rest);
          }
        }
      } else {
        // 标量（true/false）就是主进程能力开关的简写
        mainFlags[id] = entry;
      }
    }
    if (Object.keys(mainFlags).length > 0) {
      core.capabilities = mainFlags;
    } else {
      delete core.capabilities;
    }
  }

  // 其余未识别字段：保留而非丢弃
  for (const [key, value] of Object.entries(flat)) {
    if (handled.has(key)) continue;
    legacy[key] = value;
    warnings.push('未识别字段已保留到 legacy: ' + key);
  }

  const out = { version: FORMAT_VERSION, core };
  out.capabilities = capabilities;
  if (Object.keys(legacy).length > 0) out.legacy = legacy;
  return { ok: true, config: out, warnings };
}

/** 带上限的深拷贝（防止循环引用把 JSON.stringify 拖死） */
function safeClone(value, depth) {
  const d = depth || 0;
  if (d > 8) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => safeClone(v, d + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const c = safeClone(v, d + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/**
 * v2（命名空间化） → v1（扁平）。纯函数，用作兼容层。
 * 结构畸形时尽量摊平已识别的部分，并把问题记入 warnings（不抛错）。
 * @returns {{ok:boolean, config:object, warnings:string[]}}
 */
function decodeV2(doc) {
  const warnings = [];
  const flat = {};

  if (!isPlainObject(doc)) {
    return { ok: false, config: {}, warnings: ['配置不是一个对象'] };
  }

  if (isPlainObject(doc.core)) {
    for (const [k, v] of Object.entries(doc.core)) {
      flat[k] = safeClone(v);
    }
  } else if (doc.core !== undefined) {
    warnings.push('core 不是对象，已忽略');
  }

  if (isPlainObject(doc.capabilities)) {
    // 渲染侧能力配置摊平回同一个命名空间（与 v1 的用法一致）。
    // 注意必须先接住 core.capabilities（主进程能力开关，前面已放进 flat），
    // 否则这里会把它们整体覆盖掉。
    const store = isPlainObject(flat.capabilities) ? flat.capabilities : {};
    for (const [id, entry] of Object.entries(doc.capabilities)) {
      if (GROUP_NAMES.has(id)) continue;
      if (!isPlainObject(entry)) continue;
      if (id === RESERVED_CAPS_KEY) {
        // `_caps` 里是「与分组撞名的能力」的配置，逐个还原到各自 id
        for (const [realId, realEntry] of Object.entries(entry)) {
          if (!isPlainObject(realEntry)) continue;
          store[realId] = Object.assign({}, store[realId], safeClone(realEntry));
        }
        continue;
      }
      store[id] = Object.assign({}, store[id], safeClone(entry));
    }
    if (Object.keys(store).length > 0) flat.capabilities = store;

    // file-manager / dock 等分组回到顶层
    for (const group of CAPABILITY_GROUPS) {
      const bucket = doc.capabilities[group.group];
      if (bucket === undefined) continue;
      if (!isPlainObject(bucket)) {
        warnings.push('capabilities.' + group.group + ' 不是对象，已忽略');
        continue;
      }
      for (const [k, v] of Object.entries(bucket)) {
        flat[k] = safeClone(v);
      }
    }
  } else if (doc.capabilities !== undefined) {
    warnings.push('capabilities 不是对象，已忽略');
  }

  if (isPlainObject(doc.legacy)) {
    for (const [k, v] of Object.entries(doc.legacy)) {
      flat[k] = safeClone(v);
    }
  }

  return { ok: true, config: flat, warnings };
}

/** 是否已是 v2 文档 */
function isV2(doc) {
  return isPlainObject(doc) && doc.version === FORMAT_VERSION &&
    (isPlainObject(doc.core) || isPlainObject(doc.capabilities));
}

/**
 * 把内存中的扁平配置编码为待写盘的文档（始终 v2）。
 * 这样"内部扁平、磁盘 v2"两个视图不会互相污染。
 */
function encodeForDisk(flat) {
  const res = migrateToV2(flat);
  if (res.ok) return res.config;
  // 极端情况（内存里不是对象）：至少写出版本号，避免磁盘上留下非文档结构
  return { version: FORMAT_VERSION, core: {}, capabilities: {} };
}

module.exports = {
  FORMAT_VERSION,
  MAPPING,
  CORE_KEYS,
  isPlainObject,
  isV2,
  migrateToV2,
  decodeV2,
  encodeForDisk
};
