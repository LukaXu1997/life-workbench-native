// Safety limits for imported files. Centralized so adapters and the UI share one
// source of truth and an abnormal file can never blow up memory.
//
// These are CONSERVATIVE caps for a personal finance app. They are checked at
// read time (before any parsing) and again per-sheet/per-row during parsing.

export const IMPORT_LIMITS = {
  /** Max raw file size in bytes. 20 MB is far above any real statement. */
  maxFileBytes: 20 * 1024 * 1024,
  /** Max number of sheets in one workbook. */
  maxSheets: 32,
  /** Max rows read from a single sheet (header rows do not count). */
  maxRowsPerSheet: 50_000,
  /** Max columns per row — protects against malformed wide rows. */
  maxColsPerRow: 256,
  /** Max characters kept from a single cell (defensive; real cells are tiny). */
  maxCellChars: 4096,
  /** Max characters of decoded text kept for preview / source detection. */
  maxPreviewChars: 64 * 1024,
  /** Max password attempts before the unlock dialog forces a cooldown. */
  maxPasswordAttempts: 5,
  /** Cooldown (ms) after exceeding maxPasswordAttempts. */
  passwordLockoutMs: 30_000,
} as const;

export function isWithinFileSize(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= IMPORT_LIMITS.maxFileBytes;
}
