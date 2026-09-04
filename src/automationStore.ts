// Store-bound wrappers for the auto-booking feature.
//
// This module is the ONLY place that turns a learned rule into a real Txn. It does
// so by reusing the exact same sink as manual confirmation: `buildTxnFromPending`
// (from ./confirm) + `store.setTxns`. Notification / OCR capture paths never touch
// balances directly — they only create pending records; booking always funnels
// through here.
//
// Safety:
//  - bookPendingTransaction is serialized through a module-level promise lock AND
//    guarded by the candidate's createdTxnId, so the same candidate can never be
//    booked twice even under concurrent calls / duplicate notifications.
//  - A startup repair (repairHalfBooked) heals a candidate that was marked booked
//    but whose Txn was lost (no real DB transaction available).
//  - Undo (undoAutoBook) deletes the Txn (balances recompute on read via
//    recomputeAccounts), restores the candidate to needs_review, and DOWNGRADES the
//    responsible rule to fill-only (autoBook=false) so it cannot silently re-book.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PendingRecord, PendingStatus, ProcessingStatus } from './types';
import { store, uid } from './store';
import { getPending, setPending } from './notify/pendingStore';
import { buildTxnFromPending } from './notify/confirm';
import {
  AUTOMATION_RULES_KEY,
  AUTOMATION_FEEDBACK_KEY,
  AUTOMATION_SETTINGS_KEY,
  DEFAULT_AUTOBOOK_SETTINGS,
  applyRules,
  canAutoBook,
  buildRuleSuggestion,
  merchantSignature,
  dirOf,
  downgradeRuleOnUndo,
  type AutomationRule,
  type AutomationRuleAction,
  type AutoBookSettings,
  type ConfirmationFeedback,
  type RuleSuggestion,
} from './automation';

// ----------------------------------------------------------- low-level storage

export async function getRules(): Promise<AutomationRule[]> {
  try {
    const raw = await AsyncStorage.getItem(AUTOMATION_RULES_KEY);
    return raw ? (JSON.parse(raw) as AutomationRule[]) : [];
  } catch {
    return [];
  }
}

export async function setRules(rules: AutomationRule[]): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTOMATION_RULES_KEY, JSON.stringify(rules));
  } catch {
    /* best-effort */
  }
}

export async function getFeedback(): Promise<ConfirmationFeedback[]> {
  try {
    const raw = await AsyncStorage.getItem(AUTOMATION_FEEDBACK_KEY);
    return raw ? (JSON.parse(raw) as ConfirmationFeedback[]) : [];
  } catch {
    return [];
  }
}

export async function setFeedback(fb: ConfirmationFeedback[]): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTOMATION_FEEDBACK_KEY, JSON.stringify(fb));
  } catch {
    /* best-effort */
  }
}

export async function getAutoBookSettings(): Promise<AutoBookSettings> {
  try {
    const raw = await AsyncStorage.getItem(AUTOMATION_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_AUTOBOOK_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_AUTOBOOK_SETTINGS;
}

export async function setAutoBookSettings(s: AutoBookSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTOMATION_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

// ----------------------------------------------------------- rule CRUD

function nowIso(): string {
  return new Date().toISOString();
}

export function makeRuleFromSuggestion(
  s: RuleSuggestion,
  opts: { autoBook: boolean; name?: string; priority?: number; ignore?: boolean }
): AutomationRule {
  const ts = nowIso();
  const makeIgnore = opts.ignore ?? false;
  return {
    id: uid('r'),
    name: opts.name || (makeIgnore ? s.sourceApp || 'app' : autoRuleName(s)),
    enabled: true,
    priority: opts.priority ?? 100,
    conditions: { ...s.conditions },
    actions: { ...s.actions, autoBook: opts.autoBook, ignore: makeIgnore },
    stats: {
      matchedCount: 0,
      confirmedUnchangedCount: 0,
      correctedCount: 0,
      autoBookedCount: 0,
      autoBookUndoneCount: 0,
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

function autoRuleName(s: RuleSuggestion): string {
  const app = s.sourceApp || 'app';
  const dir = s.direction === 'income' ? '收入' : '支出';
  return `${app} · ${dir}`;
}

export async function addRule(rule: AutomationRule): Promise<void> {
  const rules = await getRules();
  rules.push(rule);
  await setRules(rules);
}

export async function updateRule(id: string, patch: Partial<AutomationRule>): Promise<void> {
  const rules = await getRules();
  const next = rules.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r));
  await setRules(next);
}

export async function deleteRule(id: string): Promise<void> {
  const rules = await getRules();
  await setRules(rules.filter((r) => r.id !== id));
}

export async function setRuleAction(
  id: string,
  action: Partial<AutomationRuleAction>
): Promise<void> {
  const rules = await getRules();
  const next = rules.map((r) =>
    r.id === id ? { ...r, actions: { ...r.actions, ...action }, updatedAt: nowIso() } : r
  );
  await setRules(next);
}

// ----------------------------------------------------------- idempotent mutex

// Serialize book attempts so a second call observes the first's createdTxnId write.
let bookLock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = bookLock.then(fn, fn);
  // keep the chain alive even if fn rejects
  bookLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ----------------------------------------------------------- record confirmation (Step 4/5)

export interface ConfirmEdits {
  accountId?: string;
  category?: string;
  merchant?: string;
}

/**
 * Called right after a user confirms a pending record. Records what they chose vs
 * what was suggested, bumps matched-rule stats, and returns a RuleSuggestion if
 * the system is now confident enough to offer one (3+ identical confirmations).
 * The CALLER decides whether to surface the "create rule?" prompt — this function
 * never silently creates a rule.
 */
export async function recordConfirmation(
  candidateId: string,
  edits?: ConfirmEdits
): Promise<RuleSuggestion | null> {
  const records = await getPending();
  const rec = records.find((r) => r.id === candidateId);
  if (!rec) return null;
  const dir = dirOf(rec);
  if (dir === 'unknown') return null;

  const finalAccount = edits?.accountId ?? rec.suggestedAccountId ?? undefined;
  const finalCategory = edits?.category ?? rec.suggestedCategory ?? undefined;
  const finalMerchant = edits?.merchant ?? rec.merchant ?? undefined;
  const sig = merchantSignature(rec.merchant);

  const fb: ConfirmationFeedback = {
    candidateId,
    sourceType: rec.sourceType,
    sourceApp: rec.sourceApp,
    merchantSignature: sig,
    suggestedAccountId: rec.suggestedAccountId,
    finalAccountId: finalAccount,
    suggestedCategoryId: rec.suggestedCategory,
    finalCategoryId: finalCategory,
    suggestedMerchant: rec.merchant,
    finalMerchant,
    suggestedDirection: dir,
    finalDirection: dir,
    outcome:
      rec.suggestedAccountId === finalAccount && rec.suggestedCategory === finalCategory
        ? 'unchanged'
        : 'corrected',
    confirmedAt: nowIso(),
  };

  const feedback = await getFeedback();
  feedback.push(fb);
  await setFeedback(feedback);

  // Update matched-rule stats.
  const rules = await getRules();
  const apply = applyRules(rec, rules);
  let statsChanged = false;
  const newRules = rules.map((r) => {
    if (!apply.matchedRuleIds.includes(r.id)) return r;
    statsChanged = true;
    const matchAcc = r.actions.accountId === finalAccount;
    const matchCat = r.actions.categoryId === finalCategory;
    return {
      ...r,
      stats: {
        ...r.stats,
        matchedCount: r.stats.matchedCount + 1,
        confirmedUnchangedCount: r.stats.confirmedUnchangedCount + (matchAcc && matchCat ? 1 : 0),
        correctedCount: r.stats.correctedCount + (matchAcc && matchCat ? 0 : 1),
      },
      updatedAt: nowIso(),
    };
  });
  if (statsChanged) await setRules(newRules);

  return buildRuleSuggestion(rec, feedback, newRules);
}

// ----------------------------------------------------------- book (Step 7)

export interface BookResult {
  txnId?: string;
  alreadyBooked: boolean;
  reason?: string;
}

/**
 * Idempotent entry point: turn one confirmed-eligible pending candidate into a real
 * Txn, reusing buildTxnFromPending + store.setTxns (the same sink as manual confirm).
 * If the candidate already has createdTxnId, returns it without double-booking.
 */
export async function bookPendingTransaction(candidateId: string): Promise<BookResult> {
  return withLock(async (): Promise<BookResult> => {
    const records = await getPending();
    const rec = records.find((r) => r.id === candidateId);
    if (!rec) return { alreadyBooked: false, reason: 'candidate_not_found' };
    if (rec.createdTxnId || rec.txnId) {
      return { txnId: rec.createdTxnId || rec.txnId, alreadyBooked: true };
    }

    const [rules, settings, txns, accounts, fx] = await Promise.all([
      getRules(),
      getAutoBookSettings(),
      store.getTxns(),
      store.getAccounts(),
      store.getFx(),
    ]);

    const apply = applyRules(rec, rules);
    const cab = canAutoBook(rec, apply, settings);
    if (!cab.allowed) {
      return { alreadyBooked: false, reason: cab.reasons[0] || 'not_allowed' };
    }

    const accountId = apply.fill.accountId ?? rec.suggestedAccountId;
    const category = apply.fill.categoryId ?? rec.suggestedCategory;
    const txn = {
      ...buildTxnFromPending(rec, accounts, fx, { accountId, category }),
      id: uid('x'),
      createdAt: Date.now(),
    };

    const newTxns = [...txns, txn];
    const newRecords = records.map((r) =>
      r.id === candidateId
        ? {
            ...r,
            status: 'auto_booked' as PendingStatus,
            processingStatus: 'auto_booked' as ProcessingStatus,
            createdTxnId: txn.id,
            txnId: txn.id,
            matchedRuleIds: apply.matchedRuleIds,
            autoBookedByRuleId: apply.autoBookRuleId,
            needsReview: false,
          }
        : r
    );
    const newRules = rules.map((r) =>
      apply.matchedRuleIds.includes(r.id)
        ? {
            ...r,
            stats: {
              ...r.stats,
              matchedCount: r.stats.matchedCount + 1,
              autoBookedCount: r.stats.autoBookedCount + 1,
            },
            updatedAt: nowIso(),
          }
        : r
    );

    await store.setTxns(newTxns);
    await setPending(newRecords);
    await setRules(newRules);
    return { txnId: txn.id, alreadyBooked: false };
  });
}

/** Book several candidates (e.g. freshly ingested ones). Safe to call repeatedly. */
export async function bookCandidates(ids: string[]): Promise<number> {
  let booked = 0;
  for (const id of ids) {
    try {
      const res = await bookPendingTransaction(id);
      if (res.txnId && !res.alreadyBooked) booked++;
    } catch {
      /* skip a candidate that fails; never abort the batch */
    }
  }
  return booked;
}

/** Sweep every actionable pending record and auto-book whatever is eligible. */
export async function runAutoBookEligible(): Promise<number> {
  const records = await getPending();
  const eligible = records.filter((r) => !r.createdTxnId && !r.txnId);
  return bookCandidates(eligible.map((r) => r.id));
}

// ----------------------------------------------------------- undo (Step 8)

export interface UndoResult {
  ok: boolean;
  merchant?: string;
  category?: string;
  account?: string;
  ruleDowngraded?: boolean;
}

/**
 * Reverse an auto-booked Txn. Deletes the Txn (balances recompute on read),
 * restores the candidate to needs_review (so the user re-decides), and DOWNGRADES
 * the responsible rule to fill-only (autoBook=false) so it cannot silently re-book.
 */
export async function undoAutoBook(txnId: string): Promise<UndoResult> {
  const records = await getPending();
  const rec = records.find((r) => r.createdTxnId === txnId || r.txnId === txnId);
  if (!rec) return { ok: false };

  const txns = await store.getTxns();
  const newTxns = txns.filter((t) => t.id !== txnId);

  let ruleDowngraded = false;
  let rules = await getRules();
  if (rec.autoBookedByRuleId) {
    rules = rules.map((r) =>
      r.id === rec.autoBookedByRuleId ? downgradeRuleOnUndo(r) : r
    );
    ruleDowngraded = true;
  }

  const newRecords = records.map((r) =>
    r.id === rec.id
      ? {
          ...r,
          status: 'needs_review' as PendingStatus,
          processingStatus: 'needs_review' as ProcessingStatus,
          createdTxnId: undefined,
          txnId: undefined,
          autoBookedByRuleId: undefined,
          needsReview: true,
        }
      : r
  );

  await store.setTxns(newTxns);
  await setPending(newRecords);
  await setRules(rules);

  return {
    ok: true,
    merchant: rec.merchant,
    category: rec.suggestedCategory,
    account: rec.suggestedAccountId,
    ruleDowngraded,
  };
}

// ----------------------------------------------------------- startup repair (Step 7)

/**
 * Heal candidates marked booked but whose Txn is missing (e.g. a crash between
 * store.setTxns and setPending). Returns how many were restored to needs_review.
 */
export async function repairHalfBooked(): Promise<number> {
  const [records, txns] = await Promise.all([getPending(), store.getTxns()]);
  const txnIds = new Set(txns.map((t) => t.id));
  let changed = false;
  const newRecords = records.map((r) => {
    const bookedId = r.createdTxnId || r.txnId;
    if (bookedId && !txnIds.has(bookedId)) {
      changed = true;
      return {
        ...r,
        status: 'needs_review' as PendingStatus,
        processingStatus: 'needs_review' as ProcessingStatus,
        createdTxnId: undefined,
        txnId: undefined,
        autoBookedByRuleId: undefined,
        needsReview: true,
      };
    }
    return r;
  });
  if (changed) await setPending(newRecords);
  return changed ? newRecords.filter((r) => r.id !== undefined && (r as PendingRecord).needsReview).length : 0;
}
