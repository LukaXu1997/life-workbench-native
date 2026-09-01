// Recurring transaction auto-generation — pure, RN-free (unit-testable under Node).
//
// Templates carry `recurrence: 'monthly' | 'weekly' | 'yearly'`. On each launch we
// walk forward from the template's own date (or the latest generated instance) and
// create the next occurrence once it has come due (date <= today). Generation is
// strictly forward-only — we never backfill past months the user already managed
// manually, and a guard caps the loop so a far-past template can't flood the ledger.
//
// Generated instances carry `recurrenceId = template.id` (the dedup key) so the
// next run finds them and advances `last` correctly. Instances themselves have
// `recurrence: undefined` so they are never treated as new templates (no chains).

import type { Txn, Currency, AccountType } from './types';

function rid(): string {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function parseYMD(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function fmtYMD(d: Date): string {
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${day}`;
}

function nextOccurrence(from: Date, freq: NonNullable<Txn['recurrence']>): Date {
  const d = new Date(from);
  if (freq === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d;
  }
  // monthly / yearly: advance the month/year, clamping the day to the target month length
  const day = d.getDate();
  const step = freq === 'yearly' ? 12 : 1;
  const m = d.getMonth() + step;
  const y = d.getFullYear() + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(y, mm + 1, 0).getDate();
  return new Date(y, mm, Math.min(day, last));
}

function makeInstance(t: Txn, date: Date): Txn {
  // Spread then override the identity fields so the instance is a fresh entry
  // that still carries the template's financial attributes.
  const { recurrence, ...rest } = t;
  void recurrence;
  return {
    ...rest,
    id: rid(),
    recurrenceId: t.id,
    date: fmtYMD(date),
    createdAt: Date.now(),
    isRecurring: true,
    recurrence: undefined,
  } as Txn;
}

/**
 * Given the full txn list, return the (possibly extended) list plus the newly
 * created instances. Pure: does not touch storage.
 */
export function generateRecurring(txns: Txn[]): { txns: Txn[]; added: Txn[] } {
  const templates = txns.filter((t) => t.recurrence && t.recurrence !== 'none');
  if (templates.length === 0) return { txns, added: [] };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // We only auto-create occurrences in the CURRENT month or later. This avoids
  // retroactively inventing past months the user may have already recorded by
  // hand (a far-past template would otherwise flood the ledger with back-fills).
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // Group generated instances by their template id for fast "last occurrence" lookup.
  const byTemplate = new Map<string, Txn[]>();
  for (const x of txns) {
    if (x.recurrenceId) {
      const arr = byTemplate.get(x.recurrenceId);
      if (arr) arr.push(x);
      else byTemplate.set(x.recurrenceId, [x]);
    }
  }

  const newOnes: Txn[] = [];
  for (const t of templates) {
    const freq = t.recurrence!;
    let last = parseYMD(t.date);
    const inst = byTemplate.get(t.id) || [];
    for (const x of inst) {
      const d = parseYMD(x.date);
      if (d > last) last = d;
    }
    let guard = 0;
    while (guard++ < 36) {
      const next = nextOccurrence(last, freq);
      if (next > today) break;
      if (next >= firstOfMonth) newOnes.push(makeInstance(t, next));
      last = next;
    }
  }

  if (newOnes.length === 0) return { txns, added: [] };
  return { txns: [...txns, ...newOnes], added: newOnes };
}

// ---- types re-exported for the wizard / editors ----
export type { Currency, AccountType };
