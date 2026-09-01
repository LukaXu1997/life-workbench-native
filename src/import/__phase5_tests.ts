// Phase 5 unit tests — standardization, auto-categorization, and the four shared
// matchers (Duplicate / Transfer / Refund / CrossCurrency) plus the unify
// orchestrator. React-Native-free; run via scripts/import-test-runner.js.
//
// PRIVACY: all samples are synthetic ("Sample Coffee Shop", "示例商户A", fictional
// order ids). No real card / account numbers or personal identifiers.

import type { ImportCandidate, ImportSource } from './models';
import { standardize } from './standardize';
import { suggestCategory, categorize } from './autoCategorize';
import { toMatchable, normMerchant, type Matchable } from './matchers/types';
import { findDuplicates } from './matchers/duplicate';
import { findTransferMatches } from './matchers/transfer';
import { findRefundMatches } from './matchers/refund';
import { findCrossCurrencyMatches, reconcileCrossCurrency } from './matchers/crossCurrency';
import { buildImportPreview } from './unify';

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

/** Minimal candidate factory (de-identified defaults). */
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

// --------------------------------------------------------------- standardize
console.log('--- standardize ---');
{
  // MYR row with live rate -> predicted (display only), no settle written.
  const c = mk({ id: 't1', source: 'tng', currency: 'MYR', amountMinor: 1250, accountHint: 'TNG', merchant: 'Sample Coffee Shop' });
  const s = standardize(c, { rateScaled: 1_600_000 }); // 1 MYR = 1.6 CNY
  eq('origAmountMinor anchored', s.origAmountMinor, 1250);
  eq('origCurrency MYR', s.origCurrency, 'MYR');
  eq('predicted settle = RM12.50 * 1.6 = ¥20.00 (2000 fen)', s.predictedSettleMinor, 2000);
  eq('settle NOT written from live rate', (s as ImportCandidate).settleAmountMinor, undefined);
}
{
  // File already carries a real (historical) settlement -> keep it, never overwrite.
  const c = mk({
    id: 't2', source: 'tng', currency: 'MYR', amountMinor: 1250,
    settleAmountMinor: 2000, settleCurrency: 'CNY', accountHint: 'TNG',
  });
  const s = standardize(c, { rateScaled: 999_000_000 }); // a wildly different live rate
  eq('file settle preserved', s.settleAmountMinor, 2000);
  eq('file settle currency preserved', s.settleCurrency, 'CNY');
  eq('predicted NOT recomputed when file settle exists', s.predictedSettleMinor, undefined);
}

// ------------------------------------------------------------- autoCategorize
console.log('--- autoCategorize ---');
{
  eq('Starbucks -> 餐饮', suggestCategory('Starbucks'), '餐饮');
  eq('Sample Coffee Shop -> 餐饮', suggestCategory('Sample Coffee Shop'), '餐饮');
  eq('Grab -> 交通', suggestCategory('Grab'), '交通');
  eq('Petronas -> 交通', suggestCategory('Petronas'), '交通');
  eq('Shopee -> 购物', suggestCategory('Shopee'), '购物');
  eq('转账 -> 转账还款', suggestCategory('支付宝-转账'), '转账还款');
  eq('Netflix -> 娱乐', suggestCategory('Netflix'), '娱乐');
  eq('empty -> 其他', suggestCategory(''), '其他');
}
{
  const c = mk({ id: 'c1', merchant: 'Starbucks', warnings: ['missing_category'] as any });
  const out = categorize(c);
  eq('categorize fills 餐饮', out.category, '餐饮');
  ok('missing_category warning cleared', !out.warnings.includes('missing_category'));
}
{
  const c = mk({ id: 'c2', merchant: '某不知名小店', category: '餐饮' });
  const out = categorize(c);
  eq('explicit category untouched', out.category, '餐饮');
}

// ----------------------------------------------------------------- duplicate
function matchablesOf(...cs: ImportCandidate[]): Matchable[] {
  return cs.map(toMatchable);
}
console.log('--- duplicate (suspected hint only — NO auto-skip) ---');
{
  // No automatic dedup: even an exact same-reference repeat is NOT auto-removed.
  // It is only flagged "suspected" as a hint; the user decides in the preview.
  const a = mk({ id: 'a', accountHint: '支付宝', rawRef: 'ORD123', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const b = mk({ id: 'b', accountHint: '支付宝', rawRef: 'ORD123', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const r = findDuplicates(matchablesOf(a, b));
  eq('no auto-skip: a flagged suspected (hint only)', r.byId['a'], 'suspected');
  eq('no auto-skip: b flagged suspected (hint only)', r.byId['b'], 'suspected');
  eq('no row removed (both still importable)', r.suspected.size, 2);
}
{
  // P2: same account/date/amount/currency/merchant -> suspected (user decides).
  // sourceFile is irrelevant; identical-content rows from different files are
  // never merged into one.
  const a = mk({ id: 'a', sourceFile: 'f1.csv', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const b = mk({ id: 'b', sourceFile: 'f2.csv', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const r = findDuplicates(matchablesOf(a, b));
  eq('P2 suspected count', r.suspected.size, 2);
  eq('a is suspected', r.byId['a'], 'suspected');
  eq('b is suspected', r.byId['b'], 'suspected');
}
{
  // P4: only merchant similar, different amount -> NOT a duplicate
  const a = mk({ id: 'a', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const b = mk({ id: 'b', accountHint: '支付宝', amountMinor: 8800, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const r = findDuplicates(matchablesOf(a, b));
  eq('P4 not suspected', r.suspected.size, 0);
}
{
  // cross-account: identical row on different accounts -> NOT a duplicate
  const a = mk({ id: 'a', accountHint: '支付宝', rawRef: 'ORD9', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const b = mk({ id: 'b', accountHint: '微信支付', rawRef: 'ORD9', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克' });
  const r = findDuplicates(matchablesOf(a, b));
  eq('cross-account not flagged', r.byId['a'], undefined);
  eq('cross-account not flagged (b)', r.byId['b'], undefined);
}

// ------------------------------------------------------------------ transfer
console.log('--- transfer ---');
{
  const exp = mk({ id: 'e', accountHint: '微信支付', txnType: 'expense', amountMinor: 50000, currency: 'CNY', date: '2026-01-05', merchant: '转账给朋友A' });
  const inc = mk({ id: 'i', accountHint: '支付宝', txnType: 'income', amountMinor: 50000, currency: 'CNY', date: '2026-01-05', merchant: '朋友A转账' });
  const r = findTransferMatches(matchablesOf(exp, inc));
  eq('transfer pair found', r.length, 1);
  eq('transfer expenseId', r[0]?.expenseId, 'e');
}
{
  // same account -> not a transfer
  const exp = mk({ id: 'e', accountHint: '支付宝', txnType: 'expense', amountMinor: 50000, currency: 'CNY', date: '2026-01-05', merchant: '转账给朋友A' });
  const inc = mk({ id: 'i', accountHint: '支付宝', txnType: 'income', amountMinor: 50000, currency: 'CNY', date: '2026-01-05', merchant: '朋友A转账' });
  const r = findTransferMatches(matchablesOf(exp, inc));
  eq('same-account not a transfer', r.length, 0);
}

// ------------------------------------------------------------------- refund
console.log('--- refund ---');
{
  const exp = mk({ id: 'e', accountHint: '支付宝', txnType: 'expense', amountMinor: 9900, currency: 'CNY', date: '2026-01-10', merchant: '示例商户A' });
  const ref = mk({ id: 'r', accountHint: '支付宝', txnType: 'refund', amountMinor: 9900, currency: 'CNY', date: '2026-01-12', merchant: '示例商户A' });
  const r = findRefundMatches(matchablesOf(exp, ref));
  eq('refund linked', r.length, 1);
  eq('refund expenseId', r[0]?.expenseId, 'e');
}
{
  // different merchant -> not linked
  const exp = mk({ id: 'e', accountHint: '支付宝', txnType: 'expense', amountMinor: 9900, currency: 'CNY', date: '2026-01-10', merchant: '示例商户A' });
  const ref = mk({ id: 'r', accountHint: '支付宝', txnType: 'refund', amountMinor: 9900, currency: 'CNY', date: '2026-01-12', merchant: '示例商户B' });
  const r = findRefundMatches(matchablesOf(exp, ref));
  eq('mismatched refund not linked', r.length, 0);
}

// ----------------------------------------------------------- cross-currency
console.log('--- cross-currency ---');
function mkMatch(p: Partial<Matchable> & { id: string }): Matchable {
  return { accountKey: '', amountMinor: 0, currency: 'MYR', merchantNorm: '', date: '2026-01-01', ...p } as Matchable;
}
{
  const awaiting = mkMatch({
    id: 'aw', accountKey: 'CNY卡', postingStatus: 'awaiting_posting',
    origCurrency: 'MYR', origAmountMinor: 10000, currency: 'MYR',
    merchantNorm: normMerchant('starbucks'), date: '2026-01-01',
  });
  const posted = mkMatch({
    id: 'po', accountKey: 'CNY卡', postingStatus: 'posted',
    settleCurrency: 'CNY', settleAmountMinor: 16800, currency: 'CNY',
    merchantNorm: normMerchant('starbucks'), date: '2026-01-02',
  });
  const pairs = findCrossCurrencyMatches([awaiting, posted]);
  eq('cross-currency pair found', pairs.length, 1);
  eq('fxRateScaled = 16800*1e6/10000 = 1,680,000', pairs[0]?.fxRateScaled, 1_680_000);
  const rec = reconcileCrossCurrency(awaiting, posted);
  eq('reconcile settleAmountMinor', rec.settleAmountMinor, 16800);
  eq('reconcile settleCurrency = card currency (R1)', rec.settleCurrency, 'CNY');
  eq('reconcile fxRate = 1.68', rec.fxRate, 1.68);
  eq('reconcile fxSource card', rec.fxSource, 'card');
  ok('reconcile isPosted', rec.isPosted === true);
}
{
  // different account -> no match
  const awaiting = mkMatch({ id: 'aw', accountKey: '卡A', postingStatus: 'awaiting_posting', origCurrency: 'MYR', origAmountMinor: 10000, currency: 'MYR', merchantNorm: normMerchant('starbucks'), date: '2026-01-01' });
  const posted = mkMatch({ id: 'po', accountKey: '卡B', postingStatus: 'posted', settleCurrency: 'CNY', settleAmountMinor: 16800, currency: 'CNY', merchantNorm: normMerchant('starbucks'), date: '2026-01-02' });
  eq('different account no cross match', findCrossCurrencyMatches([awaiting, posted]).length, 0);
}

// ------------------------------------------------------------ unify (e2e)
console.log('--- unify.buildImportPreview ---');
{
  const cny = mk({ id: 'c1', source: 'wechat', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克', rawRef: 'R1' });
  const cnyDup = mk({ id: 'c2', source: 'wechat', accountHint: '支付宝', amountMinor: 1250, currency: 'CNY', date: '2026-01-01', merchant: '星巴克', rawRef: 'R1' });
  const myr = mk({ id: 'm1', source: 'tng', accountHint: 'TNG', currency: 'MYR', amountMinor: 1250, date: '2026-01-03', merchant: 'Sample Coffee Shop' });
  const preview = buildImportPreview([cny, cnyDup, myr], { rateScaled: 1_600_000 });
  eq('preview total rows', preview.rows.length, 3);
  // No automatic dedup: rows are only hinted, never auto-removed.
  eq('no definite duplicate (no auto-skip)', preview.duplicates.length, 0);
  eq('importable = all 3 (user decides)', preview.summary.importable, 3);
  const mRow = preview.rows.find((r) => r.id === 'm1')!;
  eq('MYR predicted settle computed', mRow.predictedSettleMinor, 2000);
  ok('standardized category assigned', mRow.category === '餐饮');
}
{
  // cross-currency through unify: both rows resolve to the same card account
  const myrAwait = mk({
    id: 'aw', source: 'tng', accountHint: 'CNY卡', currency: 'MYR', amountMinor: 10000,
    date: '2026-01-01', merchant: 'starbucks', meta: { postingStatus: 'awaiting_posting' as any },
  });
  const cnyPosted = mk({
    id: 'po', source: 'alipay', accountHint: 'CNY卡', currency: 'CNY', amountMinor: 16800,
    date: '2026-01-02', merchant: 'starbucks', meta: { postingStatus: 'posted' as any },
  });
  const preview = buildImportPreview([myrAwait, cnyPosted], { rateScaled: 1_600_000 });
  eq('unify finds cross-currency pair', preview.crossCurrencyPairs.length, 1);
  const awRow = preview.rows.find((r) => r.id === 'aw')!;
  eq('awaiting predicted settle shown', awRow.predictedSettleMinor, 16000);
}

// --------------------------------------------------------------- summary
console.log(`\nPhase 5 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(1);
}
