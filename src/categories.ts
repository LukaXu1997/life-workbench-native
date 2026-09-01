import { ICONS } from './icons';

export interface CategoryDef {
  key: string; // 稳定 key，用于去重/选择判定
  icon: string; // MaterialCommunityIcons 图标名
  labelKey: string; // i18n key
}

// 支出预设分类（带图标，CN/EN 双语）
export const EXPENSE_CATEGORIES: CategoryDef[] = [
  { key: 'dining', icon: ICONS.catFood, labelKey: 'cat.dining' },
  { key: 'transport', icon: ICONS.catTransport, labelKey: 'cat.transport' },
  { key: 'shopping', icon: ICONS.shopping, labelKey: 'cat.shopping' },
  { key: 'home', icon: ICONS.catHome, labelKey: 'cat.home' },
  { key: 'entertainment', icon: ICONS.catEntertainment, labelKey: 'cat.entertainment' },
  { key: 'medical', icon: ICONS.catMedical, labelKey: 'cat.medical' },
  { key: 'other', icon: ICONS.menu, labelKey: 'cat.other' },
];

// 收入预设分类
export const INCOME_CATEGORIES: CategoryDef[] = [
  { key: 'salary', icon: ICONS.catSalary, labelKey: 'cat.salary' },
  { key: 'bonus', icon: ICONS.catBonus, labelKey: 'cat.bonus' },
  { key: 'investment', icon: ICONS.trend, labelKey: 'cat.investment' },
  { key: 'other', icon: ICONS.menu, labelKey: 'cat.other' },
];

// 判断某个分类字符串是否属于某清单（用于区分“预设”与“自定义”）
export function isPresetCategory(kind: 'expense' | 'income', label: string, t: (k: string) => string): boolean {
  const list = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return list.some((c) => t(c.labelKey) === label);
}
