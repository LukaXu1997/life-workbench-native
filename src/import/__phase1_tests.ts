// Phase 1 unit tests — models, file/source detection, zod schemas, v1 migration.
// React-Native-free; run under plain Node via scripts/import-test-runner.js.
//
// All sample data below is DE-IDENTIFIED: merchants/notes are placeholders like
// "示例商户A" and amounts are synthetic. No real card / account numbers appear.

import { detectFileKind, extOf, probeFile, isSupportedKind } from './fileDetect';
import { detectSource, isAlipayCsv, isGenericCsv } from './sourceDetect';
import {
  validateLifeWorkbenchSnapshot,
  validateImportCandidate,
  validateImportBatch,
  validateImportTemplate,
} from './schemas';
import { buildImportBatch } from './models';
import type { ImportCandidate } from './models';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(name);
    console.log('  FAIL: ' + name);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}

const bytes = (arr: number[]) => Uint8Array.from(arr);
const strBytes = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));

// ---------------------------------------------------------------- fileDetect
console.log('--- fileDetect ---');
eq('pdf magic -> pdf', detectFileKind({ name: 'stmt.pdf', bytes: bytes([0x25, 0x50, 0x44, 0x46, 0x2d]) }), 'pdf');
eq('xlsx zip magic -> xlsx', detectFileKind({ name: 'w.xlsx', bytes: bytes([0x50, 0x4b, 0x03, 0x04, 0x00]) }), 'xlsx');
eq('.csv ext -> csv', detectFileKind({ name: 'a.CSV', bytes: strBytes('a,b,c\n1,2,3') }), 'csv');
eq('.json ext -> json', detectFileKind({ name: 'b.json', bytes: strBytes('[]') }), 'json');
eq('gzip -> unknown', detectFileKind({ name: 'x.gz', bytes: bytes([0x1f, 0x8b, 0x08]) }), 'unknown');
eq('random binary -> unknown', detectFileKind({ name: 'x.bin', bytes: bytes([0x00, 0x01, 0x02, 0x03, 0x04]) }), 'unknown');
eq('text { -> json', detectFileKind({ name: 'noext', bytes: strBytes('  \n  {"a":1}') }), 'json');
eq('text csv -> csv', detectFileKind({ name: 'noext', bytes: strBytes('a,b\n1,2') }), 'csv');
eq('extOf', extOf('path/to/账单.CSV'), 'csv');
ok('isSupportedKind(pdf)', isSupportedKind('pdf'));
ok('!isSupportedKind(unknown)', !isSupportedKind('unknown'));
{
  const r = probeFile({ name: 'big.bin', bytes: bytes(new Array(10).fill(0)), size: 999999999 });
  ok('oversize rejected', r.sizeOk === false);
  ok('oversize kind still detected', r.kind === 'unknown');
}

// -------------------------------------------------------------- sourceDetect
console.log('--- sourceDetect ---');
const ALIPAY_CSV = [
  '支付宝交易记录明细查询',
  '交易时间,交易分类,交易对方,商品说明,金额,收/支,收/付款方式,交易状态',
  '2026-01-05 12:30:00,餐饮,示例商户A,示例商品说明,12.50,支出,余额宝,交易成功',
  '2026-01-06 09:15:00,转账,示例用户B,示例转账,100.00,收入,银行卡,交易成功',
].join('\n');
ok('isAlipayCsv true', isAlipayCsv(ALIPAY_CSV));
ok('isAlipayCsv false for generic', !isAlipayCsv('日期,摘要,金额\n2026-01-01,示例,1.00'));
ok('isGenericCsv true', isGenericCsv('日期,摘要,金额\n2026-01-01,示例,1.00'));

{
  const d = detectSource({ kind: 'csv', name: 'alipay.csv', text: ALIPAY_CSV });
  eq('alipay csv -> alipay', d.source, 'alipay');
  ok('alipay confidence high', d.confidence >= 0.9);
}
{
  const d = detectSource({ kind: 'csv', name: 'g.csv', text: '日期,摘要,金额\n2026-01-01,示例,1.00' });
  eq('generic csv -> genericCsv', d.source, 'genericCsv');
}
{
  const d = detectSource({ kind: 'json', name: 'lw.json', text: JSON.stringify(makeLifeWorkbenchV2()) });
  eq('lifeWorkbench json -> lifeWorkbench', d.source, 'lifeWorkbench');
  eq('lifeWorkbench confidence', d.confidence, 1);
}
{
  const d = detectSource({ kind: 'xlsx', name: 'wx.xlsx' });
  eq('xlsx kind -> genericXlsx (phase1 default)', d.source, 'genericXlsx');
  ok('xlsx confidence low', d.confidence < 0.7);
}
{
  const d = detectSource({ kind: 'pdf', name: 'tng.pdf', encrypted: false });
  eq('pdf kind -> tng', d.source, 'tng');
}
{
  const d = detectSource({ kind: 'pdf', name: 'tng.pdf', encrypted: true });
  eq('encrypted pdf -> tng + encrypted flag', d.source, 'tng');
  ok('encrypted flag propagated', d.encrypted === true);
}

// --------------------------------------------------------------- schemas
console.log('--- schemas ---');
function makeCandidate(over: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    id: 'c1',
    source: 'genericCsv',
    sourceFile: 'stmt.csv',
    rowIndex: 0,
    txnType: 'expense',
    amountMinor: 1250,
    currency: 'MYR',
    date: '2026-01-05',
    warnings: [],
    ...over,
  };
}
{
  const r = validateImportCandidate(makeCandidate());
  ok('valid candidate passes', r.ok === true);
}
{
  const r = validateImportCandidate(makeCandidate({ currency: 'USD' as any }));
  ok('invalid currency rejected', r.ok === false);
  if (!r.ok) {
    console.log('    err: ' + r.error);
    ok('currency error has no received echo', !/received/i.test(r.error));
  }
}
{
  const r = validateImportCandidate(makeCandidate({ amountMinor: 12.5 as any }));
  ok('non-integer amountMinor rejected', r.ok === false);
}
{
  const r = validateImportCandidate(makeCandidate({ date: '2026/01/05' as any }));
  ok('bad date format rejected', r.ok === false);
}
{
  // PII safety: a description-heavy candidate with an invalid enum must not echo
  // the merchant/note into the error message.
  const r = validateImportCandidate(
    makeCandidate({ currency: 'XXX' as any, merchant: '示例商户机密A', note: '示例备注机密B' })
  );
  ok('PII not echoed on error', r.ok === false);
  if (!r.ok) {
    ok('error omits merchant', !r.error.includes('示例商户机密A'));
    ok('error omits note', !r.error.includes('示例备注机密B'));
  }
}

// ---- ImportTemplate
{
  const tpl = {
    id: 't1',
    name: '我的银行CSV',
    source: 'genericCsv' as const,
    fileKind: 'csv' as const,
    headerRowIndex: 0,
    mappings: [{ field: 'date' as const, sourceColumn: '日期' }],
    createdAt: 1700000000000,
  };
  const r = validateImportTemplate(tpl);
  ok('valid template passes', r.ok === true);
}
{
  const bad = { id: 't1', name: 'x', source: 'genericCsv', fileKind: 'csv', mappings: [{ field: 'bogus' as any, sourceColumn: 'x' }], createdAt: 1 };
  ok('template bad field rejected', validateImportTemplate(bad).ok === false);
}

// ---- ImportBatch (must stay PII-free; .strict rejects stray keys)
{
  const batch = buildImportBatch({
    id: 'b1',
    sources: ['genericCsv'],
    fileNames: ['stmt.csv'],
    txnIds: ['txn-1', 'txn-2'],
    counters: { totalRows: 3, importedRows: 2, skippedDuplicates: 1, bySource: { genericCsv: 2 }, totalMinor: 1250, currency: 'MYR', dateFrom: '2026-01-01', dateTo: '2026-01-05' },
  });
  const r = validateImportBatch(batch);
  ok('valid batch (no PII) passes', r.ok === true);
}
{
  // A batch that somehow carried a description must FAIL strict validation.
  const evil = {
    id: 'b1', sources: ['genericCsv'], fileNames: ['stmt.csv'], txnIds: ['t1'],
    summary: { totalRows: 1, importedRows: 1, skippedDuplicates: 0, bySource: { genericCsv: 1 }, totalMinor: 10, currency: 'MYR' },
    status: 'committed', merchant: '示例商户机密', note: 'leak',
  };
  ok('batch with PII key REJECTED by strict schema', validateImportBatch(evil).ok === false);
}

// --------------------------------------------------- lifeWorkbench snapshot
console.log('--- snapshot validation ---');
function makeLifeWorkbenchV2() {
  return {
    schemaVersion: 2,
    accounts: [{ id: 'a1', name: '示例账户', type: 'cash', currency: 'MYR', includeInNetWorth: true, showOnHome: false, order: 0, createdAt: 1700000000000 }],
    txns: [{ id: 't1', type: 'expense', currency: 'MYR', amount: 12.5, category: '餐饮', note: '示例备注', date: '2026-01-05', createdAt: 1700000000000 }],
    budgets: [], habits: [], schedule: [], shopping: [], media: [], journal: [], inbox: [],
    cardStmtDay: null, cardDueDay: null, version: '1.0.0', exportedAt: '2026-01-05',
  };
}
{
  const r = validateLifeWorkbenchSnapshot(JSON.stringify(makeLifeWorkbenchV2()));
  ok('v2 snapshot valid', r.ok === true);
  if (r.ok) eq('v2 not flagged as migrated', r.migrated, false);
}
{
  const r = validateLifeWorkbenchSnapshot('not json{');
  ok('malformed JSON rejected', r.ok === false);
  if (!r.ok) eq('json_parse kind', r.error.kind, 'json_parse');
}
{
  const r = validateLifeWorkbenchSnapshot(JSON.stringify({ schemaVersion: 99, txns: [] }));
  ok('future version rejected', r.ok === false);
  if (!r.ok) {
    eq('unsupported_version kind', r.error.kind, 'unsupported_version');
    ok('message mentions v99', r.error.message.includes('v99'));
  }
}
{
  // v1 legacy (no schemaVersion) -> migrated to v2 and validated.
  const v1 = {
    accounts: [],
    txns: [{ id: 't1', type: 'expense', currency: 'MYR', amount: 12.5, category: '餐饮', note: '示例', date: '2026-01-05', createdAt: 1700000000000 }],
    budgets: [], habits: [], schedule: [], shopping: [], media: [], journal: [], inbox: [],
    cardStmtDay: null, cardDueDay: null,
  };
  const r = validateLifeWorkbenchSnapshot(JSON.stringify(v1));
  ok('v1 snapshot migrates', r.ok === true);
  if (r.ok) {
    eq('migrated flag', r.migrated, true);
    eq('migrated schemaVersion', r.data.schemaVersion, 2);
    eq('migrated txn origAmountMinor', r.data.txns[0].origAmountMinor, 1250);
  }
}
{
  // v0 (below 1) rejected.
  const r = validateLifeWorkbenchSnapshot(JSON.stringify({ schemaVersion: 0, txns: [] }));
  ok('v0 rejected', r.ok === false);
}

// ---------------------------------------------------------------- summary
console.log(`\nPhase1 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
process.exit(0);
