// MYR e-wallet CSV adapters — GrabPay / ShopeePay / Lazada Wallet.
//
// These three Malaysian e-wallets export their transaction history as a plain
// CSV (UTF-8) that is structurally similar to the Alipay CSV: a (sometimes
// multi-line) brand header block, then a real column header row, then one row
// per transaction. Unlike Alipay (CNY), all three are denominated in MYR, so
// amounts are stored as integer SEN (1 MYR = 100 sen).
//
// This adapter:
//   - decodes the bytes (UTF-8 auto-detect; the shared charset decoder is used so
//     a stray GB18030 byte-order never crashes the parse) — never logs raw text
//   - detects WHICH of the three brands the file is (brand marker + >=2 known cols)
//   - parses each finalized row into a MYR ImportCandidate (integer sen)
//   - skips non-finalized rows (failed / pending / processing / cancelled)
//   - classifies transfer-like rows (top-up / reload / withdraw) as `transfer`
//     so they move the wallet balance but NEVER count in budget / income-expense
//   - never logs raw descriptions
//
// PRIVACY: merchant / description live in the candidate only (in memory); they are
// never persisted to logs or the ImportBatch. The platform transaction id is kept
// as `rawRef` / `meta.orderId` (a non-PII reference token for dedup).
//
// NOTE ON CALIBRATION: the header aliases and classification keywords below are an
// INITIAL best-effort mapping covering the common GrabPay / ShopeePay / Lazada
// Wallet export shapes. Real sample statements should be used to fine-tune the
// HEADER_ALIASES and brand markers; the architecture (decode -> detect -> parse)
// is complete and stable regardless of column-name tweaks.

import type { ImportCandidate, ImportSource } from '../models';
import type { TxnType } from '../../types';
import { toMinor } from '../../money';
import { decodeStatement, forceDecode, type StatementEncoding } from '../charset';
import type { AdapterInput, AdapterWarning, ImportAdapter, ImportParseResult } from './types';

// ---- brand markers (case-sensitive substrings expected in the statement) ----
const GRAB_MARKERS = ['GrabPay', 'Grab', 'GrabFood', 'GrabMart', 'GrabCar', 'GrabExpress', 'GrabFinance'];
const SHOPEE_MARKERS = ['ShopeePay', 'Shopee', 'SPayLater', 'ShopeePay Wallet'];
const LAZADA_MARKERS = ['Lazada', 'LazadaPay', 'Lazada Wallet', 'LazWallet'];

const MYR_ALL_SIGNATURES = [...GRAB_MARKERS, ...SHOPEE_MARKERS, ...LAZADA_MARKERS];

// Columns that, when present, strongly suggest "this is an e-wallet CSV".
const MYR_COLUMNS = [
  'Date',
  'Time',
  'Transaction Date',
  'Transaction ID',
  'Ref No',
  'Reference No',
  'Order No',
  'Order ID',
  'Description',
  'Merchant',
  'Particulars',
  'Details',
  'Item',
  'Amount',
  'Status',
  'Type',
  'Balance',
];

// Canonical field <- known header-label aliases. Header cells are matched by
// exact token, then by substring (so 'Amount (MYR)' still resolves to 'amount').
const HEADER_ALIASES: Record<string, string> = {
  // date / time
  Date: 'date',
  'Transaction Date': 'date',
  Datetime: 'date',
  'Date/Time': 'date',
  Time: 'time',
  'Transaction Time': 'time',
  // description / merchant
  Description: 'description',
  'Transaction Details': 'description',
  Details: 'description',
  Particulars: 'particulars',
  Item: 'description',
  Product: 'description',
  Merchant: 'merchant',
  Counterparty: 'merchant',
  // amount
  Amount: 'amount',
  'Amount (MYR)': 'amount',
  'Amount(MYR)': 'amount',
  Value: 'amount',
  // status
  Status: 'status',
  State: 'status',
  'Transaction Status': 'status',
  // type
  Type: 'type',
  'Transaction Type': 'type',
  Category: 'category',
  // reference
  'Transaction ID': 'orderId',
  'Transaction ID.': 'orderId',
  'Reference No': 'orderId',
  Reference: 'orderId',
  'Ref No': 'orderId',
  'Order No': 'orderId',
  'Order ID': 'orderId',
  'Txn ID': 'orderId',
  // balance (kept for completeness; not used for amount)
  Balance: 'balance',
  'Wallet Balance': 'balance',
};

function aliasForHeader(h: string): string | undefined {
  const t = h.trim();
  if (!t) return undefined;
  if (HEADER_ALIASES[t]) return HEADER_ALIASES[t];
  for (const token of Object.keys(HEADER_ALIASES)) {
    if (t.includes(token)) return HEADER_ALIASES[token];
  }
  return undefined;
}

// ---- brand detection ------------------------------------------------------
function isBrandCsv(markers: readonly string[], text: string): boolean {
  if (!text || text.length < 8) return false;
  const hasBrand = markers.some((m) => text.includes(m));
  if (!hasBrand) return false;
  const cols = MYR_COLUMNS.filter((c) => text.includes(c));
  return cols.length >= 2;
}

export function isGrabCsv(text: string): boolean {
  return isBrandCsv(GRAB_MARKERS, text);
}
export function isShopeeCsv(text: string): boolean {
  return isBrandCsv(SHOPEE_MARKERS, text);
}
export function isLazadaCsv(text: string): boolean {
  return isBrandCsv(LAZADA_MARKERS, text);
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

/** Strip currency symbols / spaces / thousands separators and return POSITIVE
 *  integer minor units (sen). Returns null if no number can be parsed. */
function parseAmount(raw: string): number | null {
  if (raw == null) return null;
  let t = String(raw).trim();
  if (t === '') return null;
  // Remove enclosing parentheses (some exports wrap negatives as (12.50)).
  let neg = false;
  if (t.startsWith('(') && t.endsWith(')')) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[RM$￥€£\s,]/gi, '');
  if (t.startsWith('-')) {
    neg = true;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const num = parseFloat(m[0]);
  if (!isFinite(num)) return null;
  const minor = toMinor(Math.abs(num), 'MYR'); // sen
  return neg ? -minor : minor;
}

/** The raw amount's sign BEFORE normalization, used to classify direction when no
 *  explicit Type column is present. -1 = negative, 0 = unsigned/unknown, 1 = plus. */
function amountSign(raw: string): number {
  const t = String(raw).trim();
  if (t.startsWith('(') && t.endsWith(')')) return -1;
  if (/^-/.test(t)) return -1;
  if (/^\+/.test(t)) return 1;
  return 0;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a date (and optional time) from a MYR e-wallet timestamp. Tolerant of:
 *   - YYYY-MM-DD or YYYY/MM/DD (+ HH:MM[:SS])
 *   - DD/MM/YYYY or DD-MM-YYYY (+ HH:MM)  — Malaysian day-first convention
 *   - DD MMM YYYY (e.g. 03 Sep 2026)
 * Returns null if nothing parseable. */
function parseDateTime(s: string): { date: string; time?: string } | null {
  if (!s) return null;
  let t = s.trim();
  // drop a trailing timezone offset like +08:00 / +0800
  t = t.replace(/[+-]\d{2}:?\d{2}$/, '').trim();

  // form 1: YYYY-MM-DD [HH:MM[:SS]]
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const time = m[4] && m[5] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined;
    return { date, time };
  }

  // form 2: DD/MM/YYYY or DD-MM-YYYY [HH:MM]
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const time = m[4] && m[5] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined;
    return { date, time };
  }

  // form 3: DD MMM YYYY [HH:MM]
  m = t.match(/^(\d{1,2})[ ]?([A-Za-z]{3})[ ]?(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    const date = `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const time = m[4] && m[5] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined;
    return { date, time };
  }

  return null;
}

// Transfer-like rows move the wallet balance but are NOT ordinary income/expense:
//   - top-up / reload / add-money / deposit  -> money INTO the wallet (transfer in)
//   - withdraw / cash-out / payout / send    -> money OUT of the wallet (transfer out)
const TRANSFER_IN = /top[- ]?up|reload|add[- ]?money|cash[- ]?in|deposit|fund[- ]?transfer|transfer in|receive money|refund to wallet/i;
const TRANSFER_OUT = /withdraw|cash[- ]?out|payout|transfer out|send money|bank[- ]?in|send to bank/i;
const SPEND = /payment|purchase|paid|spend|bill|order|food|ride|delivery|subscription|checkout|pay /i;
const INCOME = /receive|cashback|reward|income|payout received|commission|interest/i;

/** Classify a MYR e-wallet row into a TxnType + nature + budget flags. */
function classifyMyr(opts: {
  type: string;
  status: string;
  merchant: string;
  amountMinor: number; // already positive
  sign: number; // -1 / 0 / 1 from the raw amount string
}): {
  type: TxnType;
  refund: boolean;
  transactionNature: 'normal' | 'transfer' | 'refund';
  affectsBudget: boolean;
  affectsIncomeExpense: boolean;
} {
  const hay = `${opts.type} ${opts.status} ${opts.merchant}`.toLowerCase();

  if (/refund/.test(hay)) {
    // Refund: money returns to the wallet. Counts as income-like (consistent with
    // the Alipay adapter, where refunds affect budget/income-expense).
    return { type: 'refund', refund: true, transactionNature: 'refund', affectsBudget: true, affectsIncomeExpense: true };
  }

  if (TRANSFER_IN.test(hay)) {
    return { type: 'income', refund: false, transactionNature: 'transfer', affectsBudget: false, affectsIncomeExpense: false };
  }
  if (TRANSFER_OUT.test(hay)) {
    return { type: 'expense', refund: false, transactionNature: 'transfer', affectsBudget: false, affectsIncomeExpense: false };
  }
  if (SPEND.test(hay)) {
    return { type: 'expense', refund: false, transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
  }
  if (INCOME.test(hay)) {
    return { type: 'income', refund: false, transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
  }

  // No explicit type keyword — fall back to the raw amount sign.
  if (opts.sign < 0) {
    return { type: 'expense', refund: false, transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
  }
  // positive / unsigned -> ordinary income (e.g. a credit). Reassessed by the UI
  // if the user edits the direction.
  return { type: 'income', refund: false, transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
}

/** Stable, non-crypto id for a candidate row (per-source prefix). */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function makeId(source: ImportSource, name: string, row: number, amountMinor: number, date: string): string {
  return `${source}-${fnv1a(`${name}|${row}|${amountMinor}|${date}|MYR`)}`;
}

function validate(source: ImportSource, input: AdapterInput): { ok: true } | { ok: false; reason: string } {
  const text = input.text ?? '';
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: '文件没有可解析的文本内容' };
  }
  const okBrand =
    source === 'grab' ? isGrabCsv(text) : source === 'shopee' ? isShopeeCsv(text) : isLazadaCsv(text);
  if (!okBrand) {
    const label = source === 'grab' ? 'GrabPay' : source === 'shopee' ? 'ShopeePay' : 'Lazada';
    return { ok: false, reason: `不是${label}账单格式（缺少品牌表头签名）` };
  }
  return { ok: true };
}

function parse(source: ImportSource, input: AdapterInput): ImportParseResult {
  const text = input.text ?? '';
  const warnings: AdapterWarning[] = [];
  const lines = text.split(/\r?\n/);

  // Find the real header line: must carry an Amount column + a date-ish column.
  // (Brand is already confirmed by validate(), so this can be lenient.)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const hasAmount = l.includes('Amount') || l.includes('amount');
    const hasDate = /Date|Transaction|Time/i.test(l);
    if (hasAmount && hasDate) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      candidates: [],
      warnings: [{ rowIndex: -1, code: 'no_header', message: '未找到账单表头行' }],
      summary: { totalRows: 0, parsedRows: 0, skippedRows: 0 },
    };
  }

  const headerCols = splitCsvLine(lines[headerIdx]);
  const colIndex: Record<string, number> = {};
  headerCols.forEach((c, i) => {
    const key = aliasForHeader(c);
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

    const rawAmt = get(row, 'amount');
    const amountMinor = parseAmount(rawAmt);
    if (amountMinor == null) {
      skipped++;
      continue;
    }
    const sign = amountSign(rawAmt);

    const status = get(row, 'status');
    const finalized =
      status === '' ||
      /complete|success|settled|done|refund|paid|approved|posted/i.test(status);
    if (!finalized) {
      skipped++;
      continue;
    }

    const dt = parseDateTime(get(row, 'date') || (colIndex['time'] !== undefined ? get(row, 'time') : ''));
    if (!dt) {
      skipped++;
      continue;
    }

    const merchant = get(row, 'merchant') || get(row, 'description') || get(row, 'particulars') || '';
    const category = get(row, 'category') || undefined;
    const type = get(row, 'type');
    const orderId = get(row, 'orderId');

    const cls = classifyMyr({
      type,
      status,
      merchant,
      amountMinor: Math.abs(amountMinor),
      sign,
    });
    const typeFinal: TxnType = cls.type;
    const refund = cls.refund;

    const candidate: ImportCandidate = {
      id: makeId(source, input.name, r, Math.abs(amountMinor), dt.date),
      source,
      sourceFile: input.name,
      rowIndex: r,
      txnType: typeFinal,
      amountMinor: Math.abs(amountMinor),
      currency: 'MYR', // these e-wallets are MYR-denominated; no currency column
      currencyInferredFromSource: true,
      merchant: merchant || undefined,
      category,
      accountHint: source === 'grab' ? 'GrabPay' : source === 'shopee' ? 'ShopeePay' : 'Lazada',
      date: dt.date,
      time: dt.time,
      warnings: [],
      rawRef: orderId || undefined,
      meta: orderId ? { orderId } : undefined,
      budgetCurrency: 'MYR',
      affectsBudget: cls.affectsBudget,
      affectsIncomeExpense: cls.affectsIncomeExpense,
      transactionNature: cls.transactionNature,
    };

    if (!candidate.category) candidate.warnings.push('missing_category');
    if (typeFinal === 'expense' && !refund && sign > 0 && type === '') {
      candidate.warnings.push('unsigned_expense'); // positive amount w/o a spend keyword — flagged for review
    }
    candidates.push(candidate);
    total++;
    parsed++;
  }

  return { candidates, warnings, summary: { totalRows: total, parsedRows: parsed, skippedRows: skipped } };
}

// ---- shared decode + dispatch ----------------------------------------------
type DecodeResult =
  | { ok: true; text: string; encoding: StatementEncoding; bom: boolean }
  | { ok: false; stage: 'decode' | 'empty'; reason: string };

function decodeInput(input: { name: string; bytes?: Uint8Array; text?: string; encoding?: string }): DecodeResult {
  if (input.bytes && input.bytes.length > 0) {
    const dec = input.encoding
      ? forceDecode(input.bytes, input.encoding as StatementEncoding)
      : decodeStatement(input.bytes, { signatures: MYR_ALL_SIGNATURES });
    if (!dec.ok) {
      return { ok: false, stage: 'decode', reason: dec.message };
    }
    return { ok: true, text: dec.text, encoding: dec.encoding, bom: dec.bom };
  }
  if (input.text) {
    return { ok: true, text: input.text, encoding: 'utf-8', bom: false };
  }
  return { ok: false, stage: 'empty', reason: '未提供文件内容' };
}

function runParse(
  source: 'grab' | 'shopee' | 'lazada',
  input: { name: string; bytes?: Uint8Array; text?: string; encoding?: string }
): ParseMyrEwalletOutcome {
  const dec = decodeInput(input);
  if (!dec.ok) return { ok: false, stage: dec.stage, reason: dec.reason };
  const v = validate(source, { name: input.name, kind: 'csv', text: dec.text });
  if (!v.ok) return { ok: false, stage: 'validate', reason: v.reason };
  const result = parse(source, { name: input.name, kind: 'csv', text: dec.text });
  return { ok: true, source, result, encoding: dec.encoding, bom: dec.bom };
}

export type ParseMyrEwalletOutcome =
  | {
      ok: true;
      source: 'grab' | 'shopee' | 'lazada';
      result: ImportParseResult;
      encoding: StatementEncoding;
      bom: boolean;
    }
  | {
      ok: false;
      stage: 'decode' | 'validate' | 'unknown' | 'empty';
      reason: string;
    };

/** Brand-aware entry point: decodes -> detects which of the three wallets -> parses. */
export function parseMyrEwalletFile(input: {
  name: string;
  bytes?: Uint8Array;
  text?: string;
  encoding?: string;
}): ParseMyrEwalletOutcome {
  const dec = decodeInput(input);
  if (!dec.ok) return { ok: false, stage: dec.stage, reason: dec.reason };

  let source: ImportSource | undefined;
  if (isGrabCsv(dec.text)) source = 'grab';
  else if (isShopeeCsv(dec.text)) source = 'shopee';
  else if (isLazadaCsv(dec.text)) source = 'lazada';
  if (!source) {
    return { ok: false, stage: 'unknown', reason: '未识别为 Grab / Shopee / Lazada 账单' };
  }
  const v = validate(source, { name: input.name, kind: 'csv', text: dec.text });
  if (!v.ok) return { ok: false, stage: 'validate', reason: v.reason };
  const result = parse(source, { name: input.name, kind: 'csv', text: dec.text });
  return { ok: true, source: source as 'grab' | 'shopee' | 'lazada', result, encoding: dec.encoding, bom: dec.bom };
}

/** Per-wallet entry points (used when the source is already known). */
export function parseGrabFile(input: { name: string; bytes?: Uint8Array; text?: string; encoding?: string }): ParseMyrEwalletOutcome {
  return runParse('grab', input);
}
export function parseShopeeFile(input: { name: string; bytes?: Uint8Array; text?: string; encoding?: string }): ParseMyrEwalletOutcome {
  return runParse('shopee', input);
}
export function parseLazadaFile(input: { name: string; bytes?: Uint8Array; text?: string; encoding?: string }): ParseMyrEwalletOutcome {
  return runParse('lazada', input);
}

// ---- ImportAdapter objects (so the registry / unit tests can route by source) -
export const grabCsvAdapter: ImportAdapter = {
  source: 'grab',
  validate: (i) => validate('grab', i),
  parse: (i) => parse('grab', i),
};
export const shopeeCsvAdapter: ImportAdapter = {
  source: 'shopee',
  validate: (i) => validate('shopee', i),
  parse: (i) => parse('shopee', i),
};
export const lazadaCsvAdapter: ImportAdapter = {
  source: 'lazada',
  validate: (i) => validate('lazada', i),
  parse: (i) => parse('lazada', i),
};

/** Re-export for reuse by source detection / registry. */
export { isGrabCsv as isGrabStatement, isShopeeCsv as isShopeeStatement, isLazadaCsv as isLazadaStatement };
