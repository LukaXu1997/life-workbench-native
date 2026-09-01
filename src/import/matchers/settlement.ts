// SettlementLinkMatcher — same-currency settlement association (spec §三/§四).
//
// When an e-wallet platform (Alipay / TNG) consumes at a merchant, the money is
// actually settled by a linked bank account (a CNY bank card funding Alipay, a
// MYR bank card / PayDirect funding TNG). Both records refer to the SAME real
// consumption. Per the product rule, only ONE expense is counted and the budget
// is deducted ONCE; the two source records are linked to a single main txn.
//
// This matcher finds the association between an imported platform-consumption row
// and an EXISTING ledger settlement, OR an imported settlement row and an EXISTING
// platform-consumption row. Exactly one of the two becomes the "settlement" side
// (flagged countInStats=false by the caller) so it is never double-counted.
//
// CRITICAL currency gate (spec §二/§三/§四): an Alipay (CNY) consumption only
// ever matches a CNY ledger row, and a TNG (MYR) consumption only a MYR ledger
// row — because the gate compares against the row's own currency, Alipay can
// NEVER match a TNG (MYR) ledger row and vice-versa.
//
// RN-free, pure.

import type { Currency } from '../../types';
import type { UnifiedRow } from '../unify';
import { normMerchant, dayDiff } from './types';

/** Platform tokens a settlement row's merchant text may contain — BOTH latin and
 *  CJK forms, because real Alipay settlement lines read "支付宝消费…" (CJK), not the
 *  latin "alipay". A single latin-only token would never match Chinese statements. */
const PLATFORM_TOKENS: Record<'alipay' | 'tng', string[]> = {
  alipay: ['alipay', '支付宝', '蚂蚁'],
  tng: ['tng', 'touchngo', 'touchngo', 'touch n go', 'e-wallet', 'ewallet'],
};

/** Resolve the platform tokens for a row, inferring from merchant text when the
 *  row itself is not a platform row. Returns [] when nothing matches. */
function platformTokens(source: string | undefined, merchant?: string): string[] {
  if (source === 'alipay' || source === 'tng') return PLATFORM_TOKENS[source];
  const m = normMerchant(merchant);
  if (m.includes('支付宝') || m.includes('蚂蚁')) return PLATFORM_TOKENS.alipay;
  if (m.includes('tng') || m.includes('touchngo') || m.includes('touchngo')) return PLATFORM_TOKENS.tng;
  return [];
}

function hasToken(norm: string, tokens: string[]): boolean {
  return tokens.some((t) => norm.includes(t));
}

export interface SettlementMatch {
  /** Imported platform-consumption row id (the side that stays counted). */
  rowId: string;
  /** Existing ledger txn id (the settlement, to be flagged countInStats=false). */
  existingId: string;
}

function rowCurrency(r: UnifiedRow): Currency {
  return (r.origCurrency ?? r.currency) as Currency;
}

// `existing` rows that could act as a settlement for a platform-consumption row.
function findExistingSettlement(
  row: UnifiedRow,
  existing: import('../../types').Txn[],
  tokens: string[]
): string | undefined {
  const cur = rowCurrency(row);
  const amount = row.origAmountMinor ?? row.amountMinor;
  const norm = normMerchant(row.merchant);
  if (!norm) return undefined;
  let best: { id: string; dist: number } | undefined;
  for (const t of existing) {
    if ((t.origCurrency ?? t.currency) !== cur) continue; // currency gate
    if (t.type !== 'expense') continue;
    if (!hasToken(normMerchant(t.merchant), tokens)) continue;
    const tAmt = t.origAmountMinor ?? 0;
    if (tAmt <= 0) continue;
    if (Math.abs(tAmt - amount) / tAmt > 0.02) continue;
    if (Math.abs(dayDiff(t.date, row.date)) > 30) continue;
    const dist = Math.abs(dayDiff(t.date, row.date));
    if (!best || dist < best.dist) best = { id: t.id, dist };
  }
  return best?.id;
}

// `existing` platform-consumption rows matched by an imported settlement row.
function findExistingConsumption(
  row: UnifiedRow,
  existing: import('../../types').Txn[],
  token: string
): string | undefined {
  const cur = rowCurrency(row);
  const amount = row.origAmountMinor ?? row.amountMinor;
  let best: { id: string; dist: number } | undefined;
  for (const t of existing) {
    if (t.source === undefined) continue; // only platform-consumption rows
    if (t.source !== 'alipay' && t.source !== 'tng') continue;
    if ((t.origCurrency ?? t.currency) !== cur) continue; // currency gate
    if (t.type !== 'expense') continue;
    const tAmt = t.origAmountMinor ?? 0;
    if (tAmt <= 0) continue;
    if (Math.abs(tAmt - amount) / tAmt > 0.02) continue;
    if (Math.abs(dayDiff(t.date, row.date)) > 30) continue;
    const dist = Math.abs(dayDiff(t.date, row.date));
    if (!best || dist < best.dist) best = { id: t.id, dist };
  }
  return best?.id;
}

/**
 * Resolve settlement associations for a set of imported rows against the existing
 * ledger. Each returned match has `flagExisting=true` when the imported row is the
 * platform consumption (so the EXISTING settlement row should be flagged
 * countInStats=false), and `flagExisting=false` when the imported row IS the
 * settlement (so the IMPORTED txn should be flagged countInStats=false).
 */
export interface SettlementResolution extends SettlementMatch {
  flagExisting: boolean;
}

export function resolveSettlementLinks(
  rows: UnifiedRow[],
  existing: import('../../types').Txn[],
  resolveAccountId: (r: UnifiedRow) => string | undefined
): SettlementResolution[] {
  const out: SettlementResolution[] = [];
  for (const row of rows) {
    if (row.txnType !== 'expense') continue;
    if (!resolveAccountId(row)) continue;
    const tokens = row.source === 'alipay' || row.source === 'tng'
      ? platformTokens(row.source)
      : platformTokens(undefined, row.merchant);
    if (tokens.length === 0) continue;
    if (row.source === 'alipay' || row.source === 'tng') {
      const exId = findExistingSettlement(row, existing, tokens);
      if (exId) out.push({ rowId: row.id, existingId: exId, flagExisting: true });
    } else {
      const exId = findExistingConsumption(row, existing, tokens[0] ?? '');
      if (exId) out.push({ rowId: row.id, existingId: exId, flagExisting: false });
    }
  }
  return out;
}
