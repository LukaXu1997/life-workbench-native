// Phase 6 tests — pure orchestration / privacy / stability layer.
// Covers: ingestEnvelope (the envelope -> PendingRecord pipeline, incl. dup / no-amount
// skips and CNY-posted -> MYR-pending posting-match linking) and redact (the privacy
// guarantees: never persist raw text, mask 6+ digit runs, deterministic digests) plus
// fingerprint stability across re-recognize.
//
// Pure modules only (no React Native). Run under plain Node via scripts/notify-test-runner.js.

import type { Account, PendingRecord } from '../types';
import type { NotifyEnvelope } from './types';
import { ingestEnvelope, labelForApp } from './ingest';
import { recognize, type RecognizeContext } from './recognizer';
import { CNY_CARD_APPS } from './parsers';
import { fingerprintOf } from './dedup';
import { redactForLog, maskedPreview, safeDigest } from './redact';

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

const accounts = [
  { id: 'ew_myr', type: 'ewallet', currency: 'MYR', name: 'TnG', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: 0 },
  { id: 'cc_cny', type: 'credit', currency: 'CNY', name: 'RMB Card', creditLimitMinor: 100000, includeInNetWorth: true, showOnHome: true, order: 1, createdAt: 0 },
] as Account[];

const RATE = Math.round(1.68 * 1e6); // cnyPerMyr = 1.68
const ctx: RecognizeContext = { accounts, rateScaled: RATE, cnyCardApps: CNY_CARD_APPS, confidenceFloor: 0.5 };

const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

const envTnG = (txt: string): NotifyEnvelope => ({
  pkg: 'my.com.tngdigital.ewallet',
  title: 'Touch n Go',
  text: txt,
  bigText: '',
  postedAt: now,
});
const envWeChatPosted = (txt: string, at = now + dayMs): NotifyEnvelope => ({
  pkg: 'com.tencent.mm',
  title: 'WeChat',
  text: txt,
  bigText: '',
  postedAt: at,
});

// ---- 1. ingest: happy path (MYR e-wallet expense) ----
{
  const res = ingestEnvelope(envTnG('Payment of RM12.50 at Starbucks successful'), ctx, []);
  ok(res.record !== undefined, 'ingest: produces a record');
  ok(res.skip === undefined, 'ingest: no skip on happy path');
  const r = res.record!;
  eq(r.currency, 'MYR', 'ingest: currency');
  eq(r.amountMinor, 1250, 'ingest: amountMinor');
  eq(r.merchant, 'Starbucks', 'ingest: merchant');
  eq(r.sourceApp, 'my.com.tngdigital.ewallet', 'ingest: sourceApp');
  eq(r.sourceAppLabel, 'Touch \'n Go', 'ingest: sourceAppLabel');
  eq(r.status, 'pending', 'ingest: status pending');
  ok(typeof r.rawDigest === 'string' && r.rawDigest.length > 0, 'ingest: rawDigest set (one-way)');
  ok(typeof r.fingerprint === 'string' && r.fingerprint.length > 0, 'ingest: fingerprint set');
  ok(r.previewMasked != null && r.previewMasked.startsWith('merchant='), 'ingest: previewMasked is masked token form');
}

// ---- 2. ingest: dup skip ----
{
  const first = ingestEnvelope(envTnG('Payment of RM12.50 at Starbucks successful'), ctx, [])!.record!;
  const second = ingestEnvelope(envTnG('Payment of RM12.50 at Starbucks successful'), ctx, [first]);
  eq(second.skip, 'dup', 'ingest: identical envelope is skipped as dup');
  ok(second.record === undefined, 'ingest: dup yields no new record');
}

// ---- 3. ingest: no-amount skip ----
{
  const res = ingestEnvelope(envTnG('Your bill is ready'), ctx, []);
  eq(res.skip, 'no-amount', 'ingest: envelope without amount is skipped');
}

// ---- 4. ingest: CNY posted notification links to awaiting MYR pending (matched) ----
{
  const awaiting: PendingRecord = {
    id: 'p1',
    status: 'pending',
    postingStatus: 'awaiting_posting',
    suggestedAccountId: 'cc_cny',
    merchant: 'UNIQLO',
    predictedSettleMinor: 16800, // MYR 100 * 1.68 estimate from the original MYR notification
    notifiedAt: now,
    rawDigest: 'x',
    sourceApp: 'com.tencent.mm',
    fingerprint: 'f',
    amountMinor: 10000,
    currency: 'MYR',
    createdAt: 0,
    kind: 'expense',
  } as PendingRecord;
  const res = ingestEnvelope(envWeChatPosted('支付 ¥168.00 UNIQLO'), ctx, [awaiting]);
  ok(res.record !== undefined, 'ingest: CNY posted produces a record');
  eq(res.record!.status, 'matched', 'ingest: linked record status=matched');
  eq(res.record!.matchOfId, 'p1', 'ingest: matchOfId points at original awaiting pending');
  // predicted settle should be inherited from the original awaiting pending
  eq(res.record!.predictedSettleMinor, 16800, 'ingest: predictedSettleMinor inherited (100 MYR *1.68)');
}

// ---- 5. redact: masks long digit runs but keeps short numbers / amounts ----
{
  eq(redactForLog('1234567890'), '12****90', 'redact: 10-digit run masked');
  eq(redactForLog(''), '', 'redact: empty stays empty');
  eq(redactForLog('RM12.50'), 'RM12.50', 'redact: short amount untouched');
  eq(redactForLog('card 123456 end'), 'card 12****56 end', 'redact: masked mid-string');
}

// ---- 6. maskedPreview + safeDigest ----
{
  eq(maskedPreview('星巴克', 'RM 25.50'), 'merchant=星巴克 amount=RM 25.50', 'redact: maskedPreview token form');
  eq(safeDigest('a', 'b'), safeDigest('a', 'b'), 'redact: safeDigest deterministic');
  ok(safeDigest('a', 'b') !== safeDigest('a', 'c'), 'redact: safeDigest differs on different text');
}

// ---- 7. fingerprint stability across re-recognize ----
{
  const e = envTnG('Payment of RM12.50 at Starbucks successful');
  const f1 = fingerprintOf(recognize(e, ctx)!);
  const f2 = fingerprintOf(recognize(e, ctx)!);
  ok(f1 === f2 && f1.length > 0, 'fp: identical envelope yields identical fingerprint on re-recognize');
}

// ---- 8. labelForApp fallback ----
eq(labelForApp('my.com.tngdigital.ewallet'), 'Touch \'n Go', 'label: known app');
eq(labelForApp('com.some.unknown'), 'com.some.unknown', 'label: unknown falls back to pkg');

console.log(`\nPhase 6 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILURES:\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
