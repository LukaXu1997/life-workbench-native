import type { NotifyEnvelope, ParsedNotification } from './types';

// ---- amount parsing (integer minor units; no float) ----

export function toMinor(amount: string): number {
  const clean = amount.replace(/,/g, '');
  const [ip, fp] = clean.split('.');
  const intPart = ip || '0';
  const fracPart = (fp || '').padEnd(2, '0').slice(0, 2);
  return parseInt(intPart + fracPart, 10);
}

interface AmountHit {
  minor: number;
  cur: 'MYR' | 'CNY';
  index: number;
}

const RM_RE = /RM\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
const CNY_RE = /[¥￥]\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
const YUAN_RE = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*元/g;

function parseAmounts(text: string): AmountHit[] {
  const out: AmountHit[] = [];
  for (const m of text.matchAll(RM_RE)) {
    out.push({ minor: toMinor(m[1]), cur: 'MYR', index: m.index ?? 0 });
  }
  for (const m of text.matchAll(CNY_RE)) {
    out.push({ minor: toMinor(m[1]), cur: 'CNY', index: m.index ?? 0 });
  }
  for (const m of text.matchAll(YUAN_RE)) {
    out.push({ minor: toMinor(m[1]), cur: 'CNY', index: m.index ?? 0 });
  }
  return out;
}

// Pick the amount associated with a spend/income keyword when present.
function pickAmount(text: string, hits: AmountHit[]): AmountHit | null {
  if (hits.length === 0) return null;
  const kw = /(spent|paid|payment|purchase|charge|debit|支出|消费|付款|支付|扣款|received|credit|收款|入账|退款|工资|收入)/i;
  const km = kw.exec(text);
  if (km) {
    const after = hits.filter((h) => h.index >= km.index);
    if (after.length) return after[0];
  }
  return hits[0];
}

function detectKind(text: string): 'expense' | 'income' | 'unknown' {
  if (/(spent|paid|payment|purchase|charge|debit|支出|消费|付款|支付|扣款)/i.test(text)) return 'expense';
  if (/(received|credit|收款|入账|退款|工资|收入)/i.test(text)) return 'income';
  return 'unknown';
}

// ---- merchant parsing ----

// App package -> account hint (informational; recognizer maps to a real account).
type AppHint = 'myr_ewallet' | 'myr_bank' | 'cny_bank' | 'cny_credit';

const EWALLET = new Set([
  'my.com.tngdigital.ewallet', // Touch n Go eWallet (official Play Store package)
  'com.grabtaxi.passenger', // Grab / GrabPay (official Play Store package)
  'com.shopee.my', // ShopeePay
  'com.lazada.android', // Lazada
  'my.boost.app', // Boost
  'com.themakecompany.mymaybank.mae', // MAE
  'com.bigpay', // BigPay
]);
const MYR_BANK = new Set([
  'com.maybank.mobile',
  'com.bizplugin.mb', // Maybank
  'com.cimb.android',
  'com.cimb.phoenix',
  'com.rhbgroup',
  'com.publicbank',
  'com.ambank',
  'com.hongleong.android',
  'com.uob.mobile',
]);
const CNY_APP = new Set([
  'com.eg.android.AlipayGphone', // Alipay
  'com.tencent.mm', // WeChat / WeChat Pay
  'com.icbc', // ICBC
  'com.ccb', // CCB
  'com.abchina', // ABC
  'com.bankcomm', // BoCom
  'com.cmbchina', // CMB
  'com.cmbc', // CMBC
  'com.spdb', // SPD Bank
  'cn.com.modernbank.payment',
  'com.citicbank',
  'com.xunmeng.pinduoduo', // Pinduoduo (拼多多, CN e-commerce — CNY payments)
]);

export function appHintFor(pkg: string): AppHint | undefined {
  if (EWALLET.has(pkg)) return 'myr_ewallet';
  if (MYR_BANK.has(pkg)) return 'myr_bank';
  if (CNY_APP.has(pkg)) return 'cny_credit';
  return undefined;
}

// Packages that indicate a Chinese-card context even when the notification shows an
// MYR amount (i.e. the user is spending abroad with an RMB card).
export const CNY_CARD_APPS = CNY_APP;

const AT_RE =
  /(?:at|to|向|付款给)\s+([A-Za-z0-9&.\'-]+(?:\s+[A-Za-z0-9&.\'-]+){0,4}?)(?=\s*[.,;:!()·]*\s*(?:successful|paid|on|via|using|with|card|account|from|at)\b|\s*$)/i;

function cleanMerchant(s: string): string {
  return s.replace(/[.,;:!]+$/, '').trim();
}

function genericMerchant(text: string): string | undefined {
  const m = AT_RE.exec(text);
  if (m && m[1]) return cleanMerchant(m[1]);
  return undefined;
}

function alipayMerchant(title: string, text: string, bigText: string): string | undefined {
  const t = bigText || text;
  const x = /向\s*(.+?)\s*付款/.exec(t);
  if (x && x[1]) return cleanMerchant(x[1]);
  if (bigText && !/[¥￥]|支付宝|alipay/i.test(bigText)) return cleanMerchant(bigText);
  if (title && !/支付宝|alipay/i.test(title)) return cleanMerchant(title);
  const after = /[¥￥][\d.,]+\s*(.+)/.exec(t);
  if (after && after[1] && !/支付宝/.test(after[1])) return cleanMerchant(after[1]);
  return undefined;
}

function wechatMerchant(title: string, text: string, bigText: string): string | undefined {
  const t = bigText || text;
  const after = /[¥￥][\d.,]+\s*(.+)/.exec(t.replace(/微信支付/g, ' '));
  if (after && after[1] && !/微信支付/.test(after[1])) return cleanMerchant(after[1]);
  if (title && !/微信|wechat/i.test(title)) return cleanMerchant(title);
  return undefined;
}

function extractMerchant(pkg: string, title: string, text: string, bigText: string): string | undefined {
  const body = `${title}\n${text}\n${bigText}`;
  if (pkg === 'com.eg.android.AlipayGphone') return alipayMerchant(title, text, bigText);
  if (pkg === 'com.tencent.mm') return wechatMerchant(title, text, bigText);
  const g = genericMerchant(body);
  if (g) return g;
  // fallback: title if it is clearly a merchant, not a generic app name
  if (title && !/^(touch ?n ?go|grab|shopee|boost|maybank|cimb|payment|通知)$/i.test(title)) {
    return cleanMerchant(title);
  }
  return undefined;
}

const BANKREF_RE = /(?:ref(?:erence)?|流水号|参考号|编号|no\.?)\s*[:#]?\s*([A-Za-z0-9\-]{6,})/i;

function extractBankRef(text: string): string | undefined {
  const m = BANKREF_RE.exec(text);
  return m ? m[1] : undefined;
}

/**
 * Parse a notification envelope into structured fields.
 * Returns null when no amount can be found (cannot bookkeep without an amount).
 */
export function parseEnvelope(env: NotifyEnvelope): ParsedNotification | null {
  const body = `${env.title}\n${env.text}\n${env.bigText}`;
  const hits = parseAmounts(body);
  const chosen = pickAmount(body, hits);
  if (!chosen) return null;

  const kind = detectKind(body);
  const merchant = extractMerchant(env.pkg, env.title, env.text, env.bigText);
  const bankRef = extractBankRef(body);
  const hint = appHintFor(env.pkg);

  // Confidence: amount + merchant + known app parser is high; amount only is medium.
  let confidence = 0.7;
  if (merchant) confidence = hint ? 0.92 : 0.85;
  if (kind === 'unknown') confidence -= 0.1;

  return {
    amountMinor: chosen.minor,
    currency: chosen.cur,
    merchant,
    kind,
    confidence: Math.max(0.1, Math.min(1, confidence)),
    bankRef,
    accountHint: hint,
  };
}
