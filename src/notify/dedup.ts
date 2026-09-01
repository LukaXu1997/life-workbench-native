import type { PendingDraft, PendingRecord, PendingStatus, PostingStatus } from '../types';
import type { NotifyEnvelope } from './types';
import { safeDigest } from './redact';
import { normMerchant } from './recognizer';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One-way digest of a specific notification (used to skip re-delivery duplicates). */
export function rawDigestOf(env: NotifyEnvelope): string {
  return safeDigest(env.pkg, `${env.title}\n${env.text}\n${env.bigText}`);
}

/** Deterministic structured fingerprint (currency/amount included) for exact-txn dedup. */
export function fingerprintOf(draft: PendingDraft): string {
  const p = draft.fingerprintParts;
  return [
    p.sourceApp,
    p.accountId ?? '-',
    p.currency,
    p.amountMinor,
    p.merchantNorm,
    p.dayBucket,
    p.bankRef ?? '-',
  ].join('|');
}

export function withinWindow(a: number, b: number, windowDays: number): boolean {
  return Math.abs(a - b) <= windowDays * DAY_MS;
}

/**
 * Cross-notification match: link a CNY "posted" notification to the original
 * MYR "awaiting_posting" pending on the same RMB credit card.
 *
 * Returns the original pending id, 'ambiguous' if >1 candidate (ask the user),
 * or null if no candidate (treat as a standalone expense).
 */
export function findPostingMatch(
  draft: PendingDraft,
  candidates: Array<{
    id: string;
    status: PendingStatus;
    postingStatus?: PostingStatus;
    suggestedAccountId?: string;
    merchant?: string;
    bankRef?: string;
    notifiedAt: number;
  }>,
  opts: { windowDays?: number } = {}
): string | 'ambiguous' | null {
  const windowDays = opts.windowDays ?? 3;
  const draftNorm = draft.fingerprintParts.merchantNorm;
  if (!draft.suggestedAccountId || !draftNorm) return null;

  const matched = candidates.filter(
    (c) =>
      c.status === 'pending' &&
      c.postingStatus === 'awaiting_posting' &&
      c.suggestedAccountId === draft.suggestedAccountId &&
      (() => {
        const cn = normMerchant(c.merchant);
        return (
          !!cn &&
          (cn === draftNorm || cn.includes(draftNorm) || draftNorm.includes(cn))
        );
      })() &&
      withinWindow(c.notifiedAt, draft.notifiedAt, windowDays) &&
      (!c.bankRef || !draft.bankRef || c.bankRef === draft.bankRef)
  );

  if (matched.length === 1) return matched[0].id;
  if (matched.length > 1) return 'ambiguous';
  return null;
}

/** True if a record with the same raw notification digest already exists. */
export function hasDigest(digest: string, records: PendingRecord[]): boolean {
  return records.some((r) => r.rawDigest === digest);
}
