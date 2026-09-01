// Store-bound async wrapper for quick-add. The only place that touches the real store
// for manual / shared / shortcut entries. Mirrors confirmStore.ts.

import type { Txn } from '../types';
import { store } from '../store';
import { uid } from './uid';
import type { QuickAddDraft } from './quickAdd';
import { buildQuickAddTxn } from './quickAdd';

/** Save a quick-add draft as a confirmed Txn. Returns the new Txn id. */
export async function saveQuickAdd(draft: QuickAddDraft): Promise<string> {
  const [accounts, fx, txns] = await Promise.all([store.getAccounts(), store.getFx(), store.getTxns()]);
  const txn: Txn = {
    ...buildQuickAddTxn(draft, accounts, fx),
    id: uid('x'),
    createdAt: Date.now(),
  };
  await store.setTxns([...txns, txn]);
  return txn.id;
}
