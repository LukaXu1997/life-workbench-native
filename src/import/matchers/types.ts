// Shared matching primitives for the Unified Importer.
//
// These types/functions are deliberately RN-free and PURE so they can be unit
// tested under plain Node and consumed by BOTH the file-import pipeline and the
// notification (auto-bookkeeping) pipeline. The plan (IMPLEMENTATION_PLAN §4.3)
// requires the four matchers (Duplicate / Transfer / Refund / CrossCurrency) to
// be shared across both entry points via a single `Matchable` interface.
//
// PRIVACY: a `Matchable` carries only normalized, non-PII fields (merchant NORM,
// integer amounts, dates, refs). It never stores the raw description text.

import type { Currency, TxnType } from '../../types';
import type { ImportCandidate, ImportSource } from '../models';

/** The unified shape every matcher consumes. */
export interface Matchable {
  id: string;
  /** Grouping anchor: a concrete accountId, or a logical key (hint+currency). */
  accountKey: string;
  /** Canonical "orig" amount (integer minor units) in `currency`. */
  amountMinor: number;
  currency: Currency;
  /** Normalized merchant string (lowercase, alnum + CJK only). */
  merchantNorm: string;
  /** YYYY-MM-DD */
  date: string;
  /** Originating platform (spec §二). Part of the dedup scope key. */
  source?: ImportSource;
  /** Source file name (display/scoping only). The dedup scope key does NOT include
   *  the file, so rows with identical content from different files are never merged. */
  sourceFile?: string;
  /** Platform order id (e.g. 交易单号 / 交易号). P1 dedup anchor. */
  sourceRef?: string;
  /** Bank reference (e.g. TNG ref). Also a P1 dedup anchor. */
  bankRef?: string;
  type?: TxnType;
  // cross-currency signalling
  postingStatus?: 'awaiting_posting' | 'posted' | null;
  origAmountMinor?: number;
  origCurrency?: Currency;
  settleAmountMinor?: number;
  settleCurrency?: Currency;
}

/**
 * Dedup scope key (spec §二). Two rows can ONLY be considered duplicates if they
 * share the SAME scope key — i.e. identical source + account grouping + currency.
 * Because Alipay (source=alipay, currency=CNY) and TNG (source=tng, currency=MYR)
 * differ on BOTH `source` and `currency`, they can never share a scope key, so
 * they are automatically and structurally prevented from being judged duplicates.
 * Within a single platform (e.g. two rows of the same Alipay file) the key still
 * matches, so genuine duplicates ARE still detected.
 */
export function dedupScopeKey(m: Matchable): string {
  return `${m.source ?? ''}|${m.accountKey}|${m.currency}`;
}

/** Normalized merchant string used for all comparisons. */
export function normMerchant(s?: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]/g, '');
}

/** Default grouping key for a candidate before a real account is assigned. */
export function candidateAccountKey(c: ImportCandidate): string {
  return c.accountId ?? c.accountHint ?? c.currency;
}

/** Build a `Matchable` from an `ImportCandidate`. */
export function toMatchable(c: ImportCandidate): Matchable {
  const origAmountMinor = c.origAmountMinor ?? c.amountMinor;
  const origCurrency = c.origCurrency ?? c.currency;
  const settleAmountMinor =
    c.settleAmountMinor != null && (c.settleCurrency ?? c.currency) !== origCurrency
      ? c.settleAmountMinor
      : undefined;
  const settleCurrency = settleAmountMinor != null ? (c.settleCurrency ?? c.currency) : undefined;
  return {
    id: c.id,
    accountKey: candidateAccountKey(c),
    amountMinor: origAmountMinor,
    currency: origCurrency,
    merchantNorm: normMerchant(c.merchant),
    date: c.date,
    source: c.source,
    sourceFile: c.sourceFile,
    sourceRef: c.rawRef,
    bankRef: (c.meta?.ref as string | undefined) ?? c.rawRef,
    type: c.txnType,
    postingStatus: (c.meta?.postingStatus as Matchable['postingStatus']) ?? null,
    origAmountMinor,
    origCurrency,
    settleAmountMinor,
    settleCurrency,
  };
}

/** Build a `Matchable` from an existing `Txn` (for cross-source dedup). */
export function toMatchableFromTxn(t: {
  id: string;
  accountId?: string;
  amountMinor?: number;
  currency: Currency;
  merchant?: string;
  date: string;
  type?: TxnType;
  origAmountMinor?: number;
  origCurrency?: Currency;
  settleAmountMinor?: number;
  settleCurrency?: Currency;
  isPosted?: boolean;
  postingStatus?: 'awaiting_posting' | 'posted' | null;
  bankRef?: string;
}): Matchable {
  const origAmountMinor = t.origAmountMinor ?? t.amountMinor ?? 0;
  const origCurrency = t.origCurrency ?? t.currency;
  const posting =
    t.postingStatus ?? (t.isPosted ? 'posted' : null);
  return {
    id: t.id,
    accountKey: t.accountId ?? '',
    amountMinor: origAmountMinor,
    currency: origCurrency,
    merchantNorm: normMerchant(t.merchant),
    date: t.date,
    sourceRef: undefined,
    bankRef: t.bankRef,
    type: t.type,
    postingStatus: posting,
    origAmountMinor,
    origCurrency,
    settleAmountMinor: t.settleAmountMinor,
    settleCurrency: t.settleCurrency,
  };
}

/** Whole-day delta between two YYYY-MM-DD strings (b - a). */
export function dayDiff(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  if (isNaN(da) || isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.round((db - da) / 86400000);
}
