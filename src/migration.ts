// Schema migration logic — isolated so it can be unit-tested without AsyncStorage.
import type { Txn, Account, Currency, Region } from './types';

export function clampDay(n: number | null | undefined): number | null {
  if (n == null || isNaN(Number(n))) return null;
  return Math.max(1, Math.min(31, Math.floor(Number(n))));
}

function isRepayment(t: any): boolean {
  return t.type === 'repayment' || t.category === '信用卡还款';
}

// Maps a single legacy/raw Txn to the dual-currency shape.
// Preserves `id` (=> re-running migration never creates duplicate records).
export function migrateTxn(t: any, acctByCur: Record<Currency, string>, cardId: string): Txn {
  const currency: Currency = t.currency === 'MYR' ? 'MYR' : 'CNY';
  const amountMinor = Math.round((typeof t.amount === 'number' ? t.amount : 0) * 100);
  const repay = isRepayment(t);
  const region: Region = currency === 'CNY' ? 'CN' : 'MY';
  return {
    ...t,
    origCurrency: currency,
    origAmountMinor: amountMinor,
    settleCurrency: currency,
    settleAmountMinor: amountMinor,
    fxRate: 1,
    fxSource: 'migration',
    accountId: repay ? cardId || acctByCur[currency] : acctByCur[currency],
    region,
    cardId: repay ? cardId || undefined : undefined,
    isCardTxn: repay,
    isPosted: true,
    isRepaid: repay,
    countInStats: !repay,
    createdAt: t.createdAt ?? Date.now(),
  };
}

export function migrateTxns(txns: any[], accounts: Account[]): { migrated: Txn[]; cardId: string } {
  const pick = (cur: Currency): string => {
    const same = accounts.filter((a) => a.currency === cur && a.type !== 'credit');
    const debit = same.find((a) => a.type === 'debit');
    return (debit ?? same[0] ?? accounts[0])?.id ?? '';
  };
  const acctByCur: Record<Currency, string> = { CNY: pick('CNY'), MYR: pick('MYR') };
  const cardAcct = accounts.find((a) => a.type === 'credit');
  const cardId = cardAcct?.id ?? '';
  const migrated = txns.map((t) => migrateTxn(t, acctByCur, cardId));
  return { migrated, cardId };
}
