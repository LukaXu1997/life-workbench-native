#!/usr/bin/env node
/**
 * Unit-test runner for the crypto + secure-storage security invariants.
 *
 * The crypto/secure code paths are deliberately React-Native-free so they can be
 * unit-tested under plain Node:
 *   - crypto.ts   : AES-256-GCM + PBKDF2 backup encryption (no Math.random fallback)
 *   - secure.ts   : strict vs. fallback key policy (sync password never downgrades)
 *
 * This script:
 *   1. Transpiles the modules + test suite via ts.transpileModule (strips types,
 *      preserves relative import structure) into a project-local `.tmptest` tree.
 *   2. Runs the suite as an isolated Node child process. The suite reports its own
 *      pass/fail and exits non-zero on failure.
 *   3. Propagates the exit code.
 *
 * The in-memory AsyncStorage stub is injected by __crypto_secure_setup.ts (imported
 * first by the suite) so the FALLBACK policy is exercised without the native module.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmptest');

// [sourceRelFromRoot, outputRelFromOUT] — output preserves relative structure.
const FILES = [
  ['src/base64.ts', 'base64.js'],
  ['src/crypto.ts', 'crypto.js'],
  ['src/secure.ts', 'secure.js'],
  ['src/__crypto_secure_setup.ts', 'crypto_secure_setup.js'],
  ['src/__crypto_secure_tests.ts', 'crypto_secure_tests.js'],
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

const SUITES = [['Crypto + Secure storage invariants', 'crypto_secure_tests.js']];

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
