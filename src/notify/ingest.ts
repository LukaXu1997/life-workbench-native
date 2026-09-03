import type { NotifyEnvelope } from './types';
import type { PendingRecord, PendingStatus } from '../types';
import { parseEnvelope } from './parsers';
import { recognize, type RecognizeContext } from './recognizer';
import { rawDigestOf, fingerprintOf, findPostingMatch } from './dedup';
import { maskedPreview } from './redact';
import { formatMoney } from '../money';
import { uid } from './uid';

export interface IngestResult {
  record?: PendingRecord;
  skip?: 'dup' | 'no-amount';
  matchId?: string | 'ambiguous';
}

export const APP_LABELS: Record<string, string> = {
  'my.com.tngdigital.ewallet': "Touch 'n Go",
  'com.tngdigital.wallet': "Touch 'n Go", // legacy / region variant — keep for backward compat + tests
  'com.grabtaxi.passenger': 'GrabPay',
  'com.shopee.my': 'ShopeePay',
  'com.lazada.android': 'Lazada',
  'my.boost.app': 'Boost',
  'com.themakecompany.mymaybank.mae': 'MAE',
  'com.bigpay': 'BigPay',
  'com.maybank.mobile': 'Maybank',
  'com.cimb.android': 'CIMB',
  'com.rhbgroup': 'RHB',
  'com.publicbank': 'Public Bank',
  'com.ambank': 'AmBank',
  'com.eg.android.AlipayGphone': 'Alipay',
  'com.tencent.mm': 'WeChat',
  'com.xunmeng.pinduoduo': '拼多多',
  'com.icbc': 'ICBC',
  'com.ccb': 'CCB',
  'com.abchina': 'ABC',
  'com.bankcomm': 'BoCom',
  'com.cmbchina': 'CMB',
};

export function labelForApp(pkg: string): string {
  return APP_LABELS[pkg] ?? pkg;
}

/**
 * Turn one notification envelope into a PendingRecord (or report a skip).
 * Pure: takes the current pending list as input, returns a record to be persisted
 * by the caller. Never touches storage or the React Native layer.
 */
export function ingestEnvelope(
  env: NotifyEnvelope,
  ctx: RecognizeContext,
  existing: PendingRecord[]
): IngestResult {
  const digest = rawDigestOf(env);
  if (existing.some((r) => r.rawDigest === digest)) return { skip: 'dup' };

  const draft = recognize(env, ctx);
  if (!draft) return { skip: 'no-amount' };

  // A CNY "posted" notification may be the bank's official posting of an earlier
  // MYR cross-currency spend -> try to link it to the original awaiting posting.
  let matchId: string | 'ambiguous' | null = null;
  if (draft.postingStatus === 'posted' && draft.currency === 'CNY' && draft.suggestedAccountId) {
    matchId = findPostingMatch(draft, existing);
  }

  const matched = matchId != null && matchId !== 'ambiguous';
  const status: PendingStatus = matched ? 'matched' : 'pending';

  let predictedSettleMinor = draft.predictedSettleMinor;
  if (matched) {
    const orig = existing.find((r) => r.id === matchId);
    if (orig) predictedSettleMinor = orig.predictedSettleMinor ?? draft.predictedSettleMinor;
  }

  const record: PendingRecord = {
    id: uid('pn'),
    sourceApp: env.pkg,
    sourceAppLabel: labelForApp(env.pkg),
    rawDigest: digest,
    previewMasked: maskedPreview(draft.merchant ?? '', formatMoney(draft.amountMinor, draft.currency)),
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    merchant: draft.merchant,
    notifiedAt: env.postedAt,
    suggestedAccountId: draft.suggestedAccountId,
    suggestedCategory: draft.suggestedCategory,
    confidence: draft.confidence,
    fingerprint: fingerprintOf(draft),
    createdAt: Date.now(),
    status,
    kind: draft.kind,
    predictedSettleMinor,
    postingStatus: draft.postingStatus,
    bankRef: draft.bankRef,
    matchOfId: matched ? (matchId as string) : undefined,
    needsReview: draft.needsReview || matchId === 'ambiguous' || undefined,
  };
  return { record };
}
