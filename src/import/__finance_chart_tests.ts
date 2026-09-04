// @ts-nocheck
// Pure aggregation tests for the finance dashboard (trend series + category share).
// RN-free; transpiled by scripts/finance-chart-test-runner.js and run under plain Node.

const fc = require('./financeCharts');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

// Minimal Txn fixture. Defaults make a valid, stats-counting MYR expense.
function txn(over) {
  return Object.assign(
    {
      id: 'tx_' + Math.random().toString(36).slice(2),
      date: '2026-08-15',
      type: 'expense',
      category: 'dining',
      amount: 0,
      currency: 'MYR',
      origAmountMinor: 0,
      origCurrency: 'MYR',
      affectsIncomeExpense: true,
      countInStats: true,
    },
    over
  );
}

// ---- monthlySeries: length / ordering / currency separation ----
const base = [
  txn({ date: '2026-08-10', type: 'income', origAmountMinor: 100000, origCurrency: 'MYR' }),
  txn({ date: '2026-08-12', type: 'expense', category: 'dining', origAmountMinor: 3000, origCurrency: 'MYR' }),
  txn({ date: '2026-07-05', type: 'expense', category: 'shopping', origAmountMinor: 5000, origCurrency: 'MYR' }),
  txn({ date: '2026-06-20', type: 'expense', origAmountMinor: 2000, origCurrency: 'CNY' }),
];
const ms = fc.monthlySeries(base, { cur: 'MYR', months: 12, until: '2026-08' });
eq(ms.length, 12, 'monthlySeries returns 12 points');
eq(ms[11].ym, '2026-08', 'last point is the until month');
eq(ms[0].ym, '2025-09', 'first point is 11 months before until');
eq(ms[11].income, 100000, 'Aug MYR income summed correctly');
eq(ms[11].expense, 3000, 'Aug MYR expense summed (CNY excluded)');
eq(ms[11].net, 97000, 'Aug net = income - expense');
eq(ms[10].expense, 5000, 'Jul MYR expense summed');
eq(ms[10].income, 0, 'Jul income is 0 when no income txn');

// ---- refund nets expense ----
const withRefund = [
  txn({ date: '2026-08-01', type: 'expense', origAmountMinor: 9000, origCurrency: 'MYR' }),
  txn({ date: '2026-08-02', type: 'refund', origAmountMinor: 4000, origCurrency: 'MYR' }),
];
const rf = fc.monthlySeries(withRefund, { cur: 'MYR', months: 1, until: '2026-08' });
eq(rf[0].expense, 5000, 'refund nets expense (9000 - 4000)');

// ---- affectsIncomeExpense=false and countInStats=false are excluded ----
const filtered = [
  txn({ date: '2026-08-01', type: 'expense', origAmountMinor: 9000, origCurrency: 'MYR', affectsIncomeExpense: false }),
  txn({ date: '2026-08-02', type: 'expense', origAmountMinor: 7000, origCurrency: 'MYR', countInStats: false }),
  txn({ date: '2026-08-03', type: 'expense', origAmountMinor: 1000, origCurrency: 'MYR' }),
];
const filt = fc.monthlySeries(filtered, { cur: 'MYR', months: 1, until: '2026-08' });
eq(filt[0].expense, 1000, 'rows with affectsIncomeExpense=false or countInStats=false excluded');

// ---- yearlySeries: length / ordering / currency separation ----
const ys = fc.yearlySeries(base, { cur: 'CNY', years: 5, until: '2026-08' });
eq(ys.length, 5, 'yearlySeries returns 5 points');
eq(ys[4].year, '2026', 'last year is the until year');
eq(ys[4].expense, 2000, '2026 CNY expense summed (MYR excluded)');

// ---- defaultSpendCurrency picks the larger-spend currency ----
const mixed = [
  txn({ date: '2026-08-01', type: 'expense', origAmountMinor: 1000, origCurrency: 'MYR' }),
  txn({ date: '2026-08-02', type: 'expense', origAmountMinor: 9000, origCurrency: 'CNY' }),
];
eq(fc.defaultSpendCurrency(mixed), 'CNY', 'defaultSpendCurrency picks larger-spend currency');

// ---- spendByCategory: sort / uncategorized / pct / limit / month scope ----
const cats = [
  txn({ date: '2026-08-01', type: 'expense', category: 'dining', origAmountMinor: 6000, origCurrency: 'MYR' }),
  txn({ date: '2026-08-02', type: 'expense', category: 'shopping', origAmountMinor: 4000, origCurrency: 'MYR' }),
  txn({ date: '2026-08-03', type: 'expense', category: '', origAmountMinor: 1000, origCurrency: 'MYR' }),
  txn({ date: '2026-07-01', type: 'expense', category: 'dining', origAmountMinor: 9999, origCurrency: 'MYR' }),
];
const share = fc.spendByCategory(cats, '2026-08', 'MYR', { limit: 8 });
eq(share.length, 3, 'spendByCategory returns 3 categories for the month');
eq(share[0].category, 'dining', 'sorted descending by amount');
eq(share[0].amountMinor, 6000, 'dining amount for the selected month only');
eq(share[2].category, 'uncategorized', "empty category key maps to 'uncategorized'");
eq(share[2].amountMinor, 1000, 'uncategorized amount correct');
const pctSum = share.reduce((s, c) => s + c.pct, 0);
ok(pctSum >= 99 && pctSum <= 101, `pct values sum to ~100 (got ${pctSum})`);

const many = [];
for (let i = 0; i < 12; i++) {
  many.push(txn({ date: '2026-08-01', type: 'expense', category: 'cat' + i, origAmountMinor: (i + 1) * 100, origCurrency: 'MYR' }));
}
eq(fc.spendByCategory(many, '2026-08', 'MYR', { limit: 8 }).length, 8, 'spendByCategory respects limit');

console.log(`\nFinance chart tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
