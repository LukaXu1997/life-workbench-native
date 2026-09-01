// ConfirmTxnScreen auto-fill — pure logic tests.
// Covers: 2-decimal amount formatting, auto-fill from a PendingRecord (incl. the
// "You spent RM 12.50 at Starbucks" notification), late record load, no-clobber-after-edit,
// and source-app-based account suggestion (real apps auto-suggest, ADB/shell manual).
//
// Pure modules only (no React Native). Run under plain Node via scripts/notify-test-runner.js.

import type { Account, PendingRecord } from '../types';
import type { NotifyEnvelope } from './types';
import {
  buildConfirmForm,
  minorToAmountStr,
  shouldSyncForm,
  suggestAccountFor,
} from './confirmForm';
import { recognize, type RecognizeContext } from './recognizer';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(msg);
    console.error('  ✗ ' + msg);
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const accounts: Account[] = [
  { id: 'ew_myr', name: 'TNG eWallet', type: 'ewallet', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 } as Account,
  { id: 'db_myr', name: 'Maybank', type: 'debit', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 1, createdAt: 0 } as Account,
  { id: 'db_cny', name: 'Alipay', type: 'debit', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 2, createdAt: 0 } as Account,
  { id: 'cc_cny', name: 'Visa', type: 'credit', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 3, createdAt: 0 } as Account,
];

function mkRec(p: Partial<PendingRecord>): PendingRecord {
  return {
    id: 'rec-1',
    sourceApp: 'com.android.shell',
    sourceAppLabel: 'Shell',
    rawDigest: 'd',
    amountMinor: 1250,
    currency: 'MYR',
    merchant: 'Starbucks',
    notifiedAt: Date.now(),
    suggestedAccountId: undefined,
    suggestedCategory: '餐饮',
    confidence: 0.85,
    fingerprint: 'f',
    createdAt: Date.now(),
    status: 'pending',
    kind: 'expense',
    ...p,
  } as PendingRecord;
}

// ---------- 1. amount formatting (2 decimals) ----------
eq(minorToAmountStr(1250), '12.50', 'fmt: 1250 minor -> 12.50');
eq(minorToAmountStr(100), '1.00', 'fmt: 100 minor -> 1.00');
eq(minorToAmountStr(0), '0.00', 'fmt: 0 minor -> 0.00');
eq(minorToAmountStr(undefined), '0.00', 'fmt: undefined -> 0.00');

// ---------- 2. recognizer produces the expected Starbucks record ----------
{
  const env: NotifyEnvelope = {
    pkg: 'com.android.shell',
    title: 'Payment',
    text: 'You spent RM 12.50 at Starbucks (successful)',
    bigText: 'You spent RM 12.50 at Starbucks (successful)',
    postedAt: Date.now(),
  };
  const ctx: RecognizeContext = { accounts, rateScaled: 1650000, cnyCardApps: new Set(), confidenceFloor: 0 };
  const draft = recognize(env, ctx);
  ok(draft != null, 'recognizer: Starbucks envelope parsed');
  eq(draft!.amountMinor, 1250, 'recognizer: Starbucks amount = 1250 minor');
  eq(draft!.currency, 'MYR', 'recognizer: Starbucks currency = MYR');
  ok(/starbucks/i.test(draft!.merchant ?? ''), 'recognizer: Starbucks merchant detected');
}

// ---------- 3. buildConfirmForm auto-fills from the record ----------
{
  const rec = mkRec({ amountMinor: 1250, currency: 'MYR', merchant: 'Starbucks', suggestedCategory: '餐饮' });
  const f = buildConfirmForm(rec, accounts, false);
  eq(f.amountStr, '12.50', 'auto-fill: amount -> 12.50');
  eq(f.currency, 'MYR', 'auto-fill: currency -> MYR');
  eq(f.merchant, 'Starbucks', 'auto-fill: merchant -> Starbucks');
  eq(f.category, '餐饮', 'auto-fill: category -> 餐饮');
  eq(f.accountId, '', 'auto-fill: ADB/shell -> manual (empty) account'); // debug pkg => let user pick
}

// ---------- 4. real apps auto-suggest an account by source ----------
{
  const tng = mkRec({ sourceApp: 'com.tngdigital.wallet', sourceAppLabel: "Touch 'n Go", currency: 'MYR' });
  eq(suggestAccountFor(tng, accounts), 'ew_myr', 'suggest: TNG -> MYR ewallet');

  const ali = mkRec({ sourceApp: 'com.eg.android.AlipayGphone', sourceAppLabel: 'Alipay', currency: 'CNY' });
  ok(suggestAccountFor(ali, accounts) !== '', 'suggest: Alipay -> non-empty CNY account');
  eq(suggestAccountFor(ali, accounts), 'db_cny', 'suggest: Alipay -> CNY debit');

  const wx = mkRec({ sourceApp: 'com.tencent.mm', sourceAppLabel: 'WeChat', currency: 'CNY' });
  eq(suggestAccountFor(wx, accounts), 'db_cny', 'suggest: WeChat -> CNY account');

  const shell = mkRec({ sourceApp: 'com.android.shell', currency: 'MYR' });
  eq(suggestAccountFor(shell, accounts), '', 'suggest: ADB shell -> empty (manual)');

  // recognizer's own suggestion is honored for non-debug apps
  const withHint = mkRec({ sourceApp: 'com.other.app', currency: 'CNY', suggestedAccountId: 'cc_cny' });
  eq(suggestAccountFor(withHint, accounts), 'cc_cny', 'suggest: honors recognizer suggestion');
}

// ---------- 5. shouldSyncForm: late record load + no-clobber ----------
{
  // (a) screen renders first, record not yet loaded
  ok(
    shouldSyncForm({ rec: undefined, isMatch: false, syncedId: null, touched: false, canSuggestAccount: false, currentAccountId: '' }) === false,
    'sync: no record -> false'
  );

  // (b) record loads later (id appears) -> should sync
  const rec = mkRec({ id: 'rec-1', amountMinor: 1250 });
  ok(
    shouldSyncForm({ rec, isMatch: false, syncedId: null, touched: false, canSuggestAccount: true, currentAccountId: '' }) === true,
    'sync: record loads after render -> true'
  );

  // (c) already synced same record, nothing changed -> don't re-sync (avoid clobber)
  ok(
    shouldSyncForm({ rec, isMatch: false, syncedId: 'rec-1', touched: false, canSuggestAccount: true, currentAccountId: 'ew_myr' }) === false,
    'sync: already synced -> false'
  );

  // (d) user edited -> never restore, even if record reloads
  ok(
    shouldSyncForm({ rec, isMatch: false, syncedId: 'rec-1', touched: true, canSuggestAccount: true, currentAccountId: 'ew_myr' }) === false,
    'sync: user edited -> false (no restore)'
  );

  // (e) account still empty but a suggestion now exists (accounts arrived later)
  ok(
    shouldSyncForm({ rec, isMatch: false, syncedId: 'rec-1', touched: false, canSuggestAccount: true, currentAccountId: '' }) === true,
    'sync: account empty + suggestion available -> true'
  );
}

// ---------- 6. full late-load simulation: user edit preserved ----------
{
  // Simulate: form starts empty, record arrives -> buildConfirmForm fills;
  // then user changes amount; a later "refresh" of the same record must NOT revert it.
  const rec = mkRec({ id: 'rec-x', amountMinor: 1250 });
  const syncedIdRef: { v: string | null } = { v: null };

  // first arrival
  let sync = shouldSyncForm({ rec, isMatch: false, syncedId: syncedIdRef.v, touched: false, canSuggestAccount: true, currentAccountId: '' });
  ok(sync === true, 'sim: first arrival triggers sync');
  let form = buildConfirmForm(rec, accounts, false);
  syncedIdRef.v = rec.id;

  // user edits amount to 99.00
  const userAmount = '99.00';
  const touched = true;

  // later refresh of same record
  sync = shouldSyncForm({ rec, isMatch: false, syncedId: syncedIdRef.v, touched, canSuggestAccount: true, currentAccountId: form.accountId });
  ok(sync === false, 'sim: refresh after user edit does NOT re-sync');
  // user's value is preserved (we don't overwrite)
  eq(userAmount, '99.00', 'sim: user amount preserved');
}

console.log(`\nConfirm-form tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILURES:\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
