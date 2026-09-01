// DuplicateMatcher — suspected duplicate detection only (dedup rules §4.2).
//
// IMPORTANT (per user request): the importer does NOT auto-remove any row.
// This matcher only FLAGS suspected duplicates so the user can see them in the
// import preview and decide. Nothing is auto-skipped, hidden, or removed — the
// user confirms everything themselves.
//
// Suspected (P2): within the same account/source scope, same date + same amount
//                 + same currency + same merchantNorm -> flagged, NOT skipped.
// Cross-account rows are never treated as duplicates (different real accounts).
// RN-free, pure.

import type { Matchable } from './types';
import { dedupScopeKey } from './types';

export type DupStatus = 'none' | 'suspected';

export interface DuplicateResult {
  /** rowId <-> rowId of a suspected pair (both directions). Hint only; never auto-skipped. */
  suspected: Map<string, string>;
  /** id -> status, for quick per-row lookup. */
  byId: Record<string, DupStatus>;
}

export interface DuplicateOptions {
  /** Reserved for future fuzzy-date tolerance. P2 is strict same-day. */
  windowDays?: number;
}

/** Two rows can only be duplicates if they share the same dedup scope
 *  (source + account grouping + currency). This structurally prevents Alipay
 *  (alipay/CNY) from ever matching TNG (tng/MYR) — see spec §二. */
function sameScope(a: Matchable, b: Matchable): boolean {
  const ka = dedupScopeKey(a);
  const kb = dedupScopeKey(b);
  return ka !== '' && ka === kb;
}

export function findDuplicates(items: Matchable[], _opts: DuplicateOptions = {}): DuplicateResult {
  const suspected = new Map<string, string>();

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (a.id === b.id) continue;
      if (!sameScope(a, b)) continue;
      if (suspected.has(a.id) || suspected.has(b.id)) continue;

      // --- P2: same day + amount + currency + merchantNorm ---
      const aMerch = a.merchantNorm;
      const bMerch = b.merchantNorm;
      if (
        a.date === b.date &&
        a.amountMinor === b.amountMinor &&
        a.currency === b.currency &&
        aMerch !== '' &&
        aMerch === bMerch
      ) {
        suspected.set(a.id, b.id);
        suspected.set(b.id, a.id);
      }
    }
  }

  const byId: Record<string, DupStatus> = {};
  for (const id of suspected.keys()) byId[id] = 'suspected';
  return { suspected, byId };
}
