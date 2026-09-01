// Phase 2 unit tests — GB18030/UTF-8 charset detection + Alipay CSV adapter.
// React-Native-free; run under plain Node via scripts/import-test-runner.js.
//
// All sample data is DE-IDENTIFIED: merchants are placeholders (示例咖啡店, 星巴克(国贸店),
// 示例用户乙, ...) and amounts are synthetic. No real card / account numbers appear.
// We also assert the decoded transaction text is NEVER written to any console sink.

import * as iconv from 'iconv-lite';
import { decodeStatement, forceDecode } from './charset';
import { parseAlipayFile, isAlipayText, alipayCsvAdapter } from './adapters/alipayCsv';

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

const gb = (s: string) => iconv.encode(s, 'gb18030') as Uint8Array;
const utf8 = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));

// A realistic de-identified Alipay statement (new format, 交易时间 header).
const ALIPAY_TEXT = [
  '支付宝交易记录明细查询',
  '账号:138****0000',
  '起始日期:[20260101] 终止日期:[20260131]',
  '---------------------------------交易记录明细列表------------------------------------',
  '交易时间,交易分类,交易对方,商品说明,金额,收/支,收/付款方式,交易状态',
  '2026-01-05 12:30:00,餐饮,示例咖啡店,拿铁中杯,12.50,支出,余额宝,交易成功',
  '2026-01-06 09:15:00,转账,示例用户乙,示例转账说明,100.00,收入,银行卡,交易成功',
  '2026-01-07 18:00:00,退款,示例商城,示例退货,30.00,收入,花呗,退款成功',
  '2026-01-08 20:00:00,餐饮,星巴克(国贸店),美式,28.00,支出,余额宝,交易成功',
  '2026-01-09 10:00:00,购物,示例商户丙,示例商品,55.00,支出,余额宝,交易关闭',
  '2026-01-10 11:00:00,餐饮,示例餐饮,示例餐,18.50,支出,余额宝,支付处理中',
].join('\n');

// ---------------------------------------------------------------- charset
console.log('--- charset ---');
{
  // UTF-8 with BOM is recognized and the BOM is stripped.
  const enc = new TextEncoder();
  const b = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode('示例咖啡店,12.50')]);
  const r = decodeStatement(b, { signatures: ['示例咖啡店'] });
  ok('utf8 BOM -> ok', r.ok === true);
  if (r.ok) {
    eq('utf8 BOM encoding', r.encoding, 'utf-8');
    ok('utf8 BOM flag true', r.bom === true);
    eq('utf8 BOM ratio', r.replacementRatio, 0);
    eq('utf8 BOM text stripped', r.text, '示例咖啡店,12.50');
  }
}
{
  // GB18030 export auto-detected via the 支付宝 signature.
  const r = decodeStatement(gb(ALIPAY_TEXT), { signatures: ['支付宝', '蚂蚁'] });
  ok('gb18030 auto-detect ok', r.ok === true);
  if (r.ok) {
    eq('gb18030 encoding', r.encoding, 'gb18030');
    eq('gb18030 ratio', r.replacementRatio, 0);
    ok('gb18030 preserves brand', r.text.includes('支付宝'));
    ok('gb18030 preserves merchant with parens', r.text.includes('星巴克(国贸店)'));
  }
}
{
  // A plain UTF-8 ASCII CSV is UTF-8 (no signatures needed).
  const r = decodeStatement(utf8('日期,摘要,金额\n2026-01-01,示例,1.00'), {});
  ok('ascii csv -> utf-8', r.ok === true && r.ok && r.encoding === 'utf-8');
}
{
  // Garbled bytes -> needs_user_choice (no silent mojibake).
  const r = decodeStatement(new Uint8Array(64).fill(0x80), { signatures: ['支付宝'] });
  ok('garbled -> needs_user_choice', r.ok === false && r.ok === false);
  if (!r.ok) eq('garbled reason', r.reason, 'needs_user_choice');
}
{
  // forceDecode honors the user's explicit choice (always ok, reports ratio).
  const r = forceDecode(new Uint8Array(16).fill(0x80), 'utf-8');
  ok('forceDecode returns ok', r.ok === true);
  if (r.ok) eq('forceDecode encoding', r.encoding, 'utf-8');
  const r2 = forceDecode(utf8('hello'), 'gb18030');
  ok('forceDecode ascii as gb18030 ok', r2.ok === true && r2.ok);
}

// ---------------------------------------------------------------- alipay detect
console.log('--- alipay detection ---');
ok('isAlipayText true', isAlipayText(ALIPAY_TEXT));
ok('isAlipayText false for generic', !isAlipayText('日期,摘要,金额\n2026-01-01,示例,1.00'));
{
  const v = alipayCsvAdapter.validate({ name: 'a.csv', kind: 'csv', text: '日期,摘要,金额\n2026-01-01,示例,1.00' });
  ok('adapter rejects non-alipay', v.ok === false);
}

// ---------------------------------------------------------------- alipay parse
console.log('--- alipay parse (GB18030 bytes) ---');
let parseResult: any = null;
{
  const out = parseAlipayFile({ name: 'alipay_2026.csv', bytes: gb(ALIPAY_TEXT) });
  ok('parseAlipayFile ok', out.ok === true);
  if (out.ok) {
    parseResult = out.result;
    eq('encoding reported', out.encoding, 'gb18030');
    eq('parsedRows', out.result.summary.parsedRows, 4); // 4 finalized rows
    eq('skippedRows', out.result.summary.skippedRows, 2); // 交易关闭 + 支付处理中
    const c = out.result.candidates;
    eq('candidate count', c.length, 4);
    // row1 expense 示例咖啡店 12.50 -> 1250 fen
    eq('c0 type', c[0].txnType, 'expense');
    eq('c0 merchant', c[0].merchant, '示例咖啡店');
    eq('c0 amountMinor (fen)', c[0].amountMinor, 1250);
    eq('c0 currency', c[0].currency, 'CNY');
    eq('c0 accountHint', c[0].accountHint, '支付宝');
    eq('c0 date', c[0].date, '2026-01-05');
    eq('c0 time', c[0].time, '12:30');
    eq('c0 category', c[0].category, '餐饮');
    // row2 income 100.00 -> 10000 fen
    eq('c1 type', c[1].txnType, 'income');
    eq('c1 amountMinor', c[1].amountMinor, 10000);
    // row3 refund 30.00 -> 3000 fen
    eq('c2 type', c[2].txnType, 'refund');
    eq('c2 amountMinor', c[2].amountMinor, 3000);
    // row4 merchant with parens preserved through GB18030 round-trip
    eq('c3 merchant parens', c[3].merchant, '星巴克(国贸店)');
    eq('c3 amountMinor', c[3].amountMinor, 2800);
    // ids stable + prefixed
    ok('ids prefixed', c.every((x: any) => x.id.startsWith('alipay-')));
    const ids1 = c.map((x: any) => x.id).join(',');
    const out2 = parseAlipayFile({ name: 'alipay_2026.csv', bytes: gb(ALIPAY_TEXT) });
    const ids2 = out2.ok ? out2.result.candidates.map((x: any) => x.id).join(',') : '';
    eq('ids stable across runs', ids1, ids2);
    // no PII leakage in warnings text
    ok('no merchant in any candidate warning', c.every((x: any) => x.warnings.every((w: string) => !'示例咖啡店示例用户乙示例商城星巴克'.includes(w))));
  }
}

console.log('--- alipay parse (UTF-8 text input) ---');
{
  const out = parseAlipayFile({ name: 'a.csv', text: ALIPAY_TEXT });
  ok('parseAlipayFile utf8 text ok', out.ok === true);
  if (out.ok) eq('utf8 text parsedRows', out.result.summary.parsedRows, 4);
}

console.log('--- alipay missing category warning ---');
{
  // Header without 交易分类 -> candidates should warn missing_category.
  const text = [
    '支付宝交易记录明细查询',
    '交易时间,交易对方,商品说明,金额,收/支,收/付款方式,交易状态',
    '2026-01-05 12:30:00,示例咖啡店,拿铁,12.50,支出,余额宝,交易成功',
  ].join('\n');
  const out = parseAlipayFile({ name: 'a.csv', text });
  ok('missing-category parse ok', out.ok === true);
  if (out.ok) {
    eq('one candidate', out.result.candidates.length, 1);
    ok('missing_category warning present', out.result.candidates[0].warnings.includes('missing_category'));
  }
}

console.log('--- parse helpers ---');
{
  // parseAmount / parseDateTime are private; exercise via a tiny public path:
  // feed amounts through the full adapter row parse instead.
  const text = [
    '支付宝交易记录明细查询',
    '交易时间,交易分类,交易对方,商品说明,金额,收/支,收/付款方式,交易状态',
    '2026-01-01 08:00:00,购物,示例商户,示例,"1,234.56",支出,余额宝,交易成功',
    '2026-01-02 09:00:00,购物,示例商户,示例,"¥88.00",支出,余额宝,交易成功',
    '2026-01-03 10:00:00,购物,示例商户,示例,abc,支出,余额宝,交易成功',
  ].join('\n');
  const out = parseAlipayFile({ name: 'a.csv', text });
  ok('helper parse ok', out.ok === true);
  if (out.ok) {
    const c = out.result.candidates;
    eq('thousands-separator amount -> 123456 fen', c[0].amountMinor, 123456);
    eq('currency-symbol amount -> 8800 fen', c[1].amountMinor, 8800);
    // "abc" amount -> row skipped (unparseable)
    eq('unparseable amount skipped', out.result.summary.skippedRows, 1);
    eq('parsed 2 valid rows', out.result.summary.parsedRows, 2);
  }
  // date variants
  const text2 = [
    '支付宝交易记录明细查询',
    '交易时间,交易分类,交易对方,商品说明,金额,收/支,收/付款方式,交易状态',
    '2026/1/1,餐饮,示例,示例,1.00,支出,余额宝,交易成功',
  ].join('\n');
  const out2 = parseAlipayFile({ name: 'a.csv', text: text2 });
  ok('slash-date parse ok', out2.ok === true);
  if (out2.ok) {
    eq('slash date normalized', out2.result.candidates[0].date, '2026-01-01');
    eq('slash date no time', out2.result.candidates[0].time, undefined);
  }
}

console.log('--- privacy: no raw text logged ---');
{
  const sinks = ['log', 'info', 'warn', 'error'] as const;
  const captured: string[] = [];
  const restore = sinks.map((s) => {
    const orig = (console as any)[s];
    (console as any)[s] = (...a: any[]) => captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    return [s, orig] as const;
  });
  try {
    parseAlipayFile({ name: 'alipay_2026.csv', bytes: gb(ALIPAY_TEXT) });
  } finally {
    restore.forEach(([s, orig]) => ((console as any)[s] = orig));
  }
  const leaked = captured.some((line) => line.includes('示例咖啡店') || line.includes('星巴克'));
  ok('no raw merchant leaked to console', !leaked);
}

// ---------------------------------------------------------------- summary
console.log(`\nPhase2 tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
process.exit(0);
