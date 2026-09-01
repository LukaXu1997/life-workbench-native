// Unified Importer — core data model.
//
// These types describe the NORMALIZED, in-memory shape that every adapter
// (TNG / Alipay / WeChat / generic / lifeWorkbench) produces and that the
// preview / dedup / commit stages consume. They are deliberately React-Native
// free so they can be unit-tested under plain Node.
//
// PRIVACY CONTRACT
// ----------------
// `ImportCandidate` may carry the merchant / description in memory (needed for
// category suggestion) but it is NEVER persisted to logs, AsyncStorage, or the
// `ImportBatch` undo record. `ImportBatch` stores only ids + a PII-free summary
// (counts, integer totals, date range) so an import can be reverted without
// retaining any transaction description, card number, or account number.

import type { Currency, TxnType } from '../types';

/** Which adapter / origin a file came from. */
export type ImportSource =
  | 'lifeWorkbench' // 生活工作台 standard JSON snapshot
  | 'tng'           // Touch 'n Go PDF statement
  | 'alipay'        // 支付宝 CSV statement
  | 'wechat'        // 微信支付 XLSX statement
  | 'genericCsv'    // user CSV (column mapping applied)
  | 'genericXlsx';  // user XLSX (column mapping applied)

/** Low-level container kind, derived from magic bytes + extension. */
export type ImportFileKind = 'pdf' | 'csv' | 'xlsx' | 'json';

/** Per-platform default properties (spec §一). Two DIFFERENT platforms can never
 *  be merged or judged duplicates of each other because they differ in source,
 *  account, AND currency — the dedup scope key (see matchers/types.dedupScopeKey)
 *  isolates them automatically. We therefore DO NOT exempt any source from dedup;
 *  instead within-platform duplicates (and cross-source same-currency settlement
 *  links) are still allowed. */
export const PLATFORM_DEFAULTS: Record<'alipay' | 'tng', { currency: Currency; accountType: 'ewallet'; label: string }> = {
  alipay: { currency: 'CNY', accountType: 'ewallet', label: '支付宝' },
  tng: { currency: 'MYR', accountType: 'ewallet', label: 'TNG' },
};

/** Fields a generic-column mapping can target. */
export type MappableField =
  | 'date'
  | 'time'
  | 'amount'
  | 'currency'
  | 'merchant'
  | 'category'
  | 'note'
  | 'type'
  | 'account';

/**
 * One normalized row parsed from a source file, BEFORE it is committed.
 * Amounts are always integer minor units (sen for MYR, fen for CNY).
 */
export interface ImportCandidate {
  id: string;               // stable per-file row id (sha1(sourceFile|rowIndex|amountMinor|date))
  source: ImportSource;
  sourceFile: string;       // original FILE NAME ONLY (no path) — display purposes
  rowIndex: number;         // 0-based row in the source
  txnType: TxnType;         // income | expense | transfer | repayment | refund
  amountMinor: number;      // integer minor units of `currency`
  currency: Currency;
  merchant?: string;        // in-memory only; never persisted to logs/batch
  category?: string;        // suggested category (may be filled later by classifier)
  accountHint?: string;     // suggested account name/type hint
  date: string;             // YYYY-MM-DD
  time?: string;            // HH:MM
  note?: string;            // in-memory only; never persisted to logs/batch
  // cross-currency support (optional, filled by adapters that know it)
  origCurrency?: Currency;
  origAmountMinor?: number;
  // settlement (optional) — only populated when the SOURCE FILE carries a real
  // historical settlement (e.g. a cross-currency statement showing both the
  // original MYR and the posted CNY). NEVER synthesized from a live FX rate.
  settleCurrency?: Currency;
  settleAmountMinor?: number;
  // assigned account — empty while parsing; filled during preview/commit.
  accountId?: string;
  // deduplication fingerprint (built in Phase 5; optional here)
  fingerprint?: string;
  // non-fatal data-quality flags (e.g. "missing category")
  warnings: string[];
  // opaque reference token for the row — NOT the raw description text.
  // Lets us trace a candidate back to its source row without storing PII.
  rawRef?: string;
  // adapter-private structured fields used by Phase 5 mapping (never logged)
  meta?: Record<string, unknown>;
  // ---- budget / income-expense / transaction-nature (spec §六·§七) ----
  /** Which budget bucket this row counts toward (defaults to its currency). */
  budgetCurrency?: Currency;
  /** Whether this row deducts the budget. Wealth / reload / transfer = false. */
  affectsBudget?: boolean;
  /** Whether this row counts as income/expense in the daily stats. Wealth = false. */
  affectsIncomeExpense?: boolean;
  /** Semantic nature (spec §六). 'normal' for ordinary spend/income. */
  transactionNature?: 'normal' | 'investment' | 'transfer' | 'repayment' | 'refund' | 'settlement';
  // ---- currency inference (spec §九) ----
  /** True when currency was inferred from the platform (no currency column). */
  currencyInferredFromSource?: boolean;
  /** True when the file's stated currency conflicts with the platform default. */
  currencyConflict?: boolean;
}

/** Reusable column mapping for generic CSV / XLSX imports (no data, no PII). */
export interface ImportColumnMapping {
  field: MappableField;
  sourceColumn: string;     // column header exactly as it appears in the file
  transform?: string;       // optional transform id (Phase 5)
}

/**
 * A saved mapping template. Stored separately so the user can re-import the
 * same bank's file without re-mapping every column. Contains NO transaction data.
 */
export interface ImportTemplate {
  id: string;
  name: string;
  source: ImportSource;
  fileKind: ImportFileKind;
  encoding?: string;        // 'utf-8' | 'gb18030' — for CSV re-use
  sheetName?: string;       // for XLSX re-use
  headerRowIndex?: number;  // 0-based header row in the file
  mappings: ImportColumnMapping[];
  /**
   * Per-source account binding (spec §八). The platform that produces this
   * template MUST bind to ONE dedicated account — Alipay to a CNY e-wallet
   * account, TNG to a MYR e-wallet account. Because the binding is stored PER
   * SOURCE, the two platforms can never share the same account even if both are
   * e-wallets. Saved here so re-imports can auto-suggest the account, while the
   * preview still shows the account + currency for confirmation.
   */
  boundAccountId?: string;
  createdAt: number;
}

export type ImportBatchStatus = 'committed' | 'undone';

/**
 * Undo record for a committed import. PII-FREE BY DESIGN:
 * it stores only the created Txn ids + a numeric summary, so we can delete the
 * imported txns to revert, WITHOUT retaining any description / card / account
 * number. (Passwords/password digests are also never stored here — see #6.)
 */
export interface ImportBatch {
  id: string;
  createdAt: number;
  sources: ImportSource[];
  fileNames: string[];            // display names only (no paths)
  txnIds: string[];               // created Txn ids — the ONLY thing needed to undo
  /**
   * Existing ledger txns this batch MODIFIED (e.g. a cross-source cross-currency
   * reconcile that back-filled settle fields). IDs only, so the batch stays
   * PII-free; the matching pre-modify snapshots live in a SEPARATE rollback
   * store (see importService `rollbacks`) and are never part of the audit record.
   */
  modifiedTxnIds?: string[];
  summary: {
    totalRows: number;
    importedRows: number;
    skippedDuplicates: number;
    bySource: Record<string, number>; // source -> count
    totalMinor: number;           // sum of imported amountMinor (display only)
    currency: Currency;           // dominant currency of the batch
    dateFrom?: string;            // YYYY-MM-DD
    dateTo?: string;             // YYYY-MM-DD
  };
  status: ImportBatchStatus;
}

/** Summary counters used while building an ImportBatch (in-memory only). */
export interface BatchCounters {
  totalRows: number;
  importedRows: number;
  skippedDuplicates: number;
  bySource: Record<string, number>;
  totalMinor: number;
  currency: Currency;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Build an `ImportBatch` from the safe result of a commit. This factory copies
 * ONLY id/summary fields — it never sees (and therefore cannot leak) the
 * candidate descriptions. Use this instead of hand-assembling a batch.
 */
export function buildImportBatch(args: {
  id: string;
  sources: ImportSource[];
  fileNames: string[];
  txnIds: string[];
  counters: BatchCounters;
  modifiedTxnIds?: string[];
}): ImportBatch {
  return {
    id: args.id,
    createdAt: Date.now(),
    sources: args.sources,
    fileNames: args.fileNames,
    txnIds: args.txnIds,
    modifiedTxnIds: args.modifiedTxnIds && args.modifiedTxnIds.length > 0 ? [...args.modifiedTxnIds] : undefined,
    summary: {
      totalRows: args.counters.totalRows,
      importedRows: args.counters.importedRows,
      skippedDuplicates: args.counters.skippedDuplicates,
      bySource: { ...args.counters.bySource },
      totalMinor: args.counters.totalMinor,
      currency: args.counters.currency,
      dateFrom: args.counters.dateFrom,
      dateTo: args.counters.dateTo,
    },
    status: 'committed',
  };
}
