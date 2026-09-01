// Pure, React-Native-free helpers for pre-filling the ConfirmTxnScreen form from a
// PendingRecord. Kept free of react-native / store so it can be unit-tested under
// plain Node (see scripts/notify-test-runner.js).
//
// Why this exists: the screen must auto-fill amount/currency/merchant/category/account
// from the record — including the case where the record loads AFTER first render — but
// must NEVER overwrite a field the user has already edited.

import type { Account, Currency, PendingRecord } from '../types';

/**
 * Format integer minor units as a 2-decimal major string.
 *   1250 -> "12.50"   100 -> "1.00"   0 -> "0.00"
 */
export function minorToAmountStr(minor: number | undefined | null): string {
  if (minor == null || !Number.isFinite(minor)) return '0.00';
  const v = Math.round(minor) / 100;
  return v.toFixed(2);
}

// ADB / system-shell simulated notifications cannot determine the real paying account.
const DEBUG_PKGS = new Set(['com.android.shell', 'android']);

/**
 * Pick the account to pre-select for a pending record.
 *  - Debug (ADB / shell) packages -> '' so the user must choose manually.
 *  - Otherwise prefer the recognizer's suggestion, else infer from the source app's
 *    known package / label (TNG -> MYR ewallet/debit; Alipay/WeChat -> CNY).
 */
export function suggestAccountFor(rec: PendingRecord, accounts: Account[]): string {
  const pkg = (rec.sourceApp || '').toLowerCase();
  if (DEBUG_PKGS.has(pkg)) return '';

  if (rec.suggestedAccountId && accounts.some((a) => a.id === rec.suggestedAccountId)) {
    return rec.suggestedAccountId;
  }

  const label = (rec.sourceAppLabel || '').toLowerCase();
  const pick = (cur: Currency, type: Account['type']) =>
    accounts.find((a) => a.currency === cur && a.type === type)?.id ?? '';

  if (/tng|touch\s?n\s?go/.test(pkg) || label.includes('tng') || label.includes('touch')) {
    return pick('MYR', 'ewallet') || pick('MYR', 'debit') || '';
  }
  if (/alipay|eg\.android/.test(pkg) || label.includes('alipay') || label.includes('支付宝')) {
    return pick('CNY', 'ewallet') || pick('CNY', 'debit') || pick('CNY', 'credit') || '';
  }
  if (/tencent|wechat|micromsg/.test(pkg) || label.includes('wechat') || label.includes('微信')) {
    return pick('CNY', 'ewallet') || pick('CNY', 'debit') || pick('CNY', 'credit') || '';
  }
  // Fallback: a non-credit account in the record's currency.
  return accounts.find((a) => a.currency === rec.currency && a.type !== 'credit')?.id ?? '';
}

export interface ConfirmFormState {
  amountStr: string;
  currency: Currency;
  merchant: string;
  category: string;
  accountId: string;
  actualCnyStr: string;
}

/** Build the auto-filled form values from a fully-loaded PendingRecord. */
export function buildConfirmForm(
  rec: PendingRecord,
  accounts: Account[],
  isMatch: boolean
): ConfirmFormState {
  return {
    amountStr: minorToAmountStr(rec.amountMinor),
    currency: rec.currency,
    merchant: rec.merchant ?? '',
    category: rec.suggestedCategory ?? '',
    accountId: suggestAccountFor(rec, accounts),
    actualCnyStr: isMatch ? minorToAmountStr(rec.amountMinor) : '',
  };
}

export interface ShouldSyncArgs {
  rec: PendingRecord | undefined;
  isMatch: boolean;
  /** id of the record we last synced the form from (null = never). */
  syncedId: string | null;
  /** true once the user has manually edited any field. */
  touched: boolean;
  /** whether suggestAccountFor(rec, accounts) currently yields a non-empty id. */
  canSuggestAccount: boolean;
  /** the form's current accountId (to know if it's still empty). */
  currentAccountId: string;
}

/**
 * Decide whether the form should be (re)filled from the record.
 * Returns true ONLY when:
 *   - the record is ready (has id + amountMinor), AND
 *   - the user has NOT manually edited, AND
 *   - (a) it's a different/new record than the one we synced, OR
 *   - (b) it's the same record but the account is still empty while a suggestion now exists
 *        (covers accounts loading after the record).
 * Never true once `touched` — so unrelated state refreshes can't clobber user input.
 */
export function shouldSyncForm(a: ShouldSyncArgs): boolean {
  if (!a.rec || a.rec.id == null || a.rec.amountMinor == null) return false;
  if (a.touched) return false;
  if (a.syncedId !== a.rec.id) return true;
  if (a.currentAccountId === '' && a.canSuggestAccount) return true;
  return false;
}
