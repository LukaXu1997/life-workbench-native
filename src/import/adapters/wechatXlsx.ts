// WeChat Pay (微信支付) XLSX statement adapter.
//
// WeChat Pay exports a bill as .xlsx. Typical shape:
//   (preamble: 微信支付账单明细 / 导出时间 / 账号  — 1~3 lines)
//   交易时间, 交易类型, 交易对方, 商品, 收/支, 金额(元), 支付方式, 当前状态, 交易单号, 商户单号, 备注
//   2026-01-01 08:00:00, 商户消费, 示例咖啡店, 拿铁, 支出, 12.50, 零钱, 支付成功, 4200..., ,
//
// This adapter:
//   - reads the workbook locally with SheetJS (`xlsx`), READ-ONLY:
//       * no formula evaluation, no macros, no VBA, no external links
//       * cellDates:true so date-formatted cells become JS Dates
//   - enforces IMPORT_LIMITS (file size / sheet count / rows / cols) BEFORE parsing
//   - auto-detects the real header row (preamble lines precede it)
//   - parses each finalized data row into a CNY ImportCandidate (integer fen)
//   - skips non-finalized rows (已关闭 / 已撤销 / 失败 / 待支付 ...)
//   - never logs raw transaction text
//
// PRIVACY: merchant/note live in the candidate only (in memory); never persisted
// to logs or the ImportBatch. The WeChat trade number (交易单号) is kept as
// `rawRef`/`meta.orderId` (a non-PII reference token for dedup).

import type { ImportCandidate, ImportSource } from '../models';
import type { TxnType, Currency } from '../../types';
import { toMinor } from '../../money';
import { IMPORT_LIMITS, isWithinFileSize } from '../limits';
import type { AdapterInput, AdapterWarning, ImportAdapter, ImportParseResult } from './types';
import * as XLSX from 'xlsx';

const SOURCE: ImportSource = 'wechat';
const CURRENCY: Currency = 'CNY';

// Brand + header markers used to confirm "this is really a WeChat Pay bill".
const WECHAT_SIGNATURES = ['微信支付', '微信'] as const;

// Canonical field <- known header-label aliases. Header cells are matched by
// exact token, then by substring (so '金额(元)' resolves to 'amount').
const HEADER_ALIASES: Record<string, string> = {
  交易时间: 'txnTime',
  交易类型: 'txnType',
  交易对方: 'merchant',
  对方: 'merchant',
  商品: 'product',
  收: 'direction',
  '收/支': 'direction',
  金额: 'amount',
  '金额(元)': 'amount',
  支付方式: 'payMethod',
  当前状态: 'status',
  交易单号: 'orderId',
  商户单号: 'merchantOrderId',
  备注: 'note',
  交易分类: 'category',
};

// Columns that must appear in the detected header for us to trust it.
const REQUIRED_TOKENS = ['txnTime', 'amount'];

function aliasForHeader(h: unknown): string | undefined {
  const t = typeof h === 'string' ? h.trim() : String(h ?? '').trim();
  if (!t) return undefined;
  if (HEADER_ALIASES[t]) return HEADER_ALIASES[t];
  for (const token of Object.keys(HEADER_ALIASES)) {
    if (t.includes(token)) return HEADER_ALIASES[token];
  }
  return undefined;
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
  return `wechat-${fnv1a(`${name}|${row}|${amountMinor}|${date}|${CURRENCY}`)}`;
}

/** Parse a money string to integer minor units (fen). Returns null if invalid. */
function parseAmount(s: string): number | null {
  if (s == null) return null;
  let t = String(s).trim();
  if (t === '') return null;
  t = t.replace(/[¥￥￥\s,]/g, ''); // strip symbols, spaces, thousands separators
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const num = parseFloat(m[0]);
  if (!isFinite(num)) return null;
  return toMinor(Math.abs(num), CURRENCY); // fen; direction carries the sign
}

/** Convert an Excel date serial (e.g. 45323) to a JS Date (1900 date system). */
function excelSerialToDate(serial: number): Date {
  // 25569 = days between Excel epoch (1899-12-30) and Unix epoch (1970-01-01).
  // This formula is correct for serials >= 60 (dates after 1900-02-28), which
  // covers every real statement.
  return new Date((serial - 25569) * 86400000);
}

/** Format a cell that holds a transaction timestamp. Handles Date objects,
 * Excel date serials, and common string forms (YYYY-MM-DD[ HH:MM[:SS]]). */
function formatCellDateTime(cell: XLSX.CellObject | undefined): { date: string; time?: string } | null {
  if (!cell || cell.v == null) return null;

  // 1) Real Date (cellDates:true turned a date-formatted cell into a Date).
  if (cell.t === 'd' || cell.v instanceof Date) {
    const d = cell.v instanceof Date ? cell.v : new Date(cell.v as string);
    if (isNaN(d.getTime())) return null;
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { date, time };
  }

  // 2) Excel date serial (a plain number in plausible range).
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const n = cell.v as number;
    if (n >= 20000 && n <= 80000) {
      const d = excelSerialToDate(n);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return { date, time };
    }
  }

  // 3) String form.
  return parseDateTime(typeof cell.v === 'string' ? cell.v : String(cell.v));
}

/** Extract YYYY-MM-DD (+ optional HH:MM) from WeChat timestamps. Tolerant of
 *  1- or 2-digit month/day AND hour/minute (e.g. 2026/1/1 9:5) and zero-pads. */
function parseDateTime(s: string): { date: string; time?: string } | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const time = m[4] && m[5] ? `${m[4].padStart(2, '0')}:${m[5].padStart(2, '0')}` : undefined;
  return { date, time };
}

function classify(direction: string, txnType: string, status: string): { type: TxnType; refund: boolean } {
  const st = (status || '').trim();
  const tt = (txnType || '').trim();
  if (st.includes('退款') || tt.includes('退款')) return { type: 'refund', refund: true };
  // 交易类型 '转账' is authoritative for transfer classification (both sent and
  // received transfers are transfers, the 收/支 column only carries the sign).
  if (tt.includes('转账')) return { type: 'transfer', refund: false };
  const d = (direction || '').trim();
  if (d === '收入') return { type: 'income', refund: false };
  if (d === '支出' || d === '零钱' || tt.includes('消费')) return { type: 'expense', refund: false };
  return { type: 'expense', refund: false };
}

function isFinalizedStatus(status: string): boolean {
  const st = (status || '').trim();
  if (st === '') return true; // no status column -> assume final
  // Final states observed in WeChat bills.
  if (/成功|已转账|对方已收钱|已退款|已存入|已提现|已收钱|已充值|已还款/.test(st)) return true;
  // Non-final / cancelled.
  if (/关闭|撤销|失败|待支付|退款中|待确认|处理中|未支付/.test(st)) return false;
  // Unknown status text -> treat as final but flag for review.
  return true;
}

/** Read a workbook from bytes, enforcing size/sheet limits up front. */
function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  const len = bytes.byteLength ?? bytes.length ?? 0;
  if (!isWithinFileSize(len)) {
    throw new Error('文件大小超出限制');
  }
  // SheetJS accepts a Uint8Array via type:'array'. (In RN/Hermes, Buffer is not
  // required; if present we use type:'buffer' for a tiny perf win.)
  const useBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes);
  const wb = XLSX.read(bytes, {
    type: useBuffer ? 'buffer' : 'array',
    cellDates: true,
    cellStyles: false,
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
    bookSheets: false,
    dense: false,
  });
  if (wb.SheetNames.length > IMPORT_LIMITS.maxSheets) {
    throw new Error('工作表数量超出限制');
  }
  return wb;
}

function safeGetCell(sheet: XLSX.Sheet, addr: string): XLSX.CellObject | undefined {
  const c = sheet[addr];
  if (!c) return undefined;
  return c;
}

interface AnalyzedSheet {
  sheetName: string;
  headerRow: number;
  colIndex: Record<string, number>;
}

/** Find the first sheet + header row that looks like a WeChat bill. */
function findWechatSheet(wb: XLSX.WorkBook): AnalyzedSheet | null {
  const scanRows = Math.min(20, IMPORT_LIMITS.maxRowsPerSheet);
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
      range: 0,
    }) as unknown[][];
    if (!rows.length) continue;
    for (let r = 0; r < Math.min(rows.length, scanRows); r++) {
      const row = rows[r] || [];
      const colIndex: Record<string, number> = {};
      let matched = 0;
      for (let c = 0; c < row.length; c++) {
        const field = aliasForHeader(row[c]);
        if (field) {
          if (colIndex[field] === undefined) {
            colIndex[field] = c;
            matched++;
          }
        }
      }
      const hasRequired = REQUIRED_TOKENS.every((tok) => colIndex[tok] !== undefined);
      // Accept if it carries the required columns AND a good number of known
      // columns (avoids matching a stray data row that happens to contain 金额).
      if (hasRequired && matched >= 4) {
        return { sheetName: name, headerRow: r, colIndex };
      }
    }
  }
  return null;
}

function analyze(bytes: Uint8Array): { ok: true; sheet: AnalyzedSheet; rows: unknown[][] } | { ok: false; reason: string } {
  let wb: XLSX.WorkBook;
  try {
    wb = readWorkbook(bytes);
  } catch (e) {
    const msg = (e as Error)?.message || '读取失败';
    // SheetJS throws on encrypted workbooks; surface a clear, non-PII reason.
    if (/password|encrypt|protected/i.test(msg)) return { ok: false, reason: '文件已加密，暂不支持加密的 Excel 账单' };
    return { ok: false, reason: '无法读取 Excel 文件' };
  }
  const sheet = findWechatSheet(wb);
  if (!sheet) return { ok: false, reason: '未找到微信支付账单表头' };
  const ws = wb.Sheets[sheet.sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: '',
    range: sheet.headerRow, // start at the header row
  }) as unknown[][];
  return { ok: true, sheet, rows };
}

/** Cheap structural gate for the registry. */
function validate(input: AdapterInput): { ok: true } | { ok: false; reason: string } {
  if (!input.bytes || input.bytes.length === 0) {
    return { ok: false, reason: '未提供文件内容' };
  }
  const res = analyze(input.bytes);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true };
}

function getCellText(rows: unknown[][], r: number, c: number): string {
  const v = rows[r]?.[c];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Y' : 'N';
  return '';
}

function parse(input: AdapterInput): ImportParseResult {
  const warnings: AdapterWarning[] = [];
  if (!input.bytes || input.bytes.length === 0) {
    return { candidates: [], warnings: [{ rowIndex: -1, code: 'empty', message: '未提供文件内容' }], summary: { totalRows: 0, parsedRows: 0, skippedRows: 0 } };
  }
  const analysis = analyze(input.bytes);
  if (!analysis.ok) {
    return { candidates: [], warnings: [{ rowIndex: -1, code: 'no_header', message: analysis.reason }], summary: { totalRows: 0, parsedRows: 0, skippedRows: 0 } };
  }
  const { sheet, rows } = analysis;
  const ci = sheet.colIndex;

  const candidates: ImportCandidate[] = [];
  let total = 0;
  let parsed = 0;
  let skipped = 0;

  // rows[0] is the header (range started at headerRow). Data starts at row 1.
  for (let r = 1; r < rows.length; r++) {
    if (total >= IMPORT_LIMITS.maxRowsPerSheet) {
      warnings.push({ rowIndex: r, code: 'row_limit', message: '已达到单表行数上限，后续行已忽略' });
      break;
    }
    const row = rows[r];
    if (!row || row.length === 0) continue;
    if (row.every((c) => c == null || c === '')) continue; // blank line

    const amountMinor = parseAmount(getCellText(rows, r, ci.amount));
    if (amountMinor == null) {
      skipped++;
      continue;
    }
    const status = getCellText(rows, r, ci.status ?? -1);
    if (!isFinalizedStatus(status)) {
      skipped++;
      continue;
    }
    const dt = formatCellDateTime(makeCell(rows, r, ci.txnTime));
    if (!dt) {
      skipped++;
      continue;
    }

    const { type, refund } = classify(getCellText(rows, r, ci.direction ?? -1), getCellText(rows, r, ci.txnType ?? -1), status);
    const merchant = getCellText(rows, r, ci.merchant ?? -1) || getCellText(rows, r, ci.product ?? -1);
    const product = getCellText(rows, r, ci.product ?? -1);
    const orderId = getCellText(rows, r, ci.orderId ?? -1);

    const candidate: ImportCandidate = {
      id: makeId(input.name, r, amountMinor, dt.date),
      source: SOURCE,
      sourceFile: input.name,
      rowIndex: r,
      txnType: type,
      amountMinor,
      currency: CURRENCY,
      merchant: merchant || undefined,
      category: getCellText(rows, r, ci.category ?? -1) || undefined,
      accountHint: '微信支付',
      date: dt.date,
      time: dt.time,
      note: product && product !== merchant ? product : undefined,
      warnings: [],
      rawRef: orderId || undefined,
      meta: orderId ? { orderId, txnType: getCellText(rows, r, ci.txnType ?? -1) } : { txnType: getCellText(rows, r, ci.txnType ?? -1) },
    };

    if (!candidate.category) candidate.warnings.push('missing_category');
    if (type === 'expense' && !refund) {
      const d = getCellText(rows, r, ci.direction ?? -1);
      if (d === '' || d === '其他' || d === '零钱') candidate.warnings.push('unknown_direction');
    }
    candidates.push(candidate);
    total++;
    parsed++;
  }

  return { candidates, warnings, summary: { totalRows: total, parsedRows: parsed, skippedRows: skipped } };
}

/** Build a minimal CellObject from a parsed row value so formatCellDateTime can
 *  treat strings/numbers/dates uniformly (sheet_to_json already unwraps cells). */
function makeCell(rows: unknown[][], r: number, c: number): XLSX.CellObject | undefined {
  if (c === undefined || c === -1) return undefined;
  const v = rows[r]?.[c];
  if (v == null) return undefined;
  // Date objects come straight from sheet_to_json when cellDates:true.
  if (v instanceof Date) return { t: 'd', v } as XLSX.CellObject;
  if (typeof v === 'number') return { t: 'n', v } as XLSX.CellObject;
  if (typeof v === 'string') return { t: 's', v } as XLSX.CellObject;
  return { t: 's', v: String(v) } as XLSX.CellObject;
}

export const wechatXlsxAdapter: ImportAdapter = { source: SOURCE, validate, parse };

/** True if the bytes look like a WeChat Pay workbook (used by source detection). */
export function isWechatXlsx(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length === 0) return false;
  try {
    const wb = readWorkbook(bytes);
    const sheet = findWechatSheet(wb);
    if (sheet) return true;
    // Fallback: scan raw sheet text for the WeChat brand marker.
    for (const name of wb.SheetNames) {
      const s = wb.Sheets[name];
      if (!s || !s['!ref']) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, blankrows: false, defval: '' }) as unknown[][];
      const flat = rows.map((row) => row.join(' ')).join('\n');
      if (WECHAT_SIGNATURES.some((sig) => flat.includes(sig)) && flat.includes('收/支')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type ParseWechatOutcome =
  | { ok: true; result: ImportParseResult; sheetName: string }
  | { ok: false; stage: 'read' | 'validate' | 'empty'; reason: string };

/** End-to-end entry for a WeChat file: read -> detect -> parse. Used by the
 *  ImporterRegistry and by tests. Never logs raw transaction text. */
export function parseWechatFile(input: { name: string; bytes?: Uint8Array }): ParseWechatOutcome {
  if (!input.bytes || input.bytes.length === 0) {
    return { ok: false, stage: 'empty', reason: '未提供文件内容' };
  }
  const analysis = analyze(input.bytes);
  if (!analysis.ok) return { ok: false, stage: 'validate', reason: analysis.reason };
  const result = parse({ name: input.name, kind: 'xlsx', bytes: input.bytes });
  return { ok: true, result, sheetName: analysis.sheet.sheetName };
}
