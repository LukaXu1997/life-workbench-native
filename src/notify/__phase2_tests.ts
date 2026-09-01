// Phase 2 tests: parsers, recognizer (incl. cross-currency), dedup/matching.
import type { Account } from '../types';
import type { NotifyEnvelope } from './types';
import { parseEnvelope, CNY_CARD_APPS } from './parsers';
import { recognize } from './recognizer';
import { rawDigestOf, fingerprintOf, findPostingMatch, hasDigest } from './dedup';

const accounts = [
  { id: 'ew_myr', type: 'ewallet', currency: 'MYR', name: 'TnG', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 },
  { id: 'db_myr', type: 'debit', currency: 'MYR', name: 'Maybank', includeInNetWorth: true, showOnHome: true, order: 1, createdAt: 0 },
  { id: 'cc_cny', type: 'credit', currency: 'CNY', name: 'RMB Card', creditLimitMinor: 100000, includeInNetWorth: true, showOnHome: true, order: 2, createdAt: 0 },
  { id: 'db_cny', type: 'debit', currency: 'CNY', name: 'CNY Bank', includeInNetWorth: true, showOnHome: true, order: 3, createdAt: 0 },
] as Account[];

const RATE = Math.round(1.68 * 1e6); // cnyPerMyr = 1.68
const ctx = { accounts, rateScaled: RATE, cnyCardApps: CNY_CARD_APPS, confidenceFloor: 0.5 };

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(`${name} (${JSON.stringify(a)} == ${JSON.stringify(b)})`, a === b);
}

const now = Date.now();

// ---------- parsers ----------
const tng = parseEnvelope({ pkg: 'com.tngdigital.wallet', title: 'Touch n Go', text: 'Payment of RM12.50 at Starbucks successful', bigText: '', postedAt: now })!;
eq('TnG amount', tng.amountMinor, 1250);
eq('TnG currency', tng.currency, 'MYR');
eq('TnG merchant', tng.merchant, 'Starbucks');
eq('TnG kind', tng.kind, 'expense');
eq('TnG hint', tng.accountHint, 'myr_ewallet');

const may = parseEnvelope({ pkg: 'com.maybank.mobile', title: 'Maybank', text: "You've spent RM55.00 at Tesco on card 1234", bigText: '', postedAt: now })!;
eq('Maybank merchant', may.merchant, 'Tesco');
eq('Maybank hint', may.accountHint, 'myr_bank');

const ali = parseEnvelope({ pkg: 'com.eg.android.AlipayGphone', title: '支付宝', text: '支出 ¥168.00', bigText: '星巴克', postedAt: now })!;
eq('Alipay amount', ali.amountMinor, 16800);
eq('Alipay currency', ali.currency, 'CNY');
eq('Alipay merchant', ali.merchant, '星巴克');

const wx = parseEnvelope({ pkg: 'com.tencent.mm', title: '微信支付', text: '支付 ¥20.00 麦当劳', bigText: '', postedAt: now })!;
eq('WeChat merchant', wx.merchant, '麦当劳');
eq('WeChat currency', wx.currency, 'CNY');

// ---------- recognizer: MYR e-wallet ----------
const r1 = recognize({ pkg: 'com.tngdigital.wallet', title: 'Touch n Go', text: 'Payment of RM12.50 at Starbucks successful', bigText: '', postedAt: now }, ctx)!;
eq('rec TnG account', r1.suggestedAccountId, 'ew_myr');
eq('rec TnG category', r1.suggestedCategory, '餐饮');
ok('rec TnG no predicted (same currency)', r1.predictedSettleMinor === undefined);
ok('rec TnG posting null', r1.postingStatus === null);

// ---------- recognizer: CNY (Alipay) -> RMB credit, posted ----------
const r2 = recognize({ pkg: 'com.eg.android.AlipayGphone', title: '支付宝', text: '支出 ¥168.00', bigText: '星巴克', postedAt: now }, ctx)!;
eq('rec Alipay account', r2.suggestedAccountId, 'cc_cny');
eq('rec Alipay posting', r2.postingStatus, 'posted');
eq('rec Alipay category', r2.suggestedCategory, '餐饮');

// ---------- recognizer: cross-currency (RMB card used in MY, MYR notification) ----------
const r3 = recognize({ pkg: 'com.tencent.mm', title: 'WeChat', text: 'You spent RM100.00 at UNIQLO', bigText: '', postedAt: now }, ctx)!;
eq('rec cross account', r3.suggestedAccountId, 'cc_cny');
eq('rec cross predicted CNY', r3.predictedSettleMinor, 16800); // 100 MYR * 1.68 = 168 CNY
eq('rec cross posting', r3.postingStatus, 'awaiting_posting');
eq('rec cross currency', r3.currency, 'MYR');

// ---------- recognizer: low confidence -> needsReview ----------
const r4 = recognize({ pkg: 'com.unknown.app', title: 'X', text: 'RM3.00', bigText: '', postedAt: now }, { ...ctx, confidenceFloor: 0.8 })!;
ok('rec low-confidence needsReview', r4.needsReview === true);

// ---------- dedup ----------
const envA = { pkg: 'com.tngdigital.wallet', title: 'Touch n Go', text: 'Payment of RM12.50 at Starbucks successful', bigText: '', postedAt: now };
const envA2 = { pkg: 'com.tngdigital.wallet', title: 'Touch n Go', text: 'Payment of RM12.50 at Starbucks successful', bigText: '', postedAt: now };
const envB = { pkg: 'com.tngdigital.wallet', title: 'Touch n Go', text: 'Payment of RM20.00 at Starbucks successful', bigText: '', postedAt: now };
eq('rawDigest deterministic', rawDigestOf(envA), rawDigestOf(envA2));
ok('rawDigest differs', rawDigestOf(envA) !== rawDigestOf(envB));

const d1 = recognize(envA, ctx)!;
eq('fingerprint deterministic', fingerprintOf(d1), fingerprintOf(recognize(envA, ctx)!));
ok('hasDigest true', hasDigest(rawDigestOf(envA), [{ rawDigest: rawDigestOf(envA) } as any]));
ok('hasDigest false', !hasDigest(rawDigestOf(envB), [{ rawDigest: rawDigestOf(envA) } as any]));

// posting match: CNY posted notification links to the awaiting MYR pending
const dayMs = 24 * 60 * 60 * 1000;
const origPending = { id: 'p1', status: 'pending' as const, postingStatus: 'awaiting_posting' as const, suggestedAccountId: 'cc_cny', merchant: 'UNIQLO', bankRef: undefined, notifiedAt: now };
const postedDraft = recognize({ pkg: 'com.tencent.mm', title: 'WeChat', text: '支付 ¥168.00 UNIQLO', bigText: '', postedAt: now + dayMs }, ctx)!;
eq('match unique', findPostingMatch(postedDraft, [origPending]), 'p1');

// ambiguous: two candidates
const c2 = { ...origPending, id: 'p2', notifiedAt: now + 2 * dayMs };
eq('match ambiguous', findPostingMatch(postedDraft, [origPending, c2]), 'ambiguous');

// none
eq('match none', findPostingMatch(postedDraft, [{ ...origPending, id: 'p3', suggestedAccountId: 'db_myr' }]), null);

// bankRef mismatch: both present but different -> null
const postedDraftRef = recognize({ pkg: 'com.tencent.mm', title: 'WeChat', text: '支付 ¥168.00 UNIQLO Ref AAA111', bigText: '', postedAt: now + dayMs }, ctx)!;
eq('match bankRef mismatch', findPostingMatch(postedDraftRef, [{ ...origPending, id: 'p4', bankRef: 'ZZZ999' }]), null);
// candidate has ref but posting has none -> still allowed to match
eq('match bankRef optional', findPostingMatch(postedDraft, [{ ...origPending, id: 'p5', bankRef: 'ZZZ999' }]), 'p5');

console.log(`\nPHASE2 RESULT pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
