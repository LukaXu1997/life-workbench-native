import { encryptText, decryptText } from './crypto';
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
    throw new Error('请先在「设置」填写并保存 Supabase 配置');
  }
  if (!pass) {
    throw new Error('请先输入加密密码（同步密码）');
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
    throw new Error(`下载失败 ${res.status}`);
  }
  const enc = await res.text();
  let json: string;
  try {
    json = await decryptText(enc, pass);
  } catch {
    throw new Error('解密失败：密码不正确或备份文件无效');
  }
  return JSON.parse(json) as Snapshot;
}

export async function backupNow(): Promise<CloudResult> {
  try {
    const cfg = await store.getSbConfig();
    const pass = await store.getSyncPass();
    if (!cfg.url || !cfg.key || !cfg.bucket || !cfg.path) {
      return { ok: false, msg: '请先在「设置」填写并保存 Supabase 配置' };
    }
    if (!pass) {
      return { ok: false, msg: '请先在「设置」设置加密密码（同步密码）' };
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
      const t = await res.text().catch(() => '');
      return { ok: false, msg: `上传失败 ${res.status}: ${t.slice(0, 160)}` };
    }
    await store.setSbLastSync(Date.now());
    return { ok: true, msg: '已备份到 Supabase ✓' };
  } catch (e: any) {
    return { ok: false, msg: '备份失败：' + (e?.message || String(e)) };
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
    if (v.empty) return { ok: false, msg: '云端备份为空，已拒绝覆盖本地数据' };
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
    return { ok: false, msg: '恢复预览失败：' + (e?.message || String(e)) };
  }
}

// Step 2: apply the previously previewed snapshot. Safety sequence:
//   1) take a local backup (so the restore can be undone)
//   2) apply the snapshot only after validation
//   3) never delete local data before the new data is validated
export async function confirmRestore(): Promise<CloudResult> {
  if (!pendingRestore) return { ok: false, msg: '没有待恢复的备份，请先点击「恢复」' };
  try {
    const v = verifySnapshot(pendingRestore);
    if (!v.ok) return { ok: false, msg: v.msg };
    if (v.empty) return { ok: false, msg: '云端备份为空，已拒绝覆盖本地数据' };
    await backupForUndo(); // safe rollback point
    await applySnapshot(pendingRestore);
    await store.setSbLastSync(Date.now());
    pendingRestore = null;
    return { ok: true, msg: '已从 Supabase 恢复 ✓' };
  } catch (e: any) {
    return { ok: false, msg: '恢复失败：' + (e?.message || String(e)) };
  }
}

export async function undoLastRestore(): Promise<CloudResult> {
  try {
    await storeUndoLastRestore();
    return { ok: true, msg: '已撤销上一次恢复，本地数据已还原' };
  } catch (e: any) {
    return { ok: false, msg: '撤销失败：' + (e?.message || String(e)) };
  }
}
