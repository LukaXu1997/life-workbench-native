// Alipay (支付宝) CSV statement adapter.
//
// Alipay exports a multi-line header block before the real column header, e.g.:
//   支付宝交易记录明细查询
//   账号:[...]
//   起始日期:[...] 终止日期:[...]
//   ----------交易记录明细列表----------
//   交易号,商家订单号,交易创建时间,交易完成时间,交易对方,商品名称,金额,收/支,交易状态,...
// A newer format uses 交易时间 / 商品说明 instead of 交易创建时间 / 商品名称.
//
// This adapter:
//   - finds the real header row (contains 金额 + a time col + a direction col)
//   - parses each finalized data row into a CNY ImportCandidate (integer fen)
//   - skips non-finalized rows (失败/处理中/已关闭)
//   - never logs raw descriptions
//
// PRIVACY: merchant/note live in the candidate only (in memory); they are never
// persisted to logs or the ImportBatch. The platform trade number (交易号) is kept
// as `rawRef`/`meta.orderId` (a non-PII reference token for dedup).

import type { ImportCandidate, ImportSource } from '../models';
import type { TxnType } from '../../types';
import { toMinor } from '../../money';
import { decodeStatement, forceDecode, type StatementEncoding } from '../charset';
import type { AdapterInput, AdapterWarning, ImportAdapter, ImportParseResult } from './types';

const SOURCE: ImportSource = 'alipay';
/** Brand + header markers used to confirm "this is really an Alipay bill". */
const ALIPAY_SIGNATURES = ['支付宝', '蚂蚁'];

// Canonical field <- known header-label aliases (covers both old & new formats).
const HEADER_ALIASES: Record<string, string> = {
  交易号: 'orderId',
  交易流水号: 'orderId',
  商家订单号: 'merchantOrderId',
  交易创建时间: 'createdAt',
  交易时间: 'createdAt',
  交易完成时间: 'finishedAt',
  交易对方: 'merchant',
  对方: 'merchant',
  商品名称: 'product',
  商品说明: 'product',
  金额: 'amount',
  '收/支': 'direction',
  收付款方向: 'direction',
  '收/付款方式': 'payMethod',
  交易状态: 'status',
  交易分类: 'category',
  备注: 'note',
  资金状态: 'fundStatus',
};

function isAlipayText(text: string): boolean {
  if (!text) return false;
  const hasBrand = ALIPAY_SIGNATURES.some((s) => text.includes(s));
  if (!hasBrand) return false;
  const cols = ['交易号', '交易时间', '交易创建时间', '金额', '收/支', '收付款方向', '交易对方', '商品名称', '商品说明', '交易状态'];
  const hit = cols.filter((c) => text.includes(c)).length;
  return hit >= 2;
}

/** RFC4180-ish CSV line splitter (handles quoted fields + escaped doubled quotes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a money string to integer minor units (fen). Returns null if invalid. */
function parseAmount(s: string): number | null {
  if (s == null) return null;
  let t = s.trim();
  if (t === '') return null;
  // Strip currency symbols, spaces, and thousands separators.
  t = t.replace(/[¥￥\s,]/g, '');
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const num = parseFloat(m[0]);
  if (!isFinite(num)) return null;
  return toMinor(num, 'CNY'); // fen
}

/** Extract YYYY-MM-DD (+ optional HH:MM) from Alipay timestamps. Tolerant of
 *  1- or 2-digit month/day (e.g. 2026/1/1) and zero-pads to YYYY-MM-DD. */
function parseDateTime(s: string): { date: string; time?: string } | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const time = m[4] && m[5] ? `${m[4]}:${m[5]}` : undefined;
  return { date, time };
}

// Alipay wealth-management entries (spec §六) are NOT ordinary income/expense and
// must NOT count toward the daily CNY budget. They are still imported (they move
// the Alipay / bank / 余额宝 / 蚂蚁财富 balances) but flagged as `investment` with
// affectsIncomeExpense=false and affectsBudget=false.
//   - 转入余额宝 / 余额宝转出 / 蚂蚁财富申购 / 蚂蚁财富赎回 / 基金买入卖出
//   - 理财账户内部调仓 / 资产冻结解冻
//   - 余额宝收益 / 基金收益 / 分红 / 蚂蚁财富收益 (kept as investmentIncome)
const WEALTH_KEYWORDS = [
  '余额宝',
  '蚂蚁财富',
  '蚂蚁聚宝',
  '招财宝',
  '基金',
  '理财',
  '分红',
  '资产冻结',
  '资产解冻',
];
function isWealthManagement(merchant: string, product: string, category?: string): boolean {
  const hay = `${merchant} ${product} ${category ?? ''}`;
  if (WEALTH_KEYWORDS.some((k) => hay.includes(k))) return true;
  // "收益/利息" only counts as wealth when paired with a wealth product.
  return /收益|利息/.test(hay) && /余额宝|基金|理财|蚂蚁财富|黄金/.test(hay);
}

// Recharge (银行卡充值支付宝) and withdraw (提现到银行卡) are ACCOUNT TRANSFERS —
// not income or expense (spec §五). They move the Alipay balance but must not be
// counted in income/expense stats or the budget.
function isRecharge(merchant: string, product: string, direction: string, category?: string): boolean {
  const hay = `${merchant} ${product} ${direction} ${category ?? ''}`;
  return /充值|充值为|充值到|转入余额/.test(hay);
}
function isWithdraw(merchant: string, product: string, direction: string, category?: string): boolean {
  const hay = `${merchant} ${product} ${direction} ${category ?? ''}`;
  return /提现|转出到银行卡|提现到/.test(hay);
}

function classify(direction: string, status: string): { type: TxnType; refund: boolean } {
  const st = (status || '').trim();
  if (st.includes('退款')) return { type: 'refund', refund: true };
  const d = (direction || '').trim();
  if (d === '收入') return { type: 'income', refund: false };
  if (d === '转账') return { type: 'transfer', refund: false };
  if (d === '支出') return { type: 'expense', refund: false };
  // 其他 / 不计收支 / empty -> treat as expense but flag for review.
  return { type: 'expense', refund: false };
}

/** Derive the budget / income-expense / nature flags for an Alipay row (spec §六·§七). */
function deriveAlipayFlags(opts: {
  type: TxnType;
  merchant: string;
  product: string;
  direction: string;
  category?: string;
}): {
  type: TxnType;
  transactionNature: 'normal' | 'investment' | 'transfer';
  affectsBudget: boolean;
  affectsIncomeExpense: boolean;
} {
  const hay = `${opts.merchant} ${opts.product} ${opts.direction} ${opts.category ?? ''}`;
  if (isRecharge(opts.merchant, opts.product, opts.direction, opts.category)) {
    // 银行卡充值支付宝: money INTO Alipay (balance +), but not income/expense.
    return { type: 'income', transactionNature: 'transfer', affectsBudget: false, affectsIncomeExpense: false };
  }
  if (isWithdraw(opts.merchant, opts.product, opts.direction, opts.category)) {
    // 提现到银行卡: money OUT of Alipay (balance -), but not income/expense.
    return { type: 'expense', transactionNature: 'transfer', affectsBudget: false, affectsIncomeExpense: false };
  }
  if (isWealthManagement(opts.merchant, opts.product, opts.category)) {
    // Wealth: moves balances, never income/expense, never budget.
    const incoming = /收益|利息|分红|赎回|转出|到账|回报|返还/.test(hay);
    return {
      type: incoming ? 'income' : 'expense',
      transactionNature: 'investment',
      affectsBudget: false,
      affectsIncomeExpense: false,
    };
  }
  // Ordinary Alipay spend / income: counts in CNY income/expense AND CNY budget.
  return { type: opts.type, transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
}

/** Stable, non-crypto id for a candidate row. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function makeId(name: string, row: number, amountMinor: number, date: string): string {
  return `alipay-${fnv1a(`${name}|${row}|${amountMinor}|${date}|CNY`)}`;
}

function validate(input: AdapterInput): { ok: true } | { ok: false; reason: string } {
  const text = input.text ?? '';
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: '文件没有可解析的文本内容' };
  }
  if (!isAlipayText(text)) {
    return { ok: false, reason: '不是支付宝账单格式（缺少支付宝表头签名）' };
  }
  return { ok: true };
}

function parse(input: AdapterInput): ImportParseResult {
  const text = input.text ?? '';
  const warnings: AdapterWarning[] = [];
  const lines = text.split(/\r?\n/);

  // Find the real header line.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('金额') && (l.includes('交易号') || l.includes('交易时间')) && (l.includes('收/支') || l.includes('收付款方向'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      candidates: [],
      warnings: [{ rowIndex: -1, code: 'no_header', message: '未找到支付宝表头行' }],
      summary: { totalRows: 0, parsedRows: 0, skippedRows: 0 },
    };
  }

  const headerCols = splitCsvLine(lines[headerIdx]);
  const colIndex: Record<string, number> = {};
  headerCols.forEach((c, i) => {
    const key = HEADER_ALIASES[c.trim()];
    if (key) colIndex[key] = i;
  });
  const get = (row: string[], key: string): string => {
    const i = colIndex[key];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const candidates: ImportCandidate[] = [];
  let total = 0;
  let parsed = 0;
  let skipped = 0;

  for (let r = headerIdx + 1; r < lines.length; r++) {
    const line = lines[r];
    if (line.trim() === '') continue;
    const row = splitCsvLine(line);
    if (row.length < headerCols.length) continue; // malformed / footer summary

    const amountMinor = parseAmount(get(row, 'amount'));
    if (amountMinor == null) {
      skipped++;
      continue;
    }
    const status = get(row, 'status');
    const finalized = status === '' || status.includes('成功') || status.includes('退款');
    if (!finalized) {
      skipped++;
      continue;
    }
    const dt = parseDateTime(get(row, 'createdAt'));
    if (!dt) {
      skipped++;
      continue;
    }

    const classified = classify(get(row, 'direction'), status);
    const merchant = get(row, 'merchant') || get(row, 'product');
    const product = get(row, 'product');
    const category = get(row, 'category') || undefined;
    const direction = get(row, 'direction');

    // Derive budget / income-expense / nature flags (spec §六·§七). Wealth,
    // recharge and withdraw are still imported (they move balances) but flagged
    // so they never count as income/expense or deduct the budget.
    const flags = deriveAlipayFlags({
      type: classified.type,
      merchant: merchant || '',
      product,
      direction,
      category,
    });
    const type = flags.type;
    const refund = classified.refund;

    const orderId = get(row, 'orderId');

    const candidate: ImportCandidate = {
      id: makeId(input.name, r, amountMinor, dt.date),
      source: SOURCE,
      sourceFile: input.name,
      rowIndex: r,
      txnType: type,
      amountMinor,
      currency: 'CNY', // Alipay default currency (no currency column in the statement)
      currencyInferredFromSource: true, // spec §九: no currency column -> inferred CNY
      merchant: merchant || undefined,
      category,
      accountHint: '支付宝',
      date: dt.date,
      time: dt.time,
      note: product && product !== merchant ? product : undefined,
      warnings: [],
      rawRef: orderId || undefined,
      meta: orderId ? { orderId } : undefined,
      // budget / nature — Alipay counts in the CNY budget only.
      budgetCurrency: 'CNY',
      affectsBudget: flags.affectsBudget,
      affectsIncomeExpense: flags.affectsIncomeExpense,
      transactionNature: flags.transactionNature,
    };
    // spec §九: if a currency was explicitly provided and differs from the platform
    // default, flag a conflict (never silently convert). Alipay has no currency
    // column, so this is normally a no-op here, but the guard keeps the contract.
    if (!candidate.currencyInferredFromSource && candidate.currency !== 'CNY') {
      candidate.currencyConflict = true;
    }

    if (!candidate.category) candidate.warnings.push('missing_category');
    if (type === 'expense' && !refund) {
      if (direction === '' || direction === '其他' || direction === '不计收支') candidate.warnings.push('unknown_direction');
    }
    candidates.push(candidate);
    total++;
    parsed++;
  }

  return { candidates, warnings, summary: { totalRows: total, parsedRows: parsed, skippedRows: skipped } };
}

export const alipayCsvAdapter: ImportAdapter = { source: SOURCE, validate, parse };

/**
 * End-to-end entry for an Alipay file: decode (GB18030/UTF-8 auto-detect) ->
 * validate -> parse. Used by the ImporterRegistry and by tests. Never logs raw
 * transaction text.
 */
export type ParseAlipayOutcome =
  | { ok: true; result: ImportParseResult; encoding: StatementEncoding; bom: boolean }
  | {
      ok: false;
      stage: 'decode' | 'validate' | 'empty';
      reason: string;
      needsUserChoice?: boolean;
    };

export function parseAlipayFile(input: {
  name: string;
  bytes?: Uint8Array;
  text?: string;
  encoding?: string;
}): ParseAlipayOutcome {
  let text: string;
  let encoding: StatementEncoding = 'utf-8';
  let bom = false;

  if (input.bytes && input.bytes.length > 0) {
    const dec = input.encoding
      ? forceDecode(input.bytes, input.encoding as StatementEncoding)
      : decodeStatement(input.bytes, { signatures: ALIPAY_SIGNATURES });
    if (!dec.ok) {
      return { ok: false, stage: 'decode', reason: dec.message, needsUserChoice: dec.reason === 'needs_user_choice' };
    }
    text = dec.text;
    encoding = dec.encoding;
    bom = dec.bom;
  } else if (input.text) {
    text = input.text;
  } else {
    return { ok: false, stage: 'empty', reason: '未提供文件内容' };
  }

  const v = validate({ name: input.name, kind: 'csv', text });
  if (!v.ok) return { ok: false, stage: 'validate', reason: v.reason };

  return { ok: true, result: parse({ name: input.name, kind: 'csv', text }), encoding, bom };
}

/** Re-export for reuse by source detection / registry. */
export { isAlipayText };
