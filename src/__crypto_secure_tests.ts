// Unit tests for the crypto + secure-storage security invariants.
//
// DE-IDENTIFIED SAMPLE DATA ONLY. No real passwords, keys, backup URLs, or
// financial figures are used. The string below is a fabricated, obviously-fake
// record used purely to exercise encrypt/decrypt round-trips.
//
// Run via scripts/crypto-secure-test-runner.js (transpiles these modules and
// runs them under plain Node — React Native is never loaded).
import './crypto_secure_setup';
import { encryptText, decryptText, SecureRandomUnavailableError } from './crypto';
import {
  secureGet,
  secureSet,
  secureDelete,
  SECURE_KEYS,
  SecureStoreUnavailableError,
} from './secure';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name);
  }
}

function eq(name: string, a: unknown, b: unknown) {
  ok(`${name} (${JSON.stringify(a)} == ${JSON.stringify(b)})`, a === b);
}

async function rejects(name: string, fn: () => Promise<unknown>, Ctor?: any) {
  try {
    await fn();
    fail++;
    console.log('FAIL', name, '(expected rejection, got none)');
  } catch (e: any) {
    const matches = !Ctor || e instanceof Ctor;
    if (matches) {
      pass++;
      console.log('PASS', name);
    } else {
      fail++;
      console.log('FAIL', name, `(wrong error type: ${e && e.name})`);
    }
  }
}

// Fabricated, clearly-fake record — NOT real data.
const SAMPLE = 'category:food;merchant:CoffeeShop;amount:12.50;note:lunch';
const PASS = 'test-password-not-real';

(async () => {
  // 1) Normal round-trip (uses the available CSPRNG — globalThis.crypto in Node).
  const blob = await encryptText(SAMPLE, PASS);
  const back = await decryptText(blob, PASS);
  eq('encrypt/decrypt round-trip', back, SAMPLE);

  // 2) Backup format compatibility — must stay { v:1, s:16B, i:12B, c:ct+tag }.
  const o = JSON.parse(blob);
  eq('format.version', o.v, 1);
  eq('format.salt is 16 bytes', Buffer.from(o.s, 'base64').length, 16);
  eq('format.iv is 12 bytes', Buffer.from(o.i, 'base64').length, 12);
  ok('format.ciphertext present', typeof o.c === 'string' && o.c.length > 0);

  // 3) Wrong password must fail to decrypt (GCM authentication).
  await rejects('decrypt with wrong password throws', () => decryptText(blob, 'wrong-pass'));

  // 4) Tampered ciphertext must fail to decrypt (GCM tag verification).
  const o2 = JSON.parse(blob);
  const c: string = o2.c;
  o2.c = c.slice(0, -1) + (c.slice(-1) === 'A' ? 'B' : 'A');
  await rejects('decrypt with tampered ciphertext throws', () => decryptText(JSON.stringify(o2), PASS));

  // 5) Secure random unavailable -> encryptText MUST reject (never degrade).
  const savedCrypto = (globalThis as any).crypto;
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  await rejects(
    'encryptText rejects when no CSPRNG is available',
    () => encryptText(SAMPLE, PASS),
    SecureRandomUnavailableError
  );
  Object.defineProperty(globalThis, 'crypto', { value: savedCrypto, configurable: true });

  // 6) STRICT secret (sync password) must NEVER downgrade to AsyncStorage.
  await rejects(
    'strict syncPass secureSet never writes to AsyncStorage',
    () => secureSet(SECURE_KEYS.syncPass, 'super-secret'),
    SecureStoreUnavailableError
  );
  // A strict get must not read anything back from the (stubbed) AsyncStorage.
  const strictGet = await secureGet(SECURE_KEYS.syncPass);
  eq('strict syncPass secureGet returns empty when store unavailable', strictGet, '');

  // 7) FALLBACK secret (sbKey, non-secret) downgrades and round-trips via stub.
  await secureSet(SECURE_KEYS.sbKey, 'anon-pub-key');
  const got = await secureGet(SECURE_KEYS.sbKey);
  eq('sbKey fallback write/read round-trip', got, 'anon-pub-key');
  await secureDelete(SECURE_KEYS.sbKey);
  const afterDelete = await secureGet(SECURE_KEYS.sbKey);
  eq('sbKey fallback delete clears value', afterDelete, '');

  console.log(`\n==== crypto/secure: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
})();
