// Dual-currency + account-based finance — RN-FREE, pure.
//
// This module holds the derived-finance math (recomputeAccounts / cardSummary /
// financeStats / financeSummary) so it can be unit-tested under plain Node
// without pulling in store.ts / React Native. `src/calc.ts` re-exports these
// from here so existing screens (FinanceScreen) keep importing from `../calc`.
//
// R3 (IMPLEMENTATION_PLAN §4.6 / §7-R3):
//   Split "已入账 (posted)" from "预计 (awaiting)". ONLY `isPosted === true`
//   counts toward the confirmed card liability / net worth. `awaiting_posting`
//   amounts are surfaced separately (unbilledMinor) and are NOT added to the
//   confirmed net worth — they are labelled "约/预计" by the UI. We NEVER
//   fabricate a settlement figure for an awaiting row.

import type { Txn, Account, FxSetting, Currency, Budget } from '../types';
import {
  convertMinor,
  txnOrigMinor,
  txnOrigCurrency,
  txnSettleMinor,
  txnCountInStats,
  txnIsPosted,
} from '../money';

// --------------------------------------------------------------------- stats
export interface FinanceStats {
  /** Daily income/expense, bucketed by currency. Respects affectsIncomeExpense. */
  incomeExpense: { CNY: { income: number; expense: number }; MYR: { income: number; expense: number } };
  /** Same as incomeExpense but only for entries flagged isRecurring (fixed income/expense). */
  recurringIncomeExpense: { CNY: { income: number; expense: number }; MYR: { income: number; expense: number } };
  /** Budget spend, bucketed by budgetCurrency. Respects affectsBudget. The two
   *  currencies are NEVER mixed — a CNY spend only ever deducts the CNY budget
   *  and an MYR spend only the MYR budget (spec §七). */
  budgetSpent: { CNY: number; MYR: number };
}

export function financeStats(txns: Txn[], ym?: string): FinanceStats {
  const r: FinanceStats = {
    incomeExpense: { CNY: { income: 0, expense: 0 }, MYR: { income: 0, expense: 0 } },
    recurringIncomeExpense: { CNY: { income: 0, expense: 0 }, MYR: { income: 0, expense: 0 } },
    budgetSpent: { CNY: 0, MYR: 0 },
  };
  for (const t of txns) {
    if (!txnCountInStats(t)) continue;
    if (ym && !t.date.startsWith(ym)) continue;
    const c = txnOrigCurrency(t);
    const amt = txnOrigMinor(t);
    const bucket = (t.budgetCurrency ?? c) as 'CNY' | 'MYR';
    // Income / expense stats — skip wealth / transfer rows (affectsIncomeExpense=false).
    if (t.affectsIncomeExpense !== false) {
      if (t.type === 'income') r.incomeExpense[c].income += amt;
      else if (t.type === 'expense') r.incomeExpense[c].expense += amt;
      else if (t.type === 'refund') r.incomeExpense[c].expense -= amt; // 冲减原支出
      // Fixed / recurring breakdown (for statistics) — only entries flagged isRecurring.
      if (t.isRecurring === true) {
        if (t.type === 'income') r.recurringIncomeExpense[c].income += amt;
        else if (t.type === 'expense') r.recurringIncomeExpense[c].expense += amt;
        else if (t.type === 'refund') r.recurringIncomeExpense[c].expense -= amt;
      }
    }
    // Budget spend — only rows that actually deduct a budget (expense/refund).
    if (t.affectsBudget !== false && (t.type === 'expense' || t.type === 'refund')) {
      if (t.type === 'expense') r.budgetSpent[bucket] += amt;
      else r.budgetSpent[bucket] -= amt; // refund returns budget
    }
  }
  return r;
}

// --------------------------------------------------------- recomputeAccounts
// Derive every account's balance / credit-card debt purely from transactions.
// Balances start at the optional opening balance (`openingBalanceMinor`, R8) so a
// brand-new account with an existing balance shows correctly even before any
// transaction is imported.
//
// POSTED vs AWAITING split (R3):
//   * credit expense with isPosted=true  -> _postedBill (confirmed liability)
//   * credit expense with isPosted=false -> _awaiting  (predicted, "约")
//   * refund mirrors the same split.
// The returned `currentBillMinor` is the CONFIRMED (posted) bill net of repaid;
// `unbilledMinor` is the AWAITING amount shown separately as an estimate.
export function recomputeAccounts(txns: Txn[], accounts: Account[]): Account[] {
  type Acc = Account & { _postedBill: number; _awaiting: number; _repaid: number; _bal: number };
  const byId = new Map<string, Acc>();
  accounts.forEach((a) =>
    byId.set(a.id, { ...a, _postedBill: 0, _awaiting: 0, _repaid: 0, _bal: a.openingBalanceMinor ?? 0 })
  );
  const acc = (id?: string): Acc | undefined => (id ? byId.get(id) : undefined);

  for (const t of txns) {
    // Off-ledger: 理财 / wealth (transactionNature==='investment') moves real
    // cash into holdings we don't model as assets, so it must NOT alter the
    // cash-account balance or net worth. Phase 4 already excluded it from
    // income/expense stats and budget; this closes the net-worth leak
    // ("理财 still affects 折合总览"). A buy/redeem pair is thus balance-neutral.
    if (t.transactionNature === 'investment') continue;
    const a = acc(t.accountId);
    const b = acc(t.toAccountId);
    const orig = txnOrigMinor(t);
    const settle = txnSettleMinor(t);
    const posted = txnIsPosted(t); // legacy txns default to posted=true
    switch (t.type) {
      case 'income':
        if (a && a.type !== 'credit') a._bal += settle;
        break;
      case 'expense':
        if (a && a.type === 'credit') {
          if (posted) a._postedBill += settle;
          else a._awaiting += settle;
        } else if (a && a.type !== 'credit') {
          a._bal -= orig;
        }
        break;
      case 'transfer':
        if (a && a.type !== 'credit') a._bal -= orig;
        if (b && b.type !== 'credit') b._bal += orig;
        break;
      case 'repayment':
        if (a && a.type !== 'credit') a._bal -= settle;
        if (b && b.type === 'credit') b._repaid += settle;
        break;
      case 'refund':
        if (a && a.type === 'credit') {
          if (posted) a._postedBill -= settle;
          else a._awaiting -= settle;
        } else if (a && a.type !== 'credit') {
          a._bal += orig;
        }
        break;
    }
  }

  return accounts.map((a) => {
    const m = byId.get(a.id)!;
    if (a.type === 'credit') {
      const currentBillMinor = Math.max(0, m._postedBill - m._repaid);
      const unbilledMinor = m._awaiting; // awaiting only; may be negative (refund>spend) -> UI clamps
      return {
        ...a,
        balanceMinor: undefined,
        currentBillMinor,
        unbilledMinor,
        repaidMinor: m._repaid,
      };
    }
    return { ...a, balanceMinor: m._bal };
  });
}

export function cardSummary(a: Account) {
  const currentBill = a.currentBillMinor || 0;
  const unbilled = a.unbilledMinor || 0;
  return {
    currentBillMinor: currentBill,
    unbilledMinor: unbilled,
    outstandingMinor: currentBill + unbilled,
  };
}

// ------------------------------------------------------------- financeSummary
// Combined overview for the finance screen.
//
// R3: `liabilitiesMYR` / `netWorthMYR` reflect ONLY the CONFIRMED (posted) card
// debt. Awaiting ("约") amounts are exposed separately via
// `predictedLiabilitiesMYR` / `predictedNetWorthMYR` so the UI can show an
// estimate without folding it into the confirmed figures.
export function financeSummary(
  txns: Txn[],
  accounts: Account[],
  fx: FxSetting,
  ym?: string
) {
  const stats = financeStats(txns, ym);
  const rec = recomputeAccounts(txns, accounts);
  let assetsMYR = 0;
  let liabilitiesMYR = 0; // confirmed (posted) only
  let predictedLiabilitiesMYR = 0; // confirmed + awaiting ("约")
  for (const a of rec) {
    if (!a.includeInNetWorth) continue;
    if (a.type === 'credit') {
      const confirmedDebt = (a.currentBillMinor || 0); // already net of repaid
      const predictedDebt = (a.currentBillMinor || 0) + (a.unbilledMinor || 0);
      liabilitiesMYR += a.currency === 'MYR' ? confirmedDebt : convertMinor(confirmedDebt, 'CNY', fx.rateScaled);
      predictedLiabilitiesMYR += a.currency === 'MYR' ? predictedDebt : convertMinor(predictedDebt, 'CNY', fx.rateScaled);
    } else {
      const bal = a.balanceMinor || 0;
      assetsMYR += a.currency === 'MYR' ? bal : convertMinor(bal, 'CNY', fx.rateScaled);
    }
  }
  return {
    stats,
    accounts: rec,
    assetsMYR,
    liabilitiesMYR,
    netWorthMYR: assetsMYR - liabilitiesMYR,
    predictedLiabilitiesMYR,
    predictedNetWorthMYR: assetsMYR - predictedLiabilitiesMYR,
  };
}

// ------------------------------------------------------------- budgetStatus
// Per-currency monthly budget status (spec §二/§三).
//
// The spend side reuses `financeStats.budgetSpent[currency]`, which already
// respects `affectsBudget` and `budgetCurrency`, so:
//   - MYR budget only counts valid MYR expenses (not CNY, no FX mixing)
//   - CNY budget only counts valid CNY expenses
//   - repayments / transfers / top-ups / withdrawals / FX principal / wealth are
//     excluded (they are not expense/refund rows, or have affectsBudget=false)
//   - refunds net the matching currency
//   - a cross-currency card (MYR spend, CNY posting) deducts ONLY the MYR budget
//     (the CNY card liability is a separate balance, counted once via origCurrency)
//
// `amountMinor` is integer minor units (sen/fen) — never a float.
export interface BudgetStatus {
  hasBudget: boolean;
  currency: Currency;
  amountMinor: number;
  used: number; // minor units, this currency
  remain: number; // minor units
  pct: number; // 0..100, capped
  state: 'normal' | 'over' | 'warn';
}

export function budgetStatus(
  txns: Txn[],
  budgets: Budget[],
  ym?: string,
  currency: Currency = 'CNY'
): BudgetStatus {
  const month = ym || new Date().toISOString().slice(0, 7);
  const b = budgets.find((x) => x.yearMonth === month && x.currency === currency);
  if (!b || typeof b.amountMinor !== 'number') {
    return { hasBudget: false, currency, amountMinor: 0, used: 0, remain: 0, pct: 0, state: 'normal' };
  }
  const stats = financeStats(txns, month);
  const used = stats.budgetSpent[currency];
  const amountMinor = b.amountMinor;
  const remain = amountMinor - used;
  const pct = amountMinor > 0 ? Math.min(100, Math.round((used / amountMinor) * 100)) : 0;
  let state: 'normal' | 'over' | 'warn' = 'normal';
  if (remain < 0) state = 'over';
  else if (pct >= 80) state = 'warn';
  return { hasBudget: true, currency, amountMinor, used, remain, pct, state };
}

export type { Currency };
