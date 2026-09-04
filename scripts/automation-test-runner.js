#!/usr/bin/env node
/**
 * Unit-test runner for the auto-booking decision logic (Steps 3-6, 8-downgrade).
 *
 * The pure module (src/automation.ts) is React-Native-free so it can be unit-tested
 * under plain Node exactly like the plan / notify / finance suites. This script:
 *   1. Transpiles the pure module + the test suite via ts.transpileModule (strips
 *      types only, no type checking, no module resolution) into a project-local
 *      `.tmptest` tree that preserves relative import structure.
 *   2. Runs the suite as an isolated Node child process (own exit code).
 *   3. Aggregates the result.
 *
 * No APK is built and React Native is never loaded.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmptest');

const FILES = [
  ['src/types.ts', 'types.js'],
  ['src/automation.ts', 'automation.js'],
  ['src/__automation_tests.ts', '__automation_tests.js'],
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

const SUITES = [['Auto-booking decision logic (match / apply / suggest / canAutoBook / undo)', '__automation_tests.js']];

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
