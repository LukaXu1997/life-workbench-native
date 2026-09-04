// Plan module aggregation — pure, React-Native-free so it can be unit-tested
// under plain Node (scripts/plan-test-runner.js) exactly like financeCharts.
//
// Covers the three Plan-deepening features:
//   A. Timeline   -> timelineGroups()
//   B. Recurring  -> listRecurring() / nextDue() / addPeriod()
//   C. Habit link -> habitCalendarMap()

import type { Task, Habit, RepeatFrequency } from './types';
import { todayStr } from './datetime';

function diffDays(a: string, b: string): number {
  // whole days from a to b (b - a)
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((db - da) / 86400000);
}

function addDaysStr(ds: string, n: number): string {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function ymd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Advance a date by one period of `freq`. Mirrors TasksScreen.addPeriod but is
// RN-free (operates purely on YYYY-MM-DD strings) so it can live here and be
// reused by nextDue() and the recurring-management UI.
export function addPeriod(dateStr: string, freq: RepeatFrequency): string {
  if (!freq || freq === 'none') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  switch (freq) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      return dateStr;
  }
  return ymd(d);
}

// ---- B. Recurring tasks -----------------------------------------------------

// Active recurring tasks (repeat set, not 'none', and not yet completed).
// Completed recurring instances are excluded so the period manager only shows
// the live template/next-occurrence.
export function listRecurring(tasks: Task[]): Task[] {
  return tasks.filter((t) => !!t.repeat && t.repeat !== 'none' && !t.completed);
}

// Next due occurrence of a recurring task, relative to `today`.
// If the stored date is still in the future, that is the next due.
// If it is today/overdue, advance by the repeat period until >= today.
export function nextDue(
  task: Task,
  today = todayStr()
): { date: string; daysLeft: number; overdue: boolean } | null {
  if (!task.repeat || task.repeat === 'none') return null;
  let date = task.date;
  // walk forward while the occurrence is still before today
  while (diffDays(today, date) < 0) {
    const adv = addPeriod(date, task.repeat);
    if (adv === date) break; // safety: no progress, stop
    date = adv;
  }
  const daysLeft = diffDays(today, date);
  const overdue = diffDays(today, task.date) < 0;
  return { date, daysLeft, overdue };
}

// ---- C. Habit calendar linkage ----------------------------------------------

// Aggregate how many habits were recorded (value > 0) on each date, so the
// month-grid can paint an intensity dot per day regardless of how many habits
// exist. A date absent from the map => no habit done that day.
export function habitCalendarMap(habits: Habit[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const h of habits) {
    const rec = h.records || {};
    for (const date of Object.keys(rec)) {
      const v = rec[date];
      if (v && v > 0) map[date] = (map[date] || 0) + 1;
    }
  }
  return map;
}

// ---- A. Timeline (agenda) grouping ------------------------------------------

export type TimelineKey = 'today' | 'tomorrow' | 'thisWeek' | 'later';
export interface TimelineGroup {
  key: TimelineKey;
  items: Task[];
}

// Group incomplete, non-past tasks into forward-looking agenda buckets.
// Order is fixed: today -> tomorrow -> thisWeek (within 7 days) -> later.
// Empty buckets are dropped so the UI only renders sections that have content.
export function timelineGroups(tasks: Task[], today = todayStr()): TimelineGroup[] {
  const tomorrow = addDaysStr(today, 1);
  const weekEnd = addDaysStr(today, 7);
  const buckets: Record<TimelineKey, Task[]> = {
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
  };
  for (const t of tasks) {
    if (t.completed) continue;
    if (t.date < today) continue;
    if (t.date === today) buckets.today.push(t);
    else if (t.date === tomorrow) buckets.tomorrow.push(t);
    else if (t.date <= weekEnd) buckets.thisWeek.push(t);
    else buckets.later.push(t);
  }
  const sortByDateTime = (a: Task, b: Task): number =>
    a.date === b.date
      ? (a.time || '').localeCompare(b.time || '')
      : a.date.localeCompare(b.date);
  (Object.keys(buckets) as TimelineKey[]).forEach((k) => buckets[k].sort(sortByDateTime));
  return (['today', 'tomorrow', 'thisWeek', 'later'] as TimelineKey[])
    .map((key) => ({ key, items: buckets[key] }))
    .filter((g) => g.items.length > 0);
}
