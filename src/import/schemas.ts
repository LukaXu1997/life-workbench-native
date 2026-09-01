// zod schemas + validation for the Unified Importer.
//
// Design rules (per user spec):
//  - zod is the SINGLE source of structural validation (amounts, currency, dates,
//    account refs, txn types). Business rules (referential integrity, dedup) live
//    in a separate validator (Phase 5) — NOT in the schema.
//  - schemaVersion is validated FIRST. Unknown / future versions are rejected with
//    a human-readable error. v1 requires an explicit migration function; it is
//    never read directly as v2.
//  - Validation failures MUST NOT write any data, and error messages must never
//    echo raw transaction content (no description / card / account numbers).

import { z } from 'zod';
import { SCHEMA_VERSION } from '../types';
import type { Snapshot } from '../types';
import type { ImportCandidate, ImportTemplate, ImportBatch, ImportSource, ImportFileKind } from './models';
import { migrateSnapshotV1ToV2 } from './migration';

// ---- primitive helpers ----------------------------------------------------
const finiteNum = z.number().refine((n) => Number.isFinite(n), { message: 'must be a finite number' });
const intMinor = z.number().int().refine((n) => Number.isFinite(n), { message: 'must be a finite integer' });

// ---- enums (mirror src/types.ts) -----------------------------------------
export const currencySchema = z.enum(['CNY', 'MYR']);
export const txnTypeSchema = z.enum(['income', 'expense', 'transfer', 'repayment', 'refund']);
export const accountTypeSchema = z.enum(['cash', 'debit', 'credit', 'ewallet']);
export const regionSchema = z.enum(['MY', 'CN', 'OTHER']);
export const fxSourceSchema = z.enum(['system', 'manual', 'card', 'migration']);

export const importSourceSchema = z.enum([
  'lifeWorkbench',
  'tng',
  'alipay',
  'wechat',
  'genericCsv',
  'genericXlsx',
]);
export const importFileKindSchema = z.enum(['pdf', 'csv', 'xlsx', 'json']);

// ---- date / time ----------------------------------------------------------
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须是 YYYY-MM-DD');
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间必须是 HH:MM')
  .optional();

// ---- Account --------------------------------------------------------------
export const accountSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    type: accountTypeSchema,
    currency: currencySchema,
    balanceMinor: intMinor.optional(),
    openingBalanceMinor: intMinor.optional(),
    creditLimitMinor: intMinor.optional(),
    currentBillMinor: intMinor.optional(),
    unbilledMinor: intMinor.optional(),
    repaidMinor: intMinor.optional(),
    stmtDay: z.number().int().nullable().optional(),
    dueDay: z.number().int().nullable().optional(),
    includeInNetWorth: z.boolean(),
    showOnHome: z.boolean(),
    order: z.number(),
    createdAt: z.number(),
  })
  .passthrough();

// ---- Txn ------------------------------------------------------------------
export const txnSchema = z
  .object({
    id: z.string().min(1),
    type: txnTypeSchema,
    currency: currencySchema,
    amount: finiteNum,
    origAmountMinor: intMinor.optional(),
    origCurrency: currencySchema.optional(),
    settleAmountMinor: intMinor.optional(),
    settleCurrency: currencySchema.optional(),
    fxRate: finiteNum.optional(),
    fxSource: fxSourceSchema.optional(),
    accountId: z.string().optional(),
    toAccountId: z.string().optional(),
    region: regionSchema.optional(),
    merchant: z.string().optional(),
    cardId: z.string().optional(),
    isCardTxn: z.boolean().optional(),
    isPosted: z.boolean().optional(),
    postedAmountMinor: intMinor.optional(),
    isRepaid: z.boolean().optional(),
    linkedBillId: z.string().optional(),
    linkedTxnId: z.string().optional(),
    countInStats: z.boolean().optional(),
    category: z.string(),
    note: z.string(),
    date: dateSchema,
    time: timeSchema,
    createdAt: z.number(),
  })
  .passthrough();

// ---- Snapshot (lifeWorkbench JSON) ---------------------------------------
export const snapshotSchema = z
  .object({
    schemaVersion: z.number().int(),
    appVersion: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    accounts: z.array(accountSchema).optional(),
    fx: z.any().optional(),
    counts: z.any().optional(),
    checksum: z.string().optional(),
    txns: z.array(txnSchema),
    budgets: z.array(z.any()).optional(),
    habits: z.array(z.any()).optional(),
    schedule: z.array(z.any()).optional(),
    shopping: z.array(z.any()).optional(),
    media: z.array(z.any()).optional(),
    journal: z.array(z.any()).optional(),
    inbox: z.array(z.any()).optional(),
    cardStmtDay: z.number().nullable().optional(),
    cardDueDay: z.number().nullable().optional(),
    version: z.string().optional(),
    exportedAt: z.string().optional(),
  })
  .passthrough();

// ---- ImportCandidate ------------------------------------------------------
export const importCandidateSchema = z
  .object({
    id: z.string().min(1),
    source: importSourceSchema,
    sourceFile: z.string(),
    rowIndex: z.number().int().nonnegative(),
    txnType: txnTypeSchema,
    amountMinor: intMinor,
    currency: currencySchema,
    merchant: z.string().optional(),
    category: z.string().optional(),
    accountHint: z.string().optional(),
    date: dateSchema,
    time: timeSchema,
    note: z.string().optional(),
    origCurrency: currencySchema.optional(),
    origAmountMinor: intMinor.optional(),
    fingerprint: z.string().optional(),
    warnings: z.array(z.string()),
    rawRef: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict(); // reject unknown keys — enforces the PII-free contract

// ---- ImportTemplate -------------------------------------------------------
export const importColumnMappingSchema = z.object({
  field: z.enum(['date', 'time', 'amount', 'currency', 'merchant', 'category', 'note', 'type', 'account']),
  sourceColumn: z.string().min(1),
  transform: z.string().optional(),
});
export const importTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: importSourceSchema,
    fileKind: importFileKindSchema,
    encoding: z.string().optional(),
    sheetName: z.string().optional(),
    headerRowIndex: z.number().int().nonnegative().optional(),
    mappings: z.array(importColumnMappingSchema),
    createdAt: z.number(),
  })
  .strict();

// ---- ImportBatch (must stay PII-free) -------------------------------------
export const importBatchSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.number(),
    sources: z.array(importSourceSchema),
    fileNames: z.array(z.string()),
    txnIds: z.array(z.string()),
    /**
     * IDs of EXISTING txns this batch patched (cross-source 关联补全). IDs only —
     * the actual before-snapshots live in a separate rollback store, never here.
     */
    modifiedTxnIds: z.array(z.string()).optional(),
    summary: z.object({
      totalRows: z.number().int().nonnegative(),
      importedRows: z.number().int().nonnegative(),
      skippedDuplicates: z.number().int().nonnegative(),
      bySource: z.record(z.string(), z.number().int().nonnegative()),
      totalMinor: intMinor,
      currency: currencySchema.optional(),
      dateFrom: dateSchema.optional(),
      dateTo: dateSchema.optional(),
    }),
    status: z.enum(['committed', 'undone']),
  })
  .strict(); // a stray merchant/description key MUST fail validation

// ---- PII-safe error formatting -------------------------------------------
// zod error messages can echo the offending value. We strip values so no
// transaction description / card / account number can leak into a log.
export function describeIssues(err: z.ZodError): string {
  return err.issues
    .map((iss) => {
      const path = iss.path.join('.') || '(root)';
      // Strip any "received '...'" tail zod may append — we never want a value
      // (even a non-PII one) echoed into an error string that could be logged.
      const msg = iss.message.replace(/,?\s*received\s+['"].*?['"]/gi, '').trim() || iss.message;
      return `${path}: ${msg}`;
    })
    .join('; ');
}

// ---- Snapshot validation + version routing --------------------------------
export type SnapshotValidationResult =
  | { ok: true; data: Snapshot; migrated: boolean }
  | {
      ok: false;
      error: { kind: 'json_parse' | 'unsupported_version' | 'schema_mismatch' | 'empty'; message: string };
    };

export function validateLifeWorkbenchSnapshot(raw: unknown): SnapshotValidationResult {
  let parsed: any;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: { kind: 'json_parse', message: '文件不是合法的 JSON' } };
    }
  } else {
    parsed = raw;
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: { kind: 'empty', message: '文件内容为空或格式无法识别' } };
  }

  const v = parsed.schemaVersion;
  const supported = SCHEMA_VERSION; // 2

  // Legacy export with no version marker -> treat as v1 and migrate.
  if (v === undefined || v === null) {
    return runV1Migration(parsed, supported);
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return { ok: false, error: { kind: 'schema_mismatch', message: 'schemaVersion 字段无效' } };
  }
  if (v > supported) {
    return {
      ok: false,
      error: {
        kind: 'unsupported_version',
        message: `不支持的备份版本 v${v}，当前应用最高支持 v${supported}`,
      },
    };
  }
  if (v < 1) {
    return { ok: false, error: { kind: 'unsupported_version', message: `不支持的备份版本 v${v}` } };
  }

  if (v === 1) return runV1Migration(parsed, supported);

  // v === supported (2)
  const res = snapshotSchema.safeParse(parsed);
  if (!res.success) {
    return { ok: false, error: { kind: 'schema_mismatch', message: describeIssues(res.error) } };
  }
  return { ok: true, data: res.data as Snapshot, migrated: false };
}

function runV1Migration(v1: any, supported: number): SnapshotValidationResult {
  let migrated: Snapshot;
  try {
    migrated = migrateSnapshotV1ToV2(v1);
  } catch (e: any) {
    return { ok: false, error: { kind: 'schema_mismatch', message: `v1 迁移失败: ${e?.message ?? 'unknown'}` } };
  }
  if (migrated.schemaVersion !== supported) {
    return { ok: false, error: { kind: 'unsupported_version', message: `迁移后版本 v${migrated.schemaVersion} 仍不被支持` } };
  }
  const res = snapshotSchema.safeParse(migrated);
  if (!res.success) {
    return { ok: false, error: { kind: 'schema_mismatch', message: describeIssues(res.error) } };
  }
  return { ok: true, data: res.data as Snapshot, migrated: true };
}

// ---- Generic validators (candidate / template / batch) --------------------
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function validateImportCandidate(raw: unknown): ValidationResult<ImportCandidate> {
  const res = importCandidateSchema.safeParse(raw);
  return res.success
    ? { ok: true, data: res.data as ImportCandidate }
    : { ok: false, error: describeIssues(res.error) };
}

export function validateImportTemplate(raw: unknown): ValidationResult<ImportTemplate> {
  const res = importTemplateSchema.safeParse(raw);
  return res.success
    ? { ok: true, data: res.data as ImportTemplate }
    : { ok: false, error: describeIssues(res.error) };
}

export function validateImportBatch(raw: unknown): ValidationResult<ImportBatch> {
  const res = importBatchSchema.safeParse(raw);
  return res.success
    ? { ok: true, data: res.data as ImportBatch }
    : { ok: false, error: describeIssues(res.error) };
}
