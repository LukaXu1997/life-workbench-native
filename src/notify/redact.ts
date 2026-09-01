import { sha256 } from '@noble/hashes/sha256';

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// One-way safe digest of (pkg + full text). Stored only for audit / same-notification
// dedup. The raw notification text is NEVER persisted.
export function safeDigest(pkg: string, text: string): string {
  return toHex(sha256(`${pkg}|${text}`));
}

// Mask long digit runs (likely account / card numbers) before ANY logging.
// Short numbers (amounts, dates) are left intact.
export function redactForLog(s: string): string {
  if (!s) return '';
  return s.replace(/\d{6,}/g, (m) => `${m.slice(0, 2)}****${m.slice(-2)}`);
}

// Masked preview that contains only extracted merchant/amount tokens — never the
// full notification text. Safe to surface to the user for verification.
export function maskedPreview(merchant: string, amount: string): string {
  return `merchant=${redactForLog(merchant)} amount=${redactForLog(amount)}`;
}
