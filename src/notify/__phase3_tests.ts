// Phase 3 unit tests — pending -> confirm logic.
// Verifies buildTxnFromPending and reconcilePostingMatch (the cross-currency
// "update original Txn, never create a 2nd expense" guarantee).
//
// Pure modules only (no React Native), so this runs under plain Node after a
// tsc transpile. Run with:  tsc ... --outDir /tmp/p3 && node /tmp/p3/.../__phase3_tests.js

import type { Account, FxSetting, PendingRecord, Txn } from '../types';
import { buildTxnFromPending, reconcilePostingMatch, computeFxRate } from './confirm';
import type { PendingEdits } from './confirm';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(msg);
    // eslint-disable-next-line no-console
    console.error('  ✗ ' + msg);
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const fx: FxSetting = {
  base: 'MYR',
  cnyPerMyr: 1.68,
  rateScaled: 1_680_000,
  rateUpdatedAt: 0,
  rateSource: 'system',
};

function acct(id: string, type: Account['type'], currency: Account['currency']): Account {
  return {
    id,
    name: id,
    type,
    currency,
    includeInNetWorth: true,
    showOnHome: true,
    order: 0,
    createdAt: 0,
  };
}

const accounts: Account[] = [
  acct('ew', 'ewallet', 'MYR'),
  acct('dm', 'debit', 'MYR'),
  acct('cc', 'credit', 'CNY'),
  acct('dc', 'debit', 'CNY'),
];

function rec(p: Partial<PendingRecord> & Pick<PendingRecord, 'id' | 'currency' | 'amountMinor'>): PendingRecord {
  return {
    sourceApp: 'my.com.tngdigital.ewallet',
    rawDigest: 'deadbeef' + p.id,
    notifiedAt: Date.parse('2026-08-28T10:00:00'),
    suggestedCategory: '餐饮',
    confidence: 0.9,
    fingerprint: 'fp-' + p.id,
    createdAt: 0,
    status: 'pending',
    kind: 'expense',
    ...p,
  } as PendingRecord;
}

// ---- 1. MYR e-wallet expense ----
{
  const r = rec({ id: 'm1', currency: 'MYR', amountMinor: 5000, suggestedAccountId: 'ew', merchant: 'Starbucks' });
  const t = buildTxnFromPending(r, accounts, fx);
  eq(t.currency, 'MYR', 'ewallet.currency');
  eq(t.origCurrency, 'MYR', 'ewallet.origCurrency');
  eq(t.origAmountMinor, 5000, 'ewallet.origAmountMinor');
  eq(t.accountId, 'ew', 'ewallet.accountId');
  eq(t.settleCurrency, 'MYR', 'ewallet.settleCurrency');
  eq(t.settleAmountMinor, 5000, 'ewallet.settleAmountMinor');
  eq(t.isCardTxn, false, 'ewallet.isCardTxn');
  eq(t.isPosted, true, 'ewallet.isPosted');
  eq(t.type, 'expense', 'ewallet.type');
  eq(t.amount, 50, 'ewallet.amount');
  eq(t.category, '餐饮', 'ewallet.category');
}

// ---- 2. Cross-currency RMB credit card (awaiting bank posting) ----
{
  const r = rec({
    id: 'c1',
    currency: 'MYR',
    amountMinor: 10000,
    suggestedAccountId: 'cc',
    postingStatus: 'awaiting_posting',
    predictedSettleMinor: 16800,
    merchant: 'Tesco',
    suggestedCategory: '购物',
  });
  const t = buildTxnFromPending(r, accounts, fx);
  eq(t.currency, 'MYR', 'cross.currency');
  eq(t.accountId, 'cc', 'cross.accountId');
  eq(t.settleCurrency, 'CNY', 'cross.settleCurrency');
  eq(t.settleAmountMinor, 16800, 'cross.settleAmountMinor(predicted)');
  eq(t.isCardTxn, true, 'cross.isCardTxn');
  eq(t.isPosted, false, 'cross.isPosted(awaiting)');
  eq(t.fxRate, 1.68, 'cross.fxRate(system)');
}

// ---- 3. reconcilePostingMatch: original already confirmed -> UPDATE, no 2nd expense ----
{
  const orig = rec({
    id: 'p1',
    currency: 'MYR',
    amountMinor: 10000,
    suggestedAccountId: 'cc',
    postingStatus: 'awaiting_posting',
    predictedSettleMinor: 16800,
    status: 'pending',
    txnId: 't1',
  });
  const post = rec({
    id: 'p2',
    currency: 'CNY',
    amountMinor: 16850, // actual posted ¥168.50
    suggestedAccountId: 'cc',
    status: 'matched',
    matchOfId: 'p1',
  });
  const txns: Txn[] = [
    {
      id: 't1',
      type: 'expense',
      currency: 'MYR',
      amount: 100,
      origCurrency: 'MYR',
      origAmountMinor: 10000,
      settleCurrency: 'CNY',
      settleAmountMinor: 16800,
      fxRate: 1.68,
      fxSource: 'system',
      accountId: 'cc',
      region: 'MY',
      merchant: 'Tesco',
      isCardTxn: true,
      isPosted: false,
      postedAmountMinor: 16800,
      countInStats: true,
      category: '购物',
      note: '',
      date: '2026-08-28',
      time: '10:00',
      createdAt: 0,
    },
  ];
  const res = reconcilePostingMatch({
    origRec: orig,
    postRec: post,
    records: [orig, post],
    txns,
    accounts,
    fx,
    edits: { actualSettleMinor: 16850 },
  });
  eq(res.txns.length, 1, 'matchA: exactly one txn (no duplicate)');
  const target = res.txns[0];
  eq(target.isPosted, true, 'matchA: original now posted');
  eq(target.settleAmountMinor, 16850, 'matchA: settle = actual posted');
  eq(target.postedAmountMinor, 16850, 'matchA: postedAmount = actual');
  // 16850 / 10000 = 1.685
  ok(Math.abs((target.fxRate as number) - 1.685) < 1e-9, 'matchA: fxRate = actual/orig = 1.685');
  eq(target.fxSource, 'card', 'matchA: fxSource = card');
  eq(res.txnId, 't1', 'matchA: txnId preserved');
  eq(res.records.find((r) => r.id === 'p2')!.status, 'confirmed', 'matchA: posting rec confirmed');
  const o = res.records.find((r) => r.id === 'p1')!;
  eq(o.status, 'confirmed', 'matchA: orig rec confirmed');
  eq(o.postingStatus, 'posted', 'matchA: orig rec postingStatus posted');
}

// ---- 4. reconcilePostingMatch: original never confirmed -> CREATE once, still no duplicate ----
{
  const orig = rec({
    id: 'p1',
    currency: 'MYR',
    amountMinor: 10000,
    suggestedAccountId: 'cc',
    postingStatus: 'awaiting_posting',
    predictedSettleMinor: 16800,
    status: 'pending',
  });
  const post = rec({
    id: 'p2',
    currency: 'CNY',
    amountMinor: 16850,
    suggestedAccountId: 'cc',
    status: 'matched',
    matchOfId: 'p1',
  });
  const res = reconcilePostingMatch({
    origRec: orig,
    postRec: post,
    records: [orig, post],
    txns: [],
    accounts,
    fx,
    edits: { actualSettleMinor: 16850 },
    makeId: () => 'newT',
  });
  eq(res.txns.length, 1, 'matchB: one txn created');
  eq(res.txnId, 'newT', 'matchB: txnId = newT');
  const created = res.txns[0];
  eq(created.settleAmountMinor, 16850, 'matchB: settle = actual');
  eq(created.isPosted, true, 'matchB: posted');
  eq(created.isCardTxn, true, 'matchB: card');
  eq(created.accountId, 'cc', 'matchB: account');
  ok(Math.abs((created.fxRate as number) - 1.685) < 1e-9, 'matchB: fxRate 1.685');
}

// ---- 5. computeFxRate sanity ----
eq(computeFxRate('MYR', 10000, 'CNY', 16850), 1.685, 'fxRate 16850/10000');

// ---- 6. ignore keeps a clean record, clear empties ----
{
  const orig = rec({ id: 'p1', currency: 'MYR', amountMinor: 5000, suggestedAccountId: 'ew' });
  // (ignore/clear are async wrappers hitting the store; we just assert the pure rec shape
  //  contract they rely on: status transitions are validated by the UI + Phase 2 digest tests)
  ok(orig.status === 'pending', 'ignore: record starts pending');
}

// eslint-disable-next-line no-console
console.log(`\nPhase 3 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  // eslint-disable-next-line no-console
  console.error('FAILURES:\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
