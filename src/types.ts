// Data model — mirrors the PWA's localStorage keys so backups are 1:1 compatible.

import type { ImportSource } from './import/models';

export type Currency = 'CNY' | 'MYR';
export type TxnType = 'income' | 'expense' | 'transfer' | 'repayment' | 'refund';
export type AccountType = 'cash' | 'debit' | 'credit' | 'ewallet';
export type Region = 'MY' | 'CN' | 'OTHER';
export type FxSource = 'system' | 'manual' | 'card' | 'migration';

// Schema/data model version. Bumped whenever the stored shape changes.
export const SCHEMA_VERSION = 2;

export interface Txn {
  id: string;
  type: TxnType;
  // --- legacy fields (kept for backward compatibility) ---
  currency: Currency;
  amount: number;
  // --- dual-currency fields (optional so pre-migration data still loads) ---
  origAmountMinor?: number; // integer minor units (sen/fen) in origCurrency
  origCurrency?: Currency;
  settleAmountMinor?: number; // integer minor units in settleCurrency
  settleCurrency?: Currency;
  fxRate?: number; // cnyPerMyr at transaction time (1 MYR = ¥fxRate)
  fxSource?: FxSource;
  accountId?: string; // source account (or transfer source)
  toAccountId?: string; // transfer destination
  region?: Region; // MY | CN | OTHER
  merchant?: string;
  cardId?: string; // linked credit-card account
  isCardTxn?: boolean;
  isPosted?: boolean; // bank posted final settle amount?
  postedAmountMinor?: number; // final CNY posted (credit card reconciliation)
  isRepaid?: boolean;
  linkedBillId?: string;
  linkedTxnId?: string; // repayment / refund / transfer linkage
  countInStats?: boolean; // count toward income/expense stats (default true)
  /** Whether this entry is a fixed / recurring income or expense (for statistics). Set by Quick Add "固定" option. */
  isRecurring?: boolean;
  /** Recurrence rule for auto-generation. `undefined` / 'none' = one-off. Templates
   *  carry this; generated instances get `recurrenceId` pointing back to the template. */
  recurrence?: 'none' | 'monthly' | 'weekly' | 'yearly';
  /** On a generated instance: the id of the template Txn that spawned it (dedup key). */
  recurrenceId?: string;
  // --- unbilled / 预算控制（spec §六·§七）---
  /** Originating platform (alipay / tng / ...). Set by the importer so cross-source
   *  matchers can tell a platform-consumption row from a bank settlement row. */
  source?: ImportSource;
  /** Which budget bucket this txn counts toward (defaults to its currency). */
  budgetCurrency?: Currency;
  /** Whether this txn deducts the budget. Wealth / reload / transfer = false. */
  affectsBudget?: boolean;
  /** Whether this txn counts as income/expense in the daily stats. Wealth = false. */
  affectsIncomeExpense?: boolean;
  /** Semantic nature (spec §六). 'normal' for ordinary spend/income. */
  transactionNature?: 'normal' | 'investment' | 'transfer' | 'repayment' | 'refund' | 'settlement';
  // --- common ---
  category: string;
  note: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM or '' — optional so older backups/PWA data stay compatible
  createdAt: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  balanceMinor?: number; // cash / debit / ewallet current balance
  openingBalanceMinor?: number; // explicit opening balance for recomputeAccounts (Phase 5+)
  creditLimitMinor?: number; // credit card limit
  currentBillMinor?: number; // credit card current bill
  unbilledMinor?: number; // credit card not-yet-posted amount
  repaidMinor?: number; // credit card repaid amount
  stmtDay?: number | null; // statement day 1-31
  dueDay?: number | null; // payment due day 1-31
  includeInNetWorth: boolean;
  showOnHome: boolean;
  order: number;
  createdAt: number;
}

export interface FxSetting {
  base: 'MYR'; // base currency is fixed to MYR
  cnyPerMyr: number; // 1 MYR = cnyPerMyr CNY
  rateScaled: number; // round(cnyPerMyr * 1e6) — integer for exact math
  rateUpdatedAt: number;
  rateSource: 'system' | 'manual';
}

export interface Budget {
  id: string;
  yearMonth: string; // YYYY-MM
  currency: Currency;
  /** Budget amount in INTEGER minor units (sen for MYR / fen for CNY). Never a
   *  float. UI input 1000.50 -> stored as 100050. */
  amountMinor: number;
  /** @deprecated legacy major-unit value (yuan). Migrated to `amountMinor` on
   *  read by store.getBudgets(); kept only so old backups still parse. */
  amount?: number;
}

export type HabitType = 'check' | 'count' | 'value';
export interface Habit {
  id: string;
  name: string;
  type: HabitType;
  target: number;
  unit: string;
  records: Record<string, number>; // date(YYYY-MM-DD) -> value (0/1 for check)
  createdAt: number;
}

export type Priority = 'P0' | 'P1' | 'P2';
export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}
export type RepeatFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface Task {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or ''
  priority: Priority;
  category: string;
  note: string;
  completed: boolean;
  createdAt: number;
  subtasks?: SubTask[]; // optional — backward compatible; absent = no subtasks
  repeat?: RepeatFrequency; // optional — backward compatible; absent/none = one-off task
}

export type ShopPriority = '高' | '中' | '低';
export interface ShopItem {
  id: string;
  name: string;
  category: string;
  priority: ShopPriority;
  estimatedPrice: number;
  currency: Currency;
  purchased: boolean;
  note: string;
  createdAt: number;
}

export type MediaType = 'book' | 'movie' | 'music';
export type MediaStatus = 'done' | 'doing' | 'want';
export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  creator: string;
  status: MediaStatus;
  rating: number; // 0-5
  review: string;
  createdAt: number;
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
  mood: string; // emoji
  createdAt: number;
}

export interface InboxItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface SbConfig {
  url: string;
  key: string;
  bucket: string;
  path: string;
  enabled: boolean;
  lastSync: number | null;
}

// ----- Quick post-payment bookkeeping: pending (unconfirmed) records -----
// Recognized notifications land here FIRST; they never enter the Txn ledger
// until the user confirms. Pending records are local-only (not in snapshots/backups).

export type PendingStatus = 'pending' | 'confirmed' | 'ignored' | 'matched';
export type PostingStatus = 'awaiting_posting' | 'posted' | null;

export interface PendingRecord {
  id: string;
  sourceApp: string; // package name, e.g. com.tngdigital.wallet
  sourceAppLabel?: string; // human label, e.g. "Touch 'n Go"
  rawDigest: string; // sha256(pkg|text) — safe digest, NOT raw text
  previewMasked?: string; // masked preview (merchant/amount tokens only)
  amountMinor: number; // integer minor units of `currency`
  currency: Currency;
  merchant?: string;
  notifiedAt: number; // epoch ms (when the notification arrived)
  suggestedAccountId?: string;
  suggestedCategory: string;
  confidence: number; // 0..1
  fingerprint: string; // structured match key (see dedup.ts)
  createdAt: number;
  status: PendingStatus;
  kind: 'expense' | 'income' | 'unknown';
  predictedSettleMinor?: number; // cross-currency predicted CNY posting
  postingStatus?: PostingStatus; // 'awaiting_posting' until bank posts
  bankRef?: string; // bank transaction reference, if extractable
  matchOfId?: string; // linked original pending/txn (posting match)
  txnId?: string; // set after confirmation -> the created Txn id
  needsReview?: boolean; // low-confidence flag
}

// What the recognizer produces before ids/timestamps are assigned.
export interface PendingDraft {
  amountMinor: number;
  currency: Currency;
  merchant?: string;
  kind: 'expense' | 'income' | 'unknown';
  confidence: number;
  suggestedAccountId?: string;
  suggestedCategory: string;
  predictedSettleMinor?: number;
  postingStatus?: PostingStatus;
  bankRef?: string;
  needsReview?: boolean;
  notifiedAt: number;
  fingerprintParts: {
    sourceApp: string;
    accountId?: string;
    amountMinor: number;
    currency: Currency;
    merchantNorm: string;
    dayBucket: string; // YYYY-MM-DD of notifiedAt
    bankRef?: string;
  };
}

// Settings for the notification-based quick-bookkeeping feature.
// NOTE: pending records are intentionally NOT included in backup/snapshot.
export interface NotifySettings {
  enabled: boolean; // user has toggled the feature on (requests notification access)
  paused: boolean; // recognition paused, but permission may still be granted
  allowlist: string[]; // package names allowed to be recognized
  confidenceFloor: number; // 0..1; below this -> needsReview
  fxOverride?: number; // optional manual cnyPerMyr override used for predicted settle
}

// The encrypted backup payload (matches PWA export shape + extras).
export interface Snapshot {
  // --- version metadata (new) ---
  schemaVersion?: number; // data-model version
  appVersion?: string; // app version that produced the snapshot
  createdAt?: string;
  updatedAt?: string;
  accounts?: Account[];
  fx?: FxSetting;
  // --- integrity & meta ---
  counts?: {
    txns: number;
    budgets: number;
    habits: number;
    tasks: number;
    shopping: number;
    media: number;
    journal: number;
    inbox: number;
    accounts: number;
  };
  checksum?: string;
  // --- payload ---
  txns: Txn[];
  budgets: Budget[];
  habits: Habit[];
  schedule: Task[];
  shopping: ShopItem[];
  media: MediaItem[];
  journal: JournalEntry[];
  inbox: InboxItem[];
  cardStmtDay: number | null;
  cardDueDay: number | null;
  version: string;
  exportedAt: string;
}
