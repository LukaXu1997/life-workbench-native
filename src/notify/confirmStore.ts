// Store-bound async wrappers for confirming / ignoring / clearing pending records.
//
// Kept separate from ./confirm (pure) so the pure logic stays React-Native-free and
// unit-testable. This module is the only place that touches the real store.

import type { PendingEdits } from './confirm';
import { buildTxnFromPending, reconcilePostingMatch } from './confirm';
import type { Txn } from '../types';
import { store } from '../store';
import { getPending, setPending } from './pendingStore';
import { uid } from './uid';

/** Confirm a pending record: create a Txn, or update the original Txn for a match. */
export async function confirmPending(id: string, edits?: PendingEdits): Promise<string | undefined> {
  const records = await getPending();
  const rec = records.find((r) => r.id === id);
  if (!rec) return undefined;

  const [accounts, fx, txns] = await Promise.all([
    store.getAccounts(),
    store.getFx(),
    store.getTxns(),
  ]);

  if (rec.matchOfId && rec.status === 'matched') {
    const origRec = records.find((r) => r.id === rec.matchOfId);
    if (!origRec) return undefined;
    const { txns: newTxns, records: newRecords, txnId } = reconcilePostingMatch({
      origRec,
      postRec: rec,
      records,
      txns,
      accounts,
      fx,
      edits,
    });
    await store.setTxns(newTxns);
    await setPending(newRecords);
    return txnId;
  }

  const txn: Txn = {
    ...buildTxnFromPending(rec, accounts, fx, edits),
    id: uid('x'),
    createdAt: Date.now(),
  };
  await store.setTxns([...txns, txn]);
  const newRecords = records.map((r) =>
    r.id === id ? { ...r, status: 'confirmed' as const, txnId: txn.id, needsReview: false } : r
  );
  await setPending(newRecords);
  return txn.id;
}

/** Dismiss a pending record without booking it. */
export async function ignorePending(id: string): Promise<void> {
  const records = await getPending();
  const newRecords = records.map((r) =>
    r.id === id ? { ...r, status: 'ignored' as const } : r
  );
  await setPending(newRecords);
}

/** Clear ALL pending records (user-initiated; confirmed ledger txns are untouched). */
export async function clearPending(): Promise<void> {
  await setPending([]);
}
