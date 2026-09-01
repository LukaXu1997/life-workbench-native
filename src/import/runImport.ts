// RN-side orchestration: pick a statement file -> bytes -> detect -> parse ->
// UnifiedPreview. Everything below this file is pure/RN-free; this module is the
// only place that touches the document picker, the file system, and the native
// PDF extractor.
//
// PRIVACY: the file never leaves the device. Only the file NAME (never the full
// path) is surfaced to the UI, and no raw transaction text is ever logged.

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { b64ToBytes } from '../base64';
import { extractPdfText } from '../native/PdfTextExtractor';
import { PdfPasswordSession } from './pdfPassword';
import { runPdfExtractFlow } from './pdfExtractFlow';
import { probeFile } from './fileDetect';
import { detectSource, type SourceDetection } from './sourceDetect';
import { parseAlipayFile } from './adapters/alipayCsv';
import { parseWechatFile, isWechatXlsx } from './adapters/wechatXlsx';
import { parseTngText } from './adapters/tngPdf';
import { validateLifeWorkbenchSnapshot } from './schemas';
import { migrateSnapshotV1ToV2 } from './migration';
import { buildImportPreview, type UnifiedPreview } from './unify';
import type { ImportCandidate, ImportSource, ImportFileKind } from './models';

export interface PickedFile {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
}

export interface PrepareOptions {
  /** UI hook: show the PDF password dialog. Return null to cancel. */
  onNeedPassword?: (wrongPassword: boolean) => Promise<string | null>;
  /** cnyPerMyr * 1e6 — display-only estimate (never written to settle facts). */
  rateScaled?: number;
}

export interface PrepareResult {
  ok: boolean;
  preview?: UnifiedPreview;
  candidates?: ImportCandidate[];
  fileName?: string;
  source?: ImportSource;
  kind?: ImportFileKind | 'unknown';
  detection?: SourceDetection;
  /** Scanned (text-layer-less) PDF — UI should offer OCR guidance. */
  scanned?: boolean;
  cancelled?: boolean;
  reason?: string;
}

/** Open the system file picker for a statement file. */
export async function pickStatementFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, size: a.size, mimeType: a.mimeType ?? undefined };
}

/** Read a content URI into bytes (base64 round-trip; no temp files kept). */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return b64ToBytes(b64);
}

/**
 * Turn a picked file into a UnifiedPreview. Dispatches on the detected container
 * kind + source, and never falls back to "try the other adapter" — a platform
 * mismatch is reported as an error (IMPLEMENTATION_PLAN §6.4 #12).
 */
export async function prepareImport(
  file: PickedFile,
  opts: PrepareOptions = {}
): Promise<PrepareResult> {
  let bytes: Uint8Array;
  try {
    bytes = await readFileBytes(file.uri);
  } catch (e) {
    return { ok: false, reason: '文件读取失败' };
  }

  const probe = probeFile({ bytes, name: file.name, size: file.size });
  if (!probe.sizeOk) {
    return { ok: false, reason: '文件过大，已超出导入上限' };
  }
  const kind = probe.kind;

  // ---- PDF: extract text on-device (encrypted -> password dialog) ----
  if (kind === 'pdf') {
    const session = new PdfPasswordSession();
    const flow = await runPdfExtractFlow({
      uri: file.uri,
      session,
      extract: async (uri, s) => extractPdfText(uri, s.get() ?? undefined),
      onNeedPassword: opts.onNeedPassword ?? (async () => null),
    });
    if (!flow.ok) {
      return { ok: false, scanned: flow.scanned, cancelled: flow.cancelled, reason: flow.reason };
    }
    const parsed = parseTngText({ name: file.name, text: flow.text ?? '' });
    if (!parsed.ok) {
      return { ok: false, scanned: parsed.scanned, reason: parsed.reason };
    }
    return finish(parsed.result.candidates, file.name, 'tng', kind, opts.rateScaled);
  }

  // ---- XLSX: WeChat workbook ----
  if (kind === 'xlsx') {
    const isWechat = isWechatXlsx(bytes);
    const detection = detectSource({ kind, name: file.name, bytes });
    if (isWechat || detection.source === 'wechat') {
      const parsed = parseWechatFile({ name: file.name, bytes });
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      return finish(parsed.result.candidates, file.name, 'wechat', kind, opts.rateScaled, detection);
    }
    return { ok: false, reason: '该 XLSX 不是微信支付账单；通用 XLSX 映射尚未开放' };
  }

  // ---- CSV: Alipay (GB18030/UTF-8 auto) ----
  if (kind === 'csv') {
    const parsed = parseAlipayFile({ name: file.name, bytes });
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    // parseAlipayFile runs the adapter's own header validation, so a successful
    // parse IS an Alipay statement — no separate source detection needed.
    return finish(parsed.result.candidates, file.name, 'alipay', kind, opts.rateScaled);
  }

  // ---- JSON: life-workbench snapshot (zod-validated + migrated) ----
  if (kind === 'json') {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { ok: false, reason: 'JSON 解析失败' };
    }
    let snapshot: any = raw;
    if (snapshot && snapshot.schemaVersion === 1) {
      snapshot = migrateSnapshotV1ToV2(snapshot);
    }
    const v = validateLifeWorkbenchSnapshot(snapshot);
    if (!v.ok) return { ok: false, reason: v.error.message };
    const candidates: ImportCandidate[] = (v.data.txns ?? []).map((t: any, i: number) => ({
      id: `lw_${i}_${t.id ?? ''}`,
      source: 'lifeWorkbench' as ImportSource,
      sourceFile: file.name,
      rowIndex: i,
      txnType: (t.type ?? 'expense') as ImportCandidate['txnType'],
      amountMinor: t.origAmountMinor ?? Math.round((t.amount ?? 0) * 100),
      currency: (t.origCurrency ?? t.currency ?? 'CNY') as ImportCandidate['currency'],
      merchant: t.merchant,
      category: t.category,
      accountHint: t.accountId,
      date: t.date,
      time: t.time,
      origAmountMinor: t.origAmountMinor,
      origCurrency: t.origCurrency,
      settleAmountMinor: t.settleAmountMinor,
      settleCurrency: t.settleCurrency,
      warnings: [],
      rawRef: t.id,
    }));
    return finish(candidates, file.name, 'lifeWorkbench', kind, opts.rateScaled);
  }

  return { ok: false, reason: `不支持的文件类型（${kind}）` };
}

function finish(
  candidates: ImportCandidate[],
  fileName: string,
  source: ImportSource,
  kind: ImportFileKind | 'unknown',
  rateScaled?: number,
  detection?: SourceDetection
): PrepareResult {
  if (candidates.length === 0) {
    return { ok: false, reason: '未从该文件中解析出任何交易记录' };
  }
  const preview = buildImportPreview(candidates, { rateScaled });
  return {
    ok: true,
    preview,
    candidates,
    fileName,
    source,
    kind,
    detection,
  };
}
