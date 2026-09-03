// Pure, React-Native-free SOURCE detection.
//
// Given a file's kind + (decoded) content, decide WHICH adapter should handle it.
// This runs AFTER fileDetect (kind) and AFTER decoding (Phase 2/3). For binary
// containers (xlsx/pdf) that we cannot yet peek into in Phase 1, we return the
// kind-implied default source with reduced confidence; the adapter will confirm
// during parsing (Phase 3/4). No raw transaction text is ever recorded here.

import type { ImportFileKind, ImportSource } from './models';
import { validateLifeWorkbenchSnapshot } from './schemas';
import { isWechatXlsx } from './adapters/wechatXlsx';
import { isTngStatement } from './adapters/tngPdf';
import { isGrabCsv, isShopeeCsv, isLazadaCsv } from './adapters/myrEwalletCsv';

export interface SourceProbe {
  kind: ImportFileKind | 'unknown';
  name: string;
  /** Decoded text for text-based kinds (csv/json). Empty for xlsx/pdf in Phase 1. */
  text?: string;
  /** Raw bytes for binary containers (xlsx/pdf). Enables in-container detection. */
  bytes?: Uint8Array;
  /** Container-level flag for xlsx/pdf (set by the reader in later phases). */
  encrypted?: boolean;
  /** Optional header-preview rows (later phases fill this for xlsx). */
  previewRows?: string[][];
}

export interface SourceDetection {
  source: ImportSource;
  confidence: number; // 0..1
  /** Non-PII reason (for debugging / UI hint). Never contains raw row content. */
  reason: string;
  /** For pdf: whether the container is encrypted (drives the password dialog). */
  encrypted?: boolean;
}

// ---- Alipay CSV signature -------------------------------------------------
// Alipay statements ship with a recognizable header block. We key off the brand
// marker + at least one of the known column names. This avoids false positives
// on a generic CSV that merely contains the word "支付宝" in a note.
const ALIPAY_MARKERS = ['支付宝', '支付宝（中国）网络技术有限公司', '蚂蚁'] as const;
const ALIPAY_COLUMNS = [
  '交易时间',
  '交易创建时间',
  '交易号',
  '交易对方',
  '商品说明',
  '收/支',
  '金额',
  '收/付款方式',
  '交易分类',
  '交易状态',
] as const;

export function isAlipayCsv(text: string): boolean {
  if (!text || text.length < 8) return false;
  const hasBrand = ALIPAY_MARKERS.some((m) => text.includes(m));
  if (!hasBrand) return false;
  const cols = ALIPAY_COLUMNS.filter((c) => text.includes(c));
  return cols.length >= 2;
}

// ---- generic CSV (not Alipay) --------------------------------------------
export function isGenericCsv(text: string): boolean {
  if (!text || text.length < 2) return false;
  // A CSV has at least one delimiter-rich line. Heuristic only.
  const firstLines = text.slice(0, 4096).split(/\r?\n/).slice(0, 5).join('\n');
  const comma = (firstLines.match(/,/g) || []).length;
  const tab = (firstLines.match(/\t/g) || []).length;
  return comma + tab >= 2;
}

/**
 * Detect the source for a probed file. Returns the best-effort source plus a
 * confidence so the UI can confirm when uncertain (xlsx/pdf in Phase 1).
 */
export function detectSource(p: SourceProbe): SourceDetection {
  switch (p.kind) {
    case 'json': {
      const res = validateLifeWorkbenchSnapshot(p.text ?? '');
      if (res.ok) {
        return { source: 'lifeWorkbench', confidence: 1, reason: '生活工作台标准 JSON 校验通过' };
      }
      // Not a lifeWorkbench JSON, but it's still JSON — let the generic path warn.
      return {
        source: 'genericCsv', // placeholder; UI will show "unsupported JSON"
        confidence: 0.2,
        reason: 'JSON 不是生活工作台备份格式',
      };
    }
    case 'csv': {
      if (isAlipayCsv(p.text ?? '')) {
        return { source: 'alipay', confidence: 0.95, reason: '命中支付宝账单表头签名' };
      }
      if (isGrabCsv(p.text ?? '')) {
        return { source: 'grab', confidence: 0.95, reason: '命中 GrabPay 账单表头签名' };
      }
      if (isShopeeCsv(p.text ?? '')) {
        return { source: 'shopee', confidence: 0.95, reason: '命中 ShopeePay 账单表头签名' };
      }
      if (isLazadaCsv(p.text ?? '')) {
        return { source: 'lazada', confidence: 0.95, reason: '命中 Lazada 账单表头签名' };
      }
      if (isGenericCsv(p.text ?? '')) {
        return { source: 'genericCsv', confidence: 0.9, reason: '通用 CSV（可应用列映射）' };
      }
      return { source: 'genericCsv', confidence: 0.5, reason: '无法确定列结构，按通用 CSV 处理' };
    }
    case 'xlsx': {
      // If we have the raw bytes, peek inside for a WeChat Pay signature before
      // falling back to generic XLSX. This keeps the single unified import flow
      // (no separate "WeChat import" entry) while still routing correctly.
      if (p.bytes && p.bytes.length > 0 && isWechatXlsx(p.bytes)) {
        return {
          source: 'wechat',
          confidence: 0.9,
          reason: '命中微信支付账单表头签名',
          encrypted: p.encrypted,
        };
      }
      // Default to genericXlsx; the generic adapter will confirm columns later.
      // If encrypted, the password dialog is triggered regardless of source.
      return {
        source: 'genericXlsx',
        confidence: 0.5,
        reason: 'XLSX 容器（尚未确认具体来源，按通用 Excel 处理）',
        encrypted: p.encrypted,
      };
    }
    case 'pdf': {
      // Our only PDF source is TNG. Encrypted PDFs still route to TNG but flag
      // the password dialog. If extracted text is already available we can confirm.
      if (p.text && isTngStatement(p.text)) {
        return {
          source: 'tng',
          confidence: 0.85,
          reason: 'PDF 文本命中 TNG 账单特征',
          encrypted: p.encrypted,
        };
      }
      return {
        source: 'tng',
        confidence: 0.6,
        reason: 'PDF 账单（TNG 文本型适配器）',
        encrypted: p.encrypted,
      };
    }
    default:
      return { source: 'genericCsv', confidence: 0, reason: '无法识别的文件类型' };
  }
}
