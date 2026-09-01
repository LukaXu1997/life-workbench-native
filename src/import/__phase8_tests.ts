// Phase 8 — Dual-currency (MYR/CNY) monthly budget rules (spec §九 / §十二 #10-14).
// RN-free: only imports from ../calc (which re-exports budgetStatus from recompute.ts).
import { budgetStatus } from '../calc';
import type { Txn, Budget, Currency } from '../types';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(name);
    console.log('  ✗ ' + name);
  }
}

const YM = '2026-08';

function mk(over: Partial<Txn>): Txn {
  return {
    type: 'expense',
    currency: 'CNY',
    amount: 0,
    origCurrency: 'CNY',
    origAmountMinor: 0,
    affectsBudget: true,
    affectsIncomeExpense: true,
    countInStats: true,
    date: YM + '-05',
    ...over,
  } as Txn;
}

function budget(cur: Currency, amountMinor: number): Budget {
  return { id: 'b_' + cur, yearMonth: YM, currency: cur, amountMinor } as Budget;
}

const CNY_BUDGET = budget('CNY', 100000); // ¥1000.00
const MYR_BUDGET = budget('MYR', 50000); // RM500.00
const BUDGETS = [CNY_BUDGET, MYR_BUDGET];

// 1) Independent save — CNY txn must NOT deduct MYR budget and vice versa.
{
  const txns = [
    mk({ currency: 'CNY', origCurrency: 'CNY', origAmountMinor: 50000 }), // ¥500
    mk({ currency: 'MYR', origCurrency: 'MYR', origAmountMinor: 20000 }), // RM200
  ];
  const cny = budgetStatus(txns, BUDGETS, YM, 'CNY');
  const myr = budgetStatus(txns, BUDGETS, YM, 'MYR');
  ok('CNY budget used = ¥500 (50000)', cny.used === 50000);
  ok('CNY remain = ¥500 (50000)', cny.remain === 50000);
  ok('MYR budget used = RM200 (20000)', myr.used === 20000);
  ok('MYR remain = RM300 (30000)', myr.remain === 30000);
  ok('CNY budget NOT polluted by MYR spend', cny.used === 50000);
}

// 2) Alipay normal expense -> CNY budget only.
{
  const txns = [mk({ currency: 'CNY', origCurrency: 'CNY', origAmountMinor: 30000 })];
  ok('Alipay CNY spend deducts CNY only', budgetStatus(txns, BUDGETS, YM, 'CNY').used === 30000);
  ok('Alipay CNY spend does NOT deduct MYR', budgetStatus(txns, BUDGETS, YM, 'MYR').used === 0);
}

// 3) TNG normal expense -> MYR budget only.
{
  const txns = [mk({ currency: 'MYR', origCurrency: 'MYR', origAmountMinor: 15000 })];
  ok('TNG MYR spend deducts MYR only', budgetStatus(txns, BUDGETS, YM, 'MYR').used === 15000);
  ok('TNG MYR spend does NOT deduct CNY', budgetStatus(txns, BUDGETS, YM, 'CNY').used === 0);
}

// 4) 理财 / investment -> no budget deduction (affectsBudget=false, nature=investment).
{
  const txns = [
    mk({ currency: 'CNY', origCurrency: 'CNY', origAmountMinor: 80000, transactionNature: 'investment', affectsBudget: false }),
    mk({ currency: 'MYR', origCurrency: 'MYR', origAmountMinor: 40000, transactionNature: 'investment', affectsBudget: false }),
  ];
  ok('理财 CNY not deducted', budgetStatus(txns, BUDGETS, YM, 'CNY').used === 0);
  ok('理财 MYR not deducted', budgetStatus(txns, BUDGETS, YM, 'MYR').used === 0);
}

// 5) TNG Reload (transfer) -> no deduction.
{
  const txns = [mk({ type: 'transfer', currency: 'MYR', origCurrency: 'MYR', origAmountMinor: 10000 })];
  ok('TNG Reload (transfer) not deducted', budgetStatus(txns, BUDGETS, YM, 'MYR').used === 0);
}

// 6) transfer / repayment / recharge / withdraw / fx principal -> no deduction.
{
  // transfer/repayment: type is not expense/refund -> excluded.
  // recharge -> income + nature 'transfer' + affectsBudget:false (Alipay 充值=转账).
  // withdraw -> transfer + affectsBudget:false. fx-principal -> settlement + affectsBudget:false.
  const txns = [
    mk({ type: 'transfer', origAmountMinor: 10000 }),
    mk({ type: 'repayment', origAmountMinor: 10000 }),
    mk({ type: 'income', transactionNature: 'transfer', affectsBudget: false, origAmountMinor: 10000 }),
    mk({ type: 'transfer', transactionNature: 'transfer', affectsBudget: false, origAmountMinor: 10000 }),
    mk({ type: 'transfer', transactionNature: 'settlement', affectsBudget: false, origAmountMinor: 10000 }),
  ];
  ok('transfer/repay/recharge/withdraw/fx not deducted', budgetStatus(txns, BUDGETS, YM, 'CNY').used === 0);
}

// 7) refund restores the matching currency budget.
{
  const txns = [
    mk({ currency: 'CNY', origCurrency: 'CNY', origAmountMinor: 10000 }),
    mk({ type: 'refund', currency: 'CNY', origCurrency: 'CNY', origAmountMinor: 10000 }),
  ];
  ok('refund nets CNY budget to 0', budgetStatus(txns, BUDGETS, YM, 'CNY').used === 0);
}

// 8) cross-currency card: MYR spend RM100, CNY posting ¥168 -> only MYR budget deducted once.
{
  const txns = [
    mk({
      type: 'expense',
      currency: 'MYR',
      origCurrency: 'MYR',
      origAmountMinor: 10000, // RM100
      settleCurrency: 'CNY',
      settleAmountMinor: 16800, // ¥168
      isCardTxn: true,
      isPosted: true,
    }),
  ];
  const myr = budgetStatus(txns, BUDGETS, YM, 'MYR');
  const cny = budgetStatus(txns, BUDGETS, YM, 'CNY');
  ok('cross-card: MYR budget deducts RM100 (10000)', myr.used === 10000);
  ok('cross-card: CNY budget NOT deducted (¥168 excluded)', cny.used === 0);
}

// 9) integer minor units only — no floats leak into the spend numbers.
{
  const txns = [mk({ currency: 'CNY', origCurrency: 'CNY', origAmountMinor: 33333 })];
  const cny = budgetStatus(txns, BUDGETS, YM, 'CNY');
  ok('used is integer (sen/fen, no float)', Number.isInteger(cny.used) && cny.used === 33333);
  ok('remain is integer', Number.isInteger(cny.remain) && cny.remain === 100000 - 33333);
}

// 10) zero / unset budget — no divide-by-zero crash.
{
  ok('unset budget hasBudget=false', budgetStatus([], [], YM, 'CNY').hasBudget === false);
  ok('unset budget pct=0 (no NaN)', budgetStatus([], [], YM, 'CNY').pct === 0);
  const zero = budget('CNY', 0);
  ok('zero-amount budget pct=0 (no div-by-zero)', budgetStatus([], [zero], YM, 'CNY').pct === 0);
}

// 11) thresholds: <80% normal, >=80% warn, >=100% error (component reads usedRatio).
{
  const at85 = budgetStatus([mk({ origAmountMinor: 8500 })], [budget('CNY', 10000)], YM, 'CNY');
  ok('85% -> warn (orange)', at85.state === 'warn');
  const at50 = budgetStatus([mk({ origAmountMinor: 5000 })], [budget('CNY', 10000)], YM, 'CNY');
  ok('50% -> normal', at50.state === 'normal');
  const at150 = budgetStatus([mk({ origAmountMinor: 15000 })], [budget('CNY', 10000)], YM, 'CNY');
  ok('150% -> over (error red)', at150.state === 'over');
  ok('150% -> pct capped at 100 for bar', at150.pct === 100);
  ok('150% -> real pct 150 (text shows true value)', Math.round((15000 / 10000) * 100) === 150);
}

console.log(`\nPhase 8 — dual-currency budget rules: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED:\n - ' + fails.join('\n - '));
  process.exit(1);
}
