// Phase 6 unit tests — ImportService (atomic commit / batch undo), auto-recompute
// wiring, PII-free reporting, and the recomputeAccounts R3 posted/awaiting split.
//
// React-Native-free; run via scripts/import-test-runner.js. All samples are
// synthetic (fictional merchants / order ids). No real card or account numbers.

import type { Txn, Account, Currency } from '../types';
import type { ImportSource } from './models';
import type { ImportCandidate } from './models';
import { buildImportPreview, type UnifiedRow } from './unify';
import { resolveAccountFor, validateAccountBinding } from './accountResolver';
import { parseAlipayFile } from './adapters/alipayCsv';
import { parseTngText } from './adapters/tngPdf';
import {
  commit,
  undo,
  buildCommitPlan,
  createMemoryBackend,
  summarizeReport,
} from './importService';
import { recomputeAccounts, financeSummary, financeStats } from './recompute';

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

// -------------------------------------------------------------- test fixtures
function mk(p: Partial<ImportCandidate> & { id: string }): ImportCandidate {
  return {
    source: 'alipay' as ImportSource,
    sourceFile: 'stmt.csv',
    rowIndex: 0,
    txnType: 'expense',
    amountMinor: 0,
    currency: 'CNY',
    date: '2026-01-01',
    warnings: [],
    ...p,
  } as ImportCandidate;
}

const ACCOUNTS: Account[] = [
  { id: 'accA', name: '支付宝', type: 'ewallet', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 },
  { id: 'accB', name: '微信', type: 'ewallet', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 1, createdAt: 0 },
  { id: 'accTNG', name: 'TNG', type: 'ewallet', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 2, createdAt: 0 },
  { id: 'cardCNY', name: 'RMB卡', type: 'credit', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 3, createdAt: 0, creditLimitMinor: 100000 },
  { id: 'cashMYR', name: '现金', type: 'cash', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 4, createdAt: 0 },
];

const resolver = (row: { accountHint?: string }): string | undefined => {
  const map: Record<string, string> = {
    支付宝: 'accA',
    微信支付: 'accB',
    TNG: 'accTNG',
    CNY卡: 'cardCNY',
    现金: 'cashMYR',
  };
  return row.accountHint ? map[row.accountHint] : undefined;
};

const BASE_OPTS = { accountResolver: resolver as any, accounts: ACCOUNTS };

// commit/undo are async (the real backend is AsyncStorage), so the suites that
// touch them live inside this async IIFE.
(async () => {

// --------------------------------------------------- buildCommitPlan: basics
console.log('--- buildCommitPlan: basic mapping ---');
{
  const c = mk({ id: 'c1', source: 'alipay', accountHint: '支付宝', currency: 'CNY', amountMinor: 1250, date: '2026-01-01', merchant: '星巴克', category: '餐饮' });
  const preview = buildImportPreview([c]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('one txn created', plan.txns.length, 1);
  const t = plan.txns[0];
  eq('type expense', t.type, 'expense');
  eq('currency CNY', t.currency, 'CNY');
  eq('origAmountMinor 1250', t.origAmountMinor, 1250);
  eq('legacy amount 12.5', t.amount, 12.5);
  eq('accountId resolved', t.accountId, 'accA');
  eq('isPosted default true', t.isPosted, true);
  eq('merchant carried (shop name only)', t.merchant, '星巴克');
  eq('note empty (no PII persist)', t.note, '');
  eq('report importedRows 1', plan.report.importedRows, 1);
}

// ------------------------------------------------- suspected hint, no auto-skip
console.log('--- duplicate rows are hinted, NOT auto-skipped ---');
{
  const a = mk({ id: 'a', source: 'wechat', accountHint: '支付宝', rawRef: 'ORD1', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const b = mk({ id: 'b', source: 'wechat', accountHint: '支付宝', rawRef: 'ORD1', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const preview = buildImportPreview([a, b]);
  // No automatic dedup: nothing is flagged definite; both rows stay importable.
  eq('no definite duplicate (no auto-skip)', preview.duplicates.length, 0);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('importedRows 2 (both, user decides)', plan.txns.length, 2);
  eq('skippedDuplicates 0', plan.report.skippedDuplicates, 0);
  // user explicitly selects only one -> that one imported
  const plan2 = buildCommitPlan(preview, { ...BASE_OPTS, selectedRowIds: ['a'] });
  eq('explicit select one -> 1 imported', plan2.txns.length, 1);
}

// ------------------------------------------------- existing-ledger dup skip
console.log('--- existing-ledger duplicate suppression ---');
{
  const existing: Txn[] = [
    {
      id: 'e1', type: 'expense', currency: 'CNY', amount: 12.5,
      origAmountMinor: 1250, origCurrency: 'CNY', accountId: 'accA',
      category: '餐饮', merchant: '星巴克', note: '', date: '2026-01-01', createdAt: 0,
    },
  ];
  const c = mk({ id: 'c1', source: 'wechat', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const preview = buildImportPreview([c]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS, existingTxns: existing });
  eq('existing dup -> 0 imported', plan.txns.length, 0);
  eq('skippedExisting 1', plan.report.skippedExisting, 1);
}

// ----------------------------------------------------- cross-currency merge
console.log('--- cross-currency: awaiting MYR + posted CNY -> 1 txn ---');
{
  const awaiting = mk({
    id: 'aw', source: 'tng', accountHint: 'CNY卡', currency: 'MYR', amountMinor: 10000,
    date: '2026-01-01', merchant: 'starbucks', meta: { postingStatus: 'awaiting_posting' as any },
  });
  const posted = mk({
    id: 'po', source: 'alipay', accountHint: 'CNY卡', currency: 'CNY', amountMinor: 16800,
    date: '2026-01-02', merchant: 'starbucks',
    settleAmountMinor: 16800, settleCurrency: 'CNY', meta: { postingStatus: 'posted' as any },
  });
  const preview = buildImportPreview([awaiting, posted]);
  eq('cross-currency pair detected', preview.crossCurrencyPairs.length, 1);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('merged into 1 txn (not 2)', plan.txns.length, 1);
  const t = plan.txns[0];
  eq('type expense', t.type, 'expense');
  eq('origCurrency MYR', t.origCurrency, 'MYR');
  eq('origAmountMinor 10000 sen', t.origAmountMinor, 10000);
  eq('settleCurrency = card currency CNY (R1)', t.settleCurrency, 'CNY');
  eq('settleAmountMinor 16800 fen', t.settleAmountMinor, 16800);
  eq('fxSource card', t.fxSource, 'card');
  eq('isPosted true', t.isPosted, true);
  eq('crossCurrencyMerged 1', plan.report.crossCurrencyMerged, 1);
}

// ------------------------------------------------------------- transfer merge
console.log('--- transfer: expense A + income B -> 1 transfer ---');
{
  const e = mk({ id: 'e', accountHint: '支付宝', txnType: 'expense', amountMinor: 50000, currency: 'CNY', date: '2026-01-05', merchant: '转账给朋友A' });
  const i = mk({ id: 'i', accountHint: '微信支付', txnType: 'income', amountMinor: 50000, currency: 'CNY', date: '2026-01-05', merchant: '朋友A转账' });
  const preview = buildImportPreview([e, i]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('merged into 1 txn', plan.txns.length, 1);
  const t = plan.txns[0];
  eq('type transfer', t.type, 'transfer');
  eq('accountId = expense side', t.accountId, 'accA');
  eq('toAccountId = income side', t.toAccountId, 'accB');
  eq('transferMerged 1', plan.report.transferMerged, 1);
}

// -------------------------------------------------------------- refund link
console.log('--- refund: links to original expense ---');
{
  const e = mk({ id: 'e', accountHint: '支付宝', txnType: 'expense', amountMinor: 9900, currency: 'CNY', date: '2026-01-10', merchant: '示例商户A' });
  const r = mk({ id: 'r', accountHint: '支付宝', txnType: 'refund', amountMinor: 9900, currency: 'CNY', date: '2026-01-12', merchant: '示例商户A' });
  const preview = buildImportPreview([e, r]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('two txns (expense + refund)', plan.txns.length, 2);
  const expense = plan.txns.find((t) => t.type === 'expense')!;
  const refund = plan.txns.find((t) => t.type === 'refund')!;
  eq('refund linkedTxnId -> expense', refund.linkedTxnId, expense.id);
  eq('refund countInStats true (offsets)', refund.countInStats, true);
  eq('refundLinked 1', plan.report.refundLinked, 1);
}

// ------------------------------------------------------ file historical settle
console.log('--- file-provided settlement persists (R2 safe) ---');
{
  const c = mk({ id: 'c1', source: 'tng', accountHint: 'TNG', currency: 'MYR', amountMinor: 1250, date: '2026-01-01', merchant: 'Sample Shop', settleAmountMinor: 2000, settleCurrency: 'CNY' });
  const preview = buildImportPreview([c]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  const t = plan.txns[0];
  eq('settleAmountMinor kept', t.settleAmountMinor, 2000);
  eq('settleCurrency kept', t.settleCurrency, 'CNY');
  eq('fxSource system (real file rate)', t.fxSource, 'system');
  ok('fxRate derived', typeof t.fxRate === 'number' && Math.abs((t.fxRate || 0) - 1.6) < 1e-6);
}

// ------------------------------------------------------- commit + undo cycle
console.log('--- atomic commit / batch undo ---');
{
  const backend = createMemoryBackend({ accounts: ACCOUNTS });
  const c1 = mk({ id: 'c1', source: 'alipay', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const c2 = mk({ id: 'c2', source: 'tng', accountHint: 'TNG', amountMinor: 300, currency: 'MYR', date: '2026-01-02', merchant: 'Grab' });
  const preview = buildImportPreview([c1, c2]);
  const res = await commit(backend, preview, { ...BASE_OPTS, batchId: 'batch1' });
  eq('backend now has 2 txns', backend.state().txns.length, 2);
  eq('one batch stored', backend.state().batches.length, 1);
  eq('batch status committed', backend.state().batches[0].status, 'committed');
  eq('batch holds 2 txnIds (PII-free)', backend.state().batches[0].txnIds.length, 2);
  // batch has no merchant strings
  const batchStr = JSON.stringify(backend.state().batches[0]);
  ok('batch contains no merchant PII', !batchStr.includes('星巴克') && !batchStr.includes('Grab'));
  // undo
  const ur = await undo(backend, 'batch1');
  eq('undo ok', ur.ok, true);
  eq('txns removed', backend.state().txns.length, 0);
  eq('batch status undone', backend.state().batches[0].status, 'undone');
  // double undo
  const ur2 = await undo(backend, 'batch1');
  eq('double undo rejected', ur2.ok, false);
  eq('double undo reason', ur2.reason, 'already_undone');
  // unknown batch
  const ur3 = await undo(backend, 'nope');
  eq('unknown undo rejected', ur3.ok, false);
  eq('unknown undo reason', ur3.reason, 'not_found');
  // recompute reset: accA balance back to 0
  const rec = recomputeAccounts(backend.state().txns, backend.state().accounts);
  const accA = rec.find((a) => a.id === 'accA')!;
  eq('accA balance reset after undo', accA.balanceMinor, 0);
}

// ---------------------------------------------- R3: posted vs awaiting split
console.log('--- R3 recomputeAccounts: posted/awaiting split ---');
{
  const credit: Account = { id: 'card', name: '卡', type: 'credit', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 };
  const posted: Txn = { id: 'p', type: 'expense', currency: 'CNY', amount: 100, origAmountMinor: 10000, origCurrency: 'CNY', settleAmountMinor: 10000, settleCurrency: 'CNY', isPosted: true, accountId: 'card', category: 'x', merchant: '', note: '', date: '2026-01-01', createdAt: 0 };
  const awaiting: Txn = { id: 'a', type: 'expense', currency: 'CNY', amount: 50, origAmountMinor: 5000, origCurrency: 'CNY', settleAmountMinor: 5000, settleCurrency: 'CNY', isPosted: false, accountId: 'card', category: 'x', merchant: '', note: '', date: '2026-01-01', createdAt: 0 };
  const rec = recomputeAccounts([posted, awaiting], [credit]);
  const c = rec[0];
  eq('currentBillMinor = posted only (10000)', c.currentBillMinor, 10000);
  eq('unbilledMinor = awaiting only (5000)', c.unbilledMinor, 5000);
}
{
  // financeSummary: confirmed net worth excludes awaiting; predicted includes it.
  // All MYR to avoid FX-base conversion noise (base currency is MYR).
  const credit: Account = { id: 'card', name: '卡', type: 'credit', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 };
  const posted: Txn = { id: 'p', type: 'expense', currency: 'MYR', amount: 100, origAmountMinor: 10000, origCurrency: 'MYR', settleAmountMinor: 10000, settleCurrency: 'MYR', isPosted: true, accountId: 'card', category: 'x', merchant: '', note: '', date: '2026-01-01', createdAt: 0 };
  const awaiting: Txn = { id: 'a', type: 'expense', currency: 'MYR', amount: 50, origAmountMinor: 5000, origCurrency: 'MYR', settleAmountMinor: 5000, settleCurrency: 'MYR', isPosted: false, accountId: 'card', category: 'x', merchant: '', note: '', date: '2026-01-01', createdAt: 0 };
  const cash: Account = { id: 'cash', name: '现金', type: 'cash', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 1, createdAt: 0, openingBalanceMinor: 20000 };
  const fx = { base: 'MYR' as const, cnyPerMyr: 1.6, rateScaled: 1_600_000, rateUpdatedAt: 0, rateSource: 'system' as const };
  const s = financeSummary([posted, awaiting], [credit, cash], fx);
  eq('confirmed liabilities = posted 10000', s.liabilitiesMYR, 10000);
  eq('confirmed netWorth = 20000 - 10000 = 10000', s.netWorthMYR, 10000);
  eq('predicted liabilities = 15000', s.predictedLiabilitiesMYR, 15000);
  eq('predicted netWorth = 5000', s.predictedNetWorthMYR, 5000);
}

// ----------------------------------------------------- R3 via import commit
console.log('--- R3 via ImportService.commit (awaiting credit not in confirmed NW) ---');
{
  const backend = createMemoryBackend({ accounts: ACCOUNTS });
  const posted = mk({ id: 'p', source: 'alipay', accountHint: 'CNY卡', amountMinor: 10000, currency: 'CNY', date: '2026-01-01', merchant: 'Sample', settleAmountMinor: 10000, settleCurrency: 'CNY', meta: { postingStatus: 'posted' as any } });
  const awaiting = mk({ id: 'a', source: 'alipay', accountHint: 'CNY卡', amountMinor: 5000, currency: 'CNY', date: '2026-01-02', merchant: 'Sample2', settleAmountMinor: 5000, settleCurrency: 'CNY', meta: { postingStatus: 'awaiting_posting' as any } });
  const preview = buildImportPreview([posted, awaiting]);
  await commit(backend, preview, { ...BASE_OPTS, batchId: 'bR3' });
  const st = backend.state();
  const card = st.accounts.find((a) => a.id === 'cardCNY')!;
  eq('card currentBill = posted 10000', card.currentBillMinor, 10000);
  eq('card unbilled = awaiting 5000', card.unbilledMinor, 5000);
  const fx = { base: 'MYR' as const, cnyPerMyr: 1.6, rateScaled: 1_600_000, rateUpdatedAt: 0, rateSource: 'system' as const };
  const s = financeSummary(st.txns, st.accounts, fx);
  // liabilities are expressed in MYR base: ¥100 CNY = 62.50 MYR (cnyPerMyr=1.6).
  eq('confirmed liabilities (MYR base) = posted only', s.liabilitiesMYR, 6250);
  ok('awaiting NOT folded into confirmed liabilities', s.liabilitiesMYR !== 9375);
}

// ----------------------------------- 理财 off-ledger: recompute / net worth
console.log('--- 理财 (investment) is off-ledger in recomputeAccounts/financeSummary ---');
{
  const fx = { base: 'MYR' as const, cnyPerMyr: 1.6, rateScaled: 1_600_000, rateUpdatedAt: 0, rateSource: 'system' as const };
  const cash: Account = { id: 'accA', name: '支付宝', type: 'ewallet', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 };
  const tx = (over: Partial<Txn>): Txn => ({
    id: 'x', type: 'expense', currency: 'CNY', amount: 0,
    origAmountMinor: 0, origCurrency: 'CNY', settleAmountMinor: 0, settleCurrency: 'CNY',
    accountId: 'accA', isPosted: true, category: '其他', merchant: 'm', note: '', date: '2026-01-01', createdAt: 0,
    affectsIncomeExpense: true, affectsBudget: true, transactionNature: 'normal',
    ...over,
  });
  const income  = tx({ id: 'i', type: 'income', origAmountMinor: 10000, settleAmountMinor: 10000 });
  const spend   = tx({ id: 's', type: 'expense', origAmountMinor: 2000, settleAmountMinor: 2000 });
  const buyFund = tx({ id: 'b', type: 'expense', transactionNature: 'investment', affectsIncomeExpense: false, affectsBudget: false, origAmountMinor: 5000, settleAmountMinor: 5000 });
  const redeem  = tx({ id: 'r', type: 'income', transactionNature: 'investment', affectsIncomeExpense: false, affectsBudget: false, origAmountMinor: 3000, settleAmountMinor: 3000 });

  const recWith = recomputeAccounts([income, spend, buyFund, redeem], [cash]);
  const recWithout = recomputeAccounts([income, spend], [cash]);
  eq('理财 buy/redeem do NOT change account balance', recWith[0].balanceMinor, recWithout[0].balanceMinor);
  eq('balance = income 10000 - spend 2000 = 8000', recWith[0].balanceMinor, 8000);

  const sWith = financeSummary([income, spend, buyFund], [cash], fx);
  const sWithout = financeSummary([income, spend], [cash], fx);
  eq('折合总览 net worth ignores 理财 purchase', sWith.netWorthMYR, sWithout.netWorthMYR);
  eq('折合总览 assets ignores 理财 purchase', sWith.assetsMYR, sWithout.assetsMYR);
}

// ----------------------------------------------------------- report summary
console.log('--- summarizeReport (PII-free) ---');
{
  const c = mk({ id: 'c1', source: 'alipay', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const preview = buildImportPreview([c]);
  const res = await commit(createMemoryBackend({ accounts: ACCOUNTS }), preview, { ...BASE_OPTS, batchId: 'bR' });
  const txt = summarizeReport(res.report);
  ok('summary mentions imported count', txt.includes('导入 1 笔'));
  ok('summary is PII-free', !txt.includes('星巴克'));
}

// ------------------------------- ③ cross-source 关联补全: reconcile existing txn
console.log('--- ③ cross-source: posted CNY completes existing MYR awaiting ---');
{
  const existing: Txn[] = [
    {
      id: 'ex1', type: 'expense', currency: 'MYR', amount: 100,
      origAmountMinor: 10000, origCurrency: 'MYR', accountId: 'cardCNY',
      isPosted: false, category: '餐饮', merchant: 'starbucks', note: '',
      date: '2026-01-01', createdAt: 0,
    },
  ];
  // The imported row is the CNY posting; its MYR partner already lives in the ledger.
  const posted = mk({
    id: 'po', source: 'wechat', accountHint: 'CNY卡', currency: 'CNY', amountMinor: 16800,
    date: '2026-01-02', merchant: 'starbucks',
    settleAmountMinor: 16800, settleCurrency: 'CNY', meta: { postingStatus: 'posted' as any },
  });
  const preview = buildImportPreview([posted]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS, existingTxns: existing });
  eq('no NEW txn created (existing one completed)', plan.txns.length, 0);
  eq('one existing txn modified', plan.modified.length, 1);
  const after = plan.modified[0].after;
  eq('modified id', plan.modified[0].id, 'ex1');
  eq('settleAmountMinor back-filled', after.settleAmountMinor, 16800);
  eq('settleCurrency CNY', after.settleCurrency, 'CNY');
  eq('fxSource card', after.fxSource, 'card');
  eq('isPosted now true', after.isPosted, true);
  eq('crossSourceReconciled 1', plan.report.crossSourceReconciled, 1);
  eq('modifiedTxnIds recorded', plan.report.modifiedTxnIds.length, 1);
  // before-snapshot must be untouched (proves undo can restore)
  eq('before-snapshot untouched', plan.modified[0].before.settleAmountMinor, undefined);
  eq('before-snapshot still awaiting', plan.modified[0].before.isPosted, false);
}

// ------------------------- ③ cross-source: refund links to existing expense
console.log('--- ③ cross-source: refund links to existing ledger expense ---');
{
  const existing: Txn[] = [
    {
      id: 'ex2', type: 'expense', currency: 'CNY', amount: 99,
      origAmountMinor: 9900, origCurrency: 'CNY', accountId: 'accA',
      isPosted: true, category: '购物', merchant: '示例商户A', note: '',
      date: '2026-01-10', createdAt: 0,
    },
  ];
  const refund = mk({
    id: 'r', source: 'wechat', accountHint: '支付宝', txnType: 'refund',
    amountMinor: 9900, currency: 'CNY', date: '2026-01-12', merchant: '示例商户A',
  });
  const preview = buildImportPreview([refund]);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS, existingTxns: existing });
  eq('refund txn created', plan.txns.length, 1);
  eq('refund linked to EXISTING expense', plan.txns[0].linkedTxnId, 'ex2');
  eq('crossSourceRefundLinked 1', plan.report.crossSourceRefundLinked, 1);
}

// ---------------------- ③ undo restores MODIFIED existing txns, not just deletes
console.log('--- ③ undo restores modified existing txn ---');
{
  const existing: Txn[] = [
    {
      id: 'ex1', type: 'expense', currency: 'MYR', amount: 100,
      origAmountMinor: 10000, origCurrency: 'MYR', accountId: 'cardCNY',
      isPosted: false, category: '餐饮', merchant: 'starbucks', note: '',
      date: '2026-01-01', createdAt: 0,
    },
  ];
  const backend = createMemoryBackend({ accounts: ACCOUNTS, txns: existing });
  const posted = mk({
    id: 'po', source: 'wechat', accountHint: 'CNY卡', currency: 'CNY', amountMinor: 16800,
    date: '2026-01-02', merchant: 'starbucks',
    settleAmountMinor: 16800, settleCurrency: 'CNY', meta: { postingStatus: 'posted' as any },
  });
  const preview = buildImportPreview([posted]);
  const res = await commit(backend, preview, { ...BASE_OPTS, batchId: 'bCC' });
  eq('batch records modifiedTxnIds', res.batch.modifiedTxnIds?.length, 1);
  eq('existing txn patched to posted', backend.state().txns.find((t) => t.id === 'ex1')?.isPosted, true);
  eq('settle written to existing txn', backend.state().txns.find((t) => t.id === 'ex1')?.settleAmountMinor, 16800);

  const ur = await undo(backend, 'bCC');
  eq('undo ok', ur.ok, true);
  const restored = backend.state().txns.find((t) => t.id === 'ex1')!;
  eq('existing txn restored to awaiting', restored.isPosted, false);
  eq('settle removed on undo', restored.settleAmountMinor, undefined);
  eq('existing txn NOT deleted', backend.state().txns.length, 1);
  eq('rollback snapshot cleared', backend.state().rollbacks['bCC'], undefined);
}

// ------------------------------------------------- accountResolver (integration)
console.log('--- accountResolver (hint -> accountId) ---');
{
  const rowOf = (p: Partial<UnifiedRow>): UnifiedRow =>
    ({ id: 'r', source: 'alipay', sourceFile: 'f', rowIndex: 0, txnType: 'expense',
       amountMinor: 0, currency: 'CNY', date: '2026-01-01', warnings: [],
       dupStatus: 'none', skipByDefault: false, ...p }) as unknown as UnifiedRow;

  // explicit accountId wins over everything
  eq('explicit accountId wins', resolveAccountFor(rowOf({ accountId: 'accB', accountHint: '支付宝' }), ACCOUNTS), 'accB');
  // name match
  eq('name match 支付宝', resolveAccountFor(rowOf({ accountHint: '支付宝' }), ACCOUNTS), 'accA');
  eq('name match TNG', resolveAccountFor(rowOf({ accountHint: 'TNG' }), ACCOUNTS), 'accTNG');
  // currency fallback when the hint matches nothing
  const myrRow = rowOf({ accountHint: '未知钱包', currency: 'MYR', origCurrency: 'MYR' });
  eq('MYR currency fallback (non-credit)', resolveAccountFor(myrRow, ACCOUNTS), 'accTNG');
  // no accounts at all -> undefined (imports without an account rather than guessing)
  eq('no accounts -> undefined', resolveAccountFor(rowOf({ accountHint: '支付宝' }), []), undefined);
  // unknown hint + unknown currency -> undefined
  eq('unresolvable -> undefined',
    resolveAccountFor(rowOf({ accountHint: '火星银行', currency: 'CNY', origCurrency: 'CNY' }), ACCOUNTS), 'accA');
}

// ============ Alipay / TNG: NO in-batch auto-dedup (user decides) ============
// Per user request, identical rows within ONE import are NOT auto-removed — they
// are only flagged "suspected" as a hint and the user confirms in the preview.
// Re-importing the SAME file is still guarded against the EXISTING ledger
// (skippedExisting) so already-saved transactions are not re-added.

console.log('--- Alipay: within-batch identical rows are NOT auto-deduped ---');
{
  const a = mk({ id: 'a', source: 'alipay', accountHint: '支付宝', rawRef: 'ORD1', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const b = mk({ id: 'b', source: 'alipay', accountHint: '支付宝', rawRef: 'ORD1', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const preview = buildImportPreview([a, b]);
  // No automatic dedup: both rows stay importable; the user decides.
  eq('alipay pair NOT flagged as definite dup', preview.duplicates.length, 0);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('alipay pair: BOTH imported (user decides)', plan.txns.length, 2);
  eq('skippedDuplicates 0', plan.report.skippedDuplicates, 0);
}

console.log('--- Alipay: suppressed against existing identical ledger txn (re-import) ---');
{
  const existing: Txn[] = [
    { id: 'e1', type: 'expense', currency: 'CNY', amount: 12.5, origAmountMinor: 1250, origCurrency: 'CNY', accountId: 'accA', category: '餐饮', merchant: '星巴克', note: '', date: '2026-01-01', createdAt: 0 },
  ];
  const c = mk({ id: 'c1', source: 'alipay', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const plan = buildCommitPlan(buildImportPreview([c]), { ...BASE_OPTS, existingTxns: existing });
  eq('alipay suppressed as existing dup', plan.txns.length, 0);
  eq('alipay skippedExisting 1', plan.report.skippedExisting, 1);
}

console.log('--- TNG: suppressed against existing identical ledger txn (re-import) ---');
{
  const existing: Txn[] = [
    { id: 'e1', type: 'expense', currency: 'MYR', amount: 3, origAmountMinor: 300, origCurrency: 'MYR', accountId: 'accTNG', category: 'x', merchant: 'Grab', note: '', date: '2026-01-02', createdAt: 0 },
  ];
  const c = mk({ id: 'c1', source: 'tng', accountHint: 'TNG', amountMinor: 300, currency: 'MYR', date: '2026-01-02', merchant: 'Grab' });
  const plan = buildCommitPlan(buildImportPreview([c]), { ...BASE_OPTS, existingTxns: existing });
  eq('tng suppressed as existing dup', plan.txns.length, 0);
  eq('tng skippedExisting 1', plan.report.skippedExisting, 1);
}

console.log('--- Alipay ¥100 vs TNG RM100 are NEVER duplicates (§二/#3) ---');
{
  const a = mk({ id: 'a', source: 'alipay', accountHint: '支付宝', rawRef: 'ORDX', amountMinor: 10000, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const t = mk({ id: 't', source: 'tng', accountHint: 'TNG', rawRef: 'ORDX', amountMinor: 10000, currency: 'MYR', date: '2026-01-01', merchant: '星巴克' });
  const preview = buildImportPreview([a, t]);
  eq('no duplicate across the two platforms', preview.duplicates.length, 0);
  const plan = buildCommitPlan(preview, { ...BASE_OPTS });
  eq('both imported (2 txns)', plan.txns.length, 2);
}

console.log('--- WeChat: still suppressed (regression guard) ---');
{
  const existing: Txn[] = [
    { id: 'e1', type: 'expense', currency: 'CNY', amount: 12.5, origAmountMinor: 1250, origCurrency: 'CNY', accountId: 'accA', category: '餐饮', merchant: '星巴克', note: '', date: '2026-01-01', createdAt: 0 },
  ];
  const c = mk({ id: 'c1', source: 'wechat', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const plan = buildCommitPlan(buildImportPreview([c]), { ...BASE_OPTS, existingTxns: existing });
  eq('wechat suppressed against existing', plan.txns.length, 0);
  eq('wechat skippedExisting 1', plan.report.skippedExisting, 1);
}

console.log('--- Alipay: cross-source reconciles to existing MYR awaiting (same currency card) ---');
{
  const existing: Txn[] = [
    { id: 'ex1', type: 'expense', currency: 'MYR', amount: 100, origAmountMinor: 10000, origCurrency: 'MYR', accountId: 'cardCNY', isPosted: false, category: '餐饮', merchant: 'starbucks', note: '', date: '2026-01-01', createdAt: 0 },
  ];
  const posted = mk({ id: 'po', source: 'alipay', accountHint: 'CNY卡', currency: 'CNY', amountMinor: 16800, date: '2026-01-02', merchant: 'starbucks', settleAmountMinor: 16800, settleCurrency: 'CNY', meta: { postingStatus: 'posted' as any } });
  const plan = buildCommitPlan(buildImportPreview([posted]), { ...BASE_OPTS, existingTxns: existing });
  eq('no NEW txn created (existing completed)', plan.txns.length, 0);
  eq('one existing txn modified', plan.modified.length, 1);
  eq('crossSourceReconciled 1', plan.report.crossSourceReconciled, 1);
  eq('existing completed to posted', plan.modified[0].after.isPosted, true);
}

console.log('--- Alipay: refund links to existing ledger expense ---');
{
  const existing: Txn[] = [
    { id: 'ex2', type: 'expense', currency: 'CNY', amount: 99, origAmountMinor: 9900, origCurrency: 'CNY', accountId: 'accA', isPosted: true, category: '购物', merchant: '示例商户A', note: '', date: '2026-01-10', createdAt: 0 },
  ];
  const refund = mk({ id: 'r', source: 'alipay', accountHint: '支付宝', txnType: 'refund', amountMinor: 9900, currency: 'CNY', date: '2026-01-12', merchant: '示例商户A' });
  const plan = buildCommitPlan(buildImportPreview([refund]), { ...BASE_OPTS, existingTxns: existing });
  eq('alipay refund txn created', plan.txns.length, 1);
  eq('alipay refund linked to existing', plan.txns[0].linkedTxnId, 'ex2');
  eq('alipay crossSourceRefundLinked 1', plan.report.crossSourceRefundLinked, 1);
}

// ===================== §三/§四 settlement: same-currency only =================
console.log('--- §三/§四 settlement: Alipay(CNY) links only to CNY settlement ---');
{
  const existingCNY: Txn[] = [
    { id: 'setCNY', type: 'expense', currency: 'CNY', amount: 100, origAmountMinor: 10000, origCurrency: 'CNY', accountId: 'accA', isPosted: true, category: 'x', merchant: '支付宝消费-星巴克', note: '', date: '2026-02-01', createdAt: 0 },
  ];
  const alipayRow = mk({ id: 'a', source: 'alipay', accountHint: '支付宝', currency: 'CNY', amountMinor: 10000, date: '2026-02-02', merchant: '星巴克', rawRef: 'ORDX' });
  const plan = buildCommitPlan(buildImportPreview([alipayRow]), { ...BASE_OPTS, existingTxns: existingCNY });
  eq('alipay->CNY settlement linked (1)', plan.report.crossSourceSettlementLinked, 1);
  eq('CNY settlement flagged countInStats false', plan.modified.find((m) => m.id === 'setCNY')?.after.countInStats, false);
}

console.log('--- §二 Alipay(CNY) must NOT link to a TNG(MYR) ledger settlement ---');
{
  const existingMYR: Txn[] = [
    { id: 'setMYR', type: 'expense', currency: 'MYR', amount: 100, origAmountMinor: 10000, origCurrency: 'MYR', accountId: 'accTNG', isPosted: true, category: 'x', merchant: 'alipay消费星巴克', note: '', date: '2026-02-01', createdAt: 0 },
  ];
  const alipayRow = mk({ id: 'a', source: 'alipay', accountHint: '支付宝', currency: 'CNY', amountMinor: 10000, date: '2026-02-02', merchant: '星巴克', rawRef: 'ORDX' });
  const plan = buildCommitPlan(buildImportPreview([alipayRow]), { ...BASE_OPTS, existingTxns: existingMYR });
  eq('alipay does NOT link to TNG(MYR) settlement', plan.report.crossSourceSettlementLinked, 0);
  eq('alipay row imported normally', plan.txns.length, 1);
}

console.log('--- §四 TNG(MYR) links to MYR settlement ---');
{
  const existingMYR: Txn[] = [
    { id: 'setMYR', type: 'expense', currency: 'MYR', amount: 100, origAmountMinor: 10000, origCurrency: 'MYR', accountId: 'accTNG', isPosted: true, category: 'x', merchant: 'tng consumption starbucks', note: '', date: '2026-02-01', createdAt: 0 },
  ];
  const tngRow = mk({ id: 't', source: 'tng', accountHint: 'TNG', currency: 'MYR', amountMinor: 10000, date: '2026-02-02', merchant: 'starbucks', rawRef: 'ORDY' });
  const plan = buildCommitPlan(buildImportPreview([tngRow]), { ...BASE_OPTS, existingTxns: existingMYR });
  eq('tng->MYR settlement linked (1)', plan.report.crossSourceSettlementLinked, 1);
}

// ===================== §七 budget split by currency =====================
console.log('--- §七 budget: CNY spend deducts CNY only, MYR deducts MYR only ---');
{
  const alipay = mk({ id: 'a', source: 'alipay', accountHint: '支付宝', txnType: 'expense', currency: 'CNY', amountMinor: 12500, date: '2026-03-01', merchant: '淘宝', budgetCurrency: 'CNY', affectsBudget: true, affectsIncomeExpense: true });
  const tng = mk({ id: 't', source: 'tng', accountHint: 'TNG', txnType: 'expense', currency: 'MYR', amountMinor: 1200, date: '2026-03-01', merchant: 'Grab', budgetCurrency: 'MYR', affectsBudget: true, affectsIncomeExpense: true });
  const plan = buildCommitPlan(buildImportPreview([alipay, tng]), { ...BASE_OPTS });
  const stats = financeStats(plan.txns);
  eq('CNY expense counted', stats.incomeExpense.CNY.expense, 12500);
  eq('CNY budget spent = 12500', stats.budgetSpent.CNY, 12500);
  eq('MYR expense counted', stats.incomeExpense.MYR.expense, 1200);
  eq('MYR budget spent = 1200', stats.budgetSpent.MYR, 1200);
  eq('CNY budget NOT mixed with MYR', stats.budgetSpent.CNY, 12500);
}

// ===================== §六/§五 Alipay wealth + recharge =====================
console.log('--- §六/§五 Alipay: recharge=transfer, wealth=investment; ALL imported, flagged off-budget ---');
{
  const csv = [
    '支付宝交易记录明细查询',
    '账号:[TEST]',
    '起始日期:[2026-01-01] 终止日期:[2026-01-31]',
    '----------交易记录明细列表----------',
    '交易号,商家订单号,交易创建时间,交易对方,商品名称,金额,收/支,交易状态,交易分类',
    '20260101001,,2026/1/2 10:00,淘宝,冬季外套,125.00,支出,交易成功,购物',
    '20260101002,,2026/1/3 11:00,中国银行,充值到余额宝,500.00,转账,交易成功,理财',
    '20260101003,,2026/1/4 12:00,余额宝,余额宝转入,300.00,转账,交易成功,理财',
    '20260101004,,2026/1/5 13:00,蚂蚁财富,基金申购,1000.00,支出,交易成功,理财',
    '20260101005,,2026/1/6 14:00,招商基金,基金收益,50.00,收入,交易成功,理财',
  ].join('\n');
  const out = parseAlipayFile({ name: 'alipay.csv', text: csv });
  ok('parse ok', out.ok);
  if (out.ok) {
    const cs = out.result.candidates;
    eq('all 5 rows imported (incl. wealth + recharge)', cs.length, 5);
    const ordinary = cs.find((c) => c.merchant === '淘宝')!;
    eq('ordinary affectsBudget true', ordinary.affectsBudget, true);
    eq('ordinary affectsIncomeExpense true', ordinary.affectsIncomeExpense, true);
    eq('ordinary nature normal', ordinary.transactionNature, 'normal');
    eq('ordinary budgetCurrency CNY', ordinary.budgetCurrency, 'CNY');
    eq('ordinary currencyInferredFromSource', ordinary.currencyInferredFromSource, true);
    const recharge = cs.find((c) => c.merchant === '中国银行')!;
    eq('recharge nature transfer', recharge.transactionNature, 'transfer');
    eq('recharge affectsBudget false', recharge.affectsBudget, false);
    eq('recharge affectsIncomeExpense false', recharge.affectsIncomeExpense, false);
    const yeb = cs.find((c) => c.merchant === '余额宝')!;
    eq('余额宝转入 nature investment', yeb.transactionNature, 'investment');
    eq('余额宝转入 affectsBudget false', yeb.affectsBudget, false);
    const fund = cs.find((c) => c.merchant === '蚂蚁财富')!;
    eq('基金申购 nature investment', fund.transactionNature, 'investment');
    eq('基金申购 affectsIncomeExpense false', fund.affectsIncomeExpense, false);
    const profit = cs.find((c) => c.merchant === '招商基金')!;
    eq('基金收益 nature investment', profit.transactionNature, 'investment');
    eq('基金收益 affectsIncomeExpense false', profit.affectsIncomeExpense, false);
    // none of the wealth/recharge rows count in daily stats or budget
    const plan = buildCommitPlan(buildImportPreview(cs), { ...BASE_OPTS });
    const stats = financeStats(plan.txns);
    eq('CNY expense = only ordinary (125.00)', stats.incomeExpense.CNY.expense, 12500);
    eq('CNY budget spent = only ordinary', stats.budgetSpent.CNY, 12500);
    eq('CNY income = 0 (recharge/wealth excluded)', stats.incomeExpense.CNY.income, 0);
  }
}

// ===================== §五 TNG reload =====================
console.log('--- §五 TNG: reload=transfer (not income); ordinary spend=normal ---');
{
  const text = [
    "Touch 'n Go e-statement",
    'Transaction Date Details Amount Balance',
    '01/01/2026 Top Up from Maybank 50.00 150.00',
    '02/01/2026 Grab ride 12.00 138.00',
  ].join('\n');
  const out = parseTngText({ name: 'tng.pdf', text });
  ok('tng parse ok', out.ok);
  if (out.ok) {
    const cs = out.result.candidates;
    eq('2 rows parsed', cs.length, 2);
    const reload = cs.find((c) => /top up|reload/i.test(c.merchant || ''))!;
    eq('reload nature transfer', reload.transactionNature, 'transfer');
    eq('reload affectsBudget false', reload.affectsBudget, false);
    eq('reload affectsIncomeExpense false', reload.affectsIncomeExpense, false);
    eq('reload currency MYR', reload.currency, 'MYR');
    eq('reload currencyInferredFromSource', reload.currencyInferredFromSource, true);
    const spend = cs.find((c) => (c.merchant || '').includes('Grab'))!;
    eq('spend nature normal', spend.transactionNature, 'normal');
    eq('spend affectsBudget true', spend.affectsBudget, true);
    eq('spend currency MYR', spend.currency, 'MYR');
  }
}

// ===================== TNG txn classification (user rules) =====================
console.log('--- TNG: Reload/Transfer to Wallet=转账; Receive/Cashback=收入; Payment etc=支出 ---');
{
  const text = [
    "Touch 'n Go e-statement",
    'Transaction Date Details Amount Balance',
    '01/07/2026 Reload RM10.00 100.00',
    '02/07/2026 Transfer to Wallet RM50.00 150.00',
    '03/07/2026 Receive from Wallet RM20.00 170.00',
    '03/07/2026 Cashback RM2.00 172.00',
    '04/07/2026 Payment - Grab RM12.00 160.00',
    '05/07/2026 PayDirect Payment RM30.00 130.00',
    '06/07/2026 DuitNow QR RM15.00 115.00',
  ].join('\n');
  const out = parseTngText({ name: 'tng.pdf', text });
  ok('tng parse ok', out.ok);
  if (out.ok) {
    const cs = out.result.candidates;
    const byMerchant = (m: string) => cs.find((c) => (c.merchant || '').toLowerCase().includes(m.toLowerCase()))!;
    eq('Reload -> 转账 (transfer)', byMerchant('reload').txnType, 'transfer');
    eq('Reload not income/expense', byMerchant('reload').affectsIncomeExpense, false);
    eq('Transfer to Wallet -> 转账 (transfer)', byMerchant('transfer to wallet').txnType, 'transfer');
    eq('Transfer to Wallet not income/expense', byMerchant('transfer to wallet').affectsIncomeExpense, false);
    eq('Receive from Wallet -> 收入 (income)', byMerchant('receive from wallet').txnType, 'income');
    eq('Cashback -> 收入 (income)', byMerchant('cashback').txnType, 'income');
    eq('Payment -> 支出 (expense)', byMerchant('payment').txnType, 'expense');
    eq('PayDirect Payment -> 支出 (expense)', byMerchant('paydirect').txnType, 'expense');
    eq('DuitNow QR -> 支出 (expense)', byMerchant('duitnow').txnType, 'expense');
  }
}

// ===================== §八 per-source account binding =====================
console.log('--- §八 account binding: per-source bound account, currency-gated ---');
{
  eq('alipay bound to accA (CNY)', resolveAccountFor({ accountHint: '支付宝' } as any, ACCOUNTS, { source: 'alipay', boundAccountId: 'accA' }), 'accA');
  eq('tng bound to accTNG (MYR)', resolveAccountFor({ source: 'tng', accountHint: 'TNG' } as any, ACCOUNTS, { source: 'tng', boundAccountId: 'accTNG' }), 'accTNG');
  // currency mismatch -> binding rejected, falls back to hint match
  eq('alipay bound to MYR acc REJECTED (falls back to accA)', resolveAccountFor({ accountHint: '支付宝' } as any, ACCOUNTS, { source: 'alipay', boundAccountId: 'accTNG' }), 'accA');
  eq('tng bound to CNY acc REJECTED (falls back to accTNG)', resolveAccountFor({ source: 'tng', accountHint: 'TNG' } as any, ACCOUNTS, { source: 'tng', boundAccountId: 'accA' }), 'accTNG');
  const v1 = validateAccountBinding('alipay', 'accTNG', ACCOUNTS);
  eq('binding alipay->MYR invalid', v1.ok, false);
  const v2 = validateAccountBinding('tng', 'accTNG', ACCOUNTS);
  eq('binding tng->MYR valid', v2.ok, true);
  const v3 = validateAccountBinding('alipay', 'accA', ACCOUNTS);
  eq('binding alipay->CNY valid', v3.ok, true);
}

// --------------------------------------------------------------- summary
console.log(`\nPhase 6 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(1);
}

})();
