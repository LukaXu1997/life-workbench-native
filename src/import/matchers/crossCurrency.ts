// CrossCurrencyMatcher — link a MYR `awaiting_posting` charge to the matching
// CNY `posted` charge on the SAME card account (e.g. an RMB credit card whose
// Malaysian Ringgit spend posts later in CNY). This is the import/notify shared
// replacement for notify/dedup.findPostingMatch (IMPLEMENTATION_PLAN §4.3 / R5).
//
// On commit we RECONCILE the awaiting txn (write settle fields) — we NEVER create
// a second expense. See `reconcileCrossCurrency`.
//
// RN-free, pure.

import type { Currency, FxSource } from '../../types';
import type { Matchable } from './types';
import { dayDiff } from './types';

export interface CrossCurrencyPair {
  awaitingId: string; // MYR awaiting_posting (orig MYR)
  postedId: string; // CNY posted (settle CNY)
  accountKey: string;
  /** cnyPerMyr * 1e6, derived from the two amounts (the real historical rate). */
  fxRateScaled?: number;
}

export interface CrossCurrencyOptions {
  windowDays?: number;
}

function isMyrAwaiting(m: Matchable): boolean {
  return m.postingStatus === 'awaiting_posting' && (m.origCurrency ?? m.currency) === 'MYR';
}
function isCnyPosted(m: Matchable): boolean {
  return m.postingStatus === 'posted' && (m.settleCurrency ?? m.currency) === 'CNY';
}

export function findCrossCurrencyMatches(items: Matchable[], opts: CrossCurrencyOptions = {}): CrossCurrencyPair[] {
  const windowDays = opts.windowDays ?? 3;
  const out: CrossCurrencyPair[] = [];
  const awaiting = items.filter(isMyrAwaiting);
  const posted = items.filter(isCnyPosted);
  for (const a of awaiting) {
    for (const p of posted) {
      if (a.accountKey !== p.accountKey) continue;
      const an = a.merchantNorm;
      const pn = p.merchantNorm;
      const overlap = an !== '' && pn !== '' && (an === pn || an.includes(pn) || pn.includes(an));
      if (!overlap) continue;
      if (Math.abs(dayDiff(a.date, p.date)) > windowDays) continue;
      const refA = a.bankRef || a.sourceRef;
      const refP = p.bankRef || p.sourceRef;
      if (refA && refP && refA !== refP) continue;
      const aOrig = a.origAmountMinor ?? a.amountMinor;
      const pSettle = p.settleAmountMinor ?? p.amountMinor;
      const fxRateScaled =
        aOrig > 0 ? Math.round((pSettle * 1_000_000) / aOrig) : undefined;
      out.push({ awaitingId: a.id, postedId: p.id, accountKey: a.accountKey, fxRateScaled });
    }
  }
  return out;
}

/** Fields written onto the awaiting txn when the cross-currency pair is committed. */
export interface ReconciledSettle {
  settleAmountMinor: number; // actual ¥ posted
  settleCurrency: Currency; // = the card account currency (R1)
  fxRate: number; // cnyPerMyr (1 MYR = fxRate CNY)
  fxSource: FxSource; // 'card' — the real bank rate, never the live estimate
  isPosted: true;
}

/**
 * Reconcile: attach the real CNY settlement to the MYR awaiting charge.
 * Returns ONLY the settle fields — the caller merges them onto the existing
 * (single) txn. No second transaction is created.
 */
export function reconcileCrossCurrency(awaiting: Matchable, posted: Matchable): ReconciledSettle {
  const settleAmountMinor = posted.settleAmountMinor ?? posted.amountMinor;
  const orig = awaiting.origAmountMinor ?? awaiting.amountMinor;
  const fxRateScaled = orig > 0 ? Math.round((settleAmountMinor * 1_000_000) / orig) : 0;
  return {
    settleAmountMinor,
    settleCurrency: (posted.settleCurrency ?? posted.currency) as Currency,
    fxRate: fxRateScaled / 1_000_000,
    fxSource: 'card',
    isPosted: true,
  };
}
