// Pure, React-Native-free file-kind detection.
//
// Determines the LOW-LEVEL container type from magic bytes + extension. It does
// NOT decode content (that is Phase 2/3) and it does NOT identify the source
// app (that is sourceDetect.ts). Keeping it byte-level makes it trivially
// unit-testable under Node with synthetic byte arrays.

import type { ImportFileKind } from './models';
import { IMPORT_LIMITS, isWithinFileSize } from './limits';

export interface FileProbe {
  name: string;
  bytes: Uint8Array;
  /** size in bytes (defaults to bytes.length if omitted). */
  size?: number;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b];             // PK  (xlsx/docx/zip are zip containers)
const GZIP_MAGIC = [0x1f, 0x8b];
const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (!bytes || bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** True when the first bytes look like well-formed UTF-8 text (heuristic). */
function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  // Allow BOMs.
  if (startsWith(bytes, UTF8_BOM) || startsWith(bytes, UTF16LE_BOM) || startsWith(bytes, UTF16BE_BOM)) {
    return true;
  }
  let i = 0;
  const n = Math.min(bytes.length, 512);
  while (i < n) {
    const b = bytes[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d) { i++; continue; } // tab/lf/cr OK
    if (b < 0x20) return false;                                     // other control chars -> binary
    if (b < 0x80) { i++; continue; }                                // ASCII
    // multi-byte UTF-8 lead byte
    let extra = 0;
    if ((b & 0xe0) === 0xc0) extra = 1;
    else if ((b & 0xf0) === 0xe0) extra = 2;
    else if ((b & 0xf8) === 0xf0) extra = 3;
    else return false; // invalid lead byte
    if (i + extra >= n) return false;
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) return false; // not a continuation byte
    }
    i += extra + 1;
  }
  return true;
}

/**
 * Detect the container kind of a file.
 *   pdf  -> %PDF magic
 *   xlsx -> zip container (PK..) — xlsx is a zip of XML
 *   csv  -> text with .csv/.tsv extension, OR text that isn't obviously JSON
 *   json -> text starting with '{' or '[' (after optional BOM), or .json ext
 *   unknown -> binary we don't recognize (rejected by the UI with a clear message)
 */
export function detectFileKind(p: FileProbe): ImportFileKind | 'unknown' {
  const bytes = p.bytes;
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'xlsx'; // zip container
  if (startsWith(bytes, GZIP_MAGIC)) return 'unknown'; // compressed, unsupported

  const ext = extOf(p.name);
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'json') return 'json';

  if (looksLikeUtf8Text(bytes)) {
    // Peek the first non-whitespace char to distinguish JSON from CSV.
    let i = 0;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    const first = bytes[i];
    if (first === 0x7b /* { */ || first === 0x5b /* [ */) return 'json';
    return 'csv';
  }
  return 'unknown';
}

/** Convenience: is this a kind we can actually attempt to import? */
export function isSupportedKind(k: ImportFileKind | 'unknown'): k is ImportFileKind {
  return k !== 'unknown';
}

/** Validate the file size up front so we never try to process a gigantic blob. */
export function checkFileSize(p: FileProbe): { ok: boolean; bytes: number } {
  const bytes = p.size ?? p.bytes.length;
  return { ok: isWithinFileSize(bytes), bytes };
}

/**
 * Top-level guard used by the picker before anything else runs.
 * Returns either a concrete kind or a rejection reason (never throws).
 */
export function probeFile(p: FileProbe): { kind: ImportFileKind | 'unknown'; sizeOk: boolean; bytes: number } {
  const sizeRes = checkFileSize(p);
  return { kind: detectFileKind(p), sizeOk: sizeRes.ok, bytes: sizeRes.bytes };
}
