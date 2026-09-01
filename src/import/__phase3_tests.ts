// Phase 3 unit tests — WeChat Pay XLSX adapter (SheetJS xlsx).
// React-Native-free; run under plain Node via scripts/import-test-runner.js.
//
// All sample data is DE-IDENTIFIED: merchants are placeholders (示例咖啡店, 示例用户乙,
// ...), amounts are synthetic, trade numbers are fake. No real card / account
// numbers appear. We also assert the parsed transaction text is NEVER written to
// any console sink by the adapter.

import * as XLSX from 'xlsx';
import { parseWechatFile, isWechatXlsx, wechatXlsxAdapter } from './adapters/wechatXlsx';
import { detectSource } from './sourceDetect';

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

/** Build a WeChat-shaped .xlsx buffer in memory (no fixture file on disk). */
function buildWechatXlsx(rows: (string | number | Date)[][], preamble: string[] = []): Uint8Array {
  const aoa: (string | number | Date)[][] = [
    ...preamble.map((p) => [p]),
    ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
    ...rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '微信支付账单');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new Uint8Array(buf);
}

/** A realistic de-identified WeChat bill body (string timestamps). */
const WECHAT_ROWS: (string | number | Date)[][] = [
  ['2026-01-01 08:00:00', '商户消费', '示例咖啡店', '拿铁中杯', '支出', '12.50', '零钱', '支付成功', '420000001', '', ''],
  ['2026-01-02 09:15:00', '转账', '示例用户乙', '示例转账', '收入', '100.00', '零钱', '已转账', '420000002', '', ''],
  ['2026-01-03 18:00:00', '退款', '示例商城', '示例退货', '收入', '30.00', '零钱', '已全额退款', '420000003', '', ''],
  ['2026-01-04 20:00:00', '商户消费', '星巴克(国贸店)', '美式', '支出', '28.00', '招商银行(1234)', '支付成功', '420000004', '', ''],
  ['2026-01-05 10:00:00', '商户消费', '示例商户丙', '示例商品', '支出', '55.00', '零钱', '已关闭', '420000005', '', ''], // skipped
  ['2026-01-06 11:00:00', '商户消费', '示例餐饮', '示例餐', '支出', '18.50', '零钱', '支付处理中', '420000006', '', ''], // skipped
];

// ---------------------------------------------------------- detection

{
  const bytes = buildWechatXlsx(WECHAT_ROWS, ['微信支付账单明细', '导出时间:2026-01-07 00:00:00']);
  ok('isWechatXlsx true on WeChat bill', isWechatXlsx(bytes) === true);
  const probe = detectSource({ kind: 'xlsx', name: 'wechat.xlsx', bytes });
  eq('detectSource -> wechat', probe.source, 'wechat');
  ok('detectSource confidence high', probe.confidence >= 0.8);

  // A generic, non-WeChat workbook must NOT be detected as WeChat.
  const generic = XLSX.utils.aoa_to_sheet([['Name', 'Age', 'City'], ['Alice', 30, 'Beijing'], ['Bob', 25, 'Shanghai']]);
  const gwb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(gwb, generic, 'Sheet1');
  const gbuf = new Uint8Array(XLSX.write(gwb, { type: 'buffer', bookType: 'xlsx' }));
  ok('isWechatXlsx false on generic sheet', isWechatXlsx(gbuf) === false);
  const gprobe = detectSource({ kind: 'xlsx', name: 'generic.xlsx', bytes: gbuf });
  eq('detectSource -> genericXlsx for non-wechat', gprobe.source, 'genericXlsx');
}

// ---------------------------------------------------------- parsing

{
  const bytes = buildWechatXlsx(WECHAT_ROWS, ['微信支付账单明细', '导出时间:2026-01-07 00:00:00']);
  const res = parseWechatFile({ name: '示例账单.xlsx', bytes });
  ok('parseWechatFile ok', res.ok === true);
  if (res.ok) {
    const c = res.result.candidates;
    eq('parsed rows (skips 2 non-finalized)', c.length, 4);
    eq('summary totalRows', res.result.summary.totalRows, 4);
    eq('summary skippedRows', res.result.summary.skippedRows, 2);

    // Row 1: 支出 12.50 -> 1250 fen, expense, CNY
    const r1 = c[0];
    eq('r1 amountMinor fen', r1.amountMinor, 1250);
    eq('r1 currency', r1.currency, 'CNY');
    eq('r1 txnType expense', r1.txnType, 'expense');
    eq('r1 merchant', r1.merchant, '示例咖啡店');
    eq('r1 accountHint', r1.accountHint, '微信支付');
    eq('r1 date', r1.date, '2026-01-01');
    eq('r1 time', r1.time, '08:00');
    eq('r1 rawRef orderId', r1.rawRef, '420000001');

    // Row 2: 转账 收入 100.00 -> transfer (direction 收入 + type 转账 -> transfer)
    const r2 = c[1];
    eq('r2 txnType transfer', r2.txnType, 'transfer');
    eq('r2 amountMinor fen', r2.amountMinor, 10000);

    // Row 3: 退款 -> refund
    const r3 = c[2];
    eq('r3 txnType refund', r3.txnType, 'refund');
    eq('r3 amountMinor fen', r3.amountMinor, 3000);

    // Row 4: 招商银行 card, still expense
    const r4 = c[3];
    eq('r4 txnType expense', r4.txnType, 'expense');
    eq('r4 amountMinor fen', r4.amountMinor, 2800);

    // Skipped rows must not appear.
    ok('no skipped 已关闭 row', !c.some((x) => x.rawRef === '420000005'));
    ok('no skipped 支付处理中 row', !c.some((x) => x.rawRef === '420000006'));
  }
}

// ---------------------------------------------------------- date forms

{
  // String with slash date + single-digit components, and a real Date object.
  const rows: (string | number | Date)[][] = [
    ['2026/1/1 9:05', '商户消费', '示例餐饮', '示例餐', '支出', '8.80', '零钱', '支付成功', '420000010', '', ''],
    [new Date(2026, 0, 2, 14, 30, 0), '商户消费', '示例书店', '示例书', '支出', '21.00', '零钱', '支付成功', '420000011', '', ''],
  ];
  const bytes = buildWechatXlsx(rows);
  const res = parseWechatFile({ name: 'date.xlsx', bytes });
  ok('date-form parse ok', res.ok === true);
  if (res.ok) {
    const c = res.result.candidates;
    eq('slash-date row normalized to 2026-01-01', c[0].date, '2026-01-01');
    eq('slash-date time', c[0].time, '09:05');
    eq('Date-object row date', c[1].date, '2026-01-02');
    eq('Date-object row time', c[1].time, '14:30');
    eq('Date-object amount fen', c[1].amountMinor, 2100);
  }
}

// ---------------------------------------------------------- Excel date serial

{
  // A number cell that is a real Excel date serial with a date number format.
  // Serial 45292 == 2024-01-01 (Excel 1900 date system). On read, SheetJS
  // (cellDates:true) converts it to a Date; if it ever stays a plain number, the
  // adapter's serial branch resolves it identically.
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
    [45292, '商户消费', '示例咖啡店', '拿铁', '支出', '9.90', '零钱', '支付成功', '420000020', '', ''],
  ]);
  // Give the 交易时间 cell a date number format so it is read as a date.
  ws['A2'] = { t: 'n', v: 45292, z: 'yyyy-mm-dd hh:mm:ss' } as XLSX.CellObject;
  XLSX.utils.book_append_sheet(wb, ws, '微信支付账单');
  const buf = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const res = parseWechatFile({ name: 'serial.xlsx', bytes: buf });
  ok('excel serial parse ok', res.ok === true);
  if (res.ok) {
    eq('excel serial -> 2024-01-01', res.result.candidates[0].date, '2024-01-01');
  }
}

// ---------------------------------------------------------- no-header / empty

{
  const noHeader = XLSX.utils.aoa_to_sheet([['foo', 'bar', 'baz'], ['1', '2', '3']]);
  const nwb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nwb, noHeader, 's');
  const nbuf = new Uint8Array(XLSX.write(nwb, { type: 'buffer', bookType: 'xlsx' }));
  ok('isWechatXlsx false on no-header', isWechatXlsx(nbuf) === false);
  const v = wechatXlsxAdapter.validate({ name: 'x.xlsx', kind: 'xlsx', bytes: nbuf });
  ok('adapter.validate rejects no-header', v.ok === false);

  const empty = parseWechatFile({ name: 'x.xlsx', bytes: new Uint8Array(0) });
  ok('empty bytes -> not ok', empty.ok === false);
  if (!empty.ok) eq('empty stage', empty.stage, 'empty');
}

// ---------------------------------------------------------- privacy: no PII logged

{
  // Silence + capture console to ensure adapters do not log raw transaction text.
  const realLog = console.log;
  let logged = '';
  (console as any).log = (...args: unknown[]) => {
    logged += args.map((a) => String(a)).join(' ');
  };
  const bytes = buildWechatXlsx(WECHAT_ROWS, ['微信支付账单明细']);
  parseWechatFile({ name: '示例账单.xlsx', bytes });
  (console as any).log = realLog;
  ok('adapter did not log merchant 示例咖啡店', !logged.includes('示例咖啡店'));
  ok('adapter did not log trade number 420000001', !logged.includes('420000001'));
}

// ---------------------------------------------------------- result

console.log(`\nPhase 3 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
