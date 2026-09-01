// PersistenceBackend wired to AsyncStorage — the RN half of ImportService.
//
// All importer state is LOCAL-ONLY and deliberately excluded from the Snapshot
// backup payload (same policy as pending notification records):
//   * batches   -> KEYS.importBatches  (PII-free audit records: ids + numbers)
//   * rollbacks -> KEYS.importRollback (before-snapshots of EXISTING txns a batch
//                  patched, so undo can restore them exactly)
//
// Writes go through `store.setTxns/setAccounts`, whose `setJSON` emits a change
// event — so every screen using `useReload` refreshes automatically after an
// import or undo. The three writes are issued together; because planning is pure
// and happens before any write, a bad batch never reaches disk.

import { store } from '../store';
import type { PersistenceBackend, BackendState } from './importService';

export function createAsyncBackend(): PersistenceBackend {
  return {
    load: async (): Promise<BackendState> => {
      const [txns, accounts, batches, rollbacks] = await Promise.all([
        store.getTxns(),
        store.getAccounts(),
        store.getImportBatches(),
        store.getImportRollback(),
      ]);
      return { txns: txns ?? [], accounts: accounts ?? [], batches: batches ?? [], rollbacks: rollbacks ?? {} };
    },

    save: async (state: BackendState): Promise<void> => {
      // Order matters for crash-safety: persist the ledger first, then the audit
      // record. A batch that exists without its txns would be an orphan undo
      // entry; the reverse (txns without a batch) merely loses undo-ability.
      await store.setTxns(state.txns);
      await store.setAccounts(state.accounts);
      await store.setImportBatches(state.batches);
      await store.setImportRollback(state.rollbacks);
    },
  };
}
