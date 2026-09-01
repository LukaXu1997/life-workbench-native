import type { Account, Currency, PendingDraft, PostingStatus } from '../types';
import type { NotifyEnvelope } from './types';
import { parseEnvelope } from './parsers';
import { convertMinor } from '../money';

export interface RecognizeContext {
  accounts: Account[];
  rateScaled: number; // round(cnyPerMyr * 1e6)
  cnyCardApps: Set<string>;
  confidenceFloor?: number; // below this -> needsReview
}

export function normMerchant(s?: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]/g, '');
}

// Merchant keyword -> category (matches the app's existing CNY/MYR category vocabulary).
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/starbucks|coffee|kfc|mcdonald|subway|restaurant|餐厅|咖啡|奶茶|grab food|foodpanda|星巴克|麦当劳|肯德基|汉堡|披萨/i, '餐饮'],
  [/grab|uber|lrt|mrt|myrapid|touch n go|petronas|shell| petrol|汽油|停车|taxi|klia|airasia/i, '交通'],
  [/shopee|lazada|tesco|giant|aeon|1010|guardian|watson|超市|购物|mr\.? diy|ikea/i, '购物'],
  [/cinema|netflix|spotify|steam|game|电影|游戏|娱乐/i, '娱乐'],
  [/telekom|maxis|celcom|umobile|digi|unifi|话费|流量|电费|air limbah|indah water|水电/i, '账单'],
  [/guardian|watsons|pharmacy|药|医院|clinic|诊所/i, '医疗'],
];

function suggestCategory(merchant?: string): string {
  if (!merchant) return '其他';
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(merchant)) return cat;
  }
  return '其他';
}

function suggestAccount(
  parsedHint: 'myr_ewallet' | 'myr_bank' | 'cny_bank' | 'cny_credit' | undefined,
  currency: Currency,
  isCross: boolean,
  accounts: Account[]
): string | undefined {
  if (currency === 'CNY' || isCross) {
    const credit = accounts.find((a) => a.type === 'credit' && a.currency === 'CNY');
    if (credit) return credit.id;
    const debit = accounts.find((a) => a.type === 'debit' && a.currency === 'CNY');
    if (debit) return debit.id;
  }
  if (currency === 'MYR') {
    if (parsedHint === 'myr_ewallet') {
      const ew = accounts.find((a) => a.type === 'ewallet' && a.currency === 'MYR');
      if (ew) return ew.id;
    }
    const debit = accounts.find((a) => a.type === 'debit' && a.currency === 'MYR');
    if (debit) return debit.id;
  }
  return undefined;
}

/**
 * Turn a notification envelope into a PendingDraft (or null if unparseable).
 * Does NOT persist anything — the store layer creates the PendingRecord.
 */
export function recognize(env: NotifyEnvelope, ctx: RecognizeContext): PendingDraft | null {
  const parsed = parseEnvelope(env);
  if (!parsed || parsed.amountMinor == null || !parsed.currency) return null;

  const isCross = parsed.currency === 'MYR' && ctx.cnyCardApps.has(env.pkg);
  const accountId = suggestAccount(parsed.accountHint, parsed.currency, isCross, ctx.accounts);

  let predictedSettleMinor: number | undefined;
  let postingStatus: PostingStatus = null;
  if (isCross) {
    predictedSettleMinor = convertMinor(parsed.amountMinor, 'MYR', ctx.rateScaled);
    postingStatus = 'awaiting_posting';
  } else if (parsed.currency === 'CNY') {
    postingStatus = 'posted'; // CNY amount is already the final posted amount
  }

  const floor = ctx.confidenceFloor ?? 0;
  const needsReview = parsed.confidence < floor;
  const dayBucket = new Date(env.postedAt).toISOString().slice(0, 10);

  return {
    amountMinor: parsed.amountMinor,
    currency: parsed.currency,
    merchant: parsed.merchant,
    kind: parsed.kind,
    confidence: parsed.confidence,
    suggestedAccountId: accountId,
    suggestedCategory: suggestCategory(parsed.merchant),
    predictedSettleMinor,
    postingStatus,
    bankRef: parsed.bankRef,
    needsReview: needsReview || undefined,
    notifiedAt: env.postedAt,
    fingerprintParts: {
      sourceApp: env.pkg,
      accountId,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      merchantNorm: normMerchant(parsed.merchant),
      dayBucket,
      bankRef: parsed.bankRef,
    },
  };
}
