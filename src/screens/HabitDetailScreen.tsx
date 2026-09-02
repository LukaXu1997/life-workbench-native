import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Switch, Alert, TouchableOpacity } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { store, onChange, todayStr } from '../store';
import { ScreenHeader, IconButton } from '../components/kit';
import { M3Text } from '../components/ui';
import { ICONS } from '../icons';
import { space, pageMargin, radius } from '../tokens';
import { useBottomContentInset } from '../components/layout';
import { scheduleHabitReminder, cancelHabitReminder, ensureReminderPermission } from '../reminder';
import type { Habit } from '../types';

/** Parse 'HH:MM' (local) into a Date. Returns today at that time. */
function parseHm(hm: string): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(hm || '09:00');
  const d = new Date();
  d.setHours(m ? Number(m[1]) : 9, m ? Number(m[2]) : 0, 0, 0);
  return d;
}
/** Format a Date as 'HH:MM'. */
function fmtHm(d: Date): string {
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---- pure helpers (no hooks, testable) ----

/** Days in month for a given year/month (1-based). */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Day of week for the 1st of month (0=Sun .. 6=Sat). */
function firstDayOfWeek(y: number, m: number): number {
  return new Date(y, m - 1, 1).getDay();
}

/** Build calendar grid: 5-6 rows × 7 cols. Null = padding cell (prev/next month). */
interface Cell {
  date: string;       // YYYY-MM-DD
  day: number;        // 1-31
  isCurrentMonth: boolean;
}

function buildGrid(year: number, month: number): Cell[][] {
  const dim = daysInMonth(year, month);
  const fdow = firstDayOfWeek(year, month);
  const grids: Cell[][] = [];
  let row: Cell[] = [];

  // Padding cells before 1st
  const prevDim = month === 1 ? daysInMonth(year - 1, 12) : daysInMonth(year, month - 1);
  for (let i = fdow - 1; i >= 0; i--) {
    const d = prevDim - i;
    row.push({
      date: `${month === 1 ? year - 1 : year}-${`${month === 1 ? 12 : month - 1}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`,
      day: d,
      isCurrentMonth: false,
    });
  }

  // Current month cells
  for (let d = 1; d <= dim; d++) {
    row.push({
      date: `${year}-${`${month}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`,
      day: d,
      isCurrentMonth: true,
    });
    if (row.length === 7) {
      grids.push(row);
      row = [];
    }
  }

  // Padding cells after last day
  if (row.length > 0) {
    let next = 1;
    while (row.length < 7) {
      const nextM = month === 12 ? 1 : month + 1;
      const nextY = month === 12 ? year + 1 : year;
      const dayNum = next++;
      row.push({
        date: `${nextY}-${`${nextM}`.padStart(2, '0')}-${`${dayNum}`.padStart(2, '0')}`,
        day: dayNum,
        isCurrentMonth: false,
      });
    }
    grids.push(row);
  }

  return grids;
}

/** Compute current streak ending at `todayStr` (consecutive days going backwards). */
function computeStreak(habit: Habit, today: string): number {
  const records = habit.records;
  if (!records) return 0;
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!parsed) return 0;
  let y = Number(parsed[1]), m = Number(parsed[2]), d = Number(parsed[3]);
  let streak = 0;
  const checkDate = (yy: number, mm: number, dd: number): boolean => {
    const key = `${yy}-${`${mm}`.padStart(2, '0')}-${`${dd}`.padStart(2, '0')}`;
    const rec = records[key];
    if (habit.type === 'check') return !!rec;
    if (habit.type === 'count') return (rec || 0) >= habit.target;
    return !!rec;
  };
  // If today is checked, count it and go backwards
  if (checkDate(y, m, d)) { streak++; }
  // Go backwards from yesterday
  d--;
  while (true) {
    if (d < 1) {
      m--;
      if (m < 1) { m = 12; y--; }
      d = daysInMonth(y, m);
    }
    if (checkDate(y, m, d)) { streak++; }
    else { break; }
    d--;
  }
  return streak;
}

/** Count checked days in records for given year-month prefix. */
function countMonthChecks(records: Record<string, number> | undefined, year: number, month: number): number {
  if (!records) return 0;
  const prefix = `${year}-${`${month}`.padStart(2, '0')}-`;
  let c = 0;
  for (const k in records) {
    if (k.startsWith(prefix) && records[k]) c++;
  }
  return c;
}

/** Check if a habit is "done" on a given date (matches HabitRow logic). */
function isHabitDone(habit: Habit, dateStr: string): boolean {
  const rec = habit.records && habit.records[dateStr];
  if (habit.type === 'check') return !!rec;
  if (habit.type === 'count') return (rec || 0) >= habit.target;
  return !!rec; // value type
}

// ---- Component ----

export default function HabitDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { t } = useI18n();
  const bottomInset = useBottomContentInset(0);

  const habitId = route.params?.habitId as string;

  const [habit, setHabit] = useState<Habit | null>(null);
  // 习惯每日提醒（V2.13.0）
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState('09:00');
  const [showReminderTime, setShowReminderTime] = useState(false);
  const [nowYear, setNowYear] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });

  // Load habit on mount + when habits change
  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      const list = await store.getHabits();
      if (!mounted) return;
      const h = list.find((x: Habit) => x.id === habitId) || null;
      setHabit(h);
      setReminderOn(!!h?.reminderTime);
      setReminderTime(h?.reminderTime || '09:00');
    };
    load();
    // Re-load when habits key changes (another screen toggled)
    const unsub = onChange(() => { load(); });
    return () => { mounted = false; unsub(); };
  }, [habitId]);

  const fieldStyle = {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.divider,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceContainer,
  };

  // Update the habit's daily reminder (set/clear) and re-schedule the notification.
  const applyReminder = async (on: boolean, hm: string) => {
    if (!habit) return;
    const updated: Habit = { ...habit, reminderTime: on ? hm : undefined };
    const list = await store.getHabits();
    await store.setHabits(list.map((x) => (x.id === habit.id ? updated : x)));
    if (on) await scheduleHabitReminder(updated);
    else await cancelHabitReminder(habit.id);
  };

  const today = todayStr();

  const goMonth = useCallback((delta: number) => {
    setNowYear(prev => {
      let nm = prev.m + delta;
      let ny = prev.y;
      if (nm > 12) { nm = 1; ny++; }
      else if (nm < 1) { nm = 12; ny--; }
      return { y: ny, m: nm };
    });
  }, []);

  const grid = useMemo(() => buildGrid(nowYear.y, nowYear.m), [nowYear]);
  const monthChecks = habit ? countMonthChecks(habit.records, nowYear.y, nowYear.m) : 0;
  const streak = habit ? computeStreak(habit, today) : 0;

  // Month label: "August 2026" / "2026年8月"
  const monthLabel = (() => {
    const monthNames = [
      t('habitCal.jan'), t('habitCal.feb'), t('habitCal.mar'),
      t('habitCal.apr'), t('habitCal.may'), t('habitCal.jun'),
      t('habitCal.jul'), t('habitCal.aug'), t('habitCal.sep'),
      t('habitCal.oct'), t('habitCal.nov'), t('habitCal.dec'),
    ];
    return t('habitCal.monthYear', { month: monthNames[nowYear.m - 1], year: nowYear.y });
  })();

  if (!habit) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScreenHeader title="" onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <M3Text role="bodyLarge" color={theme.onSurfaceVariant}>{t('habitCal.notFound')}</M3Text>
        </View>
      </View>
    );
  }

  const CELL_SIZE = 40;
  const GAP_H = 8;
  const GAP_V = 10;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title={habit.name}
        onBack={() => navigation.goBack()}
      />

      {/* Month navigator */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: pageMargin,
        paddingTop: space.sm,
        paddingBottom: space.xs,
        gap: space.md,
      }}>
        <IconButton name={ICONS.chevronLeft} size={22} color={theme.onSurfaceVariant} onPress={() => goMonth(-1)} />
        <View>
          <M3Text role="titleMedium" style={{ color: theme.onSurface }}>
            {monthLabel}
          </M3Text>
        </View>
        <IconButton name={ICONS.chevronRight} size={22} color={theme.onSurfaceVariant} onPress={() => goMonth(1)} />
      </View>

      {/* Weekday headers */}
      <View style={{
        flexDirection: 'row',
        paddingHorizontal: pageMargin,
        paddingBottom: space.sm,
        justifyContent: 'space-between',
      }}>
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <M3Text
            key={i}
            role="labelMedium"
            color={theme.t2}
            style={{ width: CELL_SIZE, textAlign: 'center' }}
          >
            {t(`habitCal.wd${i}` as any)}
          </M3Text>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={{ paddingHorizontal: pageMargin, alignItems: 'center' }}>
        {grid.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap: GAP_H, marginBottom: GAP_V }}>
            {row.map((cell, ci) => {
              const isChecked = isHabitDone(habit, cell.date);
              const isToday = cell.date === today;
              const isFuture = cell.date > today;

              return (
                <View
                  key={ci}
                  style={{
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                    borderRadius: CELL_SIZE / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isChecked ? theme.accent : 'transparent',
                  }}
                  accessibilityLabel={`${cell.day}${isChecked ? t('habitCal.checked') : ''}`}
                  accessibilityRole="text"
                  accessibilityState={{ selected: isChecked }}
                >
                  <M3Text
                    role="bodyLarge"
                    color={
                      !cell.isCurrentMonth
                        ? theme.t3
                        : isChecked
                          ? theme.onPrimary  /* white text on blue circle */
                          : isToday
                            ? theme.accent   /* today highlighted */
                            : isFuture
                              ? theme.t3       /* future dates dimmer */
                              : theme.onSurfaceVariant
                    }
                    style={[
                      isChecked && styles.checkedText,
                      isToday && !isChecked && { textDecorationLine: 'underline' },
                    ]}
                  >
                    {cell.day}
                  </M3Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {/* 习惯每日提醒（V2.13.0） */}
      <View style={{
        paddingHorizontal: pageMargin,
        paddingVertical: space.lg,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('plan.habitReminder')}</M3Text>
          <Switch
            value={reminderOn}
            onValueChange={async (v) => {
              if (v) {
                const ok = await ensureReminderPermission();
                if (!ok) {
                  Alert.alert(t('plan.reminderPermissionDenied'));
                  return;
                }
              }
              setReminderOn(v);
              await applyReminder(v, reminderTime);
            }}
            trackColor={{ false: theme.divider, true: theme.primaryContainer }}
            thumbColor={reminderOn ? theme.primary : theme.onSurfaceVariant}
            style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
          />
        </View>
        {reminderOn && (
          <>
            <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 8 }}>{t('plan.habitReminderHint')}</M3Text>
            <TouchableOpacity onPress={() => setShowReminderTime(true)} accessibilityRole="button" accessibilityLabel={t('plan.reminderTime')} style={[fieldStyle, { marginTop: 8 }]}>
              <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('plan.reminderTime')}</M3Text>
              <M3Text role="bodyLarge">{reminderTime}</M3Text>
            </TouchableOpacity>
            {showReminderTime && (
              <DateTimePicker
                mode="time"
                value={parseHm(reminderTime)}
                onChange={(e, sel) => {
                  setShowReminderTime(false);
                  if (e.type === 'set' && sel) {
                    const hm = fmtHm(sel);
                    setReminderTime(hm);
                    applyReminder(true, hm);
                  }
                }}
              />
            )}
          </>
        )}
      </View>

      {/* Stats bar */}
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        paddingHorizontal: pageMargin,
        paddingVertical: space.lg,
        marginTop: 'auto',
        marginBottom: bottomInset,
      }}>
        <View style={{ alignItems: 'center' }}>
          <M3Text role="titleLarge" color={theme.onSurface}>{monthChecks}</M3Text>
          <M3Text role="labelSmall" color={theme.t2}>{t('habitCal.thisMonth')}</M3Text>
        </View>
        <View style={{ width: 1, backgroundColor: theme.outlineVariant }} />
        <View style={{ alignItems: 'center' }}>
          <M3Text role="titleLarge" color={theme.onSurface}>{streak}</M3Text>
          <M3Text role="labelSmall" color={theme.t2}>{t('habitCal.streak')}</M3Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  checkedText: {
    fontWeight: '600',
  },
});
