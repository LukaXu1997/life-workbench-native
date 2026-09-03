// Account resolution: turn an adapter's `accountHint` (e.g. "支付宝", "TNG",
// "CNY卡") into a concrete `accountId` in the user's ledger.
//
// Pure and RN-free. Resolution order (most specific first):
//   0. Per-source bound account (spec §八). When a saved ImportTemplate binds a
//      platform to a dedicated account, that account wins — but ONLY if its
//      currency matches the platform default (Alipay->CNY, TNG->MYR). This
//      currency gate structurally guarantees the two platforms can never share an
//      account even though both are e-wallets: Alipay can only bind a CNY account
//      and TNG only a MYR account, so a binding mismatch is ignored and we fall
//      through to the normal resolution below (the UI then re-prompts).
//   1. The row already carries an explicit accountId.
//   2. Name match against an account (exact, then bidirectional substring).
//   3. Currency match — prefer ewallet > debit > cash, and only fall back to a
//      credit card when the row is itself a card transaction.
//   4. undefined -> the row imports without an account (recompute ignores it and
//      the preview surfaces it), which is safer than guessing wrong.

import type { Account } from '../types';
import type { ImportSource } from './models';
import { PLATFORM_DEFAULTS } from './models';
import type { UnifiedRow } from './unify';

const NON_CREDIT_ORDER: Account['type'][] = ['ewallet', 'debit', 'cash'];

/** Per-source binding (spec §八), carried from a saved ImportTemplate. */
export interface AccountBinding {
  source: ImportSource;
  /** Dedicated account id this platform is bound to. */
  boundAccountId?: string;
}

/** True when `source` is a platform that supports per-source account binding. */
function platformDefaultCurrency(source: ImportSource | undefined): 'CNY' | 'MYR' | undefined {
  if (
    source === 'alipay' ||
    source === 'tng' ||
    source === 'grab' ||
    source === 'shopee' ||
    source === 'lazada'
  ) {
    return PLATFORM_DEFAULTS[source].currency;
  }
  return undefined;
}

export function resolveAccountFor(
  row: UnifiedRow,
  accounts: Account[],
  binding?: AccountBinding
): string | undefined {
  if (!accounts || accounts.length === 0) return undefined;

  // 0) Per-source bound account (currency-gated so Alipay/TNG never share).
  const expCur = platformDefaultCurrency(binding?.source);
  if (binding?.boundAccountId && expCur) {
    const bound = accounts.find((a) => a.id === binding.boundAccountId);
    if (bound && bound.currency === expCur) return bound.id;
  }

  if (row.accountId) return row.accountId;

  const hint = (row.accountHint || '').trim();

  // 2) name match
  if (hint) {
    const exact = accounts.find((a) => a.name === hint);
    if (exact) return exact.id;
    const partial = accounts.find(
      (a) => a.name.length > 0 && (a.name.includes(hint) || hint.includes(a.name))
    );
    if (partial) return partial.id;
  }

  // 3) currency match
  const cur = row.origCurrency ?? row.currency;
  const sameCurrency = accounts.filter((a) => a.currency === cur);
  if (sameCurrency.length === 0) return undefined;

  for (const type of NON_CREDIT_ORDER) {
    const hit = sameCurrency.find((a) => a.type === type);
    if (hit) return hit.id;
  }
  // credit cards only when nothing else in that currency exists
  return sameCurrency.find((a) => a.type === 'credit')?.id;
}

/** Convenience factory for `CommitOptions.accountResolver`. */
export function makeAccountResolver(accounts: Account[], binding?: AccountBinding) {
  return (row: UnifiedRow): string | undefined => resolveAccountFor(row, accounts, binding);
}

/** Validate that a platform can bind to a given account (currency must match the
 *  platform default). Returns the reason when invalid so the UI can re-prompt. */
export function validateAccountBinding(
  source: ImportSource,
  accountId: string | undefined,
  accounts: Account[]
): { ok: boolean; reason?: string } {
  const expCur = platformDefaultCurrency(source);
  if (!expCur) return { ok: true }; // non-bindable source — nothing to validate
  if (!accountId) return { ok: false, reason: 'no_account' };
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return { ok: false, reason: 'not_found' };
  if (acc.currency !== expCur) {
    return {
      ok: false,
      reason: expCur === 'CNY' ? 'currency_must_be_cny' : 'currency_must_be_myr',
    };
  }
  return { ok: true };
}
