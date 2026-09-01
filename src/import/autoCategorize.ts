// AutoCategorize — suggest a category for an ImportCandidate from merchant /
// note keywords. Pure, RN-free, no PII beyond the merchant name already present in
// the candidate (which is in-memory only and never logged).
//
// The vocabulary mirrors the app's existing CNY/MYR categories so imported rows
// blend with manually-entered ones.

import type { ImportCandidate } from './models';

// Ordered: first match wins. Tuned for both CNY and MYR statements.
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/工资|薪水|salary|income|报销|reimburse|分红|利息|interest|退税|tax refund/i, '收入'],
  [/starbucks|coffee|kfc|mcdonald|subway|restaurant|餐厅|咖啡|奶茶|grab food|foodpanda|星巴克|麦当劳|肯德基|汉堡|披萨|pizza|dining/i, '餐饮'],
  [/grab|uber|lrt|mrt|myrapid|touch ?n ?go|petronas|shell| petrol|汽油|停车|taxi|klia|airasia|加油|高铁|地铁|公交|打车/i, '交通'],
  [/shopee|lazada|tesco|giant|aeon|1010|guardian|watsons?|超市|购物|mr\.? ?diy|ikea|mall|store/i, '购物'],
  [/cinema|netflix|spotify|steam|game|电影|游戏|娱乐|youtube|disney/i, '娱乐'],
  [/telekom|maxis|celcom|umobile|digi|unifi|话费|流量|电费|水费|air limbah|indah water|物业|网费|宽带/i, '账单'],
  [/guardian|watsons?|pharmacy|药|医院|hospital|clinic|诊所|医疗|doctor/i, '医疗'],
  [/转账|transfer|还款|repayment|loan|贷款|信用|credit/i, '转账还款'],
  [/退款|refund/i, '退款'],
];

/** Suggest a category for a merchant/note string. Returns '其他' when unsure. */
export function suggestCategory(merchant?: string, note?: string): string {
  const text = `${merchant || ''} ${note || ''}`;
  if (!text.trim()) return '其他';
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(text)) return cat;
  }
  return '其他';
}

/**
 * Fill a candidate's category if missing/unknown. Clears the 'missing_category'
 * warning once a concrete (non-其他 fallback still kept if truly unknown) category
 * is assigned. Leaves an explicit user category untouched.
 */
export function categorize(c: ImportCandidate): ImportCandidate {
  if (c.category && c.category !== '其他') return c;
  const cat = suggestCategory(c.merchant, c.note);
  const warnings =
    cat !== '其他' && c.warnings.includes('missing_category')
      ? c.warnings.filter((w) => w !== 'missing_category')
      : c.warnings;
  return { ...c, category: cat, warnings };
}
