// Minimal, dependency-free base64 for Uint8Array <-> string.
// Standard RFC 4648 with '=' padding, matching btoa/atob semantics.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const e0 = b0 >> 2;
    const e1 = ((b0 & 3) << 4) | (b1 >> 4);
    const e2 = ((b1 & 15) << 2) | (b2 >> 6);
    const e3 = b2 & 63;
    out += B64[e0] + B64[e1];
    out += i + 1 < bytes.length ? B64[e2] : '=';
    out += i + 2 < bytes.length ? B64[e3] : '=';
  }
  return out;
}

export function b64ToBytes(b64: string): Uint8Array {
  const c = b64;
  const groups = Math.floor(c.length / 4);
  const last = c.slice(-4);
  let lastBytes = 3;
  if (last.endsWith('==')) lastBytes = 1;
  else if (last.endsWith('=')) lastBytes = 2;
  const out = new Uint8Array(groups * 3 - (3 - lastBytes));
  let p = 0;
  for (let i = 0; i < c.length; i += 4) {
    const c0 = B64.indexOf(c[i]);
    const c1 = B64.indexOf(c[i + 1]);
    const c2 = c[i + 2] !== '=' && c[i + 2] !== undefined ? B64.indexOf(c[i + 2]) : -1;
    const c3 = c[i + 3] !== '=' && c[i + 3] !== undefined ? B64.indexOf(c[i + 3]) : -1;
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    out[p++] = (n >> 16) & 255;
    if (c2 >= 0) out[p++] = (n >> 8) & 255;
    if (c3 >= 0) out[p++] = n & 255;
  }
  return out;
}
