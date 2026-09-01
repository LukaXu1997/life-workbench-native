// Phase 4 unit tests — TNG PDF text adapter, owner-profile obfuscation, and the
// encrypted-PDF password session/flow. React-Native-free; run via
// scripts/import-test-runner.js. No real account numbers or merchant names;
// samples are synthetic ("Sample Coffee Shop", etc.) and minted at runtime.
//
// PRIVACY: the owner TNG identifier is never a plaintext literal here. We only
// assert it decodes to the expected obfuscated value via base64 (atob), and we
// build owner-matching samples by calling the decode function at runtime.

import { parseTngText, isTngStatement } from './adapters/tngPdf';
import { getOwnerTngIdentifier, statementMentionsOwner } from './ownerProfile';
import { detectSource } from './sourceDetect';
import { PdfPasswordSession } from './pdfPassword';
import { runPdfExtractFlow } from './pdfExtractFlow';
import type { ExtractPdfResult } from '../native/PdfTextExtractor';

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

// De-identified TNG-style statement text (synthetic merchants/amounts).
const TNG_TEXT = [
  "Touch 'n Go eWallet Statement",
  'Period: 01/08/2026 - 31/08/2026',
  '',
  'Date        Details              Amount(RM)  Balance(RM)',
  '01/08/2026  Sample Coffee Shop   12.50       88.50',
  '02/08/2026  Top Up              50.00 CR     138.50',
  '03/08/2026  Sample Ride          8.30        130.20',
].join('\n');

// ---------------------------------------------------------- obfuscated owner id
console.log('--- ownerProfile (obfuscated) ---');
const OBF = 'MTczMTU4OTQw'; // base64 of the owner TNG identifier (NOT plaintext)
const ownerId = getOwnerTngIdentifier();
eq('owner id decodes to base64 plaintext', ownerId, (globalThis as any).atob(OBF));
ok('owner id is 9 digits', /^\d{9}$/.test(ownerId));
ok('owner id contains no latin letters', !/[A-Za-z]/.test(ownerId));
ok('statementMentionsOwner true when present', statementMentionsOwner('ref ' + ownerId + ' end'));
ok('statementMentionsOwner false otherwise', !statementMentionsOwner('no identifier here'));

// ------------------------------------------------------------- TNG detection
console.log('--- isTngStatement ---');
ok('detects TNG text', isTngStatement(TNG_TEXT));
ok('rejects unrelated text', !isTngStatement('Just some random notes about groceries.'));

// --------------------------------------------------------------- TNG parsing
console.log('--- parseTngText ---');
{
  const r = parseTngText({ name: 'tng.pdf', text: TNG_TEXT });
  ok('parsed ok', r.ok === true);
  if (r.ok) {
    const c = r.result.candidates;
    eq('candidate count', c.length, 3);
    eq('row0 date zero-padded', c[0].date, '2026-08-01');
    eq('row0 amountMinor (sen)', c[0].amountMinor, 1250);
    eq('row0 currency MYR', c[0].currency, 'MYR');
    eq('row0 type expense', c[0].txnType, 'expense');
    eq('row0 merchant', c[0].merchant, 'Sample Coffee Shop');
    eq('row0 accountHint TNG', c[0].accountHint, 'TNG');
    eq('row1 amount 50.00 -> 5000 sen', c[1].amountMinor, 5000);
    eq('row1 type transfer (Top Up = Reload -> 转账, not income)', c[1].txnType, 'transfer');
    eq('row1 not income/expense', c[1].affectsIncomeExpense, false);
    eq('row1 date', c[1].date, '2026-08-02');
    eq('row2 amount 8.30 -> 830 sen', c[2].amountMinor, 830);
    eq('row2 type expense', c[2].txnType, 'expense');
    ok('owner not mentioned -> unknown_account flag', c[0].warnings.includes('unknown_account'));
    ok('ownerMatched false for synthetic text', r.ownerMatched === false);
  }
}

// Empty / scanned PDF -> clear "no text" signal, no silent import.
console.log('--- scanned / empty PDF ---');
{
  const r = parseTngText({ name: 'scan.pdf', text: '' });
  ok('empty text -> not ok', r.ok === false);
  if (!r.ok) {
    ok('empty text -> scanned true', r.scanned === true);
    ok('empty text reason mentions 扫描/没有', /扫描|没有|暂不支持/.test(r.reason));
  }
}

// PRIVACY: the TNG adapter must never log merchant/description text.
console.log('--- no PII logging ---');
{
  const logs: string[] = [];
  const orig = console.log;
  (console as any).log = (...a: unknown[]) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  try {
    parseTngText({ name: 'tng.pdf', text: TNG_TEXT });
  } finally {
    (console as any).log = orig;
  }
  const leaked = logs.filter((l) => l.includes('Sample Coffee Shop') || l.includes('Sample Ride')).length;
  eq('no merchant text logged', leaked, 0);
}

// ----------------------------------------------------------- password session
console.log('--- PdfPasswordSession ---');
{
  const s = new PdfPasswordSession(3);
  eq('starts empty', s.get(), null);
  s.set('secret');
  eq('holds password in memory', s.get(), 'secret');
  s.registerAttempt(false);
  eq('failed attempt increments', s.attempts, 1);
  ok('not locked yet', s.locked === false);
  s.registerAttempt(true);
  eq('success resets attempts', s.attempts, 0);
  s.registerAttempt(false);
  s.registerAttempt(false);
  s.registerAttempt(false);
  ok('locked at maxAttempts', s.locked === true);
  s.clear();
  eq('clear wipes password', s.get(), null);
  eq('clear resets attempts', s.attempts, 0);
}

// ------------------------------------------------------- extract flow (pure)
console.log('--- runPdfExtractFlow ---');
function fakeExtract(behaviour: 'open' | 'encrypted' | 'wrong-then-open'): (uri: string, s: PdfPasswordSession) => Promise<ExtractPdfResult> {
  let calls = 0;
  return async () => {
    calls++;
    if (behaviour === 'open') return { text: 'PDF TEXT', encrypted: false, wrongPassword: false, scanned: false };
    if (behaviour === 'encrypted') return { text: '', encrypted: true, wrongPassword: true, scanned: false };
    // wrong-then-open: first call encrypted (wrong pw), second call opens
    const encrypted = calls < 2;
    return { text: encrypted ? '' : 'PDF TEXT', encrypted, wrongPassword: encrypted, scanned: false };
  };
}
async function flowTests() {
  {
    // 1) Already-open PDF, no password needed.
    const s = new PdfPasswordSession(5);
    const out = await runPdfExtractFlow({
      uri: 'x.pdf',
      session: s,
      extract: fakeExtract('open'),
      onNeedPassword: async () => 'never',
    });
    ok('open flow ok', out.ok === true);
    eq('open flow text', out.text, 'PDF TEXT');
    eq('session cleared after success', s.get(), null);
  }
  {
    // 2) Encrypted then correct password on 2nd try.
    const s = new PdfPasswordSession(5);
    let prompts = 0;
    const out = await runPdfExtractFlow({
      uri: 'x.pdf',
      session: s,
      extract: fakeExtract('wrong-then-open'),
      onNeedPassword: async () => {
        prompts++;
        return prompts === 1 ? 'bad' : 'good';
      },
    });
  ok('encrypted flow ok', out.ok === true);
  eq('encrypted flow got text', out.text, 'PDF TEXT');
  ok('prompted once (password supplied on 2nd extract)', prompts === 1);
  eq('session cleared after success', s.get(), null);
  }
  {
    // 3) User cancels the password prompt.
    const s = new PdfPasswordSession(5);
    const out = await runPdfExtractFlow({
      uri: 'x.pdf',
      session: s,
      extract: fakeExtract('encrypted'),
      onNeedPassword: async () => null,
    });
    ok('cancel -> cancelled', out.ok === false && out.cancelled === true);
    eq('session cleared after cancel', s.get(), null);
  }
  {
    // 4) Too many wrong attempts -> locked / cancelled.
    const s = new PdfPasswordSession(2);
    const out = await runPdfExtractFlow({
      uri: 'x.pdf',
      session: s,
      extract: fakeExtract('encrypted'),
      onNeedPassword: async () => 'x',
    });
    ok('lockout -> cancelled', out.ok === false && out.cancelled === true);
  }
}

// ----------------------------------------------------------- source detection
console.log('--- detectSource (pdf -> tng) ---');
{
  const d = detectSource({ kind: 'pdf', name: 'stmt.pdf' });
  eq('pdf routes to tng', d.source, 'tng');
  const d2 = detectSource({ kind: 'pdf', name: 'stmt.pdf', text: TNG_TEXT });
  eq('pdf+TNG text confidence', d2.confidence, 0.85);
}

// --------------------------------------------------------------- summary
async function main() {
  await flowTests();
  console.log(`\nPhase 4 tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error('Phase 4 tests threw:', e);
  process.exit(1);
});
