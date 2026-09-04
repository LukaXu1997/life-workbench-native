import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Txn,
  Budget,
  Habit,
  Task,
  ShopItem,
  MediaItem,
  JournalEntry,
  InboxItem,
  SbConfig,
  Snapshot,
  Account,
  FxSetting,
  Currency,
} from './types';
import type { ImportBatch, ImportTemplate } from './import/models';
import { SCHEMA_VERSION } from './types';
import { VERSION_NAME } from './version';
import { clampDay, migrateTxns } from './migration';
import { secureGet, secureSet, secureDelete, SECURE_KEYS } from './secure';
import { sha256 } from '@noble/hashes/sha256';
import { t } from './i18n';
// Auto-booking data is part of the user's learned preferences and must travel
// with backups and Supabase sync, so its accessors are pulled into the snapshot.
import {
  getRules,
  setRules,
  getFeedback,
  setFeedback,
  getAutoBookSettings,
  setAutoBookSettings,
} from './automationStore';

// Key names MUST match the PWA (wb_life_*) so backups are 1:1 compatible.
export const KEYS = {
  txns: 'wb_life_txns',
  budgets: 'wb_life_budgets',
  habits: 'wb_life_habits',
  schedule: 'wb_life_schedule',
  shopping: 'wb_life_shopping',
  media: 'wb_life_media',
  journal: 'wb_life_journal',
  inbox: 'wb_life_inbox',
  theme: 'wb_life_theme',
  fxRate: 'wb_life_fx_rate',
  cardStmtDay: 'wb_life_card_stmt_day',
  cardDueDay: 'wb_life_card_due_day',
  accounts: 'wb_life_accounts',
  fx: 'wb_life_fx',
  schemaVersion: 'wb_life_schema_version',
  schemaBackup: 'wb_life_schema_backup',
  restoreBackup: 'wb_life_restore_backup',
  syncPass: 'wb_life_sync_pass',
  lastSync: 'wb_life_last_sync',
  sbUrl: 'wb_life_sb_url',
  sbKey: 'wb_life_sb_key',
  sbBucket: 'wb_life_sb_bucket',
  sbPath: 'wb_life_sb_path',
  sbEnabled: 'wb_life_sb_enabled',
  sbLastSync: 'wb_life_sb_last_sync',
  // ---- importer (local-only, NEVER included in Snapshot/backup, like pending) ----
  importBatches: 'wb_life_import_batches',
  importRollback: 'wb_life_import_rollback',
  importTemplates: 'wb_life_import_templates',
  // ---- user profile (local-only) ----
  profileName: 'wb_life_profile_name',
  profileAvatar: 'wb_life_profile_avatar',
  profileAvatarPhoto: 'wb_life_profile_avatar_photo',
  // ---- privacy: 隐藏余额开关（local-only） ----
  hideBalances: 'wb_life_hide_balances',
  // ---- onboarding: 首次启动引导是否已完成的标记（local-only） ----
  onboarded: 'wb_life_onboarded',
  // ---- privacy: 应用锁总开关旧键（V2.3.x）：V2.4.0 起语义迁移为「进入App时验证」 ----
  biometricLock: 'wb_life_biometric_lock',
  // ---- privacy: 进入 App 时验证（冷启动锁；默认关闭，由用户主动开启） ----
  biometricOnEntry: 'wb_life_biometric_on_entry',
  // ---- privacy: 回到 App 时重新验证（离开超过自动锁定时间后再次验证） ----
  biometricOnReturn: 'wb_life_biometric_on_return',
  // ---- privacy: 自动锁定时间（毫秒）：立即 0 / 30 秒 30000 / 1 分钟 60000 / 5 分钟 300000 ----
  biometricAutoLockMs: 'wb_life_biometric_auto_lock_ms',
  // ---- privacy: 隐藏最近任务画面（原生 FLAG_SECURE，防止任务缩略图泄露） ----
  biometricHideRecents: 'wb_life_biometric_hide_recents',
  // ---- privacy: 使用设备密码作为生物识别失败时的回退 ----
  biometricDeviceFallback: 'wb_life_biometric_device_fallback',
  // ---- privacy: 应用锁安全级别偏好（standard=弱/兼容，high=仅强识别） ----
  biometricSecurity: 'wb_life_biometric_security',
  // ---- privacy: 最近一次认证错误码（仅存非敏感的错误字面量，如 user_cancel） ----
  biometricLastError: 'wb_life_biometric_last_error',
};

const FX_DEFAULT = 1.65;

// A malformed or temporarily unreadable value must never be silently replaced
// by a fallback on the next write. Keep the affected key read-only for the rest
// of the process so the original bytes remain available for recovery.
const unreadableStorageKeys = new Set<string>();

export type StorageIssue = { key: string; kind: 'read' | 'parse' };
const storageIssues = new Map<string, StorageIssue>();

function recordStorageIssue(key: string, kind: StorageIssue['kind']) {
  unreadableStorageKeys.add(key);
  storageIssues.set(key, { key, kind });
  // Log the key only. Never include raw financial data or secret values.
  console.error(`[storage] ${kind} failure for key ${key}; writes are blocked until restart`);
}

export function getStorageIssues(): StorageIssue[] {
  return [...storageIssues.values()];
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function defaultFx(): FxSetting {
  const cnyPerMyr = FX_DEFAULT;
  return {
    base: 'MYR',
    cnyPerMyr,
    rateScaled: Math.round(cnyPerMyr * 1_000_000),
    rateUpdatedAt: Date.now(),
    rateSource: 'system',
  };
}

// Default accounts created on first migration so legacy txns have a home.
export function defaultAccounts(): Account[] {
  const now = Date.now();
  return [
    { id: uid('a'), name: t('seed.cashMyr'), type: 'cash', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 0, createdAt: now, balanceMinor: 0 },
    { id: uid('a'), name: t('seed.debitMyr'), type: 'debit', currency: 'MYR', includeInNetWorth: true, showOnHome: true, order: 1, createdAt: now, balanceMinor: 0 },
    { id: uid('a'), name: t('seed.debitCny'), type: 'debit', currency: 'CNY', includeInNetWorth: true, showOnHome: true, order: 2, createdAt: now, balanceMinor: 0 },
    { id: uid('a'), name: t('seed.creditCny'), type: 'credit', currency: 'CNY', includeInNetWorth: false, showOnHome: true, order: 3, createdAt: now, creditLimitMinor: 1000000, currentBillMinor: 0, unbilledMinor: 0, repaidMinor: 0, stmtDay: null, dueDay: null },
  ];
}

export function uid(prefix = 'x'): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    recordStorageIssue(key, 'read');
    return fallback;
  }
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    recordStorageIssue(key, 'parse');
    return fallback;
  }
}

async function setJSON(key: string, value: unknown): Promise<void> {
  if (unreadableStorageKeys.has(key)) {
    throw new Error(`Refusing to overwrite unreadable storage key: ${key}`);
  }
  await AsyncStorage.setItem(key, JSON.stringify(value));
  emitChange(key);
}

// ---- pub/sub so screens refresh across mutations ----
type Listener = (key?: string) => void;
const listeners = new Set<Listener>();
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emitChange(key?: string) {
  listeners.forEach((l) => l(key));
}

// ---- user profile: 显示名变更订阅（用于跨页同步到「今日」问候语） ----
const profileNameListeners = new Set<() => void>();
function emitProfileNameChange() {
  profileNameListeners.forEach((l) => l());
}

// ---- typed accessors ----
export const store = {
  getTxns: () => getJSON<Txn[]>(KEYS.txns, []),
  setTxns: (v: Txn[]) => setJSON(KEYS.txns, v),
  getBudgets: async () => {
    const list = await getJSON<Budget[]>(KEYS.budgets, []);
    // Idempotent migration: legacy budgets stored `amount` in major units (yuan).
    // Convert to integer minor units (sen/fen) so the budget amount is never a
    // float and can never be 100x off. Re-running is a no-op once amountMinor exists.
    return list.map((b) => {
      const legacy = (b as { amountMinor?: number; amount?: number }).amountMinor;
      if (typeof legacy === 'number') return b;
      const major = (b as { amount?: number }).amount;
      const amountMinor = typeof major === 'number' ? Math.round(major * 100) : 0;
      return { ...b, amountMinor };
    });
  },
  setBudgets: (v: Budget[]) => setJSON(KEYS.budgets, v),

  // ---- accounts ----
  getAccounts: () => getJSON<Account[]>(KEYS.accounts, []),
  setAccounts: (v: Account[]) => setJSON(KEYS.accounts, v),
  getDefaultAccountId: async (cur: Currency): Promise<string> => {
    let accounts = await store.getAccounts();
    if (accounts.length === 0) {
      accounts = defaultAccounts();
      await store.setAccounts(accounts);
    }
    const a =
      accounts.find((x) => x.currency === cur && x.type === 'debit') ??
      accounts.find((x) => x.currency === cur && x.type !== 'credit') ??
      accounts.find((x) => x.type !== 'credit') ??
      accounts[0];
    return a.id;
  },

  // ---- fx setting ----
  getFx: () => getJSON<FxSetting>(KEYS.fx, defaultFx()),
  setFx: (v: FxSetting) => setJSON(KEYS.fx, v),

  // ---- import batches (audit records, PII-free) + undo rollback snapshots ----
  getImportBatches: () => getJSON<ImportBatch[]>(KEYS.importBatches, []),
  setImportBatches: (v: ImportBatch[]) => setJSON(KEYS.importBatches, v),
  getImportRollback: () => getJSON<Record<string, Txn[]>>(KEYS.importRollback, {}),
  setImportRollback: (v: Record<string, Txn[]>) => setJSON(KEYS.importRollback, v),
  getImportTemplates: () => getJSON<ImportTemplate[]>(KEYS.importTemplates, []),
  setImportTemplates: (v: ImportTemplate[]) => setJSON(KEYS.importTemplates, v),

  // ---- schema version ----
  getSchemaVersion: () => getJSON<number>(KEYS.schemaVersion, 0),
  setSchemaVersion: (v: number) => setJSON(KEYS.schemaVersion, v),
  getHabits: () => getJSON<Habit[]>(KEYS.habits, []),
  setHabits: (v: Habit[]) => setJSON(KEYS.habits, v),
  getTasks: () => getJSON<Task[]>(KEYS.schedule, []),
  setTasks: (v: Task[]) => setJSON(KEYS.schedule, v),
  getShopping: () => getJSON<ShopItem[]>(KEYS.shopping, []),
  setShopping: (v: ShopItem[]) => setJSON(KEYS.shopping, v),
  getMedia: () => getJSON<MediaItem[]>(KEYS.media, []),
  setMedia: (v: MediaItem[]) => setJSON(KEYS.media, v),
  getJournal: () => getJSON<JournalEntry[]>(KEYS.journal, []),
  setJournal: (v: JournalEntry[]) => setJSON(KEYS.journal, v),
  getInbox: () => getJSON<InboxItem[]>(KEYS.inbox, []),
  setInbox: (v: InboxItem[]) => setJSON(KEYS.inbox, v),

  getTheme: () => getJSON<string>(KEYS.theme, 'auto'),
  setTheme: (v: string) => setJSON(KEYS.theme, v),
  getFxRate: async () => {
    const r = await getJSON<number>(KEYS.fxRate, FX_DEFAULT);
    return r && r > 0 ? r : FX_DEFAULT;
  },
  setFxRate: (v: number) => setJSON(KEYS.fxRate, v),
  // Read stmt/due from their separate keys (fixes the old read/write mismatch bug).
  getCardDays: async () => {
    const [stmt, due] = await Promise.all([
      getJSON<number | null>(KEYS.cardStmtDay, null),
      getJSON<number | null>(KEYS.cardDueDay, null),
    ]);
    return { stmt: clampDay(stmt), due: clampDay(due) };
  },
  setCardDays: (stmt: number | null, due: number | null) =>
    Promise.all([setJSON(KEYS.cardStmtDay, stmt), setJSON(KEYS.cardDueDay, due)]).then(() => {}),

  // ---- Supabase config (encrypted backup target) ----
  // The anon key is NOT a secret but we still keep it out of plain AsyncStorage
  // logging; it is stored in Android secure storage alongside the sync password.
  getSbConfig: async (): Promise<SbConfig> => {
    const [url, key, bucket, path, enabled, last] = await Promise.all([
      getJSON<string>(KEYS.sbUrl, ''),
      secureGet(SECURE_KEYS.sbKey),
      getJSON<string>(KEYS.sbBucket, 'backup'),
      getJSON<string>(KEYS.sbPath, 'life-workbench-backup.json'),
      getJSON<boolean>(KEYS.sbEnabled, false),
      getJSON<number | null>(KEYS.sbLastSync, null),
    ]);
    return { url, key, bucket, path, enabled, lastSync: last };
  },
  setSbConfig: async (c: SbConfig) => {
    await Promise.all([
      setJSON(KEYS.sbUrl, c.url),
      secureSet(SECURE_KEYS.sbKey, c.key),
      setJSON(KEYS.sbBucket, c.bucket),
      setJSON(KEYS.sbPath, c.path),
      setJSON(KEYS.sbEnabled, c.enabled),
    ]);
  },
  setSbEnabled: (on: boolean) => setJSON(KEYS.sbEnabled, on),
  setSbLastSync: (t: number) => setJSON(KEYS.sbLastSync, t),
  getSyncPass: () => secureGet(SECURE_KEYS.syncPass),
  setSyncPass: (p: string) => secureSet(SECURE_KEYS.syncPass, p),
  // ---- user profile ----
  getProfileName: () => getJSON<string>(KEYS.profileName, ''),
  setProfileName: (v: string) => {
    setJSON(KEYS.profileName, v);
    emitProfileNameChange();
  },
  onProfileNameChange: (fn: () => void): (() => void) => {
    profileNameListeners.add(fn);
    return () => { profileNameListeners.delete(fn); };
  },
  getProfileAvatar: () => getJSON<string>(KEYS.profileAvatar, 'me'),
  setProfileAvatar: (v: string) => setJSON(KEYS.profileAvatar, v),
  getProfileAvatarPhoto: () => getJSON<string | null>(KEYS.profileAvatarPhoto, null),
  setProfileAvatarPhoto: (v: string | null) => setJSON(KEYS.profileAvatarPhoto, v),
  // ---- privacy: 隐藏余额 ----
  getHideBalances: () => getJSON<boolean>(KEYS.hideBalances, false),
  setHideBalances: (v: boolean) => setJSON(KEYS.hideBalances, v),
  // ---- onboarding ----
  getOnboarded: () => getJSON<boolean>(KEYS.onboarded, false),
  setOnboarded: (v: boolean) => setJSON(KEYS.onboarded, v),
  // ---- app lock (face / fingerprint) —— legacy key kept for one-time migration ----
  getBiometricLock: () => getJSON<boolean>(KEYS.biometricLock, false),
  setBiometricLock: (v: boolean) => setJSON(KEYS.biometricLock, v),
  // ---- 进入 App 时验证（冷启动锁） ----
  // 首次读取时若新键不存在，从旧 key(biometricLock) 迁移，保证升级后行为不变。
  getBiometricOnEntry: async (): Promise<boolean> => {
    const v = await getJSON<boolean | null>(KEYS.biometricOnEntry, null);
    if (v !== null) return v;
    const legacy = await getJSON<boolean>(KEYS.biometricLock, false);
    await setJSON(KEYS.biometricOnEntry, legacy);
    return legacy;
  },
  setBiometricOnEntry: (v: boolean) => setJSON(KEYS.biometricOnEntry, v),
  // ---- 回到 App 时重新验证 ----
  getBiometricOnReturn: () => getJSON<boolean>(KEYS.biometricOnReturn, false),
  setBiometricOnReturn: (v: boolean) => setJSON(KEYS.biometricOnReturn, v),
  // ---- 自动锁定时间（毫秒） ----
  getBiometricAutoLockMs: () => getJSON<number>(KEYS.biometricAutoLockMs, 30_000),
  setBiometricAutoLockMs: (v: number) => setJSON(KEYS.biometricAutoLockMs, v),
  // ---- 隐藏最近任务画面（FLAG_SECURE） ----
  getBiometricHideRecents: () => getJSON<boolean>(KEYS.biometricHideRecents, false),
  setBiometricHideRecents: (v: boolean) => setJSON(KEYS.biometricHideRecents, v),
  // ---- 使用设备密码作为回退 ----
  getBiometricDeviceFallback: () => getJSON<boolean>(KEYS.biometricDeviceFallback, true),
  setBiometricDeviceFallback: (v: boolean) => setJSON(KEYS.biometricDeviceFallback, v),
  // ---- app lock security preference ----
  getBiometricSecurity: () => getJSON<'standard' | 'high'>(KEYS.biometricSecurity, 'standard'),
  setBiometricSecurity: (v: 'standard' | 'high') => setJSON(KEYS.biometricSecurity, v),
  // ---- last biometric auth error (non-sensitive code only) ----
  getBiometricLastError: () => getJSON<string | null>(KEYS.biometricLastError, null),
  setBiometricLastError: (v: string | null) => setJSON(KEYS.biometricLastError, v),
};

// ---- snapshot for backup/restore ----
export async function takeSnapshot(): Promise<Snapshot> {
  const [
    txns,
    budgets,
    habits,
    schedule,
    shopping,
    media,
    journal,
    inbox,
    cardDays,
    accounts,
    fx,
    automationRules,
    automationFeedback,
    automationSettings,
  ] = await Promise.all([
    store.getTxns(),
    store.getBudgets(),
    store.getHabits(),
    store.getTasks(),
    store.getShopping(),
    store.getMedia(),
    store.getJournal(),
    store.getInbox(),
    store.getCardDays(),
    store.getAccounts(),
    store.getFx(),
    getRules(),
    getFeedback(),
    getAutoBookSettings(),
  ]);
  const now = new Date().toISOString();
  const base: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: VERSION_NAME,
    createdAt: now,
    updatedAt: now,
    txns,
    budgets,
    habits,
    schedule,
    shopping,
    media,
    journal,
    inbox,
    accounts,
    fx,
    cardStmtDay: cardDays.stmt,
    cardDueDay: cardDays.due,
    version: VERSION_NAME,
    exportedAt: now,
    automationRules,
    automationFeedback,
    automationSettings,
  };
  const counts = {
    txns: txns.length,
    budgets: budgets.length,
    habits: habits.length,
    tasks: schedule.length,
    shopping: shopping.length,
    media: media.length,
    journal: journal.length,
    inbox: inbox.length,
    accounts: accounts.length,
  };
  // checksum over the canonical payload (everything except the checksum field)
  const checksum = toHex(sha256(JSON.stringify({ ...base, counts })));
  return { ...base, counts, checksum };
}

// Validate a snapshot's integrity and detect empty backups.
export function verifySnapshot(s: Partial<Snapshot>): { ok: boolean; empty: boolean; msg: string } {
  if (!s || typeof s !== 'object') return { ok: false, empty: false, msg: t('backup.invalidFormat') };
  if (s.checksum) {
    const { checksum, ...rest } = s as Record<string, any>;
    const calc = toHex(sha256(JSON.stringify(rest)));
    if (calc !== s.checksum) return { ok: false, empty: false, msg: t('backup.checksumFailed') };
  }
  const isEmpty =
    (!s.txns || s.txns.length === 0) &&
    (!s.schedule || s.schedule.length === 0) &&
    (!s.accounts || s.accounts.length === 0) &&
    (!s.habits || s.habits.length === 0) &&
    (!s.journal || s.journal.length === 0) &&
    (!s.inbox || s.inbox.length === 0) &&
    (!s.budgets || s.budgets.length === 0) &&
    (!s.media || s.media.length === 0);
  return { ok: true, empty: isEmpty, msg: '' };
}

// Snapshot the current data so a restore can be undone.
export async function backupForUndo(): Promise<void> {
  const snap = await takeSnapshot();
  await setJSON(KEYS.restoreBackup, { ...snap, backupAt: new Date().toISOString() });
}

export async function undoLastRestore(): Promise<void> {
  const b = await getJSON<any>(KEYS.restoreBackup, null);
  if (!b) throw new Error('没有可撤销的恢复');
  await applySnapshot(b);
}

export async function applySnapshot(data: Partial<Snapshot>): Promise<void> {
  const ops: Promise<void>[] = [];
  if (data.txns) ops.push(store.setTxns(data.txns));
  if (data.budgets) ops.push(store.setBudgets(data.budgets));
  if (data.habits) ops.push(store.setHabits(data.habits));
  if (data.schedule) ops.push(store.setTasks(data.schedule));
  if (data.shopping) ops.push(store.setShopping(data.shopping));
  if (data.media) ops.push(store.setMedia(data.media));
  if (data.journal) ops.push(store.setJournal(data.journal));
  if (data.inbox) ops.push(store.setInbox(data.inbox));
  if (data.accounts) ops.push(store.setAccounts(data.accounts));
  if (data.fx) ops.push(store.setFx(data.fx));
  if (data.cardStmtDay !== undefined || data.cardDueDay !== undefined) {
    ops.push(store.setCardDays(data.cardStmtDay ?? null, data.cardDueDay ?? null));
  }
  // Auto-booking learned data. Only written when present so restoring an older
  // snapshot (which lacks these fields) never clobbers current rules.
  if (data.automationRules) ops.push(setRules(data.automationRules));
  if (data.automationFeedback) ops.push(setFeedback(data.automationFeedback));
  if (data.automationSettings) ops.push(setAutoBookSettings(data.automationSettings));
  await Promise.all(ops);
}

// ---- schema migration (idempotent, backup-first) ----------------------------
// migrateV1ToV2:
//  - backs up the whole store before any write
//  - creates default accounts; moves the old (buggy) card stmt/due days into the credit account
//  - maps every legacy Txn to the dual-currency shape, preserving id (=> no duplicate records)
//  - marks old "信用卡还款" rows as repayment (countInStats=false) so they stop being double-counted
//  - on failure restores the backup and keeps schemaVersion at 0 (retry next launch)

let migrationPromise: Promise<void> | null = null;

// Move any plaintext secrets left in AsyncStorage into Android secure storage.
// Idempotent: it only acts when a plaintext value still exists. Call once per launch.
//
// Safety contract:
//   - The legacy plaintext is deleted ONLY AFTER the value is confirmed written
//     to the OS secure store (round-trip read-back matches).
//   - If the secure store is unavailable, the STRICT sync password is left in
//     place (we must never delete a password we failed to migrate) and sync is
//     disabled upstream via the recoverable error. No secret is ever logged.
export async function migrateSecrets(): Promise<void> {
  // --- Strict secret: sync password (never downgraded to AsyncStorage) ---
  try {
    const oldPass = await getJSON<string>(KEYS.syncPass, '');
    if (oldPass) {
      // secureSet throws SecureStoreUnavailableError if the OS store is missing;
      // in that case we keep the legacy plaintext and let sync stay disabled.
      await secureSet(SECURE_KEYS.syncPass, oldPass);
      const confirmed = await secureGet(SECURE_KEYS.syncPass);
      if (confirmed === oldPass) {
        await AsyncStorage.removeItem(KEYS.syncPass);
      }
    }
  } catch (e) {
    // Best-effort: secure store may be unavailable on some emulators/CI.
    // Log the error name only — never the password or any secret material.
    console.warn(
      `[store] migrateSecrets: sync password not migrated (${e instanceof Error ? e.name : 'unknown'})`
    );
  }

  // --- Non-secret: Supabase anon key (downgrade-friendly, but still verify) ---
  try {
    const oldKey = await getJSON<string>(KEYS.sbKey, '');
    if (oldKey) {
      await secureSet(SECURE_KEYS.sbKey, oldKey);
      const confirmed = await secureGet(SECURE_KEYS.sbKey);
      if (confirmed === oldKey) {
        await AsyncStorage.removeItem(KEYS.sbKey);
      }
    }
  } catch {
    /* non-fatal; the anon key is not a secret */
  }
}

export function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await migrateSecrets();
      await doMigrate();
    })().catch((e) => {
      migrationPromise = null; // allow retry on next launch
      throw e;
    });
  }
  return migrationPromise;
}

async function doMigrate(): Promise<void> {
  const v = await store.getSchemaVersion();
  if (v >= SCHEMA_VERSION) return; // already migrated — never re-run

  // 1. full backup BEFORE touching anything
  const backup = await takeSnapshot();
  await setJSON(KEYS.schemaBackup, { ...backup, backupAt: new Date().toISOString() });

  try {
    // 2. load current data
    const [txns, cardDays] = await Promise.all([store.getTxns(), store.getCardDays()]);

    // 3. ensure default accounts; move old card days into the credit account
    let accounts = await store.getAccounts();
    if (accounts.length === 0) accounts = defaultAccounts();
    const cardAcct = accounts.find((a) => a.type === 'credit');
    if (cardAcct) {
      if (cardDays.stmt != null) cardAcct.stmtDay = clampDay(cardDays.stmt);
      if (cardDays.due != null) cardAcct.dueDay = clampDay(cardDays.due);
    }

    // 4. migrate each txn (preserves id => idempotent, no duplicate records)
    const { migrated } = migrateTxns(txns as any[], accounts);

    // 5. validate before replacing
    if (migrated.some((t) => !t.id || t.origAmountMinor == null)) {
      throw new Error('migration validation failed');
    }

    // 6. commit & bump version
    await store.setAccounts(accounts);
    await store.setTxns(migrated);
    await store.setSchemaVersion(SCHEMA_VERSION);
  } catch (e) {
    // restore old data, keep schemaVersion at 0 so next launch retries
    const b = await getJSON<any>(KEYS.schemaBackup, null);
    if (b) await applySnapshot(b);
    await store.setSchemaVersion(0);
    throw e;
  }
}

// ---- date helpers ----
// Date helpers live in src/datetime.ts (pure, RN-free); re-export so existing
// importers of `store.todayStr` / `store.ymStr` keep working unchanged.
import { todayStr, ymStr } from './datetime';
export { todayStr, ymStr };
