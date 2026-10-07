/* 自检：配置结构 v1 → v2 迁移 src/main/config-schema.js
   这是 ROADMAP 里标注「唯一不可逆、要一次做对」的一步，因此测试要求最严：

   1. **绝不丢字段**：真实 config.json 迁移后，所有顶层字段都能在 v2 里找回，
      且值逐字段相等（含数组/对象/数字/null）。
   2. **往返一致**：v1 → v2 → 摊平 后与原对象深度相等（兼容层正确）。
   3. **畸形输入不抛错**：null / 数组 / 字符串 / 深层嵌套 / 自引用都要安全。
   4. **渲染侧能力配置与主进程能力开关正确分家**：
      v1 里两者共用 config.capabilities，迁移后 {enabled} 留 core、其余进能力命名空间。

   本测试不依赖 Electron（config-schema.js 是纯函数模块）。 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const schema = require(path.join(root, 'src', 'main', 'config-schema.js'));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** 深度相等（键顺序无关），用于往返一致性 */
function deepEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

console.log('\n[1] 真实 config.json（已存在的用户数据）迁移零丢失');
{
  const realPath = path.join(root, '.userdata', 'config.json');
  if (!fs.existsSync(realPath)) {
    console.log('  SKIP  .userdata/config.json 不存在（首次运行）');
  } else {
    const raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    const topKeys = Object.keys(raw);
    const res = schema.migrateToV2(raw);

    ok('迁移成功', () => assert.strictEqual(res.ok, true));
    ok('输出为 version 2', () => assert.strictEqual(res.config.version, 2));

    const decoded = schema.decodeV2(res.config);
    ok('往返后拿到 ' + topKeys.length + ' 个顶层字段（一个不少）', () => {
      const missing = topKeys.filter((k) => !(k in decoded.config));
      assert.deepStrictEqual(missing, [], '丢失字段: ' + missing.join(', '));
    });
    ok('每个字段的值与迁移前深度相等', () => {
      for (const k of topKeys) {
        assert.ok(deepEqual(raw[k], decoded.config[k]),
          '字段 ' + k + ' 值不一致\n  迁移前: ' + JSON.stringify(raw[k]) +
          '\n  迁移后: ' + JSON.stringify(decoded.config[k]));
      }
    });
    ok('已废弃的未知键也被保留（迁移不负责清理）', () => {
      // 真实数据里有 snapEdge / desktopIconsHidden 这类当前无人读取的键
      const legacyKeys = topKeys.filter((k) =>
        !schema.CORE_KEYS.includes(k) &&
        !schema.MAPPING.some((m) => m.keys.includes(k)));
      if (legacyKeys.length === 0) return;
      legacyKeys.forEach((k) => {
        assert.ok(k in decoded.config, '废弃键 ' + k + ' 被丢掉了');
      });
    });
    ok('partitions 数组结构与元素完整', () => {
      assert.deepStrictEqual(decoded.config.partitions, raw.partitions);
    });
    ok('dockSettings 对象完整', () => {
      assert.deepStrictEqual(decoded.config.dockSettings, raw.dockSettings);
    });
    ok('navItems 数组长度一致', () => {
      assert.strictEqual(decoded.config.navItems.length, raw.navItems.length);
    });
  }
}

console.log('\n[2] 手工构造的 v1 全字段样本');
{
  const v1 = {
    savePath: 'D:\\uploads',
    preferredPath: 'D:\\pref',
    floatPosition: { x: 1, y: 2 },
    snapEdges: ['left', 'bottom'],
    dockVisible: true,
    floatAlwaysOnTop: false,
    dockAlwaysOnTop: true,
    dockX: 700,
    dockBottom: 1000,
    hideSystemTaskbar: false,
    partitions: [{ id: 'default', name: '常用', paths: [{ name: 'A', path: 'D:\\A' }] }],
    navItems: [{ id: 'nav_explorer', name: '资源管理器', visible: true }],
    dockSettings: { blurMode: 'glass', radius: 24, iconSize: 52 },
    // 能力开关与渲染侧能力配置在 v1 里共用同一命名空间
    capabilities: {
      system: false,
      'quick-upload': { recycleMode: true }
    }
  };
  const res = schema.migrateToV2(v1);  ok('迁移成功', () => assert.strictEqual(res.ok, true));
  ok('窗口/路径类字段进 core', () => {
    assert.strictEqual(res.config.core.savePath, 'D:\\uploads');
    assert.strictEqual(res.config.core.dockX, 700);
    assert.deepStrictEqual(res.config.core.snapEdges, ['left', 'bottom']);
  });
  ok('partitions/preferredPath/navItems 进 capabilities["file-manager"]', () => {
    const fm = res.config.capabilities['file-manager'];
    assert.deepStrictEqual(fm.partitions, v1.partitions);
    assert.strictEqual(fm.preferredPath, 'D:\\pref');
    assert.deepStrictEqual(fm.navItems, v1.navItems);
  });
  ok('dockSettings 进 capabilities.dock', () => {
    assert.deepStrictEqual(res.config.capabilities.dock.dockSettings, v1.dockSettings);
  });
  ok('主进程能力开关（标量 false）留在 core.capabilities', () => {
    assert.strictEqual(res.config.core.capabilities.system, false);
  });
  ok('渲染侧能力配置（对象）进 capabilities["quick-upload"]', () => {
    assert.deepStrictEqual(res.config.capabilities['quick-upload'], { recycleMode: true });
  });
  ok('{enabled:false} 形式的能力开关被抽成 core.capabilities[id]=false', () => {
    const r2 = schema.migrateToV2({ capabilities: { system: { enabled: false } } });
    assert.strictEqual(r2.config.core.capabilities.system, false);
    assert.strictEqual(r2.config.capabilities.system, undefined, '不应残留空命名空间');
  });
  ok('{enabled:false, 其它字段} 两边都要保留（撞名 id 存入 _caps）', () => {
    const r3 = schema.migrateToV2({ capabilities: { dock: { enabled: true, theme: 'dark' } } });
    assert.strictEqual(r3.config.core.capabilities.dock, true);
    // `dock` 同时是 v2 的分组名（dockSettings），为避免与分组混淆，
    // 撞名的能力配置存到保留键 _caps 下
    assert.deepStrictEqual(r3.config.capabilities._caps.dock, { theme: 'dark' });
    assert.strictEqual(r3.config.capabilities.dock, undefined,
      '不得占用分组名 dock');
  });
  ok('撞名能力配置摊平后可还原到自己的能力 id', () => {
    const r3 = schema.migrateToV2({ capabilities: { dock: { enabled: true, theme: 'dark' } } });
    const back = schema.decodeV2(r3.config);
    assert.deepStrictEqual(back.config.capabilities.dock, { theme: 'dark' });
  });
  ok('撞名 id 的已知有损点被固定下来（enabled 不随能力配置一起摊平）', () => {
    // v1 把「能力开关」与「能力配置」压进同一个键，扁平视图无法同时表示两者。
    // 摊平后 doc.capabilities.dock = { theme:'dark' }（不含 enabled），
    // 因此主进程 isEnabled 读到的是「无 enabled 字段 → 用 defaultEnabled（true）」。
    // 结果与迁移前等效，但**确实是有损的**，故在此显式固定，避免以后被当成回归。
    const r3 = schema.migrateToV2({ capabilities: { dock: { enabled: true, theme: 'dark' } } });
    const flatDock = schema.decodeV2(r3.config).config.capabilities.dock;
    assert.strictEqual(flatDock.enabled, undefined, 'enabled 不参与摊平');
    const isEnabledLike = (entry) => {
      if (entry === undefined) return true;
      if (typeof entry === 'boolean') return entry;
      return typeof entry.enabled === 'boolean' ? entry.enabled : true;
    };
    assert.strictEqual(isEnabledLike(flatDock), true, '默认启用，与迁移前 true 等效');
    assert.strictEqual(isEnabledLike(false), false);
    assert.strictEqual(isEnabledLike({ enabled: false }), false);
  });
  ok('往返一致（v1 → v2 → 摊平 深度相等）', () => {
    const back = schema.decodeV2(res.config);
    assert.ok(deepEqual(v1, back.config),
      '往返不一致\n  原始: ' + JSON.stringify(sortKeys(v1)) +
      '\n  回来: ' + JSON.stringify(sortKeys(back.config)));
  });
}

console.log('\n[3] 未识别字段进 legacy 并给出警告');
{
  const res = schema.migrateToV2({ savePath: 'D:\\x', totallyUnknown: 42, another: { a: 1 } });
  ok('未识别字段被保留到 legacy', () => {
    assert.strictEqual(res.config.legacy.totallyUnknown, 42);
    assert.deepStrictEqual(res.config.legacy.another, { a: 1 });
  });
  ok('给出警告而不是静默丢弃', () => {
    assert.ok(res.warnings.some((w) => w.includes('totallyUnknown')));
  });
  ok('legacy 可被摊平回顶层（兼容层）', () => {
    const back = schema.decodeV2(res.config);
    assert.strictEqual(back.config.totallyUnknown, 42);
    assert.deepStrictEqual(back.config.another, { a: 1 });
  });
  ok('没有未识别字段时不产生 legacy 键', () => {
    const r2 = schema.migrateToV2({ savePath: 'D:\\x' });
    assert.strictEqual(r2.config.legacy, undefined);
    assert.deepStrictEqual(r2.warnings, []);
  });
}

console.log('\n[4] 畸形输入：不抛错');
{
  const bad = [null, undefined, 42, 'oops', [], true];
  for (const input of bad) {
    ok('migrateToV2 对 ' + JSON.stringify(input) + ' 安全返回', () => {
      let r;
      assert.doesNotThrow(() => { r = schema.migrateToV2(input); });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.config, null);
      assert.ok(r.warnings.length > 0);
    });
    ok('decodeV2 对 ' + JSON.stringify(input) + ' 安全返回', () => {
      let r;
      assert.doesNotThrow(() => { r = schema.decodeV2(input); });
      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.config, {});
    });
  }

  ok('自引用对象不会死循环（safeClone 有深度上限）', () => {
    const cyc = { savePath: 'D:\\x' };
    cyc.self = cyc;
    let r;
    assert.doesNotThrow(() => { r = schema.migrateToV2(cyc); });
    assert.strictEqual(r.ok, true);
    let back;
    assert.doesNotThrow(() => { back = schema.decodeV2(r.config); });
    assert.strictEqual(back.config.savePath, 'D:\\x');
  });

  ok('core 是数组/字符串时记警告而非抛错', () => {
    const r = schema.decodeV2({ version: 2, core: 'nope' });
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes('core')));
  });

  ok('capabilities 分组不是对象时记警告并跳过', () => {
    const r = schema.decodeV2({ version: 2, core: {}, capabilities: { 'file-manager': 'nope' } });
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes('file-manager')));
  });
}

console.log('\n[5] isV2 判定与 encodeForDisk');
{
  ok('isV2 只认 version=2 且有 core/capabilities 的文档', () => {
    assert.strictEqual(schema.isV2({ version: 2, core: {} }), true);
    assert.strictEqual(schema.isV2({ version: 2, capabilities: {} }), true);
    assert.strictEqual(schema.isV2({ version: 1, savePath: 'x' }), false);
    assert.strictEqual(schema.isV2({ savePath: 'x' }), false);
    assert.strictEqual(schema.isV2(null), false);
    assert.strictEqual(schema.isV2([1, 2]), false);
  });
  ok('encodeForDisk 始终产出 v2 文档', () => {
    const doc = schema.encodeForDisk({ savePath: 'D:\\x', dockSettings: { radius: 24 } });
    assert.strictEqual(doc.version, 2);
    assert.strictEqual(doc.core.savePath, 'D:\\x');
    assert.deepStrictEqual(doc.capabilities.dock.dockSettings, { radius: 24 });
  });
  ok('encodeForDisk 对垃圾输入也产出合法文档（不抛错）', () => {
    const doc = schema.encodeForDisk(null);
    assert.strictEqual(doc.version, 2);
    assert.deepStrictEqual(doc.core, {});
  });
  ok('encodeForDisk → decodeV2 往返一致', () => {
    const flat = { savePath: 'D:\\x', dockVisible: false, dockSettings: { radius: 8 } };
    const back = schema.decodeV2(schema.encodeForDisk(flat));
    assert.ok(deepEqual(flat, back.config));
  });
  ok('多次「读盘→写盘」循环幂等（不会逐次嵌套累积）', () => {
    // 这是最危险的一类回归：每次 saveConfig 都会 encode，
    // 若编码不幂等，分组会被越套越深，配置体积持续膨胀。
    const flat = {
      savePath: 'D:\\x',
      dockSettings: { radius: 24 },
      capabilities: { system: false, 'quick-upload': { recycleMode: true } }
    };
    let doc = schema.encodeForDisk(flat);
    const first = JSON.stringify(doc);
    for (let i = 0; i < 4; i++) {
      doc = schema.encodeForDisk(schema.decodeV2(doc).config);
    }
    assert.strictEqual(JSON.stringify(doc), first, '编码不幂等，配置会逐次膨胀');
  });
}

console.log('\n[6] 大写/嵌套值不被破坏（数字、null、布尔、深层对象）');
{
  const tricky = {
    savePath: 'D:\\路径 with spaces\\中文',
    dockX: 0,
    dockBottom: null,
    dockVisible: false,
    floatPosition: { x: -100, y: 0 },
    dockSettings: { nested: { deep: { value: [1, 2, 3] } } },
    partitions: []
  };
  const res = schema.migrateToV2(tricky);
  const back = schema.decodeV2(res.config);
  ok('0 / null / false / 负数 / 中文路径 / 深层嵌套 / 空数组都原样保留', () => {
    assert.ok(deepEqual(tricky, back.config),
      '往返不一致\n  原始: ' + JSON.stringify(tricky) +
      '\n  回来: ' + JSON.stringify(back.config));
  });
}

console.log('\n通过 ' + pass + ' 项断言' + (process.exitCode ? '，存在失败' : '，全部通过'));
