// Pure helpers for the "quick entry" feature (Tile / Shortcut / Share).
//
// Kept React-Native-free so the URL/Share parsing can be unit-tested under plain Node.
// The actual Txn write lives in ./quickAddStore (store-bound).

import type { Account, Currency, FxSetting, FxSource, Txn, TxnType } from '../types';
import { convertMinor } from '../money';

export interface QuickAddDraft {
  type: TxnType; // expense | income | repayment (the three shortcut types)
  amountMinor?: number; // integer minor units of `currency`
  currency?: Currency;
  accountId?: string;
  merchant?: string;
  category?: string;
  note?: string; // full shared text, when imported from a share
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  shared?: boolean; // true when imported from a share intent
  recurrence?: 'none' | 'monthly' | 'weekly' | 'yearly'; // fixed/recurring rule
}

/** Parse a deep link like lifeworkbench://quick-add?type=income into a draft. */
export function parseQuickAddUrl(url: string): QuickAddDraft | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'lifeworkbench:' && u.protocol !== 'com.luka.lifeworkbench:') return null;
    const typeParam = u.searchParams.get('type');
    const type: TxnType =
      typeParam === 'income' ? 'income' : typeParam === 'repayment' ? 'repayment' : 'expense';
    return { type };
  } catch {
    return null;
  }
}

function todayStr(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ---- amount / currency extraction (mirrors parsers.ts, kept local so this module stays pure) ----

const RM_RE = /RM\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
const CNY_RE = /[¥￥]\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;
const YUAN_RE = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*元/;

function toMinor(amount: string): number {
  const clean = amount.replace(/,/g, '');
  const [ip, fp] = clean.split('.');
  const intPart = ip || '0';
  const fracPart = (fp || '').padEnd(2, '0').slice(0, 2);
  return parseInt(intPart + fracPart, 10) || 0;
}

function pickAmount(text: string): { minor: number; cur: Currency } | null {
  const rm = RM_RE.exec(text);
  if (rm) return { minor: toMinor(rm[1]), cur: 'MYR' };
  const cny = CNY_RE.exec(text);
  if (cny) return { minor: toMinor(cny[1]), cur: 'CNY' };
  const yuan = YUAN_RE.exec(text);
  if (yuan) return { minor: toMinor(yuan[1]), cur: 'CNY' };
  return null;
}

function detectKind(text: string): 'expense' | 'income' | 'unknown' {
  if (/(spent|paid|payment|purchase|charge|debit|支出|消费|付款|支付|扣款)/i.test(text)) return 'expense';
  if (/(received|credit|收款|入账|退款|工资|收入)/i.test(text)) return 'income';
  return 'unknown';
}

function extractMerchant(text: string): string | undefined {
  // Capture the token(s) after a "pay to / 向 / 付款给" keyword, up to a stop (space or CJK
  // punctuation). Handles both Latin ("at Starbucks") and CJK ("向 星巴克") merchant names.
  const m =
    /向\s+([^\s，。、]+)|付款给\s+([^\s，。、]+)|at\s+([A-Za-z0-9&.'\u4e00-\u9fff]+)|to\s+([A-Za-z0-9&.'\u4e00-\u9fff]+)/i.exec(
      text
    );
  if (!m) return undefined;
  const hit = (m[1] || m[2] || m[3] || m[4] || '').replace(/[.,;:!]+$/, '').trim();
  return hit || undefined;
}

/**
 * Best-effort parse of arbitrary shared text (a copied bank SMS, a receipt snippet, a note).
 * We NEVER auto-book — the result is only used to pre-fill the QuickAdd confirm screen.
 */
export function parseSharedText(text: string): QuickAddDraft {
  const body = text || '';
  const hit = pickAmount(body);
  const kind = detectKind(body);
  const merchant = extractMerchant(body);
  const type: TxnType = kind === 'income' ? 'income' : 'expense';
  return {
    type,
    amountMinor: hit?.minor,
    currency: hit?.cur,
    merchant,
    note: body.trim(),
    date: todayStr(),
    shared: true,
  };
}

/**
 * Build a Txn-shaped object from a draft. Pure (no store access) so it can be unit-tested.
 * Mirrors the dual-currency / cross-currency logic used by FinanceScreen's AddTxnForm.
 */
export function buildQuickAddTxn(
  draft: QuickAddDraft,
  accounts: Account[],
  fx: FxSetting
): Omit<Txn, 'id' | 'createdAt'> {
  const type = draft.type;
  const currency: Currency = draft.currency ?? 'MYR';
  const origMinor = draft.amountMinor ?? 0;

  const account =
    accounts.find((a) => a.id === draft.accountId) ??
    (type === 'repayment'
      ? accounts.find((a) => a.type === 'credit')
      : accounts.find((a) => a.currency === currency && a.type !== 'credit') ??
        accounts.find((a) => a.currency === currency)) ??
    accounts[0];
  const accountId = account?.id;
  const settleCur: Currency = account?.currency ?? currency;
  const cross = type === 'expense' && !!account && account.type === 'credit' && account.currency !== currency;
  const sameCur = settleCur === currency;
  const settleMinor = sameCur ? origMinor : convertMinor(origMinor, currency, fx.rateScaled);

  const isCard = cross || (type === 'repayment' && !!account && account.type === 'credit');
  const countInStats = type !== 'repayment' && type !== 'transfer';

  let fxRate = 1;
  let fxSource: FxSource = 'system';
  let posted = true;
  if (cross) {
    // awaiting bank posting — predicted settle only
    posted = false;
    fxRate = fx.cnyPerMyr;
    fxSource = 'system';
  }

  return {
    type,
    currency,
    amount: origMinor / 100,
    origCurrency: currency,
    origAmountMinor: origMinor,
    settleCurrency: settleCur,
    settleAmountMinor: settleMinor,
    fxRate,
    fxSource,
    accountId,
    region: currency === 'CNY' ? 'CN' : 'MY',
    merchant: draft.merchant?.trim() || '',
    cardId: isCard ? accountId : undefined,
    isCardTxn: isCard,
    isPosted: posted,
    postedAmountMinor: isCard && posted ? settleMinor : undefined,
    isRepaid: type === 'repayment',
    countInStats,
    recurrence: draft.recurrence && draft.recurrence !== 'none' ? draft.recurrence : undefined,
    isRecurring: draft.recurrence && draft.recurrence !== 'none' ? true : undefined,
    category: draft.category?.trim() || '其他',
    note: draft.note?.trim() || '',
    date: draft.date || todayStr(),
    time: draft.time || '',
  };
}
