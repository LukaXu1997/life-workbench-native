// Auto-booking "the system learns from your confirmations" — PURE logic.
//
// React-Native-free on purpose so it can be unit-tested under plain Node (see
// scripts/automation-test-runner.js). Only type-only imports are allowed here;
// never import AsyncStorage / store / react-native. The store-bound wrappers
// (bookPendingTransaction, undoAutoBook, recordConfirmation, rule CRUD) live in
// ./automationStore, which calls into this module.
//
// Design contract (user spec, Steps 3-6):
//  - Notification / OCR paths MUST NOT modify account balances directly. The only
//    way a candidate becomes a real Txn is through the same `buildTxnFromPending`
//    + `store.setTxns` sink that manual confirmation uses. bookPendingTransaction
//    (in automationStore) reuses that exact path.
//  - All matcher helpers are pure: they take a candidate + rules and return a
//    result, never mutating inputs. Stat increments (matchedCount++ etc.) happen
//    in the store layer after applyRules decides what matched.
//  - merchantSignature is intentionally lossy (strips order/ref numbers + digits)
//    so "Starbucks #88213" and "Starbucks #99102" collapse to the same merchant.
//  - Auto-booking is REFUSE-by-default: amount confidence >= 0.98, duplicate risk
//    <= 0.10, within user limits, a matched autoBook rule, no conflict, no
//    alwaysConfirm, no ignore, not already booked.

import type {
  Currency,
  PendingRecord,
  CandidateConfidence,
  CandidateReason,
  ProcessingStatus,
} from './types';

// Storage keys. NOTE: the app uses the `wb_life_*` prefix (see store.ts KEYS), so
// we follow that convention rather than the `b_life_*` sketch in the spec.
export const AUTOMATION_RULES_KEY = 'wb_life_automation_rules_v1';
export const AUTOMATION_FEEDBACK_KEY = 'wb_life_automation_feedback_v1';
export const AUTOMATION_SETTINGS_KEY = 'wb_life_automation_settings_v1';

// ----------------------------------------------------------------- types

export type RuleDirection = 'expense' | 'income';

export interface AutomationRuleCondition {
  sourceType?: 'notification' | 'ocr' | 'shared' | 'statement';
  sourceApp?: string;
  /** Case-insensitive substring match against the raw merchant. */
  merchantContains?: string;
  /** Exact match against merchantSignature(merchant). Preferred over contains. */
  normalizedMerchantEquals?: string;
  direction?: RuleDirection;
  currency?: Currency;
  accountHint?: string;
  amountMinMinor?: number;
  amountMaxMinor?: number;
}

export interface AutomationRuleAction {
  accountId?: string;
  categoryId?: string;
  /** Persisted/trained merchant name to write onto the Txn. */
  normalizedMerchant?: string;
  /** Auto-book immediately (requires canAutoBook to also pass). */
  autoBook?: boolean;
  /** Never auto-book; just pre-fill the confirm form. */
  ignore?: boolean;
  /** Always require manual confirmation even if a sibling rule says autoBook. */
  alwaysConfirm?: boolean;
}

export interface AutomationRuleStats {
  matchedCount: number;
  confirmedUnchangedCount: number;
  correctedCount: number;
  autoBookedCount: number;
  autoBookUndoneCount: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number; // higher = evaluated first
  conditions: AutomationRuleCondition;
  actions: AutomationRuleAction;
  stats: AutomationRuleStats;
  createdAt: string;
  updatedAt: string;
}

export interface AutoBookSettings {
  enabled: boolean;
  /** Auto-book expenses only when amountMinor <= this. 0 = no cap. */
  expenseLimitMinor: number;
  /** Auto-book income only when amountMinor <= this. 0 = no cap. */
  incomeLimitMinor: number;
}

export const DEFAULT_AUTOBOOK_SETTINGS: AutoBookSettings = {
  enabled: false,
  expenseLimitMinor: 5000, // RM 50
  incomeLimitMinor: 0, // 0 = no cap
};

export interface ConfirmationFeedback {
  candidateId: string;
  sourceType?: 'notification' | 'ocr' | 'shared' | 'statement';
  sourceApp?: string;
  merchantSignature?: string;
  suggestedAccountId?: string;
  finalAccountId?: string;
  suggestedCategoryId?: string;
  finalCategoryId?: string;
  suggestedMerchant?: string;
  finalMerchant?: string;
  suggestedDirection?: RuleDirection;
  finalDirection?: RuleDirection;
  /** 'unchanged' if the user kept the suggestion, 'corrected' if they changed it. */
  outcome?: 'unchanged' | 'corrected';
  confirmedAt: string;
}

export interface RuleSuggestion {
  sourceApp: string;
  direction: RuleDirection;
  merchantSignature: string;
  count: number;
  conditions: AutomationRuleCondition;
  actions: AutomationRuleAction;
}

export interface ApplyRulesResult {
  matchedRuleIds: string[];
  conflict: boolean;
  ignore: boolean;
  alwaysConfirm: boolean;
  canAutoBook: boolean;
  autoBookRuleId?: string;
  fill: { accountId?: string; categoryId?: string; normalizedMerchant?: string };
  reasons: CandidateReason[];
}

export interface CanAutoBookResult {
  allowed: boolean;
  reasons: string[];
}

export type CandidateInput = Pick<
  PendingRecord,
  | 'id'
  | 'sourceType'
  | 'sourceApp'
  | 'merchant'
  | 'kind'
  | 'currency'
  | 'amountMinor'
  | 'accountHint'
  | 'suggestedAccountId'
  | 'suggestedCategory'
  | 'confidence'
  | 'confidenceDetail'
  | 'createdTxnId'
  | 'txnId'
>;

// ------------------------------------------------------------- helpers

function reason(field: CandidateReason['field'], code: string, text: string): CandidateReason {
  return { field, code, text };
}

/** Classify a candidate's direction; only expense/income are auto-bookable. */
export function dirOf(c: CandidateInput): RuleDirection | 'unknown' {
  if (c.kind === 'income') return 'income';
  if (c.kind === 'expense') return 'expense';
  return 'unknown';
}

/**
 * Lossy merchant signature used for grouping confirmations into rules.
 *  - lowercases, strips whitespace
 *  - drops prefixes like "payment to" / "paid at" / "收款" / "付款给"
 *  - removes ALL digits (order numbers, refs, dates)
 *  - keeps only [a-z] + CJK so "Starbucks #88213" and "Starbucks #99102" match
 * Returns '' when nothing meaningful remains, in which case the merchant must NOT
 * participate in learning.
 */
export function merchantSignature(raw?: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(
    /^(payment\s*to|paid\s*at|pay\s*to|paid\s*to|transfer\s*to|top\s*up\s*at|purchase\s*at|payment\s*from|收款|付款给|向|支付)\s*/i,
    ''
  );
  // keep letters + CJK only (this also drops digits and punctuation)
  s = s.replace(/[^a-z一-龥]/g, '');
  return s;
}

function sourceAppMatches(cond: string, actual?: string): boolean {
  if (!actual) return false;
  return cond.toLowerCase() === actual.toLowerCase();
}

// ------------------------------------------------------------- matchRule

/** Pure: does one rule match a candidate? No side effects. */
export function matchRule(candidate: CandidateInput, rule: AutomationRule): boolean {
  const c = candidate;
  const cond = rule.conditions;
  if (cond.sourceType && c.sourceType && cond.sourceType !== c.sourceType) return false;
  if (cond.sourceApp && !sourceAppMatches(cond.sourceApp, c.sourceApp)) return false;
  if (cond.direction && dirOf(c) !== cond.direction) return false;
  if (cond.currency && c.currency !== cond.currency) return false;
  if (cond.accountHint && c.accountHint && cond.accountHint !== c.accountHint) return false;
  if (cond.normalizedMerchantEquals) {
    const sig = merchantSignature(c.merchant);
    if (!sig || sig !== cond.normalizedMerchantEquals) return false;
  }
  if (cond.merchantContains) {
    const hay = (c.merchant || '').toLowerCase();
    if (!hay.includes(cond.merchantContains.toLowerCase())) return false;
  }
  if (cond.amountMinMinor != null && c.amountMinor < cond.amountMinMinor) return false;
  if (cond.amountMaxMinor != null && c.amountMinor > cond.amountMaxMinor) return false;
  return true;
}

// ------------------------------------------------------------- sortRules

/** Pure: priority desc, then oldest-created first (stable tie-break). */
export function sortRules(rules: AutomationRule[]): AutomationRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

// ------------------------------------------------------------- applyRules

/**
 * Pure evaluation of every enabled rule against a candidate.
 * Order: enabled filter -> priority desc. Within the pass:
 *  - `ignore` rules prevent auto-booking for this candidate.
 *  - `alwaysConfirm` beats any `autoBook` (forces manual review).
 *  - Multiple matched rules disagreeing on account/category => `conflict=true`
 *    (never auto-book on conflict).
 *  - Never overwrites an already-identified amount/currency (we simply don't
 *    touch those fields).
 * Returns the matched rule ids + the resolved fill (account/category/merchant)
 * so the caller can pre-fill or auto-book. Stat increments happen in the store.
 */
export function applyRules(candidate: CandidateInput, rules: AutomationRule[]): ApplyRulesResult {
  const sorted = sortRules(rules.filter((r) => r.enabled));
  const matchedRuleIds: string[] = [];
  let ignore = false;
  let alwaysConfirm = false;
  let autoBook = false;
  let autoBookRuleId: string | undefined;
  const fill: { accountId?: string; categoryId?: string; normalizedMerchant?: string } = {};
  const reasons: CandidateReason[] = [];
  let conflict = false;
  let firstAccount: string | undefined;
  let firstCategory: string | undefined;

  for (const r of sorted) {
    if (!matchRule(candidate, r)) continue;
    matchedRuleIds.push(r.id);
    const act = r.actions;

    if (act.accountId) {
      if (firstAccount === undefined) firstAccount = act.accountId;
      else if (firstAccount !== act.accountId) conflict = true;
      fill.accountId = act.accountId;
    }
    if (act.categoryId) {
      if (firstCategory === undefined) firstCategory = act.categoryId;
      else if (firstCategory !== act.categoryId) conflict = true;
      fill.categoryId = act.categoryId;
    }
    if (act.normalizedMerchant) fill.normalizedMerchant = act.normalizedMerchant;

    if (act.ignore) {
      ignore = true;
      reasons.push(reason('rule', 'ignore', `rule ${r.id} ignores this candidate`));
      continue;
    }
    if (act.alwaysConfirm) {
      alwaysConfirm = true;
      reasons.push(reason('rule', 'always_confirm', `rule ${r.id} requires manual confirmation`));
    }
    if (act.autoBook) {
      autoBook = true;
      autoBookRuleId = r.id;
      reasons.push(reason('rule', 'auto_book', `rule ${r.id} allows auto-booking`));
    }
  }

  if (conflict) {
    reasons.push(reason('rule', 'conflict', 'matched rules disagree on account/category'));
  }

  const canAutoBook = autoBook && !ignore && !alwaysConfirm && !conflict;
  return {
    matchedRuleIds,
    conflict,
    ignore,
    alwaysConfirm,
    canAutoBook,
    autoBookRuleId,
    fill,
    reasons,
  };
}

// ------------------------------------------------------------- buildRuleSuggestion

function ruleMatchesSignature(
  r: AutomationRule,
  app: string,
  sig: string,
  dir: RuleDirection
): boolean {
  const c = r.conditions;
  if (c.sourceApp && c.sourceApp.toLowerCase() !== app.toLowerCase()) return false;
  if (c.direction && c.direction !== dir) return false;
  if (c.normalizedMerchantEquals && c.normalizedMerchantEquals !== sig) return false;
  return true;
}

/**
 * Build a rule suggestion from a history of confirmations. Pure.
 * Returns null unless ALL of:
 *  - same sourceApp + merchantSignature + direction seen >= 3 times
 *  - the 3 most recent all share the same final account AND same final category
 *  - the candidate direction is expense/income (never transfer/refund/repayment)
 *  - signature is non-empty
 *  - no existing ignore rule and no identical existing rule
 * The caller decides whether to surface the prompt (Step 5: only after the 3rd
 * confirmation, and never silently create a rule).
 */
export function buildRuleSuggestion(
  candidate: CandidateInput,
  feedbackHistory: ConfirmationFeedback[],
  existingRules: AutomationRule[]
): RuleSuggestion | null {
  const dir = dirOf(candidate);
  if (dir === 'unknown') return null;
  const sig = merchantSignature(candidate.merchant);
  if (!sig) return null;
  const app = candidate.sourceApp || '';
  if (!app) return null;

  // Already ignored for this signature -> never suggest.
  if (
    existingRules.some(
      (r) => r.enabled && r.actions.ignore && ruleMatchesSignature(r, app, sig, dir)
    )
  ) {
    return null;
  }

  const group = feedbackHistory.filter(
    (f) =>
      f.sourceApp === app &&
      f.merchantSignature === sig &&
      f.suggestedDirection === dir &&
      !!f.finalAccountId &&
      !!f.finalCategoryId
  );
  if (group.length < 3) return null;

  const recent = [...group]
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))
    .slice(0, 3);
  const acc = recent[0].finalAccountId!;
  const cat = recent[0].finalCategoryId!;
  if (!recent.every((f) => f.finalAccountId === acc && f.finalCategoryId === cat)) return null;

  // No duplicate identical rule.
  if (
    existingRules.some(
      (r) =>
        ruleMatchesSignature(r, app, sig, dir) &&
        r.actions.accountId === acc &&
        r.actions.categoryId === cat
    )
  ) {
    return null;
  }

  return {
    sourceApp: app,
    direction: dir,
    merchantSignature: sig,
    count: group.length,
    conditions: { sourceApp: app, normalizedMerchantEquals: sig, direction: dir },
    actions: { accountId: acc, categoryId: cat, autoBook: false },
  };
}

// ------------------------------------------------------------- canAutoBook

/**
 * Strict gate for actually writing a Txn. Pure.
 * The `apply` result (from applyRules) supplies the matched rule set; `settings`
 * is the user's auto-book policy. Direction/account/category confidence are
 * considered 1.0 when a matched rule defines them, so the only strict numeric
 * bar is the parse-time `amount` confidence and the `duplicateRisk`.
 */
export function canAutoBook(
  candidate: CandidateInput,
  apply: ApplyRulesResult,
  settings: AutoBookSettings
): CanAutoBookResult {
  const reasons: string[] = [];
  const deny = (r: string): CanAutoBookResult => ({ allowed: false, reasons: [...reasons, r] });

  if (!settings.enabled) return deny('auto_book_disabled');
  if (apply.ignore) return deny('rule_ignored');
  if (apply.conflict) return deny('rule_conflict');
  if (!apply.canAutoBook) return deny('no_auto_book_rule');
  if (candidate.createdTxnId || candidate.txnId) return deny('already_booked');

  const dir = dirOf(candidate);
  if (dir === 'unknown') return deny('unsupported_direction'); // unknown/transfer/refund/repayment
  if (candidate.amountMinor <= 0) return deny('amount_not_positive');
  if (candidate.currency !== 'MYR' && candidate.currency !== 'CNY') return deny('unknown_currency');

  const det: CandidateConfidence | undefined = candidate.confidenceDetail;
  const amountConf = det?.amount ?? candidate.confidence ?? 0;
  const dupRisk = det?.duplicateRisk ?? 0;
  if (amountConf < 0.98) return deny('amount_confidence_low');
  if (dupRisk > 0.1) return deny('duplicate_risk_high');

  const limit = dir === 'income' ? settings.incomeLimitMinor : settings.expenseLimitMinor;
  if (limit > 0 && candidate.amountMinor > limit) return deny('over_limit');

  if (!apply.fill.accountId) return deny('missing_account');
  if (!apply.fill.categoryId) return deny('missing_category');

  return { allowed: true, reasons: [] };
}

// ------------------------------------------------------------- undo downgrade

/**
 * Pure: when the user undoes an auto-booked Txn, the responsible rule is DOWNGRADED
 * from auto-book to fill-only (so it cannot silently re-book) and its undo counter
 * increments. Undo of the Txn/candidate state itself happens in the store wrapper.
 */
export function downgradeRuleOnUndo(rule: AutomationRule): AutomationRule {
  return {
    ...rule,
    actions: { ...rule.actions, autoBook: false },
    stats: { ...rule.stats, autoBookUndoneCount: rule.stats.autoBookUndoneCount + 1 },
    updatedAt: new Date().toISOString(),
  };
}
