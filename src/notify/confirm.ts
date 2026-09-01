// Confirm / ignore / clear logic for pending (unconfirmed) records — PURE part.
//
// This module is intentionally React-Native-free (no store / AsyncStorage / react-native)
// so it can be unit-tested under plain Node. The store-bound async wrappers live in
// ./confirmStore, which imports this module.

import type {
  Account,
  Currency,
  FxSetting,
  PendingRecord,
  Txn,
} from '../types';
import { convertMinor } from '../money';
import { uid } from './uid';

export interface PendingEdits {
  amountMinor?: number;
  currency?: Currency;
  accountId?: string;
  category?: string;
  merchant?: string;
  date?: string;
  time?: string;
  /** For a posting-match confirm: the actual CNY (fen) the bank posted. */
  actualSettleMinor?: number;
}

/** Actual exchange rate implied by an original->settled pair (CNY per 1 MYR). */
export function computeFxRate(
  origCur: Currency,
  origMinor: number,
  settleCur: Currency,
  settleMinor: number
): number {
  if (origMinor === 0) return 1;
  if (origCur === 'MYR' && settleCur === 'CNY') return settleMinor / origMinor;
  if (origCur === 'CNY' && settleCur === 'MYR') return origMinor / settleMinor;
  return 1;
}

/**
 * Build a Txn-shaped object from a pending record. Pure — no storage access, so it
 * can be unit-tested directly. Honors user edits and the cross-currency shape.
 */
export function buildTxnFromPending(
  rec: PendingRecord,
  accounts: Account[],
  fx: FxSetting,
  edits?: PendingEdits
): Omit<Txn, 'id' | 'createdAt'> {
  const currency = edits?.currency ?? rec.currency;
  const accountId = edits?.accountId ?? rec.suggestedAccountId;
  const account = accounts.find((a) => a.id === accountId);
  const settleCur: Currency = account?.currency ?? currency;
  const origMinor = edits?.amountMinor ?? rec.amountMinor;
  const cross = !!account && account.type === 'credit' && settleCur !== currency;
  const sameCur = settleCur === currency;
  const settleMinor = sameCur ? origMinor : convertMinor(origMinor, currency, fx.rateScaled);
  const isCard = cross || (!!account && account.type === 'credit');

  // Posted status:
  //  - 'awaiting_posting' (cross-currency, bank not yet posted) -> not posted
  //  - 'posted' (CNY amount is already final) -> posted
  //  - null (normal MYR spend) -> posted immediately
  let posted = true;
  if (rec.postingStatus === 'awaiting_posting') posted = false;
  else if (rec.postingStatus === 'posted') posted = true;

  const fxRate = cross ? fx.cnyPerMyr : 1;
  const d = new Date(rec.notifiedAt);
  const date = edits?.date ?? d.toISOString().slice(0, 10);
  const time =
    edits?.time ??
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  return {
    type: rec.kind === 'income' ? 'income' : 'expense',
    currency,
    amount: origMinor / 100,
    origCurrency: currency,
    origAmountMinor: origMinor,
    settleCurrency: settleCur,
    settleAmountMinor: settleMinor,
    fxRate,
    fxSource: cross ? 'system' : undefined,
    accountId: accountId ?? undefined,
    toAccountId: undefined,
    region: currency === 'CNY' ? 'CN' : 'MY',
    merchant: (edits?.merchant ?? rec.merchant ?? '').trim(),
    cardId: isCard ? account?.id : undefined,
    isCardTxn: isCard,
    isPosted: posted,
    postedAmountMinor: isCard && posted ? settleMinor : undefined,
    isRepaid: false,
    countInStats: true,
    category: (edits?.category ?? rec.suggestedCategory).trim() || '其他',
    note: '',
    date,
    time,
  };
}

export interface ReconcileResult {
  txns: Txn[];
  records: PendingRecord[];
  txnId: string;
}

/**
 * Pure reconciliation for a CNY "bank posted" notification that matches an earlier
 * MYR "awaiting_posting" pending. Updates the ORIGINAL txn (or creates it if the
 * original pending was never confirmed) and never adds a second expense.
 *
 * `makeId` is injectable so tests can assert on deterministic ids.
 */
export function reconcilePostingMatch(params: {
  origRec: PendingRecord;
  postRec: PendingRecord;
  records: PendingRecord[];
  txns: Txn[];
  accounts: Account[];
  fx: FxSetting;
  edits?: PendingEdits;
  makeId?: () => string;
}): ReconcileResult {
  const { origRec, postRec, records, txns, accounts, fx, edits } = params;
  const makeId = params.makeId ?? (() => uid('x'));
  const actualMinor = edits?.actualSettleMinor ?? postRec.amountMinor;
  const origMinor = origRec.amountMinor;
  const fxRateActual = computeFxRate('MYR', origMinor, 'CNY', actualMinor);

  let targetId = origRec.txnId;
  let newTxns: Txn[];

  if (targetId && txns.some((t) => t.id === targetId)) {
    // Original expense already exists -> update its settle fields only.
    newTxns = txns.map((t) =>
      t.id === targetId
        ? {
            ...t,
            settleAmountMinor: actualMinor,
            postedAmountMinor: actualMinor,
            isPosted: true,
            fxRate: fxRateActual,
            fxSource: 'card' as const,
          }
        : t
    );
  } else if (origRec) {
    // Original pending was never confirmed -> create it now, already posted.
    const base = buildTxnFromPending(origRec, accounts, fx, {
      ...edits,
      amountMinor: origMinor,
      currency: origRec.currency,
    });
    const created: Txn = {
      ...base,
      settleAmountMinor: actualMinor,
      postedAmountMinor: actualMinor,
      isPosted: true,
      fxRate: fxRateActual,
      fxSource: 'card' as const,
      id: makeId(),
      createdAt: Date.now(),
    };
    newTxns = [...txns, created];
    targetId = created.id;
  } else {
    // Defensive fallback: original lost -> standalone expense (rare).
    const base = buildTxnFromPending(postRec, accounts, fx, edits);
    const created: Txn = { ...base, id: makeId(), createdAt: Date.now() };
    newTxns = [...txns, created];
    targetId = created.id;
  }

  const newRecords = records.map((r) => {
    if (r.id === postRec.id) return { ...r, status: 'confirmed' as const, needsReview: false };
    if (r.id === origRec.id)
      return { ...r, status: 'confirmed' as const, postingStatus: 'posted' as const, txnId: targetId, needsReview: false };
    return r;
  });

  return { txns: newTxns, records: newRecords, txnId: targetId };
}
