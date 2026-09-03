import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToB64, b64ToBytes } from './base64';

// Cross-compatible with the PWA's Web Crypto AES-GCM + PBKDF2 backup:
//   salt 16B, iv 12B, AES-256-GCM, PBKDF2(SHA-256, 100000 iters, 32B key)
// Output JSON: { v:1, s:saltB64, i:ivB64, c:ct+tagB64 }

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Thrown when no cryptographically-secure random source is available on the
 * device. Callers MUST treat this as a hard failure: never fall back to a
 * weaker RNG, never proceed with an encryption/backup operation. The backup
 * flow surfaces a recoverable error to the user and disables cloud sync.
 */
export class SecureRandomUnavailableError extends Error {
  constructor() {
    super(
      'Secure random source unavailable: cannot safely generate salt/IV. ' +
      'Aborting encryption. Cloud backup/sync has been disabled to protect your data.'
    );
    this.name = 'SecureRandomUnavailableError';
  }
}

// Lazily resolved native CSPRNG from expo-crypto (iOS SecRandomCopyBytes /
// Android SecureRandom). Wrapped in a function so requiring expo-crypto never
// breaks module load in environments without the native module (e.g. the
// Node test runner), and so a missing native binding degrades to Web Crypto
// rather than crashing.
let _nativeRandom: ((n: number) => Promise<Uint8Array>) | null | undefined;
function getNativeRandomBytes(): ((n: number) => Promise<Uint8Array>) | null {
  if (_nativeRandom !== undefined) return _nativeRandom;
  try {
    // Lazy require: the native module is absent in Node test runs and some
    // stripped builds. We never want a missing native crypto to crash load.
    const mod: any = require('expo-crypto');
    _nativeRandom =
      mod && typeof mod.getRandomBytesAsync === 'function'
        ? (n: number) => mod.getRandomBytesAsync(n)
        : null;
  } catch {
    _nativeRandom = null;
  }
  return _nativeRandom;
}

/**
 * Returns `len` cryptographically-secure random bytes.
 *
 * Resolution order:
 *   1. expo-crypto native RNG (device)  — iOS SecRandomCopyBytes / Android SecureRandom
 *   2. globalThis.crypto.getRandomValues (Web Crypto, available in Node tests)
 *   3. otherwise throw SecureRandomUnavailableError (caller must fail loudly)
 *
 * The previous non-CSPRNG fallback has been removed: a weak salt/IV
 * would silently weaken AES-GCM and must never be used.
 */
async function getSecureRandom(len: number): Promise<Uint8Array> {
  const native = getNativeRandomBytes();
  if (native) {
    return native(len);
  }
  const g: any = (globalThis as any).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const a = new Uint8Array(len);
    g.getRandomValues(a);
    return a;
  }
  throw new SecureRandomUnavailableError();
}

function deriveKey(pass: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, enc.encode(pass), salt, { c: 100000, dkLen: 32 });
}

export async function encryptText(text: string, pass: string): Promise<string> {
  // Propagates SecureRandomUnavailableError so the backup operation fails
  // loudly instead of falling back to an insecure RNG.
  const salt = await getSecureRandom(16);
  const iv = await getSecureRandom(12);
  const key = deriveKey(pass, salt);
  const cipher = gcm(key, iv);
  const ct = cipher.encrypt(enc.encode(text)); // ciphertext || 16-byte tag
  return JSON.stringify({
    v: 1,
    s: bytesToB64(salt),
    i: bytesToB64(iv),
    c: bytesToB64(ct),
  });
}

export async function decryptText(blob: string, pass: string): Promise<string> {
  const o = JSON.parse(blob);
  const salt = b64ToBytes(o.s);
  const iv = b64ToBytes(o.i);
  const key = deriveKey(pass, salt);
  const cipher = gcm(key, iv);
  const pt = cipher.decrypt(b64ToBytes(o.c));
  return dec.decode(pt);
}
