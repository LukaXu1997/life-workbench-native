// Store + native wiring for the "quick post-payment bookkeeping" feature.
//
// Pending records are deliberately kept OUT of the app snapshot/backup (see types.ts
// note). They live in their own AsyncStorage key and are surfaced to the user for
// confirmation before anything touches the real Txn ledger.
//
// Privacy contract (enforced here + native side):
//  - Raw notification text is never persisted; only a safe digest + extracted fields.
//  - The native service only forwards notifications from user-allowlisted packages.
//  - Config is pushed to native so it can stop reading entirely when paused/disabled.

import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Account, FxSetting, NotifySettings, PendingRecord, Txn } from '../types';
import { store } from '../store';
import {
  drainNotifyQueue,
  isListenerEnabled,
  onNotifyReceived,
  openNotifySettings,
  setNotifyConfig,
} from './NativeNotifyModule';
import { ingestEnvelope } from './ingest';
import { CNY_CARD_APPS } from './parsers';
import type { NotifyEnvelope } from './types';

const PENDING_KEY = 'wb_life_pending';
const NOTIFY_SETTINGS_KEY = 'wb_life_notify_settings';

export function defaultNotifySettings(): NotifySettings {
  return { enabled: false, paused: false, allowlist: [], confidenceFloor: 0.4 };
}

/* ---------------------------------- read/write pending -------------------------- */

export async function getPending(): Promise<PendingRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingRecord[]) : [];
  } catch {
    return [];
  }
}

export async function setPending(records: PendingRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(records));
  } catch {
    /* best-effort */
  }
  emitPendingChange();
}

export async function addPending(rec: PendingRecord): Promise<PendingRecord[]> {
  const all = await getPending();
  all.push(rec);
  await setPending(all);
  return all;
}

/** Only records that still need a user decision (pending + bank-posted matches). */
export function actionablePending(records: PendingRecord[]): PendingRecord[] {
  return records.filter((r) => r.status === 'pending' || r.status === 'matched');
}

/* ----------------------------- notify settings -------------------------------- */

export async function getNotifySettings(): Promise<NotifySettings> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFY_SETTINGS_KEY);
    if (raw) return { ...defaultNotifySettings(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultNotifySettings();
}

export async function setNotifySettings(s: NotifySettings): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFY_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  applyNotifyConfig(s);
  emitPendingChange();
}

/**
 * Push the latest enable/pause/allowlist down to the native NotificationListenerService.
 * Native `isAllowed()` is `enabled && !paused && allowSet.contains(pkg)`, so when the
 * user disables or pauses, the service stops forwarding immediately (graceful degrade).
 */
export function applyNotifyConfig(s: NotifySettings): void {
  // Only mark the service "enabled" if there is at least one allowlisted app, so we
  // never tell the OS we are listening when nothing is selected.
  setNotifyConfig({
    enabled: s.enabled && s.allowlist.length > 0,
    paused: s.paused,
    allowlist: s.allowlist,
  });
}

/** Whether the OS has granted this app notification-listener access. */
export function notifyListenerEnabled(): Promise<boolean> {
  return isListenerEnabled();
}

/** Open the system notification-access settings (must be a user-initiated call). */
export function openNotificationSettings(): void {
  openNotifySettings();
}

/* --------------------------- ingest (notification -> pending) ----------------- */

/**
 * Turn notification envelopes into pending records and persist them.
 * Pure-ish: builds the context from the store, then feeds each envelope through
 * `ingestEnvelope` (digest dedup + recognize + posting-match). Returns how many
 * new records were added. Existing pending is threaded through so a burst of
 * duplicate/matched notifications collapses to at most one record.
 */
export async function ingestEnvelopes(envs: NotifyEnvelope[]): Promise<number> {
  if (envs.length === 0) return 0;
  const [accounts, fx, settings] = await Promise.all([
    store.getAccounts(),
    store.getFx(),
    getNotifySettings(),
  ]);
  const ctx = {
    accounts,
    // Honour an explicit fx override if the user set one; otherwise fall back to the
    // global exchange-rate setting used everywhere else.
    rateScaled:
      settings.fxOverride && settings.fxOverride > 0
        ? Math.round(settings.fxOverride * 1_000_000)
        : fx.rateScaled,
    cnyCardApps: CNY_CARD_APPS,
    confidenceFloor: settings.confidenceFloor,
  };
  let existing = await getPending();
  let added = 0;
  for (const env of envs) {
    const res = ingestEnvelope(env, ctx, existing);
    if (res.record) {
      existing = [...existing, res.record];
      added++;
    }
  }
  if (added > 0) await setPending(existing);
  return added;
}

export async function ingestEnvelopeToStore(env: NotifyEnvelope): Promise<number> {
  return ingestEnvelopes([env]);
}

/* ------------------------- native receiver lifecycle -------------------------- */

let receiverStarted = false;
let liveOff: (() => void) | null = null;

/**
 * Drain the durable envelope queue (covers time JS was not active) and subscribe to
 * live notification events. Idempotent — safe to call on every app focus. Any previous
 * live subscription is removed first so we never double-subscribe.
 * Returns a cleanup function that removes the live listener.
 */
export function startNotifyReceiver(): () => void {
  // Drain queue (durable file cleared by native after read; safe to repeat).
  drainNotifyQueue()
    .then((envs) => {
      if (envs.length) ingestEnvelopes(envs).catch(() => {});
    })
    .catch(() => {});

  // Live events while JS is active — replace any prior subscription.
  if (liveOff) {
    liveOff();
    liveOff = null;
  }
  liveOff = onNotifyReceived((env) => {
    ingestEnvelopeToStore(env).catch(() => {});
  });

  return () => {
    if (liveOff) {
      liveOff();
      liveOff = null;
    }
  };
}

/** Convenience used by App bootstrap: start once and re-drain on each foreground. */
export function ensureReceiverStarted(): () => void {
  const off = startNotifyReceiver();
  if (!receiverStarted) receiverStarted = true;
  return off;
}

/* ------------------------------ pub/sub + hooks ------------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();
function emitPendingChange() {
  listeners.forEach((l) => l());
}

export function onPendingChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePending(): PendingRecord[] {
  const [list, setList] = useState<PendingRecord[]>([]);
  useEffect(() => {
    let alive = true;
    const reload = async () => {
      const p = await getPending();
      if (alive) setList(p);
    };
    reload();
    const off = onPendingChange(reload);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}

export function useActionablePending(): PendingRecord[] {
  const list = usePending();
  return actionablePending(list);
}

export function usePendingCount(): number {
  return useActionablePending().length;
}

/* -------------------------------- re-exports ---------------------------------- */

export type { Account, FxSetting, NotifySettings, PendingRecord, Txn };
