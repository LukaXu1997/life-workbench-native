// Chart aggregation — RN-FREE, pure, unit-testable under plain Node.
//
// These functions feed the finance dashboard's trend chart (monthly / yearly) and
// the category-share donut. They deliberately live in the `import/` tree (no React
// Native imports) so the same code runs in `scripts/finance-chart-test-runner.js`.
//
// All amounts are INTEGER MINOR units (sen/fen). No floating-point math.
//
// Design notes (consistent with recompute.ts financeStats):
//   - Only rows that count toward income/expense stats are summed:
//       txnCountInStats(t) && t.affectsIncomeExpense !== false
//   - Currency is respected: an MYR expense only ever contributes to the MYR series.
//   - Refunds net the matching currency (expense side is reduced by the refund).

import type { Txn, Currency } from '../types';
import { ymStr } from '../datetime';
import {
  txnStatCurrency,
  txnStatMinor,
  txnCountInStats,
} from '../money';

// --------------------------------------------------------------------- shapes
export interface MonthPoint {
  /** YYYY-MM */
  ym: string;
  income: number; // minor units, selected currency
  expense: number; // minor units (expense − refund)
  net: number; // income − expense
}
export interface YearPoint {
  /** YYYY */
  year: string;
  income: number;
  expense: number;
  net: number;
}
export interface CatShare {
  category: string;
  amountMinor: number;
  pct: number; // 0..100, integer
}

// ------------------------------------------------------------------- helpers
// 统计口径：跨币种信用卡按卡本币（settleCurrency）计，而非商户原币。
// 因此「人民币信用卡（settleCurrency=CNY）在马来西亚消费（origCurrency=MYR）」
// 只在 ¥ 视图出现，不会计入 RM 视图（不双计、不在原币重复记录）。
function statIncome(tx: Txn, cur: Currency): number {
  if (!txnCountInStats(tx)) return 0;
  if (tx.affectsIncomeExpense === false) return 0;
  if (tx.type !== 'income') return 0;
  if (txnStatCurrency(tx) !== cur) return 0;
  return txnStatMinor(tx);
}
function statExpense(tx: Txn, cur: Currency): number {
  if (!txnCountInStats(tx)) return 0;
  if (tx.affectsIncomeExpense === false) return 0;
  if (tx.type !== 'expense' && tx.type !== 'refund') return 0;
  if (txnStatCurrency(tx) !== cur) return 0;
  const amt = txnStatMinor(tx);
  return tx.type === 'refund' ? -amt : amt;
}

/** Pick the currency that has more spend, so the chart opens on the meaningful data. */
export function defaultSpendCurrency(txns: Txn[]): Currency {
  let myr = 0;
  let cny = 0;
  for (const tx of txns) {
    const e = statExpense(tx, 'MYR');
    const c = statExpense(tx, 'CNY');
    myr += e;
    cny += c;
  }
  return myr >= cny ? 'MYR' : 'CNY';
}

// ------------------------------------------------------------------- monthly
export function monthlySeries(
  txns: Txn[],
  opts?: { months?: number; until?: string; cur?: Currency }
): MonthPoint[] {
  const cur = opts?.cur ?? 'MYR';
  const n = opts?.months ?? 12;
  const until = opts?.until ?? ymStr();
  const [uy, um] = until.split('-').map(Number);
  const out: MonthPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let yy = uy;
    let mm = um - i;
    while (mm < 1) {
      mm += 12;
      yy--;
    }
    while (mm > 12) {
      mm -= 12;
      yy++;
    }
    const ym = `${yy}-${`${mm}`.padStart(2, '0')}`;
    let income = 0;
    let expense = 0;
    for (const tx of txns) {
      if (!tx.date.startsWith(ym)) continue;
      income += statIncome(tx, cur);
      expense += statExpense(tx, cur);
    }
    out.push({ ym, income, expense, net: income - expense });
  }
  return out;
}

// -------------------------------------------------------------------- yearly
export function yearlySeries(
  txns: Txn[],
  opts?: { years?: number; until?: string; cur?: Currency }
): YearPoint[] {
  const cur = opts?.cur ?? 'MYR';
  const n = opts?.years ?? 5;
  const until = opts?.until ?? ymStr();
  const uy = Number(until.split('-')[0]);
  const out: YearPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const year = `${uy - i}`;
    let income = 0;
    let expense = 0;
    for (const tx of txns) {
      if (!tx.date.startsWith(year + '-')) continue;
      income += statIncome(tx, cur);
      expense += statExpense(tx, cur);
    }
    out.push({ year, income, expense, net: income - expense });
  }
  return out;
}

// ------------------------------------------------------------ category share
export function spendByCategory(
  txns: Txn[],
  ym: string,
  cur: Currency,
  opts?: { limit?: number }
): CatShare[] {
  const limit = opts?.limit ?? 8;
  const byCat: Record<string, number> = {};
  for (const tx of txns) {
    if (!tx.date.startsWith(ym)) continue;
    const amt = statExpense(tx, cur);
    if (amt <= 0) continue;
    const key = tx.category || 'uncategorized';
    byCat[key] = (byCat[key] || 0) + amt;
  }
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const total = entries.reduce((s, e) => s + e[1], 0) || 1;
  return entries.map(([category, amountMinor]) => ({
    category,
    amountMinor,
    pct: Math.round((amountMinor / total) * 100),
  }));
}
