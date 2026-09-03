import { encryptText, decryptText, SecureRandomUnavailableError } from './crypto';
import { SecureStoreUnavailableError } from './secure';
import { t } from './i18n';
import { store, takeSnapshot, applySnapshot, verifySnapshot, backupForUndo, undoLastRestore as storeUndoLastRestore } from './store';
import type { Snapshot } from './types';

function sbBase(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

export interface CloudResult {
  ok: boolean;
  msg: string;
}

export interface RestoreMeta {
  appVersion: string;
  schemaVersion: number | string;
  exportedAt: string;
  counts: any;
}

// Shared download + decrypt. Throws CloudResult-shaped errors (no sensitive data).
async function downloadDecrypted(): Promise<Snapshot> {
  const cfg = await store.getSbConfig();
  const pass = await store.getSyncPass();
  if (!cfg.url || !cfg.key || !cfg.bucket || !cfg.path) {
    throw new Error(t('cloud.cfgMissing'));
  }
  if (!pass) {
    throw new Error(t('cloud.passMissing'));
  }
  const base = sbBase(cfg.url);
  const path = cfg.path.trim().replace(/^\/+/, '');
  const url =
    base +
    '/storage/v1/object/' +
    encodeURIComponent(cfg.bucket) +
    '/' +
    encodeURIComponent(path);
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
  };
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(t('cloud.downloadFailed', { status: res.status }));
  }
  const enc = await res.text();
  let json: string;
  try {
    json = await decryptText(enc, pass);
  } catch {
    throw new Error(t('cloud.decryptFailed'));
  }
  return JSON.parse(json) as Snapshot;
}

export async function backupNow(): Promise<CloudResult> {
  try {
    const cfg = await store.getSbConfig();
    const pass = await store.getSyncPass();
    if (!cfg.url || !cfg.key || !cfg.bucket || !cfg.path) {
      return { ok: false, msg: t('cloud.cfgMissing') };
    }
    if (!pass) {
      return { ok: false, msg: t('cloud.passMissingSettings') };
    }
    const snap = await takeSnapshot();
    const json = JSON.stringify(snap);
    const enc = await encryptText(json, pass);

    const base = sbBase(cfg.url);
    const path = cfg.path.trim().replace(/^\/+/, '');
    const url = `${base}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${encodeURIComponent(path)}`;
    const headers: Record<string, string> = {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
    };
    const res = await fetch(url, { method: 'POST', headers, body: enc });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, msg: t('cloud.uploadFailed', { status: res.status, detail: body.slice(0, 160) }) };
    }
    await store.setSbLastSync(Date.now());
    return { ok: true, msg: t('cloud.backupOk') };
  } catch (e: any) {
    // Hard security failures must surface as recoverable, user-facing messages
    // and disable the cloud operation — never silently downgrade.
    if (e instanceof SecureRandomUnavailableError) {
      return { ok: false, msg: t('cloud.secureRandomUnavailable') };
    }
    if (e instanceof SecureStoreUnavailableError) {
      return { ok: false, msg: t('cloud.secureStoreUnavailable') };
    }
    return { ok: false, msg: t('cloud.backupFailed', { err: e?.message || String(e) }) };
  }
}

// Step 1: download, decrypt, verify — but DO NOT apply yet. Returns metadata for the
// user to review (time / app version / schema version / record counts).
let pendingRestore: Snapshot | null = null;

export async function previewRestore(): Promise<{ ok: boolean; msg: string; meta?: RestoreMeta }> {
  pendingRestore = null;
  try {
    const data = await downloadDecrypted();
    const v = verifySnapshot(data);
    if (!v.ok) return { ok: false, msg: v.msg };
    if (v.empty) return { ok: false, msg: t('cloud.emptyBackup') };
    pendingRestore = data;
    return {
      ok: true,
      msg: 'ok',
      meta: {
        appVersion: data.appVersion || data.version || '?',
        schemaVersion: data.schemaVersion ?? '?',
        exportedAt: data.exportedAt || data.createdAt || '',
        counts: data.counts,
      },
    };
  } catch (e: any) {
    return { ok: false, msg: t('cloud.previewFailed', { err: e?.message || String(e) }) };
  }
}

// Step 2: apply the previously previewed snapshot. Safety sequence:
//   1) take a local backup (so the restore can be undone)
//   2) apply the snapshot only after validation
//   3) never delete local data before the new data is validated
export async function confirmRestore(): Promise<CloudResult> {
  if (!pendingRestore) return { ok: false, msg: t('cloud.noPendingRestore') };
  try {
    const v = verifySnapshot(pendingRestore);
    if (!v.ok) return { ok: false, msg: v.msg };
    if (v.empty) return { ok: false, msg: t('cloud.emptyBackup') };
    await backupForUndo(); // safe rollback point
    await applySnapshot(pendingRestore);
    await store.setSbLastSync(Date.now());
    pendingRestore = null;
    return { ok: true, msg: t('cloud.restoreOk') };
  } catch (e: any) {
    return { ok: false, msg: t('cloud.restoreFailed', { err: e?.message || String(e) }) };
  }
}

export async function undoLastRestore(): Promise<CloudResult> {
  try {
    await storeUndoLastRestore();
    return { ok: true, msg: t('cloud.undoOk') };
  } catch (e: any) {
    return { ok: false, msg: t('cloud.undoFailed', { err: e?.message || String(e) }) };
  }
}
