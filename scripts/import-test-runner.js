#!/usr/bin/env node
/**
 * Unit-test runner for the Unified Importer (Phase 1) pure logic.
 *
 * Mirrors scripts/notify-test-runner.js: transpiles every pure module + the test
 * suite via ts.transpileModule into a project-local `.tmptest` tree (preserving
 * relative imports so `require('./schemas')` still resolves), then runs the suite
 * as an isolated Node child process. No APK is built and React Native is never
 * loaded. `zod` resolves through the project's node_modules.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmptest');

// [sourceRelFromRoot, outputRelFromOUT]
const FILES = [
  ['src/types.ts', 'types.js'],
  ['src/datetime.ts', 'datetime.js'],
  ['src/calc.ts', 'calc.js'],
  ['src/migration.ts', 'migration.js'],
  ['src/money.ts', 'money.js'],
  ['src/import/models.ts', 'import/models.js'],
  ['src/import/limits.ts', 'import/limits.js'],
  ['src/import/fileDetect.ts', 'import/fileDetect.js'],
  ['src/import/charset.ts', 'import/charset.js'],
  ['src/import/schemas.ts', 'import/schemas.js'],
  ['src/import/migration.ts', 'import/migration.js'],
  ['src/import/sourceDetect.ts', 'import/sourceDetect.js'],
  ['src/import/adapters/types.ts', 'import/adapters/types.js'],
  ['src/import/adapters/alipayCsv.ts', 'import/adapters/alipayCsv.js'],
  ['src/import/adapters/myrEwalletCsv.ts', 'import/adapters/myrEwalletCsv.js'],
  ['src/import/adapters/wechatXlsx.ts', 'import/adapters/wechatXlsx.js'],
  ['src/import/ownerProfile.ts', 'import/ownerProfile.js'],
  ['src/import/adapters/tngPdf.ts', 'import/adapters/tngPdf.js'],
  ['src/import/pdfPassword.ts', 'import/pdfPassword.js'],
  ['src/import/pdfExtractFlow.ts', 'import/pdfExtractFlow.js'],
  ['src/import/standardize.ts', 'import/standardize.js'],
  ['src/import/autoCategorize.ts', 'import/autoCategorize.js'],
  ['src/import/matchers/types.ts', 'import/matchers/types.js'],
  ['src/import/matchers/duplicate.ts', 'import/matchers/duplicate.js'],
  ['src/import/matchers/transfer.ts', 'import/matchers/transfer.js'],
  ['src/import/matchers/refund.ts', 'import/matchers/refund.js'],
  ['src/import/matchers/settlement.ts', 'import/matchers/settlement.js'],
  ['src/import/matchers/crossCurrency.ts', 'import/matchers/crossCurrency.js'],
  ['src/import/unify.ts', 'import/unify.js'],
  ['src/import/recompute.ts', 'import/recompute.js'],
  ['src/import/importService.ts', 'import/importService.js'],
  ['src/import/accountResolver.ts', 'import/accountResolver.js'],
  ['src/statusBar.ts', 'statusBar.js'],
  ['src/uiTasks.ts', 'uiTasks.js'],
  ['src/__ui_tests.ts', '__ui_tests.js'],
  ['src/import/__phase1_tests.ts', 'import/__phase1_tests.js'],
  ['src/import/__phase2_tests.ts', 'import/__phase2_tests.js'],
  ['src/import/__phase3_tests.ts', 'import/__phase3_tests.js'],
  ['src/import/__phase4_tests.ts', 'import/__phase4_tests.js'],
  ['src/import/__phase5_tests.ts', 'import/__phase5_tests.js'],
  ['src/import/__phase6_tests.ts', 'import/__phase6_tests.js'],
  ['src/import/__phase7_tests.ts', 'import/__phase7_tests.js'],
  ['src/import/__phase8_tests.ts', 'import/__phase8_tests.js'],
  ['src/import/__phase9_tests.ts', 'import/__phase9_tests.js'],
  ['src/import/__e2e_real_tests.ts', 'import/__e2e_real_tests.js'],
];

const TRANSPILE_OPTS = {
  module: 1 /* CommonJS */,
  target: 7 /* ES2019 */,
  esModuleInterop: true,
  jsx: 0 /* None */,
};

function transpileAll() {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  for (const [srcRel, outRel] of FILES) {
    const src = fs.readFileSync(path.join(ROOT, srcRel), 'utf8');
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: TRANSPILE_OPTS,
      fileName: path.basename(srcRel),
      reportDiagnostics: false,
    });
    const outAbs = path.join(OUT, outRel);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, outputText);
  }
  console.log(`transpiled ${FILES.length} modules -> ${OUT}`);
}

const SUITES = [
  ['Phase 1  models / fileDetect / sourceDetect / schemas / migration', 'import/__phase1_tests.js'],
  ['Phase 2  charset (GB18030/UTF-8) / Alipay CSV adapter', 'import/__phase2_tests.js'],
  ['Phase 3  WeChat XLSX adapter (SheetJS)', 'import/__phase3_tests.js'],
  ['Phase 4  TNG PDF adapter / owner profile / password session+flow', 'import/__phase4_tests.js'],
  ['Phase 5  standardize / autoCategorize / matchers / unify', 'import/__phase5_tests.js'],
  ['Phase 6  ImportService (commit/undo) / recompute R3', 'import/__phase6_tests.js'],
  ['Phase 7  dual-currency (MYR/CNY) monthly budget', 'import/__phase7_tests.js'],
  ['Phase 8  dual-currency budget rules (independent / 理财 / cross-card / thresholds)', 'import/__phase8_tests.js'],
  ['Phase 9  MYR e-wallet CSV adapters (GrabPay / ShopeePay / Lazada)', 'import/__phase9_tests.js'],
  ['E2E  real files (Alipay CSV / WeChat XLSX / TNG PDF) — in-memory', 'import/__e2e_real_tests.js'],
  ['UI  status-bar + Tasks add-form logic', '__ui_tests.js'],
];

function runAll() {
  let failedSuites = 0;
  for (const [label, rel] of SUITES) {
    const file = path.join(OUT, rel);
    if (!fs.existsSync(file)) {
      console.log(`\n=== ${label} ===\n  !! SKIPPED (missing ${rel})`);
      failedSuites++;
      continue;
    }
    const res = spawnSync(process.execPath, [file], { cwd: OUT, encoding: 'utf8' });
    const out = `${(res.stdout || '').trim()}\n${(res.stderr || '').trim()}`.trim();
    console.log(`\n=== ${label} ===`);
    console.log(out || '(no output)');
    if (res.status !== 0) {
      failedSuites++;
      console.log(`  !! ${label} FAILED (exit ${res.status})`);
    }
  }
  console.log(
    `\n==== CONSOLIDATED RESULT: ${
      failedSuites === 0 ? 'ALL SUITES GREEN' : `${failedSuites} SUITE(S) FAILED`
    } ====`
  );
  process.exit(failedSuites === 0 ? 0 : 1);
}

transpileAll();
runAll();
