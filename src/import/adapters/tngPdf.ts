// TNG (Touch 'n Go) PDF statement adapter.
//
// Uses an INDEPENDENT parser (not the generic CSV/XLSX table rules) per the
// product rule that TNG statements must not be force-fit into generic tables.
// It consumes the already-extracted text (from the native PdfTextExtractor) and
// turns recognized transaction lines into MYR ImportCandidates (integer sen).
//
// PRIVACY: merchant/desc live only in the candidate (memory); never logged or
// persisted to ImportBatch. Any owner identifier match is used solely to set the
// account hint and is never written out.

import type { ImportCandidate, ImportSource } from '../models';
import type { TxnType } from '../../types';
import { toMinor } from '../../money';
import { statementMentionsOwner, OWNER_TNG_ACCOUNT_HINT } from '../ownerProfile';
import type { AdapterInput, AdapterWarning, ImportAdapter, ImportParseResult } from './types';

const SOURCE: ImportSource = 'tng';

/** Heuristic TNG statement detection from extracted text. */
export function isTngStatement(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const brand = t.includes("touch 'n go") || t.includes('touch n go') || t.includes('tng') || t.includes('ewallet') || t.includes('e-wallet');
  if (!brand) return false;
  const structural = ['statement', 'transaction', 'balance', 'account', 'e-statement', 'bill'].some((k) => t.includes(k));
  return structural;
}

function parseDate(s: string): { date: string; time?: string } | null {
  // DD/MM/YYYY (Malaysia) with optional time
  let m = s.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    const date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const time = m[4] && m[5] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined;
    return { date, time };
  }
  // YYYY-MM-DD
  m = s.match(/(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (m) return { date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  return null;
}

function parseMoneySen(raw: string): number | null {
  const t = raw.replace(/RM\s*/i, '').replace(/,/g, '').trim();
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const num = parseFloat(m[0]);
  if (!isFinite(num)) return null;
  return toMinor(num, 'MYR'); // sen
}

/**
 * Classify a TNG transaction line into a TxnType per the user's rules:
 *   - Reload / Top-up              -> transfer (转账); NOT income/expense, NOT budgeted
 *   - Transfer to Wallet           -> transfer (转账); NOT income/expense, NOT budgeted
 *   - Receive from Wallet / Cashback -> income (收入); counts as income & budget
 *   - Refund                       -> refund (kept distinct; used by refund-linking)
 *   - Everything else (Payment, PayDirect Payment, DuitNow QR, ...) -> expense (支出)
 */
function deriveTngFlags(line: string): {
  type: TxnType;
  transactionNature: 'normal' | 'investment' | 'transfer';
  affectsBudget: boolean;
  affectsIncomeExpense: boolean;
} {
  const l = line.toLowerCase();
  if (/\b(reload|top[\s_-]?up|topup)\b/.test(l)) {
    // Reload / Top-up: money INTO the e-wallet from a bank card. It is an account
    // TRANSFER, NOT income, and must not deduct the MYR budget.
    return { type: 'transfer', transactionNature: 'transfer', affectsBudget: false, affectsIncomeExpense: false };
  }
  if (/\btransfer\s+to\s+wallet\b/.test(l)) {
    // Transfer to Wallet: moving money between own wallets — a transfer, not spend.
    return { type: 'transfer', transactionNature: 'transfer', affectsBudget: false, affectsIncomeExpense: false };
  }
  if (/\breceive\s+from\s+wallet\b/.test(l) || /\bcashback\b/.test(l)) {
    // Receive from Wallet / Cashback: genuine income.
    return { type: 'income', transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
  }
  if (/\brefund(ed)?\b/.test(l)) {
    // Refund returns money; keep as its own type (used by refund-linking).
    return { type: 'refund', transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
  }
  // Payment / PayDirect Payment / DuitNow QR / any other -> ordinary expense.
  return { type: 'expense', transactionNature: 'normal', affectsBudget: true, affectsIncomeExpense: true };
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function makeId(name: string, row: number, amountMinor: number, date: string): string {
  return `tng-${fnv1a(`${name}|${row}|${amountMinor}|${date}|MYR`)}`;
}

function validate(input: AdapterInput): { ok: true } | { ok: false; reason: string } {
  const text = input.text ?? '';
  if (!text || text.trim().length === 0) return { ok: false, reason: 'PDF 没有可提取的文本层（扫描件暂不支持）' };
  if (!isTngStatement(text)) return { ok: false, reason: '不是 TNG 账单格式' };
  return { ok: true };
}

function parse(input: AdapterInput): ImportParseResult {
  const text = input.text ?? '';
  const warnings: AdapterWarning[] = [];
  const lines = text.split(/\r?\n/);
  const owner = statementMentionsOwner(text);
  const candidates: ImportCandidate[] = [];
  let total = 0;
  let parsed = 0;
  let skipped = 0;

  const moneyRe = /RM\s*([\d,]+\.\d{2})|([\d,]+\.\d{2})/g;

  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    if (line.trim() === '') continue;

    const dateM = line.match(/(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})|(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})/);
    if (!dateM) continue;
    const dt = parseDate(dateM[0]);
    if (!dt) {
      skipped++;
      continue;
    }

    // Collect all monetary amounts on the line.
    const amounts: number[] = [];
    let mm: RegExpExecArray | null;
    moneyRe.lastIndex = 0;
    while ((mm = moneyRe.exec(line)) !== null) {
      const sen = parseMoneySen(mm[1] ?? mm[2]);
      if (sen != null) amounts.push(sen);
    }
    if (amounts.length === 0) {
      skipped++;
      continue;
    }
    // First amount is the transaction amount; the trailing one (if any) is balance.
    const amountMinor = amounts[0];

    // Description: text between the date and the first money token.
    const afterDate = line.slice((dateM.index ?? 0) + dateM[0].length);
    const moneyIdx = afterDate.search(/RM\s*[\d,]+\.\d{2}|[\d,]+\.\d{2}/);
    const descRaw = moneyIdx >= 0 ? afterDate.slice(0, moneyIdx) : afterDate;
    const merchant = descRaw.replace(/\s+/g, ' ').replace(/^[-:.\s]+|[-:.\s]+$/g, '').trim();

    // Optional reference number (long digit run).
    const refM = line.match(/(\d{8,})/);
    const rawRef = refM ? refM[1] : undefined;

    const flags = deriveTngFlags(line);
    const candidate: ImportCandidate = {
      id: makeId(input.name, r, amountMinor, dt.date),
      source: SOURCE,
      sourceFile: input.name,
      rowIndex: r,
      txnType: flags.type,
      amountMinor,
      currency: 'MYR', // TNG default currency (no currency column in the statement)
      currencyInferredFromSource: true, // spec §九: no currency column -> inferred MYR
      merchant: merchant || undefined,
      accountHint: OWNER_TNG_ACCOUNT_HINT,
      date: dt.date,
      time: dt.time,
      warnings: owner ? [] : ['unknown_account'],
      rawRef,
      meta: rawRef ? { ref: rawRef } : undefined,
      // budget / nature — TNG counts in the MYR budget only.
      budgetCurrency: 'MYR',
      affectsBudget: flags.affectsBudget,
      affectsIncomeExpense: flags.affectsIncomeExpense,
      transactionNature: flags.transactionNature,
    };
    // spec §九: if a currency was explicitly provided and differs from the platform
    // default, flag a conflict (never silently convert). TNG has no currency column,
    // so this is normally a no-op here, but the guard keeps the contract.
    if (!candidate.currencyInferredFromSource && candidate.currency !== 'MYR') {
      candidate.currencyConflict = true;
    }
    candidates.push(candidate);
    total++;
    parsed++;
  }

  if (parsed === 0) {
    warnings.push({ rowIndex: -1, code: 'no_transactions', message: '未在 TNG 文本中识别到交易行' });
  }

  return { candidates, warnings, summary: { totalRows: total, parsedRows: parsed, skippedRows: skipped } };
}

export const tngPdfAdapter: ImportAdapter = { source: SOURCE, validate, parse };

/**
 * End-to-end entry for a TNG PDF: the caller first extracts text (native module),
 * then calls this with that text. Returns scanned/empty info so the UI can show
 * the "暂不支持扫描件" message instead of silently importing nothing.
 */
export type ParseTngOutcome =
  | { ok: true; result: ImportParseResult; ownerMatched: boolean }
  | { ok: false; stage: 'validate' | 'empty'; reason: string; scanned?: boolean };

export function parseTngText(input: { name: string; text: string }): ParseTngOutcome {
  const v = validate({ name: input.name, kind: 'pdf', text: input.text });
  if (!v.ok) {
    return { ok: false, stage: input.text.trim() === '' ? 'empty' : 'validate', reason: v.reason, scanned: input.text.trim() === '' };
  }
  return { ok: true, result: parse({ name: input.name, kind: 'pdf', text: input.text }), ownerMatched: statementMentionsOwner(input.text) };
}
