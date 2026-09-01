#!/usr/bin/env node
/**
 * Consolidated unit-test runner for the notification -> quick-bookkeeping pure logic.
 *
 * The notification pipeline (parsers / recognizer / dedup / redact / ingest / confirm /
 * quickAdd) is deliberately React-Native-free so it can be unit-tested under plain Node.
 * This script:
 *   1. Transpiles every pure module + every test suite via ts.transpileModule (no type
 *      checking, no module resolution — just strip types) into a project-local `.tmptest`
 *      tree that preserves relative import structure (so `require('../money')` still works).
 *   2. Runs each test suite as an isolated Node child process. Each suite reports its own
 *      pass/fail and exits non-zero on failure, so a crash in one suite can't poison another.
 *   3. Aggregates the exit codes and prints a consolidated result.
 *
 * No APK is built and React Native is never loaded. `@noble/hashes` (used by redact.ts)
 * resolves through the project's node_modules because the output tree lives inside the repo.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmptest');

// [sourceRelFromRoot, outputRelFromOUT] — output preserves relative structure.
const FILES = [
  ['src/money.ts', 'money.js'],
  ['src/types.ts', 'types.js'],
  ['src/notify/uid.ts', 'notify/uid.js'],
  ['src/notify/parsers.ts', 'notify/parsers.js'],
  ['src/notify/recognizer.ts', 'notify/recognizer.js'],
  ['src/notify/dedup.ts', 'notify/dedup.js'],
  ['src/notify/redact.ts', 'notify/redact.js'],
  ['src/notify/ingest.ts', 'notify/ingest.js'],
  ['src/notify/confirm.ts', 'notify/confirm.js'],
  ['src/notify/confirmForm.ts', 'notify/confirmForm.js'],
  ['src/notify/quickAdd.ts', 'notify/quickAdd.js'],
  ['src/notify/__phase2_tests.ts', 'notify/__phase2_tests.js'],
  ['src/notify/__phase3_tests.ts', 'notify/__phase3_tests.js'],
  ['src/notify/__quickadd_tests.ts', 'notify/__quickadd_tests.js'],
  ['src/notify/__phase6_tests.ts', 'notify/__phase6_tests.js'],
  ['src/notify/__confirm_form_tests.ts', 'notify/__confirm_form_tests.js'],
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
    const { outputText, diagnostics } = ts.transpileModule(src, {
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
  ['Phase 2  parsers / recognizer / dedup / redact', 'notify/__phase2_tests.js'],
  ['Phase 3  confirm / reconcile (cross-currency posting match)', 'notify/__phase3_tests.js'],
  ['Phase 5  quickAdd (deep-link / share / build)', 'notify/__quickadd_tests.js'],
  ['Phase 6  ingest / redact / fingerprint stability', 'notify/__phase6_tests.js'],
  ['Confirm form auto-fill (amount / late load / no-clobber / account suggest)', 'notify/__confirm_form_tests.js'],
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
