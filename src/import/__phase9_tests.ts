// Phase 9 unit tests — MYR e-wallet CSV adapters (GrabPay / ShopeePay / Lazada).
// React-Native-free; run under plain Node via scripts/import-test-runner.js.
//
// All sample data is DE-IDENTIFIED: merchants are placeholders, amounts synthetic,
// transaction ids fake. No real card / account numbers appear. We also assert the
// parsed transaction text is NEVER written to any console sink by the adapter.

import { parseGrabFile, parseShopeeFile, parseLazadaFile, parseMyrEwalletFile, isGrabCsv, isShopeeCsv, isLazadaCsv } from './adapters/myrEwalletCsv';
import { detectSource } from './sourceDetect';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(name);
    console.log('  FAIL: ' + name);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}

// ---- synthetic statements (de-identified) ----------------------------------
const GRAB_CSV = [
  'GrabPay Transaction History',
  'Date,Description,Amount,Status,Transaction ID',
  '2026-01-01,Sample Coffee Shop,-12.50,Completed,GRB0001',
  '2026-01-02,Top Up,100.00,Completed,GRB0002',
  '2026-01-03,Sample Refund,5.00,Refunded,GRB0003',
].join('\n');

const SHOPEE_CSV = [
  'ShopeePay Statement',
  'Order No,Date/Time,Item,Amount,Status',
  'SO1001,2026-02-01 10:00,Sample T-shirt,-25.00,Completed',
  'SO1002,2026-02-02 11:00,Sample Top Up,50.00,Completed',
].join('\n');

const LAZADA_CSV = [
  'Lazada Wallet',
  'Transaction ID,Date,Particulars,Amount,Status',
  'LZ1,2026-03-01,Sample Gadget,-80.00,Success',
  'LZ2,2026-03-02,Reload,200.00,Success',
].join('\n');

const GENERIC_CSV = ['Name,Age,Date,Amount', 'Alice,30,2026-01-01,12.50', 'Bob,25,2026-01-02,30.00'].join('\n');

// ---------------------------------------------------------- brand detection
{
  ok('isGrabCsv true on GrabPay statement', isGrabCsv(GRAB_CSV) === true);
  ok('isShopeeCsv true on ShopeePay statement', isShopeeCsv(SHOPEE_CSV) === true);
  ok('isLazadaCsv true on Lazada Wallet statement', isLazadaCsv(LAZADA_CSV) === true);

  ok('isGrabCsv false on Shopee', isGrabCsv(SHOPEE_CSV) === false);
  ok('isShopeeCsv false on Lazada', isShopeeCsv(LAZADA_CSV) === false);
  ok('isLazadaCsv false on Grab', isLazadaCsv(GRAB_CSV) === false);
  ok('isGrabCsv false on generic', isGrabCsv(GENERIC_CSV) === false);
}

// ---------------------------------------------------------- detectSource csv branch
{
  eq('detectSource -> grab', detectSource({ kind: 'csv', name: 'grab.csv', text: GRAB_CSV }).source, 'grab');
  eq('detectSource -> shopee', detectSource({ kind: 'csv', name: 'shopee.csv', text: SHOPEE_CSV }).source, 'shopee');
  eq('detectSource -> lazada', detectSource({ kind: 'csv', name: 'lazada.csv', text: LAZADA_CSV }).source, 'lazada');
  eq('detectSource -> genericCsv for generic', detectSource({ kind: 'csv', name: 'x.csv', text: GENERIC_CSV }).source, 'genericCsv');
}

// ---------------------------------------------------------- GrabPay parsing
{
  const res = parseGrabFile({ name: 'grab.csv', text: GRAB_CSV });
  ok('parseGrabFile ok', res.ok === true);
  if (res.ok) {
    const c = res.result.candidates;
    eq('grab parsed rows', c.length, 3);
    eq('grab summary totalRows', res.result.summary.totalRows, 3);

    const r1 = c[0];
    eq('r1 amountMinor sen', r1.amountMinor, 1250);
    eq('r1 currency', r1.currency, 'MYR');
    eq('r1 txnType expense', r1.txnType, 'expense');
    eq('r1 merchant', r1.merchant, 'Sample Coffee Shop');
    eq('r1 accountHint', r1.accountHint, 'GrabPay');
    eq('r1 date', r1.date, '2026-01-01');
    eq('r1 currencyInferredFromSource', r1.currencyInferredFromSource, true);
    eq('r1 budgetCurrency', r1.budgetCurrency, 'MYR');
    eq('r1 affectsBudget', r1.affectsBudget, true);
    eq('r1 rawRef', r1.rawRef, 'GRB0001');

    const r2 = c[1];
    eq('r2 txnType transfer (top-up)', r2.txnType, 'income');
    eq('r2 nature transfer', r2.transactionNature, 'transfer');
    eq('r2 affectsBudget false', r2.affectsBudget, false);
    eq('r2 affectsIncomeExpense false', r2.affectsIncomeExpense, false);
    eq('r2 amountMinor sen', r2.amountMinor, 10000);

    const r3 = c[2];
    eq('r3 txnType refund', r3.txnType, 'refund');
    eq('r3 amountMinor sen', r3.amountMinor, 500);
  }
}

// ---------------------------------------------------------- ShopeePay parsing
{
  const res = parseShopeeFile({ name: 'shopee.csv', text: SHOPEE_CSV });
  ok('parseShopeeFile ok', res.ok === true);
  if (res.ok) {
    const c = res.result.candidates;
    eq('shopee parsed rows', c.length, 2);
    const r1 = c[0];
    eq('r1 amountMinor sen', r1.amountMinor, 2500);
    eq('r1 txnType expense', r1.txnType, 'expense');
    eq('r1 merchant', r1.merchant, 'Sample T-shirt');
    eq('r1 accountHint', r1.accountHint, 'ShopeePay');
    eq('r1 date', r1.date, '2026-02-01');
    eq('r1 time', r1.time, '10:00');
    const r2 = c[1];
    eq('r2 transfer top-up', r2.transactionNature, 'transfer');
    eq('r2 amountMinor sen', r2.amountMinor, 5000);
  }
}

// ---------------------------------------------------------- Lazada parsing
{
  const res = parseLazadaFile({ name: 'lazada.csv', text: LAZADA_CSV });
  ok('parseLazadaFile ok', res.ok === true);
  if (res.ok) {
    const c = res.result.candidates;
    eq('lazada parsed rows', c.length, 2);
    const r1 = c[0];
    eq('r1 amountMinor sen', r1.amountMinor, 8000);
    eq('r1 txnType expense', r1.txnType, 'expense');
    eq('r1 merchant', r1.merchant, 'Sample Gadget');
    eq('r1 accountHint', r1.accountHint, 'Lazada');
    eq('r1 date', r1.date, '2026-03-01');
    const r2 = c[1];
    eq('r2 transfer reload', r2.transactionNature, 'transfer');
    eq('r2 amountMinor sen', r2.amountMinor, 20000);
  }
}

// ---------------------------------------------------------- brand auto-dispatch
{
  const g = parseMyrEwalletFile({ name: 'grab.csv', text: GRAB_CSV });
  ok('parseMyrEwalletFile -> grab', g.ok && g.source === 'grab');
  const s = parseMyrEwalletFile({ name: 'shopee.csv', text: SHOPEE_CSV });
  ok('parseMyrEwalletFile -> shopee', s.ok && s.source === 'shopee');
  const l = parseMyrEwalletFile({ name: 'lazada.csv', text: LAZADA_CSV });
  ok('parseMyrEwalletFile -> lazada', l.ok && l.source === 'lazada');
  const generic = parseMyrEwalletFile({ name: 'x.csv', text: GENERIC_CSV });
  ok('parseMyrEwalletFile -> unknown on generic', generic.ok === false);
  if (!generic.ok) eq('unknown stage', generic.stage, 'unknown');
}

// ---------------------------------------------------------- date forms (DD/MM/YYYY + D Mon YYYY)
{
  const csv = [
    'GrabPay Export',
    'Date,Description,Amount,Status,Transaction ID',
    '03/09/2026,Sample Shop,-9.90,Completed,G1',
    '05 Sep 2026,Sample Cafe,-7.00,Completed,G2',
  ].join('\n');
  const res = parseGrabFile({ name: 'dates.csv', text: csv });
  ok('date-form parse ok', res.ok === true);
  if (res.ok) {
    const c = res.result.candidates;
    eq('DD/MM/YYYY -> 2026-09-03', c[0].date, '2026-09-03');
    eq('D Mon YYYY -> 2026-09-05', c[1].date, '2026-09-05');
  }
}

// ---------------------------------------------------------- privacy: no PII logged
{
  const realLog = console.log;
  let logged = '';
  (console as any).log = (...args: unknown[]) => {
    logged += args.map((a) => String(a)).join(' ');
  };
  parseGrabFile({ name: 'grab.csv', text: GRAB_CSV });
  parseShopeeFile({ name: 'shopee.csv', text: SHOPEE_CSV });
  parseLazadaFile({ name: 'lazada.csv', text: LAZADA_CSV });
  (console as any).log = realLog;
  ok('adapter did not log merchant Sample Coffee Shop', !logged.includes('Sample Coffee Shop'));
  ok('adapter did not log txn id GRB0001', !logged.includes('GRB0001'));
  ok('adapter did not log merchant Sample T-shirt', !logged.includes('Sample T-shirt'));
}

// ---------------------------------------------------------- result
console.log(`\nPhase 9 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
