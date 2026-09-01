// RefundMatcher — link a `refund` candidate to a matching `expense` on the same
// account (same amount, same currency, merchantNorm match, within a time window)
// and suggest `linkedTxnId` association. On commit the refund keeps
// `countInStats=true` so it offsets the original expense without double counting.
//
// RN-free, pure.

import type { Currency } from '../../types';
import type { Matchable } from './types';
import { dayDiff } from './types';

export interface RefundSuggestion {
  refundId: string;
  expenseId: string;
  amountMinor: number;
  currency: Currency;
  accountKey: string;
}

export interface RefundOptions {
  /** Max days between the original expense and the refund. Default 30. */
  windowDays?: number;
}

export function findRefundMatches(items: Matchable[], opts: RefundOptions = {}): RefundSuggestion[] {
  const windowDays = opts.windowDays ?? 30;
  const out: RefundSuggestion[] = [];
  const refunds = items.filter((i) => i.type === 'refund');
  const expenses = items.filter((i) => i.type === 'expense');
  for (const r of refunds) {
    for (const e of expenses) {
      if (e.accountKey !== r.accountKey) continue;
      if (e.amountMinor !== r.amountMinor) continue;
      if (e.currency !== r.currency) continue;
      // merchantNorm must match (or one is empty -> skip match to avoid false link)
      if (e.merchantNorm === '' || e.merchantNorm !== r.merchantNorm) continue;
      if (Math.abs(dayDiff(e.date, r.date)) > windowDays) continue;
      out.push({
        refundId: r.id,
        expenseId: e.id,
        amountMinor: e.amountMinor,
        currency: e.currency,
        accountKey: e.accountKey,
      });
    }
  }
  return out;
}
