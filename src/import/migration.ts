// Import-time snapshot migration (lifeWorkbench JSON v1 -> v2).
//
// Reuses the app's existing migrateTxns() so behavior stays 1:1 with the in-app
// migration. An imported v1 backup is migrated to v2 BEFORE it is validated as v2
// — it is NEVER read directly as v2 (per spec: "旧版本需要经过明确迁移函数").

import type { Account, Snapshot } from '../types';
import { migrateTxns } from '../migration';

/**
 * Migrate a raw v1 (or version-less legacy) snapshot to the v2 shape.
 * `schemaVersion` is forced to 2 on the output so validateLifeWorkbenchSnapshot
 * can then run the v2 schema check.
 */
export function migrateSnapshotV1ToV2(v1: any): Snapshot {
  const accounts: Account[] = Array.isArray(v1?.accounts) ? v1.accounts : [];
  const txnsIn = Array.isArray(v1?.txns) ? v1.txns : [];
  const { migrated } = migrateTxns(txnsIn, accounts);

  const out: Snapshot = {
    schemaVersion: 2,
    appVersion: v1?.appVersion,
    createdAt: v1?.createdAt,
    updatedAt: v1?.updatedAt,
    accounts,
    fx: v1?.fx,
    counts: v1?.counts,
    checksum: v1?.checksum,
    txns: migrated,
    budgets: Array.isArray(v1?.budgets) ? v1.budgets : [],
    habits: Array.isArray(v1?.habits) ? v1.habits : [],
    schedule: Array.isArray(v1?.schedule) ? v1.schedule : [],
    shopping: Array.isArray(v1?.shopping) ? v1.shopping : [],
    media: Array.isArray(v1?.media) ? v1.media : [],
    journal: Array.isArray(v1?.journal) ? v1.journal : [],
    inbox: Array.isArray(v1?.inbox) ? v1.inbox : [],
    cardStmtDay: v1?.cardStmtDay ?? null,
    cardDueDay: v1?.cardDueDay ?? null,
    version: v1?.version,
    exportedAt: v1?.exportedAt,
  };
  return out;
}
