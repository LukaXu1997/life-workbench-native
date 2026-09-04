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

// ─────────────────────────────────────────────────────────────────────────────
// 分类配色：用于「分类占比」环形图 / 图例。预设分类固定映射，自定义分类按
// key 做稳定哈希着色，保证同一分类在不同月份颜色一致（不会每次重排乱跳）。
// 调色板刻意走低饱和、与 Notion 中性底协调，并在暗色下提高明度。
// ─────────────────────────────────────────────────────────────────────────────
const CAT_PALETTE_LIGHT = [
  '#D66A60', // 珊瑚红（餐饮）
  '#1F8A7A', // 蓝绿（交通）
  '#9A6A00', // 琥珀（购物）
  '#5B7FBF', // 蓝（居家）
  '#B07CC6', // 紫（娱乐）
  '#5FA85F', // 绿（医疗）
  '#C9774B', // 橙（其他）
  '#4FA3A3', // 青
  '#C25B7C', // 玫红
  '#7A8A3B', // 橄榄
];
const CAT_PALETTE_DARK = [
  '#EFA79D',
  '#5FCAB9',
  '#E8B667',
  '#9DB4E8',
  '#D6A8E8',
  '#9FD99F',
  '#E8A87C',
  '#8FD3D3',
  '#E89DB8',
  '#BcC78B',
];

export function colorForCategory(key: string, isDark = false): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  const pal = isDark ? CAT_PALETTE_DARK : CAT_PALETTE_LIGHT;
  return pal[h % pal.length];
}
