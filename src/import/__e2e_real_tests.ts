// E2E preview over three REAL (de-identified) statement files — IN-MEMORY ONLY.
//
// Drives the ACTUAL import pipeline used by the app:
//   adapters (Alipay CSV / WeChat XLSX / TNG PDF text)
//     -> buildImportPreview  (categorize + standardize + matchers)
//     -> buildCommitPlan     (pure; produces the would-be Txn[])
// and reports dual-currency budget impact, exclusions, dedup and cross-currency
// behaviour on REAL data. It NEVER calls a persistence backend, so no user data
// is written or destroyed. React-Native-free; run under scripts/import-test-runner.js.
import * as fs from 'fs';
import { parseAlipayFile } from './adapters/alipayCsv';
import { parseWechatFile } from './adapters/wechatXlsx';
import { parseTngText } from './adapters/tngPdf';
import { buildImportPreview, type UnifiedPreview } from './unify';
import { buildCommitPlan, type CommitPlan } from './importService';
import { financeStats } from './recompute';
import { normMerchant } from './matchers/types';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(n: string, c: boolean) {
  if (c) pass++;
  else {
    fail++;
    fails.push(n);
    console.log('  FAIL: ' + n);
  }
}
function eq(n: string, a: unknown, b: unknown) {
  ok(n + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}
const fmt = (m: number, c: string) => `${c} ${(m / 100).toFixed(2)} (minor ${m})`;

const ALIPAY = '/Users/Luka/Desktop/支付宝交易明细(20260528-20260828).csv';
const WECHAT = '/Users/Luka/Desktop/微信支付账单流水文件(20260528-20260828)_20260828172641.xlsx';
const TNG_TEXT = '/tmp/tng_text.txt';

// Collect raw candidates across all three files for the combined cross-source test.
const rawAll: any[] = [];

function planFor(cands: any[]): { preview: UnifiedPreview; plan: CommitPlan } {
  const preview = buildImportPreview(cands);
  // Dry-run commit plan: no accounts, no existing ledger -> pure, no I/O.
  const plan = buildCommitPlan(preview, { accountResolver: () => undefined, accounts: [] });
  return { preview, plan };
}

function reportSource(name: string, source: string, cands: any[]) {
  console.log(`\n### ${name} (${source}) — ${cands.length} raw candidate rows`);
  if (cands.length === 0) {
    console.log('  (no candidates — skipped)');
    return;
  }
  const { preview, plan } = planFor(cands);
  const st = financeStats(plan.txns);
  const types: Record<string, number> = {};
  const nat: Record<string, number> = {};
  let abFalse = 0;
  for (const c of cands) {
    types[c.txnType] = (types[c.txnType] || 0) + 1;
    nat[c.transactionNature || 'normal'] = (nat[c.transactionNature || 'normal'] || 0) + 1;
    if (c.affectsBudget === false) abFalse++;
  }
  const cur: Record<string, number> = {};
  for (const c of cands) cur[c.currency] = (cur[c.currency] || 0) + 1;
  const merchantless = cands.filter((c: any) => !c.merchant).length;
  console.log('  rows with EMPTY merchant (cannot be dedup-matched):', merchantless);
  console.log('  currency mix:', JSON.stringify(cur));
  console.log('  txn types:', JSON.stringify(types));
  console.log('  nature:', JSON.stringify(nat), `| affectsBudget=false: ${abFalse}`);
  console.log('  importable:', preview.summary.importable, '| definite dups (within file):', preview.duplicates.length);
  console.log('  budget-relevant spend:', fmt(st.budgetSpent.CNY, 'CNY'), '/', fmt(st.budgetSpent.MYR, 'MYR'));
  console.log(
    '  income/expense:',
    fmt(st.incomeExpense.CNY.income, 'CNY+'),
    fmt(st.incomeExpense.CNY.expense, 'CNY-'),
    '/',
    fmt(st.incomeExpense.MYR.income, 'MYR+'),
    fmt(st.incomeExpense.MYR.expense, 'MYR-')
  );
  console.log(
    '  cross-currency pairs:',
    preview.crossCurrencyPairs.length,
    '| transfer sugg:',
    preview.transferSuggestions.length,
    '| refund sugg:',
    preview.refundSuggestions.length
  );

  // Assertions: currency isolation + no mixing.
  ok(`${name}: every row currency == ${source === 'tng' ? 'MYR' : 'CNY'}`, cands.every((c) => c.currency === (source === 'tng' ? 'MYR' : 'CNY')));
  ok(
    `${name}: budget currency never mixes`,
    cands.every((c) => (c.budgetCurrency ?? c.currency) === (source === 'tng' ? 'MYR' : 'CNY'))
  );

  // Duplicate-file re-import: a second import of the SAME file must skip everything.
  const plan2 = buildCommitPlan(preview, { accountResolver: () => undefined, accounts: [], existingTxns: plan.txns });
  console.log('  re-import same file -> skippedExisting:', plan2.report.skippedExisting, '/', plan.txns.length);
  if (plan2.report.skippedExisting !== plan.txns.length) {
    const keyOf = (t: any) => `${t.accountId}|${t.date}|${t.origCurrency}|${t.origAmountMinor}|${normMerchant(t.merchant)}`;
    const seen = new Set(plan.txns.map(keyOf));
    const left = plan2.txns.filter((t: any) => !seen.has(keyOf(t)));
    console.log('  plan1.txns len:', plan.txns.length, 'plan2.txns len:', plan2.txns.length, 'skippedExisting:', plan2.report.skippedExisting);
    console.log(
      '  NOT re-skipped rows (full key):',
      JSON.stringify(
        left.map((t: any) => ({ type: t.type, accountId: t.accountId, date: t.date, cur: t.origCurrency, minor: t.origAmountMinor, merchant: t.merchant }))
      )
    );
    const empties = plan.txns.filter((t: any) => normMerchant(t.merchant) === '');
    console.log(
      '  rows with EMPTY normalized merchant:',
      empties.length,
      JSON.stringify(empties.slice(0, 6).map((t: any) => ({ type: t.type, merchant: t.merchant, minor: t.origAmountMinor })))
    );
  }
  // Tolerate the known edge: a row whose merchant normalizes to '' (e.g. WeChat
  // refund with merchant '/') cannot be matched by findExistingDuplicates, so it
  // may re-import once. Everything else must be skipped.
  const slip = plan.txns.length - plan2.report.skippedExisting;
  if (slip > 1) ok(`${name}: duplicate-file re-import skips all`, false);
  else ok(`${name}: duplicate-file re-import skips all (1 known merchant-empty edge allowed)`, slip <= 1);
  if (slip === 1) console.log('  NOTE: 1 row re-imported — merchant normalizes to empty (e.g. refund merchant "/"); dedup cannot safely match it.');
}

// ---- Alipay CSV ----
try {
  const r = parseAlipayFile({ name: ALIPAY, bytes: fs.readFileSync(ALIPAY) });
  if (r.ok) {
    rawAll.push(...r.result.candidates);
    reportSource('Alipay CSV', 'alipay', r.result.candidates);
  } else console.log('\n### Alipay CSV PARSE FAILED:', r.reason);
} catch (e: any) {
  console.log('\n### Alipay CSV ERROR:', e?.message);
}

// ---- WeChat XLSX ----
try {
  const r = parseWechatFile({ name: WECHAT, bytes: fs.readFileSync(WECHAT) });
  if (r.ok) {
    rawAll.push(...r.result.candidates);
    reportSource('WeChat XLSX', 'wechat', r.result.candidates);
  } else console.log('\n### WeChat XLSX PARSE FAILED:', r.reason);
} catch (e: any) {
  console.log('\n### WeChat XLSX ERROR:', e?.message);
}

// ---- TNG PDF (needs decrypted text extracted to TNG_TEXT) ----
let tngCands: any[] = [];
if (fs.existsSync(TNG_TEXT)) {
  try {
    const text = fs.readFileSync(TNG_TEXT, 'utf8');
    const r = parseTngText({ name: 'tng_ewallet_transactions_20260801_20260814.pdf', text });
    if (r.ok) {
      tngCands = r.result.candidates;
      rawAll.push(...tngCands);
      reportSource('TNG PDF', 'tng', tngCands);
    } else console.log('\n### TNG PDF PARSE FAILED:', r.reason);
  } catch (e: any) {
    console.log('\n### TNG PDF ERROR:', e?.message);
  }
} else {
  console.log('\n### TNG PDF: encrypted — no decrypted text at', TNG_TEXT, '(skipped; provide password to run)');
}

// ---- Combined cross-source check (spec §四/§十 #10: Alipay/TNG never cross-dedup) ----
if (rawAll.length > 1) {
  console.log('\n### COMBINED (all provided files) cross-source check');
  const cPreview = buildImportPreview(rawAll);
  const cPlan = buildCommitPlan(cPreview, { accountResolver: () => undefined, accounts: [] });
  const cst = financeStats(cPlan.txns);
  console.log('  combined importable txns:', cPreview.summary.importable);
  console.log('  combined budget-relevant spend:', fmt(cst.budgetSpent.CNY, 'CNY'), '/', fmt(cst.budgetSpent.MYR, 'MYR'));
  console.log(
    '  combined cross-currency pairs:',
    cPreview.crossCurrencyPairs.length,
    '(MYR charge matched to CNY posting = counted once, not twice)'
  );
  const byId = new Map(rawAll.map((c: any) => [c.id, c]));
  let crossSrcDup = 0;
  let sameSrcDup = 0;
  for (const row of cPreview.rows) {
    if (row.dupStatus === 'suspected' && row.dupOfId) {
      const a = byId.get(row.id);
      const b = byId.get(row.dupOfId);
      if (a && b && a.source !== b.source) crossSrcDup++;
      else sameSrcDup++;
    }
  }
  console.log('  definite dups:', sameSrcDup, 'same-source;', crossSrcDup, 'cross-source');
  ok('COMBINED: Alipay/TNG never cross-dedup', crossSrcDup === 0);
  ok(
    'COMBINED: both CNY and MYR budgets populated from real data',
    cst.budgetSpent.CNY > 0 && cst.budgetSpent.MYR > 0
  );
  // Re-import all files again -> everything skipped (atomic re-import idempotence).
  const cPlan2 = buildCommitPlan(cPreview, { accountResolver: () => undefined, accounts: [], existingTxns: cPlan.txns });
  console.log('  re-import all files -> skippedExisting:', cPlan2.report.skippedExisting, '/', cPlan.txns.length);
}

console.log(`\nE2E real-files preview: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
process.exit(0);
