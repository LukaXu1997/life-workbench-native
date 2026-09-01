import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToB64, b64ToBytes } from './base64';

// Cross-compatible with the PWA's Web Crypto AES-GCM + PBKDF2 backup:
//   salt 16B, iv 12B, AES-256-GCM, PBKDF2(SHA-256, 100000 iters, 32B key)
// Output JSON: { v:1, s:saltB64, i:ivB64, c:ct+tagB64 }

const enc = new TextEncoder();
const dec = new TextDecoder();

function getRandomValues(len: number): Uint8Array {
  const g: any = (globalThis as any).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const a = new Uint8Array(len);
    g.getRandomValues(a);
    return a;
  }
  // Fallback (RN without Web Crypto) — adequate for salt/iv generation.
  const a = new Uint8Array(len);
  for (let i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}

function deriveKey(pass: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, enc.encode(pass), salt, { c: 100000, dkLen: 32 });
}

export async function encryptText(text: string, pass: string): Promise<string> {
  const salt = getRandomValues(16);
  const iv = getRandomValues(12);
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
