// TransferMatcher — pair an `expense` on account A with an `income` on a
// DIFFERENT account B (same amount, same day, transfer keyword) and suggest
// merging them into a single `transfer` (accountId=A, toAccountId=B).
//
// Needs user confirmation (avoid double-counting). RN-free, pure.

import type { Currency } from '../../types';
import type { Matchable } from './types';

const TRANSFER_KW = /转账|转帐|transfer|转入|转出|跨行|interbank/i;

export interface TransferSuggestion {
  expenseId: string;
  incomeId: string;
  amountMinor: number;
  currency: Currency;
  /** The account key of the expense side (becomes accountId). */
  fromAccountKey: string;
  /** The account key of the income side (becomes toAccountId). */
  toAccountKey: string;
}

function hasTransferKeyword(a: Matchable, b: Matchable): boolean {
  return TRANSFER_KW.test(a.merchantNorm + ' ' + b.merchantNorm);
}

export function findTransferMatches(items: Matchable[]): TransferSuggestion[] {
  const out: TransferSuggestion[] = [];
  const expenses = items.filter((i) => i.type === 'expense');
  const incomes = items.filter((i) => i.type === 'income');
  for (const e of expenses) {
    for (const inc of incomes) {
      if (e.accountKey === inc.accountKey) continue; // same account => not a transfer
      if (e.amountMinor !== inc.amountMinor) continue;
      if (e.currency !== inc.currency) continue;
      if (e.date !== inc.date) continue;
      if (!hasTransferKeyword(e, inc)) continue;
      out.push({
        expenseId: e.id,
        incomeId: inc.id,
        amountMinor: e.amountMinor,
        currency: e.currency,
        fromAccountKey: e.accountKey,
        toAccountKey: inc.accountKey,
      });
    }
  }
  return out;
}
