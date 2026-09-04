import { encryptText, decryptText, SecureRandomUnavailableError } from './crypto';
import { SecureStoreUnavailableError } from './secure';
import { t } from './i18n';
import {
  store,
  takeSnapshot,
  applySnapshot,
  verifySnapshot,
  backupForUndo,
} from './store';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Snapshot } from './types';

export interface LocalRestoreMeta {
  appVersion: string;
  schemaVersion: number | string;
  exportedAt: string;
  counts: any;
}

// Local import / export uses the EXACT same security envelope as cloud sync:
// AES-256-GCM + PBKDF2, keyed by the user's sync password. A local .json file
// is therefore cryptographically identical to a cloud backup — portable, and
// useless without the password. No new crypto, no new key.
let pendingRestore: Snapshot | null = null;

export async function exportLocalBackup(): Promise<{ ok: boolean; msg: string }> {
  try {
    const pass = await store.getSyncPass();
    if (!pass) return { ok: false, msg: t('cloud.passMissingSettings') };
    const snap = await takeSnapshot();
    const enc = await encryptText(JSON.stringify(snap), pass);
    const fname = `life-workbench-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const uri = `${FileSystem.cacheDirectory}${fname}`;
    await FileSystem.writeAsStringAsync(uri, enc);
    const available = await Sharing.isAvailableAsync().catch(() => true);
    if (!available) return { ok: false, msg: t('settings.shareUnavailable') };
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: t('settings.exportTitle'),
    });
    return { ok: true, msg: t('settings.exportOk') };
  } catch (e: any) {
    if (e instanceof SecureRandomUnavailableError) {
      return { ok: false, msg: t('cloud.secureRandomUnavailable') };
    }
    if (e instanceof SecureStoreUnavailableError) {
      return { ok: false, msg: t('cloud.secureStoreUnavailable') };
    }
    return { ok: false, msg: t('settings.exportFailed', { err: e?.message || String(e) }) };
  }
}

export async function previewLocalRestore(): Promise<{
  ok: boolean;
  msg: string;
  meta?: LocalRestoreMeta;
}> {
  pendingRestore = null;
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets || res.assets.length === 0) {
      return { ok: false, msg: '' };
    }
    const uri = res.assets[0].uri;
    const enc = await FileSystem.readAsStringAsync(uri);
    const pass = await store.getSyncPass();
    if (!pass) return { ok: false, msg: t('cloud.passMissingSettings') };
    let json: string;
    try {
      json = await decryptText(enc, pass);
    } catch {
      return { ok: false, msg: t('cloud.decryptFailed') };
    }
    let data: Snapshot;
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: false, msg: t('settings.invalidBackup') };
    }
    const v = verifySnapshot(data);
    if (!v.ok) return { ok: false, msg: v.msg };
    if (v.empty) return { ok: false, msg: t('cloud.emptyBackup') };
    pendingRestore = data;
    return {
      ok: true,
      msg: 'ok',
      meta: {
        appVersion: data.appVersion || (data as any).version || '?',
        schemaVersion: data.schemaVersion ?? '?',
        exportedAt: data.exportedAt || (data as any).createdAt || '',
        counts: (data as any).counts,
      },
    };
  } catch (e: any) {
    return { ok: false, msg: t('settings.importFailed', { err: e?.message || String(e) }) };
  }
}

export async function confirmLocalRestore(): Promise<{ ok: boolean; msg: string }> {
  if (!pendingRestore) return { ok: false, msg: t('cloud.noPendingRestore') };
  try {
    const v = verifySnapshot(pendingRestore);
    if (!v.ok) return { ok: false, msg: v.msg };
    if (v.empty) return { ok: false, msg: t('cloud.emptyBackup') };
    // Safe rollback point, then apply — identical safety sequence to cloud restore.
    await backupForUndo();
    await applySnapshot(pendingRestore);
    pendingRestore = null;
    return { ok: true, msg: t('settings.importOk') };
  } catch (e: any) {
    return { ok: false, msg: t('cloud.restoreFailed', { err: e?.message || String(e) }) };
  }
}
