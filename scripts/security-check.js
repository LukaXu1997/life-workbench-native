#!/usr/bin/env node
/**
 * Release security gate (task 五 — "不可绕过的发布验证").
 *
 * This is the single, hard-to-bypass verification step that enforces the
 * crypto/secure-storage invariants statically AND dynamically before any
 * release:
 *
 *   STATIC   — grep the source for forbidden patterns so a future edit can
 *              never silently re-introduce an insecure fallback (e.g. a
 *              Math.random() salt/IV, or a strict secret downgraded to
 *              AsyncStorage plaintext).
 *
 *   DYNAMIC  — run the crypto/secure unit suite under plain Node (no RN), which
 *              proves: normal round-trip works, wrong-password / tampered
 *              ciphertext fail, a missing CSPRNG makes encryptText reject, the
 *              strict sync password never touches AsyncStorage, and the
 *              FALLBACK sbKey downgrades correctly.
 *
 * Exits non-zero if any check fails. `npm run verify` depends on this.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ---- static invariants -------------------------------------------------------
// Each check: { files:[rel], re:Regexp, mode:'exist'|'absent', desc }
const CHECKS = [
  {
    files: ['src/crypto.ts'],
    re: /Math\.random/,
    mode: 'absent',
    desc: 'crypto.ts must NOT use Math.random() for salt/IV (CSPRNG only)',
  },
  {
    files: ['src/secure.ts'],
    re: /SecureStoreUnavailableError/,
    mode: 'exist',
    desc: 'secure.ts must define SecureStoreUnavailableError (strict path exists)',
  },
  {
    files: ['src/secure.ts'],
    re: /isStrict\(\s*key\s*\)/,
    mode: 'exist',
    desc: 'secure.ts must guard STRICT keys before any AsyncStorage fallback',
  },
  {
    files: ['src/secure.ts'],
    re: /throw new SecureStoreUnavailableError/,
    mode: 'exist',
    desc: 'secure.ts must THROW (not downgrade) when a STRICT secret cannot be persisted',
  },
  {
    files: ['src/store.ts'],
    re: /confirmed === oldPass/,
    mode: 'exist',
    desc: 'store.ts migrateSecrets must verify the secure write BEFORE deleting the legacy plaintext',
  },
  {
    files: ['src/cloud.ts'],
    re: /SecureRandomUnavailableError/,
    mode: 'exist',
    desc: 'cloud.ts must surface SecureRandomUnavailableError as a recoverable result',
  },
  {
    files: ['src/i18n/zh.ts', 'src/i18n/en.ts'],
    re: /secureRandomUnavailable/,
    mode: 'exist',
    desc: 'i18n (zh/en) must expose cloud.secureRandomUnavailable',
  },
  {
    files: ['src/i18n/zh.ts', 'src/i18n/en.ts'],
    re: /secureStoreUnavailable/,
    mode: 'exist',
    desc: 'i18n (zh/en) must expose cloud.secureStoreUnavailable',
  },
  {
    // No secret material may be written to the log from these modules. We match
    // standalone secret tokens (e.g. `pass`, `syncPass`, `sbKey`, `apikey`,
    // `token`, `Authorization`) inside a console call — descriptive words like
    // "password" in a message are allowed, since no secret VALUE is emitted.
    files: ['src/crypto.ts', 'src/secure.ts', 'src/store.ts', 'src/cloud.ts'],
    re: /console\.(log|warn|error)\(\s*[^)]*\b(pass|pwd|syncPass|sbKey|sbUrl|apikey|token|Authorization)\b/i,
    mode: 'absent',
    desc: 'no secret material (pass/syncPass/sbKey/apikey/token) may be passed to a console call',
  },
];

function runStaticChecks() {
  let failed = 0;
  for (const c of CHECKS) {
    for (const rel of c.files) {
      const abs = path.join(ROOT, rel);
      const text = fs.readFileSync(abs, 'utf8');
      const hit = c.re.test(text);
      const ok = c.mode === 'exist' ? hit : !hit;
      if (!ok) {
        failed++;
        console.log(`FAIL [static] ${rel}: ${c.desc}`);
      } else {
        console.log(`PASS [static] ${rel}: ${c.desc}`);
      }
    }
  }
  return failed;
}

function runDynamicSuite() {
  console.log('\n--- running crypto/secure unit suite ---');
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'crypto-secure-test-runner.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return res.status === 0 ? 0 : 1;
}

console.log('=== SECURITY GATE ===');
const staticFailures = runStaticChecks();
const dynamicFailure = runDynamicSuite();
const totalFail = staticFailures + dynamicFailure;

console.log(
  `\n==== SECURITY GATE: ${
    totalFail === 0 ? 'PASS' : `FAIL (${totalFail} problem(s))`
  } ====`
);
process.exit(totalFail === 0 ? 0 : 1);
