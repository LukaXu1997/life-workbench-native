// Local, device-side text decoding for imported statements.
//
// Per spec (Phase 2, GB18030 selection):
//   1. Detect UTF-8 BOM first.
//   2. Try strict UTF-8 decode.
//   3. If many replacement chars OR Chinese headers cannot be recognized, try GB18030.
//   4. Validate the decode using brand/header SIGNATURES (e.g. '支付宝').
//   5. If neither UTF-8 nor GB18030 is reliable -> return needs_user_choice so the
//      UI can let the user pick an encoding. We NEVER silently import mojibake.
//   6. Raw transaction text is returned in memory only; this module never logs it.
//
// React-Native note: iconv-lite needs a Buffer implementation under Hermes. The
// `buffer` polyfill is already a dependency; this module imports it explicitly so
// it works in both Node (tests) and RN/Hermes (app). No network, no OCR.

import { Buffer } from 'buffer';
import * as iconv from 'iconv-lite';

export type StatementEncoding = 'utf-8' | 'gb18030';

export type DecodeResult =
  | {
      ok: true;
      text: string;
      encoding: StatementEncoding;
      bom: boolean;
      /** Fraction of decoded chars that are U+FFFD (replacement). 0 = clean. */
      replacementRatio: number;
    }
  | {
      ok: false;
      reason: 'empty' | 'needs_user_choice';
      tried: StatementEncoding[];
      message: string;
    };

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0xfffd) n++;
  }
  return n;
}

function toBuf(input: Uint8Array): Buffer {
  if (Buffer.isBuffer(input)) return input;
  return Buffer.from(input);
}

export interface DecodeOptions {
  /** Brand/header signatures that MUST appear in a correct decode (e.g. ['支付宝']). */
  signatures?: string[];
  /** Max acceptable fraction of replacement chars for a "clean" decode (0..1). */
  maxReplacementRatio?: number;
}

/**
 * Auto-detect the encoding of statement bytes and decode to text.
 * Returns ok:false (needs_user_choice) when no encoding can be trusted.
 */
export function decodeStatement(bytes: Uint8Array, opts: DecodeOptions = {}): DecodeResult {
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: 'empty', tried: [], message: '文件内容为空' };
  }
  const buf = toBuf(bytes);
  const sig = opts.signatures ?? [];
  const maxRatio = opts.maxReplacementRatio ?? 0.02;

  // 1) BOM
  const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

  // 2) UTF-8 attempt
  const utf8 = iconv.decode(hasUtf8Bom ? buf.subarray(3) : buf, 'utf-8');
  const utf8Repl = countReplacement(utf8);
  const utf8Ratio = utf8.length ? utf8Repl / utf8.length : 0;
  const utf8SigOk = sig.length === 0 || sig.some((s) => utf8.includes(s));
  const utf8Clean = utf8Repl === 0 && utf8Ratio <= maxRatio;

  // 3) GB18030 attempt
  const gb = iconv.decode(buf, 'gb18030');
  const gbRepl = countReplacement(gb);
  const gbRatio = gb.length ? gbRepl / gb.length : 0;
  const gbSigOk = sig.length === 0 || sig.some((s) => gb.includes(s));
  const gbClean = gbRepl === 0 && gbRatio <= maxRatio;

  // BOM wins cleanly.
  if (hasUtf8Bom && utf8Clean) {
    return { ok: true, text: utf8, encoding: 'utf-8', bom: true, replacementRatio: utf8Ratio };
  }

  // 4) signature-driven selection
  if (sig.length > 0) {
    if (utf8SigOk && utf8Clean) {
      return { ok: true, text: utf8, encoding: 'utf-8', bom: false, replacementRatio: utf8Ratio };
    }
    if (gbSigOk && gbRatio <= maxRatio) {
      return { ok: true, text: gb, encoding: 'gb18030', bom: false, replacementRatio: gbRatio };
    }
    // A clean ASCII-like decode without a brand signature still prefers UTF-8.
    if (utf8Clean) {
      return { ok: true, text: utf8, encoding: 'utf-8', bom: false, replacementRatio: utf8Ratio };
    }
    return {
      ok: false,
      reason: 'needs_user_choice',
      tried: ['utf-8', 'gb18030'],
      message: '无法可靠判断编码，请手动选择（UTF-8 或 GB18030）',
    };
  }

  // 5) no signatures: pick the cleaner decode, but never accept heavy mojibake.
  if (utf8Clean) {
    return { ok: true, text: utf8, encoding: 'utf-8', bom: false, replacementRatio: utf8Ratio };
  }
  if (gbClean) {
    return { ok: true, text: gb, encoding: 'gb18030', bom: false, replacementRatio: gbRatio };
  }
  if (utf8Ratio <= 0.2 && utf8Repl <= gbRepl) {
    return { ok: true, text: utf8, encoding: 'utf-8', bom: false, replacementRatio: utf8Ratio };
  }
  if (gbRatio <= 0.2) {
    return { ok: true, text: gb, encoding: 'gb18030', bom: false, replacementRatio: gbRatio };
  }
  return {
    ok: false,
    reason: 'needs_user_choice',
    tried: ['utf-8', 'gb18030'],
    message: '无法可靠判断编码，请手动选择（UTF-8 或 GB18030）',
  };
}

/**
 * Force a specific encoding (used when the user manually picks one in the UI).
 * Still reports the replacement ratio so the UI can warn about likely mojibake,
 * but never throws — the user explicitly chose this encoding.
 */
export function forceDecode(bytes: Uint8Array, encoding: StatementEncoding): DecodeResult {
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: 'empty', tried: [], message: '文件内容为空' };
  }
  const buf = toBuf(bytes);
  const text = iconv.decode(buf, encoding === 'utf-8' ? 'utf-8' : 'gb18030');
  const repl = countReplacement(text);
  const ratio = text.length ? repl / text.length : 0;
  return { ok: true, text, encoding, bom: false, replacementRatio: ratio };
}
