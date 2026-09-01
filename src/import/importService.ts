// ImportService — atomic commit, rollback-safe undo, auto-recompute, and
// PII-free reporting for the Unified Importer (Phase 6).
//
// Design goals (IMPLEMENTATION_PLAN §5.2 / R9):
//   * Atomicity without a transactional store: `commit`/`undo` READ the whole
//     ledger, COMPUTE the next state purely, then WRITE once. If the pure
//     `buildCommitPlan` throws (bad data), nothing is written — so a half
//     batch can never reach disk.
//   * Privacy: the persisted `ImportBatch` (audit record) stores ONLY created
//     Txn ids + a numeric summary (via `buildImportBatch`). No merchant, card,
//     or account strings are retained. Undo therefore needs only the id list
//     (delete + recompute), which is both simpler and PII-safe.
//   * Auto-recompute: every commit/undo re-derives account balances via
//     `recomputeAccounts` (R3 posted/awaiting split) and persists them.
//
// RN-free, pure. The only RN dependency is injected through `PersistenceBackend`
// (an in-memory stub is used in tests; the app wires an AsyncStorage adapter).

import type { Txn, Account, Currency } from '../types';
import { fromMinor, txnOrigMinor, txnOrigCurrency } from '../money';
import type { ImportCandidate, ImportSource, ImportBatch, BatchCounters } from './models';
import { buildImportBatch } from './models';
import type { UnifiedPreview, UnifiedRow } from './unify';
import { recomputeAccounts } from './recompute';
import { normMerchant, toMatchable, dayDiff } from './matchers/types';
import { reconcileCrossCurrency } from './matchers/crossCurrency';
import { resolveSettlementLinks } from './matchers/settlement';

// -------------------------------------------------------------------- backend
/**
 * `rollbacks` holds the pre-modify snapshots of EXISTING txns a batch changed
 * (batchId -> before-states). It lives OUTSIDE `ImportBatch` on purpose: the
 * audit record stays PII-free (ids + numbers only) while undo can still restore
 * a modified ledger row exactly. Local-only, never included in snapshots.
 */
export interface BackendState {
  txns: Txn[];
  accounts: Account[];
  batches: ImportBatch[];
  rollbacks: Record<string, Txn[]>;
}

// Async by design: the real backend is AsyncStorage. The in-memory test backend
// simply resolves synchronously inside the promise.
export interface PersistenceBackend {
  load(): Promise<BackendState>;
  save(state: BackendState): Promise<void>;
}

/** Maps a preview row to a concrete account id (or undefined if unassigned). */
export type AccountResolver = (row: UnifiedRow) => string | undefined;

// ----------------------------------------------------------------------- plan
export interface CommitOptions {
  /** Explicit row selection. If omitted, imports EVERY row — there is no
   *  automatic in-batch dedup; the user confirms duplicates in the preview. */
  selectedRowIds?: string[];
  accountResolver: AccountResolver;
  /** Accounts needed to derive settle currency (R1) from a resolved account. */
  accounts: Account[];
  /**
   * Existing ledger txns — used for cross-source duplicate suppression AND for
   * cross-source 关联补全 (link/complete against rows already in the ledger).
   */
  existingTxns?: Txn[];
  /** Enable cross-source link/complete (default true). */
  crossSource?: boolean;
  /** Window for cross-source cross-currency reconcile. Default 3 days. */
  crossCurrencyWindowDays?: number;
  /** Window for cross-source refund linking. Default 30 days. */
  refundWindowDays?: number;
  /** Display-only FX (cnyPerMyr*1e6). Never written to settle facts. */
  fxRateScaled?: number;
  makeId?: () => string;
  now?: number;
  batchId?: string;
}

export interface ImportReport {
  createdAt: number;
  totalRows: number;
  importedRows: number;
  skippedDuplicates: number; // in-batch dups (always 0 — no automatic dedup)
  skippedExisting: number; // already present in the ledger
  bySource: Record<string, number>;
  totalMinorByCurrency: Record<string, number>;
  crossCurrencyMerged: number; // pairs collapsed into one txn
  transferMerged: number;
  refundLinked: number;
  // --- cross-source 关联补全 (③) ---
  crossSourceReconciled: number; // existing awaiting txn completed by this import
  crossSourceRefundLinked: number; // refund linked to an existing ledger expense
  crossSourceSettlementLinked: number; // expense linked to same-currency bank settlement
  modifiedTxnIds: string[]; // existing txns this batch patched
  dateFrom?: string;
  dateTo?: string;
}

export interface CommitPlan {
  txns: Txn[]; // surviving new txns (existing-dups already removed)
  rowToTxnId: Map<string, string>;
  report: ImportReport;
  counters: BatchCounters;
  /** Existing txns patched by this import: {id, before, after}. */
  modified: { id: string; before: Txn; after: Txn }[];
}

function defaultMakeId(): string {
  return 'imp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function dominantCurrency(minorByCur: Record<string, number>): Currency {
  let best: Currency = 'CNY';
  let bestCount = -1;
  for (const cur of Object.keys(minorByCur)) {
    const c = minorByCur[cur];
    if (c > bestCount) {
      bestCount = c;
      best = cur as Currency;
    }
  }
  return best;
}

/** Does `t` duplicate an already-existing ledger txn (same account/date/amt/merchant)? */
function findExistingDuplicates(existing: Txn[], txns: Txn[]): Set<number> {
  const drop = new Set<number>();
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i];
    const tCur = t.origCurrency ?? t.currency;
    const tMinor = t.origAmountMinor ?? 0;
    const tNorm = normMerchant(t.merchant);
    for (const e of existing) {
      if (e.accountId !== t.accountId) continue;
      if (e.date !== t.date) continue;
      if ((e.origCurrency ?? e.currency) !== tCur) continue;
      if (txnOrigMinor(e) !== tMinor) continue;
      if (tNorm !== '' && normMerchant(e.merchant) === tNorm) {
        drop.add(i);
        break;
      }
    }
  }
  return drop;
}

/** Copy platform / budget / nature fields from a preview row onto a created Txn. */
function candidateMeta(row: UnifiedRow): Pick<
  Txn,
  'source' | 'budgetCurrency' | 'affectsBudget' | 'affectsIncomeExpense' | 'transactionNature'
> {
  return {
    source: row.source,
    budgetCurrency: row.budgetCurrency,
    affectsBudget: row.affectsBudget,
    affectsIncomeExpense: row.affectsIncomeExpense,
    transactionNature: row.transactionNature,
  };
}

// --------------------------------------------- cross-source 关联补全 (③)
// When an imported row has NO partner inside the batch, look for the partner in
// the EXISTING ledger instead. Two cases:
//   * posted CNY row  -> completes an existing MYR `awaiting_posting` txn
//                        (writes the real settle fields, R4). MODIFIES an
//                        existing txn, so we keep a before-snapshot for undo.
//   * refund row      -> links to an existing expense (linkedTxnId only; the
//                        existing txn itself is untouched).

function findCrossSourceAwaiting(
  row: UnifiedRow,
  existing: Txn[],
  accountId: string | undefined,
  windowDays: number
): Txn | undefined {
  if (!accountId) return undefined;
  const posting = row.meta?.postingStatus as string | undefined;
  if (posting !== 'posted') return undefined;
  const settleCur = row.settleCurrency ?? row.currency;
  if (settleCur !== 'CNY') return undefined;
  const norm = normMerchant(row.merchant);
  if (!norm) return undefined;
  for (const t of existing) {
    if (t.accountId !== accountId) continue;
    if (t.isPosted !== false) continue; // must still be awaiting
    if ((t.origCurrency ?? t.currency) !== 'MYR') continue;
    if (normMerchant(t.merchant) !== norm) continue;
    if (Math.abs(dayDiff(t.date, row.date)) > windowDays) continue;
    return t;
  }
  return undefined;
}

/** Settle fields to patch onto the existing awaiting txn (R1/R4). */
function reconcilePatch(existing: Txn, row: UnifiedRow): Partial<Txn> {
  const settleMinor = row.settleAmountMinor ?? row.amountMinor;
  const orig = existing.origAmountMinor ?? 0;
  return {
    settleAmountMinor: settleMinor,
    settleCurrency: (row.settleCurrency ?? row.currency) as Currency,
    fxRate: orig > 0 ? Math.round((settleMinor * 1_000_000) / orig) / 1_000_000 : undefined,
    fxSource: 'card',
    isPosted: true,
  };
}

function findCrossSourceExpense(
  row: UnifiedRow,
  existing: Txn[],
  accountId: string | undefined,
  windowDays: number
): Txn | undefined {
  if (row.txnType !== 'refund' || !accountId) return undefined;
  const norm = normMerchant(row.merchant);
  if (!norm) return undefined;
  const amount = row.origAmountMinor ?? row.amountMinor;
  const cur = row.origCurrency ?? row.currency;
  for (const t of existing) {
    if (t.accountId !== accountId) continue;
    if (t.type !== 'expense') continue;
    if ((t.origAmountMinor ?? 0) !== amount) continue;
    if ((t.origCurrency ?? t.currency) !== cur) continue;
    if (normMerchant(t.merchant) !== norm) continue;
    if (Math.abs(dayDiff(t.date, row.date)) > windowDays) continue;
    return t;
  }
  return undefined;
}

// ----------------------------------------------------------- buildCommitPlan
// Pure: turns a UnifiedPreview into the concrete Txn[] to append, performing the
// cross-currency / transfer merges, refund linkage, and duplicate suppression.
// No I/O, no store access. Throws on malformed input (caller treats as abort).
export function buildCommitPlan(preview: UnifiedPreview, opts: CommitOptions): CommitPlan {
  const now = opts.now ?? Date.now();
  const makeId = opts.makeId ?? defaultMakeId;
  const accountsById = new Map(opts.accounts.map((a) => [a.id, a]));
  const resolver = opts.accountResolver;

  const selected = new Set(
    opts.selectedRowIds ?? preview.rows.filter((r) => !r.skipByDefault).map((r) => r.id)
  );
  const importRows = preview.rows.filter((r) => selected.has(r.id));

  const consumed = new Set<string>();
  const rowToTxnId = new Map<string, string>();
  const txns: Txn[] = [];

  let crossCurrencyMerged = 0;
  let transferMerged = 0;
  let refundLinked = 0;
  let crossSourceReconciled = 0;
  let crossSourceRefundLinked = 0;
  let crossSourceSettlementLinked = 0;
  const modified: { id: string; before: Txn; after: Txn }[] = [];

  const existing = opts.existingTxns ?? [];
  const crossSource = opts.crossSource !== false && existing.length > 0;
  const ccWindow = opts.crossCurrencyWindowDays ?? 3;
  const refundWindow = opts.refundWindowDays ?? 30;

  const candidateOf = (id: string): UnifiedRow | undefined =>
    preview.rows.find((r) => r.id === id);

  // 1) Cross-currency: awaiting MYR + posted CNY -> ONE expense (R1/R4).
  for (const pair of preview.crossCurrencyPairs) {
    const aw = candidateOf(pair.awaitingId);
    const po = candidateOf(pair.postedId);
    if (!aw || !po || !importRows.includes(aw) || !importRows.includes(po)) continue;
    const rec = reconcileCrossCurrency(toMatchable(aw), toMatchable(po));
    const accountId = resolver(aw);
    const settleCurrency =
      (accountId && accountsById.get(accountId)?.currency) || rec.settleCurrency;
    const origMinor = aw.origAmountMinor ?? aw.amountMinor;
    const txn: Txn = {
      id: makeId(),
      type: 'expense',
      currency: aw.origCurrency ?? aw.currency,
      amount: fromMinor(origMinor, aw.origCurrency ?? aw.currency),
      origAmountMinor: origMinor,
      origCurrency: aw.origCurrency ?? aw.currency,
      settleAmountMinor: rec.settleAmountMinor,
      settleCurrency,
      fxRate: rec.fxRate,
      fxSource: 'card',
      isPosted: true,
      accountId,
      category: aw.category || '其他',
      merchant: aw.merchant,
      note: '',
      date: aw.date,
      time: aw.time,
      createdAt: now,
      countInStats: true,
      ...candidateMeta(aw),
    };
    txns.push(txn);
    consumed.add(aw.id);
    consumed.add(po.id);
    rowToTxnId.set(aw.id, txn.id);
    rowToTxnId.set(po.id, txn.id);
    crossCurrencyMerged++;
  }

  // 2) Transfer: expense A + income B -> ONE transfer (accountId=A, toAccountId=B).
  for (const tr of preview.transferSuggestions) {
    if (consumed.has(tr.expenseId) || consumed.has(tr.incomeId)) continue;
    const e = candidateOf(tr.expenseId);
    const i = candidateOf(tr.incomeId);
    if (!e || !i || !importRows.includes(e) || !importRows.includes(i)) continue;
    const fromId = resolver(e);
    const toId = resolver(i);
    const txn: Txn = {
      id: makeId(),
      type: 'transfer',
      currency: e.currency,
      amount: fromMinor(e.amountMinor, e.currency),
      origAmountMinor: e.origAmountMinor ?? e.amountMinor,
      origCurrency: e.origCurrency ?? e.currency,
      accountId: fromId,
      toAccountId: toId,
      category: '转账还款',
      merchant: e.merchant,
      note: '',
      date: e.date,
      time: e.time,
      createdAt: now,
      countInStats: true,
      ...candidateMeta(e),
    };
    txns.push(txn);
    consumed.add(e.id);
    consumed.add(i.id);
    rowToTxnId.set(e.id, txn.id);
    rowToTxnId.set(i.id, txn.id);
    transferMerged++;
  }

  // 3) Everything else: one Txn per remaining importable row (incl. refunds).
  for (const row of preview.rows) {
    if (consumed.has(row.id) || !importRows.includes(row)) continue;
    const accountId = resolver(row);

    // 3a) Cross-source 关联补全: this posted CNY row completes an EXISTING
    //     MYR awaiting txn instead of creating a new one (R4). Currency-gated by
    //     findCrossSourceAwaiting (MYR awaiting + CNY posted), so Alipay (CNY)
    //     only ever reconciles against its own RMB-card MYR charge and never
    //     against a TNG (MYR) ledger row. Re-enabled for all sources now that
    //     the blanket NO_DEDUP exemption is gone.
    if (crossSource) {
      const target = findCrossSourceAwaiting(row, existing, accountId, ccWindow);
      if (target) {
        modified.push({
          id: target.id,
          before: { ...target },
          after: { ...target, ...reconcilePatch(target, row) },
        });
        consumed.add(row.id);
        rowToTxnId.set(row.id, target.id);
        crossSourceReconciled++;
        continue;
      }
    }

    const cur = row.origCurrency ?? row.currency;
    const origMinor = row.origAmountMinor ?? row.amountMinor;
    const txn: Txn = {
      id: makeId(),
      type: row.txnType,
      currency: cur,
      amount: fromMinor(origMinor, cur),
      origAmountMinor: origMinor,
      origCurrency: cur,
      accountId,
      category: row.category || '其他',
      merchant: row.merchant,
      note: '',
      date: row.date,
      time: row.time,
      createdAt: now,
      countInStats: true,
      ...candidateMeta(row),
    };
    // File-provided historical settlement is SAFE to persist (R2): it's a real
    // rate from the statement, never the live FX estimate.
    if (row.settleAmountMinor != null && row.settleCurrency) {
      txn.settleAmountMinor = row.settleAmountMinor;
      txn.settleCurrency = row.settleCurrency;
      txn.fxRate = origMinor > 0 ? Math.round((row.settleAmountMinor * 1_000_000) / origMinor) / 1_000_000 : undefined;
      txn.fxSource = 'system';
    }
    // awaiting_posting -> isPosted=false (R3): no fabricated settle amount.
    const posting = (row.meta?.postingStatus as string | undefined);
    txn.isPosted = posting === 'awaiting_posting' ? false : true;
    txns.push(txn);
    rowToTxnId.set(row.id, txn.id);
  }

  // 4) Refund linkage: point each refund at the expense Txn it offsets.
  for (const row of preview.rows) {
    if (consumed.has(row.id)) continue;
    if (row.txnType !== 'refund' || !row.suggestedRefund) continue;
    const refundTxnId = rowToTxnId.get(row.id);
    const expenseTxnId = rowToTxnId.get(row.suggestedRefund.otherId);
    if (refundTxnId && expenseTxnId) {
      const rt = txns.find((t) => t.id === refundTxnId);
      if (rt && !rt.linkedTxnId) {
        rt.linkedTxnId = expenseTxnId;
        refundLinked++;
      }
    }
  }

  // 4b) Cross-source 关联补全: a refund with no in-batch partner links to an
  //     EXISTING ledger expense instead. Currency-gated by findCrossSourceExpense
  //     (the existing row must share the refund's currency), so Alipay (CNY)
  //     refunds never link to TNG (MYR) ledger rows and vice-versa (spec §四/§三).
  if (crossSource) {
    for (const row of preview.rows) {
      if (consumed.has(row.id) || !importRows.includes(row)) continue;
      if (row.txnType !== 'refund' || row.suggestedRefund) continue;
      const refundTxnId = rowToTxnId.get(row.id);
      if (!refundTxnId) continue;
      const rt = txns.find((t) => t.id === refundTxnId);
      if (!rt || rt.linkedTxnId) continue;
      const target = findCrossSourceExpense(row, existing, rt.accountId, refundWindow);
      if (target) {
        rt.linkedTxnId = target.id;
        crossSourceRefundLinked++;
      }
    }
  }

  // 5) Cross-source duplicate suppression (don't re-import what's already there).
  //     Now applies to ALL sources (the NO_DEDUP blanket exemption is gone). The
  //     composite key in findExistingDuplicates — accountId + date + currency +
  //     amount + merchant — already isolates Alipay (CNY) from TNG (MYR), so
  //     re-importing the same Alipay file correctly dedups against the existing
  //     Alipay ledger rows without ever touching TNG rows (spec §二/§十 #10).
  let skippedExisting = 0;
  if (existing.length > 0) {
    const drop = findExistingDuplicates(existing, txns);
    const kept: Txn[] = [];
    drop.forEach((idx) => {
      skippedExisting++;
      // remove its row mapping so undo count stays accurate
      const removed = txns[idx];
      for (const [rid, tid] of rowToTxnId) if (tid === removed.id) rowToTxnId.delete(rid);
    });
    for (let i = 0; i < txns.length; i++) if (!drop.has(i)) kept.push(txns[i]);
    txns.length = 0;
    txns.push(...kept);
  }

  // 5b) Settlement association (same-currency, spec §三/§四). Link an imported
  //     platform consumption to its existing bank/card settlement (or vice-versa).
  //     Exactly ONE side becomes the settlement (countInStats=false) so the budget
  //     is deducted only once. Currency-gated by the imported row's own currency,
  //     so Alipay (CNY) never matches a TNG (MYR) ledger row and vice-versa.
  if (crossSource) {
    const links = resolveSettlementLinks(
      preview.rows.filter((r) => importRows.includes(r)),
      existing,
      resolver
    );
    const modifiedIds = new Set(modified.map((m) => m.id));
    for (const link of links) {
      const importedTxnId = rowToTxnId.get(link.rowId);
      if (link.flagExisting) {
        const ex = existing.find((t) => t.id === link.existingId);
        if (!ex || ex.countInStats === false || modifiedIds.has(ex.id)) continue;
        modified.push({ id: ex.id, before: { ...ex }, after: { ...ex, countInStats: false } });
        modifiedIds.add(ex.id);
        if (importedTxnId) {
          const it = txns.find((t) => t.id === importedTxnId);
          if (it && !it.linkedTxnId) it.linkedTxnId = ex.id;
        }
        crossSourceSettlementLinked++;
      } else {
        if (importedTxnId) {
          const it = txns.find((t) => t.id === importedTxnId);
          if (it && it.countInStats !== false) {
            it.countInStats = false;
            it.linkedTxnId = link.existingId;
            crossSourceSettlementLinked++;
          }
        }
      }
    }
  }

  // 6) Counters + PII-free report.
  const bySource: Record<string, number> = {};
  const totalMinorByCurrency: Record<string, number> = {};
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  for (const t of txns) {
    const cur = t.origCurrency ?? t.currency;
    bySource[t.currency] = (bySource[t.currency] ?? 0) + 1;
    totalMinorByCurrency[cur] = (totalMinorByCurrency[cur] ?? 0) + (t.origAmountMinor ?? 0);
    if (!dateFrom || t.date < dateFrom) dateFrom = t.date;
    if (!dateTo || t.date > dateTo) dateTo = t.date;
  }
  const report: ImportReport = {
    createdAt: now,
    totalRows: preview.rows.length,
    importedRows: txns.length,
    skippedDuplicates: preview.duplicates.length,
    skippedExisting,
    bySource,
    totalMinorByCurrency,
    crossCurrencyMerged,
    transferMerged,
    refundLinked,
    crossSourceReconciled,
    crossSourceRefundLinked,
    crossSourceSettlementLinked,
    modifiedTxnIds: modified.map((m) => m.id),
    dateFrom,
    dateTo,
  };
  const counters: BatchCounters = {
    totalRows: preview.rows.length,
    importedRows: txns.length,
    skippedDuplicates: preview.duplicates.length + skippedExisting,
    bySource,
    totalMinor: totalMinorByCurrency[dominantCurrency(totalMinorByCurrency)] ?? 0,
    currency: dominantCurrency(totalMinorByCurrency),
    dateFrom,
    dateTo,
  };
  return { txns, rowToTxnId, report, counters, modified };
}

// ----------------------------------------------------------------------- commit
export interface CommitResult {
  batch: ImportBatch;
  createdTxns: Txn[];
  report: ImportReport;
}

export async function commit(
  backend: PersistenceBackend,
  preview: UnifiedPreview,
  opts: CommitOptions
): Promise<CommitResult> {
  const cur = await backend.load();
  const plan = buildCommitPlan(preview, { ...opts, existingTxns: cur.txns });

  // Apply cross-source patches to existing txns, keeping before-snapshots for undo.
  const rollbacks: Record<string, Txn[]> = { ...(cur.rollbacks ?? {}) };
  const batchId = opts.batchId ?? defaultMakeId();
  let base: Txn[];
  if (plan.modified.length > 0) {
    const patchMap = new Map(plan.modified.map((m) => [m.id, m.after]));
    base = cur.txns.map((t) => patchMap.get(t.id) ?? t);
    rollbacks[batchId] = plan.modified.map((m) => m.before);
  } else {
    base = cur.txns;
  }
  const merged = base.concat(plan.txns);
  const accounts = recomputeAccounts(merged, cur.accounts);

  const sources = Array.from(new Set(preview.rows.map((r) => r.source))) as ImportSource[];
  const fileNames = Array.from(new Set(preview.rows.map((r) => r.sourceFile)));
  const batch = buildImportBatch({
    id: batchId,
    sources,
    fileNames,
    txnIds: plan.txns.map((t) => t.id),
    counters: plan.counters,
    modifiedTxnIds: plan.modified.map((m) => m.id),
  });
  const batches = cur.batches.concat(batch);
  await backend.save({ txns: merged, accounts, batches, rollbacks });
  return { batch, createdTxns: plan.txns, report: plan.report };
}

// ------------------------------------------------------------------------- undo
export interface UndoResult {
  ok: boolean;
  reason?: 'not_found' | 'already_undone';
  removedTxnIds?: string[];
  recomputedAccounts?: Account[];
}

export async function undo(backend: PersistenceBackend, batchId: string): Promise<UndoResult> {
  const cur = await backend.load();
  const batch = cur.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, reason: 'not_found' };
  if (batch.status === 'undone') return { ok: false, reason: 'already_undone' };

  const removeIds = new Set(batch.txnIds);
  // Restore any existing txn this batch patched (cross-source 关联补全), then
  // drop the txns it created.
  const snapshots = cur.rollbacks?.[batchId] ?? [];
  const restoreMap = new Map(snapshots.map((t) => [t.id, t]));
  const txns = cur.txns
    .filter((t) => !removeIds.has(t.id))
    .map((t) => restoreMap.get(t.id) ?? t);
  const accounts = recomputeAccounts(txns, cur.accounts);
  const batches = cur.batches.map((b) =>
    b.id === batchId ? { ...b, status: 'undone' as const } : b
  );
  const rollbacks: Record<string, Txn[]> = { ...(cur.rollbacks ?? {}) };
  delete rollbacks[batchId];
  await backend.save({ txns, accounts, batches, rollbacks });
  return { ok: true, removedTxnIds: batch.txnIds, recomputedAccounts: accounts };
}

/** Build a human-readable, PII-free summary string for the import report UI. */
export function summarizeReport(r: ImportReport): string {
  const cur = Object.keys(r.totalMinorByCurrency);
  const totals = cur
    .map((c) => `${c} ${r.totalMinorByCurrency[c]}`)
    .join(', ');
  return (
    `导入 ${r.importedRows} 笔（共 ${r.totalRows} 行）` +
    (r.skippedDuplicates ? `，跳过重复 ${r.skippedDuplicates} 笔` : '') +
    (r.skippedExisting ? `，已存在 ${r.skippedExisting} 笔` : '') +
    (r.crossCurrencyMerged ? `，跨币合并 ${r.crossCurrencyMerged} 对` : '') +
    (r.transferMerged ? `，转账合并 ${r.transferMerged} 笔` : '') +
    (r.refundLinked ? `，退款关联 ${r.refundLinked} 笔` : '') +
    (r.crossSourceReconciled ? `，补全已入账 ${r.crossSourceReconciled} 笔` : '') +
    (r.crossSourceRefundLinked ? `，关联历史退款 ${r.crossSourceRefundLinked} 笔` : '') +
    (r.crossSourceSettlementLinked ? `，结算关联 ${r.crossSourceSettlementLinked} 笔` : '') +
    (totals ? `。金额：${totals}` : '')
  );
}

// In-memory backend for tests / previews. The app supplies an AsyncStorage one.
export function createMemoryBackend(seed?: {
  txns?: Txn[];
  accounts?: Account[];
  batches?: ImportBatch[];
  rollbacks?: Record<string, Txn[]>;
}): PersistenceBackend & { state: () => BackendState } {
  const data: BackendState = {
    txns: seed?.txns ?? [],
    accounts: seed?.accounts ?? [],
    batches: seed?.batches ?? [],
    rollbacks: seed?.rollbacks ?? {},
  };
  return {
    load: async () => ({
      txns: data.txns,
      accounts: data.accounts,
      batches: data.batches,
      rollbacks: data.rollbacks,
    }),
    save: async (s) => {
      data.txns = s.txns;
      data.accounts = s.accounts;
      data.batches = s.batches;
      data.rollbacks = s.rollbacks ?? {};
    },
    state: () => ({
      txns: data.txns,
      accounts: data.accounts,
      batches: data.batches,
      rollbacks: data.rollbacks,
    }),
  };
}

// In-memory backend for tests / previews. The app supplies an AsyncStorage one.
