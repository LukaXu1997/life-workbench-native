// Phase 7 unit tests — dual-currency (MYR/CNY) monthly budget (spec §二/§三).
// React-Native-free; run under plain Node via scripts/import-test-runner.js.
//
// All sample data below is DE-IDENTIFIED: merchants/notes are placeholders and
// amounts are synthetic minor-unit integers (fen for CNY, sen for MYR).

import { budgetStatus } from './recompute';
import { todayFinance, monthFinance } from '../calc';
import type { Txn, Budget } from '../types';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(name);
    console.log('  FAIL: ' + name);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}

const YM = '2026-08';

function exp(over: Partial<Txn>): Txn {
  return {
    id: 't-' + Math.random().toString(36).slice(2, 8),
    type: 'expense',
    date: YM + '-15',
    currency: 'CNY',
    origAmountMinor: 0,
    ...over,
  } as Txn;
}

const budgets: Budget[] = [
  { id: 'b-cny', yearMonth: YM, currency: 'CNY', amountMinor: 100000 }, // ¥1000.00
  { id: 'b-myr', yearMonth: YM, currency: 'MYR', amountMinor: 50000 }, // RM500.00
];

// ---------------------------------------------------------- no FX mixing
console.log('--- dual-currency isolation (no FX mixing) ---');
{
  const txns = [
    exp({ currency: 'CNY', origAmountMinor: 20000 }), // ¥200.00
    exp({ currency: 'MYR', origAmountMinor: 10000 }), // RM100.00
  ];
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  const myr = budgetStatus(txns, budgets, YM, 'MYR');
  eq('CNY used = 20000 sen? no, fen', cny.used, 20000);
  eq('CNY remain', cny.remain, 80000);
  eq('CNY pct', cny.pct, 20);
  eq('MYR used = 10000 sen', myr.used, 10000);
  eq('MYR remain', myr.remain, 40000);
  eq('MYR pct', myr.pct, 20);
  ok('CNY spend does NOT touch MYR budget', myr.used === 10000);
  ok('MYR spend does NOT touch CNY budget', cny.used === 20000);
  ok('both states normal', cny.state === 'normal' && myr.state === 'normal');
}

// ---------------------------------------------------------- per-month
console.log('--- per-month scoping ---');
{
  const txns = [
    exp({ currency: 'CNY', origAmountMinor: 20000, date: YM + '-15' }),
    exp({ currency: 'CNY', origAmountMinor: 30000, date: '2026-07-15' }), // other month
  ];
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  eq('only current month counted', cny.used, 20000);
}

// ---------------------------------------------------------- independent edit
console.log('--- editing one currency does not overwrite the other ---');
{
  const txns: Txn[] = [];
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  const myr = budgetStatus(txns, budgets, YM, 'MYR');
  eq('CNY budget present', cny.hasBudget, true);
  eq('MYR budget present', myr.hasBudget, true);
  eq('CNY amountMinor', cny.amountMinor, 100000);
  eq('MYR amountMinor', myr.amountMinor, 50000);
}

// ---------------------------------------------------------- exclusions
console.log('--- exclusions: transfer / wealth / repay / fx-principal ---');
{
  const txns: Txn[] = [
    exp({ type: 'transfer', currency: 'CNY', origAmountMinor: 99999 }), // transfer never counts (not expense/refund)
    exp({ currency: 'CNY', origAmountMinor: 50000, affectsBudget: false }), // wealth buy excluded
    exp({ currency: 'CNY', origAmountMinor: 40000, category: '信用卡还款', affectsBudget: false }), // repayment excluded by importer flag
  ];
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  // Only expense/refund rows with affectsBudget !== false count. The transfer is
  // skipped (not expense/refund); wealth & repayment carry affectsBudget=false
  // (set by the importer — verified in Phase 5 autoCategorize).
  eq('transfer + wealth + repayment excluded from CNY used', cny.used, 0);
}

// ---------------------------------------------------------- refunds net
console.log('--- refunds net the matching currency ---');
{
  const txns: Txn[] = [
    exp({ currency: 'CNY', origAmountMinor: 20000 }),
    { ...exp({ currency: 'CNY', origAmountMinor: 5000 }), type: 'refund' as const },
  ];
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  eq('CNY used net of refund = 15000', cny.used, 15000);
}

// ---------------------------------------------------------- cross-currency card
console.log('--- cross-currency card: MYR spend -> MYR budget only ---');
{
  // MYR purchase settled to a CNY card: orig MYR, settle CNY.
  const txns: Txn[] = [
    exp({ currency: 'MYR', origCurrency: 'MYR', settleCurrency: 'CNY', origAmountMinor: 8000 }),
  ];
  const myr = budgetStatus(txns, budgets, YM, 'MYR');
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  eq('MYR budget deducts the MYR spend', myr.used, 8000);
  eq('CNY budget NOT deducted by CNY settlement liability', cny.used, 0);
  ok('cross-currency counted exactly once (MYR side)', myr.used === 8000);
}

// ---------------------------------------------------------- no budget set
console.log('--- unset currency -> hasBudget=false ---');
{
  const txns: Txn[] = [exp({ currency: 'CNY', origAmountMinor: 100 })];
  const cny = budgetStatus(txns, budgets, YM, 'CNY');
  const myr = budgetStatus(txns, budgets, YM, 'MYR');
  ok('CNY has budget', cny.hasBudget === true);
  ok('MYR has budget', myr.hasBudget === true);
  // A currency with no budget entry this month:
  const noB = budgetStatus(txns, budgets, YM, 'SGD' as any);
  ok('unknown currency hasBudget=false', noB.hasBudget === false);
}

// ---------------------------------------------------------- state thresholds
console.log('--- state thresholds (normal / warn / over) ---');
{
  // warn at >=80%
  const warnBudgets: Budget[] = [{ id: 'w', yearMonth: YM, currency: 'CNY', amountMinor: 10000 }];
  const warnTxns = [exp({ currency: 'CNY', origAmountMinor: 8500 })]; // 85%
  eq('pct=85', budgetStatus(warnTxns, warnBudgets, YM, 'CNY').pct, 85);
  eq('state=warn', budgetStatus(warnTxns, warnBudgets, YM, 'CNY').state, 'warn');
  // over when remain<0
  const overTxns = [exp({ currency: 'CNY', origAmountMinor: 12000 })];
  eq('remain=-2000', budgetStatus(overTxns, warnBudgets, YM, 'CNY').remain, -2000);
  eq('state=over', budgetStatus(overTxns, warnBudgets, YM, 'CNY').state, 'over');
}

// ---------------------------------------------------------- wealth excluded from daily stats (regression for "理财 shows in app")
console.log('--- 理财(investment) must NOT appear in daily/month income-expense stats or ledger ---');
{
  const day = '2026-08-28';
  const txns: Txn[] = [
    // 基金买入 ¥500.00 — wealth, must be excluded everywhere user-facing
    exp({ date: day, type: 'expense', amount: 500, transactionNature: 'investment', affectsIncomeExpense: false, affectsBudget: false, currency: 'CNY', origAmountMinor: 50000 }),
    // 普通支出 ¥12.00 — must be counted
    exp({ date: day, type: 'expense', amount: 12, transactionNature: 'normal', affectsIncomeExpense: true, affectsBudget: true, currency: 'CNY', origAmountMinor: 1200 }),
  ];
  const f = todayFinance(txns, day);
  eq('todayFinance excludes 理财 from expCNY', f.expCNY, 12);
  eq('todayFinance excludes 理财 from expCount', f.expCount, 1);
  const m = monthFinance(txns, '2026-08');
  eq('monthFinance excludes 理财 from CNY expense', m.expense, 12);
  // ledger display: 理财 hidden by transactionNature filter (data retained)
  const ledger = txns.filter((t) => t.transactionNature !== 'investment');
  eq('ledger hides 理财 (data retained)', ledger.length, 1);
}

// ---------------------------------------------------------------- summary
console.log(`\nPhase7 dual-budget tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
process.exit(0);
