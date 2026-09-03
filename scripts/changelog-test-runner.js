#!/usr/bin/env node
/**
 * 更新记录（changelog）双语文案校验。
 *
 * 目的：保证「设置 → 关于 → 查看更新内容」展示的是面向普通用户的产品化文案，
 * 且中英文两套内容完整、对齐、不含开发术语，历史版本不丢失。
 *
 * 校验项：
 *   1. 版本列表非空、版本号格式正确、无重复
 *   2. 严格倒序（最新在最前），且首个版本等于当前 DISPLAY_VERSION
 *   3. 发布日期格式与合法性
 *   4. 中英文标题与更新项：非空、条数相等、每版 2–5 条
 *   5. 语言纯净度：中文条目必须含中文字符；英文条目不得含中文字符
 *   6. 禁用开发术语（commit / schema / versionCode / Gradle / 代码文件名 / 安全实现细节 …）
 *   7. 日期格式化输出符合预期
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

/** 把零依赖的 TS 模块转译为 CommonJS 后加载（changelog.ts / version.ts 均无 import）。 */
function loadTsModule(relPath) {
  const abs = path.join(ROOT, relPath);
  const src = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(src, {
    fileName: abs,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', out);
  fn(mod.exports, require, mod, abs, path.dirname(abs));
  return mod.exports;
}

const failures = [];
let checks = 0;

function ok(cond, message) {
  checks += 1;
  if (!cond) failures.push(message);
}

const HAN = /[㐀-䶿一-鿿豈-﫿]/;

// 开发术语 / 内部实现细节黑名单（统一小写后匹配）。
const FORBIDDEN = [
  'commit',
  'schema',
  'schemaversion',
  'versioncode',
  'gradle',
  'proguard',
  'asyncstorage',
  'securestore',
  'supabase',
  'csprng',
  'aes-gcm',
  'keystore',
  'logcat',
  'debug',
  'migrat',
  'src/',
  '.ts',
  '.tsx',
  '.kt',
  '.gradle',
  'release-artifacts',
  // 中文开发术语
  '包名',
  '构建',
  '依赖',
  '迁移脚本',
  '内部稳定性改进',
  '修复构建',
  '升级依赖',
];

function scanJargon(text, where) {
  const lower = String(text).toLowerCase();
  for (const word of FORBIDDEN) {
    if (lower.includes(word)) {
      failures.push(`${where} 含开发术语「${word}」：${text}`);
      return;
    }
  }
}

function semver(version) {
  const m = /^V(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function main() {
  const { CHANGELOG, formatChangelogDate, changelogCopy } = loadTsModule('src/changelog.ts');
  const { DISPLAY_VERSION } = loadTsModule('src/version.ts');

  ok(Array.isArray(CHANGELOG), 'CHANGELOG 必须是数组');
  ok(CHANGELOG.length > 0, 'CHANGELOG 不能为空（历史版本不得删除）');

  const seen = new Set();
  let prev = null;

  CHANGELOG.forEach((entry, index) => {
    const at = `#${index + 1} ${entry && entry.version ? entry.version : '(缺失版本号)'}`;
    ok(!!entry, `第 ${index + 1} 条记录为空`);
    if (!entry) return;

    // 1. 版本号
    const v = semver(entry.version);
    ok(!!v, `${at} 版本号格式应为 V主.次.修订（当前：${entry.version}）`);
    ok(!seen.has(entry.version), `${at} 版本号重复`);
    seen.add(entry.version);

    // 2. 倒序
    if (v && prev) {
      ok(cmp(v, prev) < 0, `${at} 排序错误：必须严格由新到旧（上一条为 V${prev.join('.')}）`);
    }
    if (v) prev = v;

    // 3. 日期
    ok(
      typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date),
      `${at} 日期格式应为 YYYY-MM-DD（当前：${entry.date}）`,
    );
    if (typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      const d = new Date(`${entry.date}T00:00:00Z`);
      ok(!Number.isNaN(d.getTime()), `${at} 日期不合法：${entry.date}`);
    }

    // 4. 双语文案
    for (const lang of ['zh', 'en']) {
      const copy = entry[lang];
      ok(!!copy, `${at} 缺少 ${lang} 文案`);
      if (!copy) continue;
      ok(typeof copy.title === 'string' && copy.title.trim().length > 0, `${at} ${lang}.title 不能为空`);
      ok(Array.isArray(copy.items), `${at} ${lang}.items 必须是数组`);
      if (!Array.isArray(copy.items)) continue;
      ok(
        copy.items.length >= 2 && copy.items.length <= 5,
        `${at} ${lang}.items 需要 2–5 条（当前 ${copy.items.length} 条）`,
      );
      copy.items.forEach((item, i) => {
        ok(typeof item === 'string' && item.trim().length > 0, `${at} ${lang}.items[${i}] 不能为空`);
        ok(item === item.trim(), `${at} ${lang}.items[${i}] 首尾不应有空白`);
      });
    }

    const zhCount = entry.zh && Array.isArray(entry.zh.items) ? entry.zh.items.length : -1;
    const enCount = entry.en && Array.isArray(entry.en.items) ? entry.en.items.length : -1;
    ok(zhCount === enCount, `${at} 中英文更新项条数不一致（zh ${zhCount} / en ${enCount}）`);

    // 5. 语言纯净度
    const zhTexts = [entry.zh && entry.zh.title, ...((entry.zh && entry.zh.items) || [])];
    const enTexts = [entry.en && entry.en.title, ...((entry.en && entry.en.items) || [])];
    zhTexts.forEach((text, i) => {
      if (typeof text !== 'string') return;
      ok(HAN.test(text), `${at} zh 文案不含中文字符：${text}`);
      scanJargon(text, `${at} zh[${i}]`);
    });
    enTexts.forEach((text, i) => {
      if (typeof text !== 'string') return;
      ok(!HAN.test(text), `${at} en 文案不应含中文字符：${text}`);
      scanJargon(text, `${at} en[${i}]`);
    });

    // 运行时取文案的辅助函数应当工作正常
    const picked = changelogCopy(entry, 'zh');
    ok(picked === entry.zh, `${at} changelogCopy(zh) 应返回中文文案`);
    ok(changelogCopy(entry, 'en') === entry.en, `${at} changelogCopy(en) 应返回英文文案`);
  });

  // 2b. 最新版本必须等于当前应用版本
  ok(
    CHANGELOG[0] && CHANGELOG[0].version === DISPLAY_VERSION,
    `最新记录（${CHANGELOG[0] && CHANGELOG[0].version}）应与 src/version.ts 的 DISPLAY_VERSION（${DISPLAY_VERSION}）一致`,
  );

  // 7. 日期格式化
  ok(
    formatChangelogDate('2026-09-03', 'zh') === '2026年9月3日',
    `中文日期格式错误：${formatChangelogDate('2026-09-03', 'zh')}`,
  );
  ok(
    formatChangelogDate('2026-09-03', 'en') === 'Sep 3, 2026',
    `英文日期格式错误：${formatChangelogDate('2026-09-03', 'en')}`,
  );

  const versionCount = CHANGELOG.length;
  const itemCount = CHANGELOG.reduce((sum, e) => sum + (e.zh && e.zh.items ? e.zh.items.length : 0), 0);

  if (failures.length > 0) {
    console.error(`\n✗ 更新记录校验失败（${failures.length} 项 / 共 ${checks} 项检查）\n`);
    failures.forEach((f) => console.error(`  · ${f}`));
    console.error('');
    process.exit(1);
  }

  console.log(
    `✓ 更新记录校验通过：${checks} 项检查 · ${versionCount} 个历史版本 · 每版中英文各 ${itemCount} 条更新项`,
  );
  console.log(`  最新：${CHANGELOG[0].version}（${CHANGELOG[0].date}）· 最早：${CHANGELOG[versionCount - 1].version}`);
}

main();
