// Data model — mirrors the PWA's localStorage keys so backups are 1:1 compatible.

import type { Txn, Habit, Task, ShopItem, Account, FxSetting, Currency } from './types';
import { todayStr, ymStr } from './datetime';
import { formatMoney } from './money';
import { t } from './i18n';

// recomputeAccounts / cardSummary / financeStats / financeSummary / budgetStatus
// are defined in src/import/recompute.ts (RN-free, unit-testable) and re-exported
// here so existing screens keep importing them from `../calc`.
export {
  financeStats,
  recomputeAccounts,
  cardSummary,
  financeSummary,
  budgetStatus,
} from './import/recompute';
export type { BudgetStatus } from './import/recompute';

export function fmt(n: number, cur: 'CNY' | 'MYR' = 'CNY'): string {
  const sym = cur === 'CNY' ? '¥' : 'RM';
  const v = Math.round(n * 100) / 100;
  return sym + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function fmtY(n: number): string {
  return fmt(n, 'CNY');
}

function addDaysStr(ds: string, n: number): string {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayFinance(txns: Txn[], today = todayStr()) {
  // Skip rows that must NOT affect daily income/expense (wealth/transfer, spec §四/§七).
  const keep = (t: Txn) => t.affectsIncomeExpense !== false;
  const exp = txns.filter((t) => t.date === today && t.type === 'expense' && keep(t));
  const inc = txns.filter((t) => t.date === today && t.type === 'income' && keep(t));
  const expCNY = exp.filter((t) => (t.currency || 'CNY') === 'CNY').reduce((s, t) => s + t.amount, 0);
  const expMYR = exp.filter((t) => t.currency === 'MYR').reduce((s, t) => s + t.amount, 0);
  const incCNY = inc.filter((t) => (t.currency || 'CNY') === 'CNY').reduce((s, t) => s + t.amount, 0);
  const incMYR = inc.filter((t) => t.currency === 'MYR').reduce((s, t) => s + t.amount, 0);
  return { expCNY, expMYR, expCount: exp.length, incCNY, incMYR, incCount: inc.length };
}

export function monthFinance(txns: Txn[], ym = ymStr()) {
  const keep = (t: Txn) => t.affectsIncomeExpense !== false;
  const income = txns
    .filter((t) => t.type === 'income' && t.date.startsWith(ym) && (t.currency || 'CNY') === 'CNY' && keep(t))
    .reduce((s, t) => s + t.amount, 0);
  const expense = txns
    .filter((t) => t.type === 'expense' && t.date.startsWith(ym) && (t.currency || 'CNY') === 'CNY' && keep(t))
    .reduce((s, t) => s + t.amount, 0);
  const incomeMYR = txns
    .filter((t) => t.type === 'income' && t.date.startsWith(ym) && t.currency === 'MYR' && keep(t))
    .reduce((s, t) => s + t.amount, 0);
  const expenseMYR = txns
    .filter((t) => t.type === 'expense' && t.date.startsWith(ym) && t.currency === 'MYR' && keep(t))
    .reduce((s, t) => s + t.amount, 0);
  return { income, expense, net: income - expense, incomeMYR, expenseMYR };
}

export function habitsProgress(habits: Habit[], today = todayStr()) {
  let done = 0;
  habits.forEach((h) => {
    const rec = h.records && h.records[today];
    const isDone = h.type === 'check' ? !!rec : h.type === 'count' ? rec >= h.target : !!rec;
    if (isDone) done++;
  });
  const total = habits.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

export function upcomingItems(tasks: Task[], today = todayStr()) {
  const end = addDaysStr(today, 7);
  return tasks
    .filter((s) => !s.completed && s.date > today && s.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
}

export function timeProgress() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const leap = now.getFullYear() % 4 === 0 && (now.getFullYear() % 100 !== 0 || now.getFullYear() % 400 === 0);
  const yearPct = Math.round((dayOfYear / (leap ? 366 : 365)) * 100);
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const weekDay = now.getDay();
  const weekPct = Math.round(((weekDay === 0 ? 7 : weekDay) / 7) * 100);
  return { weekPct, monthPct, yearPct };
}

export function creditCard(
  cardDays: { stmt: number | null; due: number | null },
  txns: Txn[],
  today = todayStr()
) {
  if (!cardDays.due) return { show: false as const };
  const dueDay = cardDays.due;
  const ym = today.slice(0, 7);
  const owe = txns
    .filter((t) => t.type === 'expense' && t.date.startsWith(ym) && t.category === '信用卡还款')
    .reduce((s, t) => s + t.amount, 0);
  const [, m] = today.split('-').map(Number);
  const dayStr = `${dueDay}`.padStart(2, '0');
  let dueDateStr: string;
  if (today.slice(8) <= dayStr) {
    dueDateStr = `${today.slice(0, 7)}-${dayStr}`;
  } else {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? Number(today.slice(0, 4)) + 1 : Number(today.slice(0, 4));
    dueDateStr = `${nextY}-${`${nextM}`.padStart(2, '0')}-${dayStr}`;
  }
  const daysLeft = Math.round(
    (new Date(dueDateStr + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000
  );
  return { show: true as const, owe, due: dueDateStr.slice(5), daysLeft, warn: daysLeft <= 3 };
}

export function relDate(ds: string): string {
  const d = new Date(ds + 'T00:00:00');
  const now = new Date(todayStr() + 'T00:00:00');
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (diff === 1) return t('date.tomorrow');
  if (diff > 1 && diff <= 7) {
    const wd = [
      t('date.wd0'), t('date.wd1'), t('date.wd2'), t('date.wd3'),
      t('date.wd4'), t('date.wd5'), t('date.wd6'),
    ][d.getDay()];
    return t('date.weekday', { w: wd });
  }
  return t('date.monthDay', { m: d.getMonth() + 1, d: d.getDate() });
}

export type { ShopItem };

// ---- Dual-currency (MYR/CNY) + account-based finance ------------------------
// All amounts are integer minor units (sen/fen). No floating-point math.

export function money(minor: number, cur: Currency): string {
  return formatMoney(minor, cur);
}

// Next occurrence of a monthly due day, computed in Asia/Kuala_Lumpur local time.
export function nextDueDate(dueDay: number, today = todayStr()): { date: string; daysLeft: number } {
  const [y, m] = today.split('-').map(Number);
  const dayStr = `${dueDay}`.padStart(2, '0');
  let due: string;
  if (Number(today.slice(8)) <= dueDay) {
    due = `${today.slice(0, 7)}-${dayStr}`;
  } else {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    due = `${nextY}-${`${nextM}`.padStart(2, '0')}-${dayStr}`;
  }
  const daysLeft = Math.round(
    (new Date(due + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000
  );
  return { date: due, daysLeft };
}
