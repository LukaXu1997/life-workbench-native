import { Appearance } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system' | 'auto';

/**
 * Time-based night detection for the 'auto' theme mode.
 * Night window: 19:00 (inclusive) through 06:59 (i.e. before 07:00).
 * Uses local device time so it works without location permission.
 */
export function isNightTime(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h >= 19 || h < 7;
}

// Material 3 semantic color roles + legacy fields kept for backward compatibility
// (screens still reference accent*/danger/green/amber/r1-r4 during the phased migration).
export interface Theme {
  // ---- legacy (kept) ----
  bg: string;
  surface: string;
  text: string;
  t2: string;
  t3: string;
  bd: string;
  divider: string;
  accent: string;
  accentSoft: string;
  accentDeep: string;
  danger: string;
  dangerSoft: string;
  green: string;
  greenSoft: string;
  amber: string;
  amberSoft: string;
  shadow: string;
  r1: number;
  r2: number;
  r3: number;
  r4: number;

  // ---- M3 semantic roles (primary) ----
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;

  // ---- M3 surfaces ----
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;

  // ---- M3 status colors ----
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;

  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;

  // §四 收入/支出语义色（低饱和蓝绿 / 低饱和珊瑚红）
  income: string;
  onIncome: string;
  incomeContainer: string;
  onIncomeContainer: string;
  expense: string;
  onExpense: string;
  expenseContainer: string;
  onExpenseContainer: string;

  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notion-style neutral palette (Milestone 1)
//
//  · 去品牌绿，整体走中性灰阶；页面近白、面板浅灰、文字暖近黑。
//  · primary 用作「主操作 / 选中 / 进度」的近黑中性色（Notion 主按钮即近黑）。
//  · accent 保留为 Notion 蓝 #2383E2，仅用于链接 / 选中文本等点缀。
//  · 收入/支出语义色保留低饱和 teal / coral，仅微调以贴合中性底。
// ─────────────────────────────────────────────────────────────────────────────

const LIGHT: Theme = {
  // legacy
  bg: '#FFFFFF', // page background (near-white)
  surface: '#F7F7F5', // panel / card background
  text: '#37352F', // warm near-black body text
  t2: '#787774', // secondary
  t3: '#9B9A97', // tertiary
  bd: '#E9E9E7', // weak border
  divider: '#EDEDEB', // hairline divider
  accent: '#2383E2', // Notion blue (links / selected text)
  accentSoft: '#E7F0FB',
  accentDeep: '#1A6CC7',
  danger: '#E03E3E',
  dangerSoft: '#FDECEC',
  green: '#2E7D57',
  greenSoft: '#DDF1E7',
  amber: '#9A6A00',
  amberSoft: '#F6ECDC',
  shadow: '0 1px 2px rgba(15,15,15,0.04)', // near-flat
  r1: 6,
  r2: 10,
  r3: 12,
  r4: 14,

  // M3 semantic (near-black primary — Notion's interactive color)
  primary: '#37352F',
  onPrimary: '#FFFFFF',
  primaryContainer: 'rgba(55,53,47,0.06)', // neutral active/hover fill
  onPrimaryContainer: '#37352F',

  surfaceContainerLow: '#FCFCFC',
  surfaceContainer: '#F7F7F5',
  surfaceContainerHigh: '#EDEDEB',
  onSurface: '#37352F',
  onSurfaceVariant: '#787774',
  outline: '#D3D1CB',
  outlineVariant: '#EDEDEB',

  error: '#E03E3E',
  onError: '#FFFFFF',
  errorContainer: '#FDECEC',
  onErrorContainer: '#5C1310',

  success: '#2E7D57',
  onSuccess: '#FFFFFF',
  successContainer: '#DDF1E7',
  onSuccessContainer: '#0C2A1C',

  // §四 收入/支出：低饱和蓝绿（teal）/ 低饱和珊瑚红（coral）
  income: '#1F8A7A',
  onIncome: '#FFFFFF',
  incomeContainer: '#D6EFEA',
  onIncomeContainer: '#053B34',
  expense: '#D66A60',
  onExpense: '#FFFFFF',
  expenseContainer: '#FBE6E2',
  onExpenseContainer: '#41120D',

  warning: '#9A6A00',
  onWarning: '#FFFFFF',
  warningContainer: '#F6ECDC',
  onWarningContainer: '#332200',
};

const DARK: Theme = {
  // legacy
  bg: '#191919', // neutral near-black page
  surface: '#202020', // panel
  text: '#FFFFFF',
  t2: 'rgba(255,255,255,0.62)',
  t3: 'rgba(255,255,255,0.40)',
  bd: 'rgba(255,255,255,0.12)',
  divider: 'rgba(255,255,255,0.09)',
  accent: '#529CCA', // lighter blue for dark
  accentSoft: 'rgba(82,156,202,0.16)',
  accentDeep: '#7FBFE6',
  danger: '#FF7369',
  dangerSoft: '#3A1C1E',
  green: '#4CB58A',
  greenSoft: '#1E3329',
  amber: '#E8B667',
  amberSoft: '#3A2C1A',
  shadow: '0 1px 2px rgba(0,0,0,0.3)',
  r1: 6,
  r2: 10,
  r3: 12,
  r4: 14,

  // M3 semantic (light primary on dark — Notion's interactive color)
  primary: '#FFFFFF',
  onPrimary: '#191919',
  primaryContainer: 'rgba(255,255,255,0.08)', // neutral active/hover fill
  onPrimaryContainer: '#FFFFFF',

  surfaceContainerLow: '#202020',
  surfaceContainer: '#252525',
  surfaceContainerHigh: '#2E2E2E',
  onSurface: '#FFFFFF',
  onSurfaceVariant: 'rgba(255,255,255,0.56)',
  outline: '#3A3A3A',
  outlineVariant: 'rgba(255,255,255,0.09)',

  error: '#FFB4AB',
  onError: '#5C1310',
  errorContainer: '#5C1310',
  onErrorContainer: '#FFDAD6',

  success: '#5FC99A',
  onSuccess: '#0C2A1C',
  successContainer: '#1E3329',
  onSuccessContainer: '#A6F0C8',

  // §四 收入/支出（暗色：提高明度但保持低饱和）
  income: '#5FCAB9',
  onIncome: '#053B34',
  incomeContainer: '#0C3A34',
  onIncomeContainer: '#A6F0E4',
  expense: '#EFA79D',
  onExpense: '#3A120D',
  expenseContainer: '#3A1813',
  onExpenseContainer: '#FFDAD6',

  warning: '#E8B667',
  onWarning: '#332200',
  warningContainer: '#3A2C1A',
  onWarningContainer: '#FDEBD2',
};

export function resolveTheme(mode: ThemeMode): Theme {
  if (mode === 'light') return LIGHT;
  if (mode === 'dark') return DARK;
  return Appearance.getColorScheme() === 'dark' ? DARK : LIGHT;
}
