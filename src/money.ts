// Money & FX utilities — all amounts stored as INTEGER MINOR units.
//   MYR -> sen  (1 MYR = 100 sen)
//   CNY -> fen  (1 CNY = 100 fen)
// FX direction is FIXED: 1 MYR = cnyPerMyr CNY. Reverse is computed, never entered.
// rateScaled = round(cnyPerMyr * 1_000_000) -> 6-decimal precision, integer math, no float drift.

import type { Currency, Txn } from './types';

export function toMinor(amount: number, _cur: Currency): number {
  // major-unit decimal -> integer minor. Round to absorb float dust.
  return Math.round(amount * 100);
}

export function fromMinor(minor: number, _cur: Currency): number {
  return minor / 100;
}

// Parse a user-typed balance ("1,234.56", "1234.56", "¥1,234.56") into integer
// MINOR units. Returns null for empty / invalid input so callers can no-op.
export function parseBalanceToMinor(text: string, _cur: Currency): number | null {
  const cleaned = text.replace(/[\s,¥RM]/gi, '').replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-' || cleaned === '-.') return null;
  const n = Number(cleaned);
  if (!isFinite(n)) return null;
  return toMinor(n, _cur);
}

// Pure-integer currency conversion. No floating intermediate.
export function convertMinor(origMinor: number, origCur: Currency, rateScaled: number): number {
  if (rateScaled <= 0) return origMinor; // defensive guard
  if (origCur === 'MYR') {
    // MYR sen -> CNY fen : fen = sen * cnyPerMyr ; cnyPerMyr = rateScaled/1e6
    return Math.round((origMinor * rateScaled) / 1_000_000);
  }
  // CNY fen -> MYR sen : sen = fen / cnyPerMyr
  return Math.round((origMinor * 1_000_000) / rateScaled);
}

export function formatMoney(minor: number, cur: Currency): string {
  const sym = cur === 'CNY' ? '¥' : 'RM ';
  const neg = minor < 0;
  const a = Math.abs(minor);
  const major = Math.floor(a / 100);
  const frac = (a % 100).toString().padStart(2, '0');
  return (neg ? '-' : '') + sym + major.toLocaleString('en-US') + '.' + frac;
}

// Display-only reverse rate (CNY -> MYR). Never stored.
export function reverseRate(cnyPerMyr: number): number {
  return cnyPerMyr > 0 ? 1 / cnyPerMyr : 0;
}

// ---- Txn field accessors with legacy fallback -----------------------------
// Old txns only had { currency, amount }. After migrateV1ToV2 these fields are
// populated; the helpers below guard any pre-migration-shaped record so screens
// never crash. Migration remains the authoritative writer.

export function txnOrigMinor(t: Txn): number {
  return t.origAmountMinor ?? toMinor(t.amount || 0, t.currency);
}
export function txnOrigCurrency(t: Txn): Currency {
  return t.origCurrency ?? t.currency;
}
export function txnSettleMinor(t: Txn): number {
  return t.settleAmountMinor ?? toMinor(t.amount || 0, t.currency);
}
export function txnSettleCurrency(t: Txn): Currency {
  return t.settleCurrency ?? t.currency;
}
export function txnCountInStats(t: Txn): boolean {
  return t.countInStats ?? true;
}
export function txnAccountId(t: Txn): string {
  return t.accountId ?? '';
}
export function txnIsCard(t: Txn): boolean {
  return t.isCardTxn ?? false;
}
export function txnIsPosted(t: Txn): boolean {
  return t.isPosted ?? true;
}
