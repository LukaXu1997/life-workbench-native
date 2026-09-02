#!/usr/bin/env node
/**
 * Device-free acceptance check for the TnG real-time capture feature (V2.14.0).
 *
 * The native TxnCaptureService (accessibility) and OcrCapture (shared screenshot) both
 * emit a NotifyEnvelope with the SAME shape the notification pipeline consumes. This
 * script transpiles the real, RN-free recognizer/ingest modules and feeds two injected
 * envelopes (accessibility + ocr) plus negatives through ingestEnvelope to prove the
 * capture -> 待确认 record path works end to end without a device.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmptest_tng');
const TS = require(path.join(ROOT, 'node_modules', 'typescript'));

const FILES = [
  ['src/money.ts', 'money.js'],
  ['src/types.ts', 'types.js'],
  ['src/notify/uid.ts', 'notify/uid.js'],
  ['src/notify/parsers.ts', 'notify/parsers.js'],
  ['src/notify/recognizer.ts', 'notify/recognizer.js'],
  ['src/notify/dedup.ts', 'notify/dedup.js'],
  ['src/notify/redact.ts', 'notify/redact.js'],
  ['src/notify/ingest.ts', 'notify/ingest.js'],
];
for (const [s, o] of FILES) {
  const src = fs.readFileSync(path.join(ROOT, s), 'utf8');
  const { outputText } = TS.transpileModule(src, {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true, jsx: 0 },
    fileName: path.basename(s),
    reportDiagnostics: false,
  });
  const outAbs = path.join(OUT, o);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, outputText);
}

const { ingestEnvelope } = require(path.join(OUT, 'notify', 'ingest.js'));
const { CNY_CARD_APPS } = require(path.join(OUT, 'notify', 'parsers.js'));

function ctx() {
  return { accounts: [], rateScaled: 1700000, cnyCardApps: CNY_CARD_APPS, confidenceFloor: 0.4 };
}

let pass = 0;
let fail = 0;
function check(label, env, expectRecord) {
  const res = ingestEnvelope(env, ctx(), []);
  const got = res.record ? `amountMinor=${res.record.amountMinor} currency=${res.record.currency} kind=${res.record.kind} merchant=${JSON.stringify(res.record.merchant)} conf=${res.record.confidence}` : `SKIP ${res.skip}`;
  const ok = !!res.record === expectRecord;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${label}] -> ${got}`);
  ok ? pass++ : fail++;
}

const now = Date.now();
// 1) Accessibility envelope — TnG success screen (exact shape emitted by TxnCaptureService)
check('accessibility-TnG', {
  pkg: 'com.tngdigital.wallet', title: '', text: "Transaksi Berjaya\nRM 12.50\nTouch 'n Go",
  bigText: "Transaksi Berjaya\nRM 12.50", postedAt: now, source: 'accessibility',
}, true);
// 2) OCR envelope — shared screenshot, empty pkg (exact shape emitted by OcrCapture)
check('ocr-screenshot', {
  pkg: '', title: '', text: 'Payment Successful\nRM 8.00\nTouch n Go eWallet',
  bigText: 'Payment Successful\nRM 8.00', postedAt: now, source: 'ocr',
}, true);
// 3) Negative — no amount (should be skipped, never becomes a record)
check('no-amount', {
  pkg: 'com.tngdigital.wallet', title: '', text: 'Transaksi Berjaya', bigText: 'Transaksi Berjaya',
  postedAt: now, source: 'accessibility',
}, false);
// 4) Pinduoduo accessibility envelope — ¥ + 支付成功 (CNY capture, V2.14.5)
check('accessibility-Pinduoduo-CNY', {
  pkg: 'com.xunmeng.pinduoduo', title: '', text: '订单支付成功\n¥ 12.50\n拼多多',
  bigText: '订单支付成功\n¥ 12.50', postedAt: now, source: 'accessibility',
}, true);
// 5) Pinduoduo OCR envelope — 元 suffix variant
check('ocr-Pinduoduo-yuan', {
  pkg: '', title: '', text: '支付成功\n12.50元\n拼多多支付',
  bigText: '支付成功\n12.50元', postedAt: now, source: 'ocr',
}, true);
// 6) Architecture note: the success-keyword gate is enforced NATIVELY in
//    TxnCaptureService (if (!hasSuccess) return), NOT in the JS recognizer. So a
//    ¥-only cart/home screen still yields a record at the JS layer — it is dropped
//    by the native service before reaching here. We assert the JS layer still
//    recognises the CNY amount correctly (native drop is covered by the dex/deploy check).
check('pinduoduo-js-amount-only', {
  pkg: 'com.xunmeng.pinduoduo', title: '', text: '¥ 99.00\n限时秒杀\n拼多多商城',
  bigText: '¥ 99.00', postedAt: now, source: 'accessibility',
}, true);

console.log(`\n==== TNG/PINDUODUO CAPTURE SMOKE: ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed) ====`);
process.exit(fail === 0 ? 0 : 1);
