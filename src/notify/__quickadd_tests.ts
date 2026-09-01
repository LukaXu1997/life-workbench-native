// Phase 5 unit tests for the pure quick-add helpers.
// Run via /tmp/transpile_qa.js (ts.transpileModule + node). No React Native imports.

import { parseQuickAddUrl, parseSharedText, buildQuickAddTxn } from './quickAdd';
import type { Account, FxSetting } from '../types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  FAIL:', name);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}

const accounts: Account[] = [
  { id: 'a1', name: '马币现金', type: 'cash', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0, balanceMinor: 0 },
  { id: 'a2', name: '马币银行卡', type: 'debit', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 1, createdAt: 0, balanceMinor: 0 },
  { id: 'a3', name: '人民币信用卡', type: 'credit', currency: 'CNY', includeInNetWorth: false, showOnHome: true, order: 2, createdAt: 0, creditLimitMinor: 1000000, currentBillMinor: 0, unbilledMinor: 0, repaidMinor: 0, stmtDay: null, dueDay: null },
];
const fx: FxSetting = { base: 'MYR', cnyPerMyr: 1.65, rateScaled: 1650000, rateUpdatedAt: 0, rateSource: 'system' };

// ---- parseQuickAddUrl ----
eq('url expense', parseQuickAddUrl('lifeworkbench://quick-add?type=expense')?.type, 'expense');
eq('url income', parseQuickAddUrl('lifeworkbench://quick-add?type=income')?.type, 'income');
eq('url repayment', parseQuickAddUrl('lifeworkbench://quick-add?type=repayment')?.type, 'repayment');
eq('url default', parseQuickAddUrl('lifeworkbench://quick-add')?.type, 'expense');
eq('url wrong scheme', parseQuickAddUrl('https://example.com/x'), null);

// ---- parseSharedText ----
const s1 = parseSharedText('您已向 星巴克 支付 RM 25.50');
eq('share amount', s1.amountMinor, 2550);
eq('share cur', s1.currency, 'MYR');
eq('share type', s1.type, 'expense');
eq('share merchant', s1.merchant, '星巴克');
eq('share note', s1.note, '您已向 星巴克 支付 RM 25.50');
eq('share flag', s1.shared, true);

const s2 = parseSharedText('工资到账 ¥8,000.00 已入账');
eq('share cny amount', s2.amountMinor, 800000);
eq('share cny cur', s2.currency, 'CNY');
eq('share income type', s2.type, 'income');

const s3 = parseSharedText('no amount here');
eq('share no amount', s3.amountMinor, undefined);
eq('share default expense', s3.type, 'expense');

// ---- buildQuickAddTxn ----
const b1 = buildQuickAddTxn({ type: 'expense', amountMinor: 2550, currency: 'MYR', accountId: 'a1' }, accounts, fx);
eq('build type', b1.type, 'expense');
eq('build origCur', b1.origCurrency, 'MYR');
eq('build origMinor', b1.origAmountMinor, 2550);
eq('build account', b1.accountId, 'a1');
eq('build sameCur settle', b1.settleCurrency, 'MYR');
eq('build settleMinor same', b1.settleAmountMinor, 2550);
eq('build not card', b1.isCardTxn, false);
eq('build countStats', b1.countInStats, true);
eq('build category fallback', b1.category, '其他');

const b2 = buildQuickAddTxn({ type: 'expense', amountMinor: 10000, currency: 'MYR', accountId: 'a3', category: '餐饮' }, accounts, fx);
eq('build cross card', b2.isCardTxn, true);
eq('build cross settleCur', b2.settleCurrency, 'CNY');
// 10000 sen * 1.65 = 16500 fen
eq('build cross settleMinor', b2.settleAmountMinor, 16500);
eq('build cross not posted', b2.isPosted, false);
eq('build cross fxSource', b2.fxSource, 'system');

const b3 = buildQuickAddTxn({ type: 'repayment', amountMinor: 50000, currency: 'CNY', accountId: 'a3' }, accounts, fx);
eq('repay isRepaid', b3.isRepaid, true);
eq('repay card', b3.isCardTxn, true);
eq('repay not in stats', b3.countInStats, false);
eq('repay settleCur', b3.settleCurrency, 'CNY');
eq('repay settleMinor', b3.settleAmountMinor, 50000);

const b4 = buildQuickAddTxn({ type: 'income', amountMinor: 800000, currency: 'CNY' }, accounts, fx);
eq('income type', b4.type, 'income');
eq('income settleCur', b4.settleCurrency, 'CNY');

console.log(`quickadd tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
