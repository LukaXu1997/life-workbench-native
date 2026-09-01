// Unify — the importer's in-memory orchestrator (Phase 5 core).
//
// `buildImportPreview` takes the adapters' ImportCandidates and produces a
// `UnifiedPreview`: the normalized + categorized + matched view that Phase 6
// (preview/commit UI) will render and act on. It performs NO I/O, NO persistence,
// and NO FX overwrites — it is a pure function over the candidate list.
//
// Pipeline:
//   1. categorize (fill missing category)
//   2. standardize (orig anchor + display-only predicted settle)
//   3. build Matchables (with an accountKey resolver)
//   4. run the four shared matchers (Duplicate / Transfer / Refund / CrossCurrency)
//   5. assemble per-row flags + summary counts
//
// RN-free, pure.

import type { ImportCandidate } from './models';
import { standardize, type StandardizedCandidate } from './standardize';
import { categorize } from './autoCategorize';
import { toMatchable, candidateAccountKey, type Matchable } from './matchers/types';
import { findDuplicates, type DupStatus } from './matchers/duplicate';
import { findTransferMatches, type TransferSuggestion } from './matchers/transfer';
import { findRefundMatches, type RefundSuggestion } from './matchers/refund';
import { findCrossCurrencyMatches, type CrossCurrencyPair } from './matchers/crossCurrency';

export type { StandardizedCandidate };

export interface UnifiedRow extends StandardizedCandidate {
  dupStatus: DupStatus;
  dupOfId?: string;
  suggestedTransfer?: { otherId: string };
  suggestedRefund?: { otherId: string };
  /** Whether this row should be skipped on commit (definite duplicate). */
  skipByDefault: boolean;
}

export interface UnifiedPreview {
  rows: UnifiedRow[];
  duplicates: string[]; // definite-dup candidate ids
  suspectedDuplicates: string[];
  transferSuggestions: TransferSuggestion[];
  refundSuggestions: RefundSuggestion[];
  crossCurrencyPairs: CrossCurrencyPair[];
  summary: {
    total: number;
    importable: number; // not a definite duplicate
    duplicates: number;
    suspected: number;
    byCurrency: Record<string, number>;
    totalMinorByCurrency: Record<string, number>;
  };
}

export interface UnifyOptions {
  /** cnyPerMyr * 1e6, for the MYR->CNY display estimate only. */
  rateScaled?: number;
  /** Map a candidate -> account grouping key. Default: hint/currency. */
  accountKeyResolver?: (c: ImportCandidate) => string;
  dedupWindowDays?: number;
  refundWindowDays?: number;
  crossCurrencyWindowDays?: number;
}

function emptyCounts(): Record<string, number> {
  return {};
}

export function buildImportPreview(candidates: ImportCandidate[], opts: UnifyOptions = {}): UnifiedPreview {
  const resolver = opts.accountKeyResolver ?? ((c: ImportCandidate) => candidateAccountKey(c));

  // 1-2: categorize + standardize
  const standardized: StandardizedCandidate[] = candidates.map((c) =>
    standardize(categorize(c), { rateScaled: opts.rateScaled })
  );

  // 3: matchables (with resolved account keys)
  const matchables: Matchable[] = standardized.map((s) => {
    const m = toMatchable(s);
    m.accountKey = resolver(s);
    return m;
  });

  // 4: matchers
  const dups = findDuplicates(matchables, { windowDays: opts.dedupWindowDays ?? 0 });
  const transfers = findTransferMatches(matchables);
  const refunds = findRefundMatches(matchables, { windowDays: opts.refundWindowDays ?? 30 });
  const cross = findCrossCurrencyMatches(matchables, { windowDays: opts.crossCurrencyWindowDays ?? 3 });

  const transferByRow = new Map<string, TransferSuggestion>();
  for (const t of transfers) {
    transferByRow.set(t.expenseId, t);
    transferByRow.set(t.incomeId, t);
  }
  const refundByRow = new Map<string, RefundSuggestion>();
  for (const r of refunds) {
    refundByRow.set(r.refundId, r);
    refundByRow.set(r.expenseId, r);
  }

  // 5: assemble rows + summary
  const rows: UnifiedRow[] = standardized.map((s) => {
    const id = s.id;
    let dupStatus = dups.byId[id] ?? 'none';
    let dupOfId = dups.suspected.get(id);
    const t = transferByRow.get(id);
    const r = refundByRow.get(id);
    return {
      ...s,
      dupStatus,
      dupOfId,
      suggestedTransfer: t ? { otherId: t.expenseId === id ? t.incomeId : t.expenseId } : undefined,
      suggestedRefund: r ? { otherId: r.refundId === id ? r.expenseId : r.refundId } : undefined,
      // No automatic skipping: every row is importable by default and the user
      // decides in the preview. Dupes are only flagged (suspected) as a hint.
      skipByDefault: false,
    };
  });

  const byCurrency: Record<string, number> = emptyCounts();
  const totalMinorByCurrency: Record<string, number> = emptyCounts();
  for (const r of rows) {
    const cur = r.currency;
    byCurrency[cur] = (byCurrency[cur] ?? 0) + 1;
    totalMinorByCurrency[cur] = (totalMinorByCurrency[cur] ?? 0) + r.amountMinor;
  }

  // No auto-dedup tier exists anymore, so the "definite duplicate" list is
  // always empty — the user reviews and confirms everything in the preview.
  const duplicates: string[] = [];
  const suspectedDuplicates = rows.filter((r) => r.dupStatus === 'suspected').map((r) => r.id);

  return {
    rows,
    duplicates,
    suspectedDuplicates,
    transferSuggestions: transfers,
    refundSuggestions: refunds,
    crossCurrencyPairs: cross,
    summary: {
      total: rows.length,
      importable: rows.length - duplicates.length,
      duplicates: duplicates.length,
      suspected: suspectedDuplicates.length,
      byCurrency,
      totalMinorByCurrency,
    },
  };
}
