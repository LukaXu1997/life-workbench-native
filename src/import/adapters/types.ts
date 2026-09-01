// Shared adapter contract for the Unified Importer.
//
// Every platform adapter (Alipay/WeChat/TNG/Generic/lifeWorkbench) implements the
// same two-method interface so the ImporterRegistry can route by detected source
// and the preview/commit stages stay source-agnostic.
//
// PRIVACY: adapters receive only file NAME (no path) + decoded text/bytes. They
// must never log raw transaction text (descriptions / card / account numbers).

import type { ImportCandidate, ImportFileKind, ImportSource } from '../models';

export interface AdapterInput {
  /** Original file NAME ONLY (no path) — for display + candidate tracing. */
  name: string;
  kind: ImportFileKind;
  /** Already-decoded text (UTF-8 or other). */
  text?: string;
  /** Raw bytes (for charset auto-detection by the adapter or caller). */
  bytes?: Uint8Array;
  /** If the caller already knows the encoding (UI retry after user choice). */
  encoding?: string;
}

export interface AdapterWarning {
  rowIndex: number;
  code: string; // non-PII machine code, e.g. 'missing_category'
  message: string; // non-PII human hint, never includes the raw row content
}

export interface ImportParseResult {
  candidates: ImportCandidate[];
  warnings: AdapterWarning[];
  summary: {
    totalRows: number; // data rows considered
    parsedRows: number; // produced a candidate
    skippedRows: number; // non-finalized / unparseable
  };
}

export interface ImportAdapter {
  readonly source: ImportSource;
  /** Cheap structural gate. Returns why it fails (non-PII) on no-match. */
  validate(input: AdapterInput): { ok: true } | { ok: false; reason: string };
  /** Parse into normalized candidates. Never throws on a bad row; counts it. */
  parse(input: AdapterInput): ImportParseResult;
}
