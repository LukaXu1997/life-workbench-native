import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FlatList,
  View,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useData } from '../useData';
import { store, uid, todayStr } from '../store';
import { formatMoney } from '../money';
import {
  FAB,
  Snackbar,
  IconButton,
  Button,
  EmptyState,
  Badge,
  M3Text,
  Chip,
  TextField,
} from '../components/ui';
import { ScreenHeader, PrimaryButton } from '../components/kit';
import { Icon, ICONS } from '../icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { radius, space, pageMargin, touchMin } from '../tokens';
import { useBottomContentInset } from '../components/layout';
import { AppBottomSheet } from '../components/anim';
import type { Task, Habit, ShopItem, Priority, HabitType, ShopPriority, Currency } from '../types';
import {
  shouldShowAddFab,
  classifySchedule,
  canSubmitSchedule,
  initialScheduleForm,
} from '../uiTasks';

// ---- date/time helpers for native pickers (store format: YYYY-MM-DD / HH:MM) ----
function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}
function fmtDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function parseTime(s: string): Date {
  const base = new Date();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    base.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return base;
  }
  return base;
}
function fmtTime(d: Date): string {
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

type Seg = 'calendar' | 'todo' | 'shopping' | 'habit';
type UndoState = { msg: string; undo: () => Promise<void> } | null;

// §七 计划页四档：日历（默认落地，合并「今日」视图）/ 待办 / 待买 / 习惯。
//  · 日历置顶并作为默认落地页；选中「今天」时详情区同时展示当日任务 + 今日习惯，替代原独立 today 模块
//  · 待买为四档之一（仍可在「更多」菜单次级入口快速进入）
//  · 勾选框统一 48×48（满足最小触控 + 视觉留白），四档行式一致
//  · 新增走底部 BottomSheet；列表改 FlatList，几百条数据不再一次性渲染
//  · 删除/切换都有撤销 Snackbar；分段标题统一中性灰，遵循 Notion 克制的层级语言
type Row =
  | { kind: 'section'; id: string; title: string; color: string; icon?: string }
  | { kind: 'task'; id: string; task: Task }
  | { kind: 'habit'; id: string; habit: Habit }
  | { kind: 'empty'; id: string; icon: string; title: string; hint?: string };

export default function TasksScreen() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const d = useData();
  const route = useRoute<any>();
  const resolveSeg = (raw: unknown): Seg => {
    if (raw === 'calendar' || raw === 'todo' || raw === 'shopping' || raw === 'habit') return raw as Seg;
    return 'calendar'; // 默认落在日历（含「今日」视图）
  };
  const initialSeg: Seg = resolveSeg(route?.params?.seg);
  const [seg, setSeg] = useState<Seg>(initialSeg);

  // Sync segment from route params on every navigation (stack reuses mounted instance)
  const segRef = useRef(seg);
  segRef.current = seg;
  useEffect(() => {
    const next = resolveSeg(route?.params?.seg);
    if (next !== segRef.current) {
      setSeg(next);
    }
  }, [route?.params?.seg]);
  const [adding, setAdding] = useState(false);
  const [snack, setSnack] = useState<UndoState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = todayStr();
  const bottomInset = useBottomContentInset(72); // +72 给悬浮 FAB 让位

  const showUndo = (msg: string, undo: () => Promise<void>) => {
    if (timer.current) clearTimeout(timer.current);
    setSnack({ msg, undo });
    timer.current = setTimeout(() => setSnack(null), 4000);
  };

  const toggleTask = async (t2: Task) => {
    const prev = { ...t2 };
    const list = await store.getTasks();
    await store.setTasks(list.map((x) => (x.id === t2.id ? { ...x, completed: !x.completed } : x)));
    showUndo(prev.completed ? t('plan.toggleUndone') : t('plan.toggleDone'), async () => {
      const l = await store.getTasks();
      await store.setTasks(l.map((x) => (x.id === t2.id ? prev : x)));
    });
  };
  const toggleHabit = async (h: Habit) => {
    const list = await store.getHabits();
    const rec = { ...(h.records || {}) };
    if (h.type === 'check') {
      if (rec[today]) delete rec[today];
      else rec[today] = 1;
    } else if (h.type === 'count') {
      rec[today] = (rec[today] || 0) + 1;
    } else {
      rec[today] = 1;
    }
    const next = list.map((x) => (x.id === h.id ? { ...x, records: rec } : x));
    await store.setHabits(next);
    showUndo(t('plan.recordedCheckin'), async () => {
      await store.setHabits(list);
    });
  };
  const toggleShop = async (s: ShopItem) => {
    const prev = { ...s };
    const list = await store.getShopping();
    await store.setShopping(list.map((x) => (x.id === s.id ? { ...x, purchased: !x.purchased } : x)));
    showUndo(prev.purchased ? t('plan.movedPending') : t('plan.markedBought'), async () => {
      const l = await store.getShopping();
      await store.setShopping(l.map((x) => (x.id === s.id ? prev : x)));
    });
  };

  const confirmDelete = (name: string, onConfirm: () => void) =>
    Alert.alert(t('plan.deleteTitle'), t('plan.deleteMsg', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: onConfirm },
    ]);

  const deleteTask = async (t2: Task) => {
    const prev = await store.getTasks();
    await store.setTasks(prev.filter((x) => x.id !== t2.id));
    showUndo(t('plan.deletedTask'), async () => { await store.setTasks(prev); });
  };
  const deleteHabit = async (h: Habit) => {
    const prev = await store.getHabits();
    await store.setHabits(prev.filter((x) => x.id !== h.id));
    showUndo(t('plan.deletedHabit'), async () => { await store.setHabits(prev); });
  };
  const deleteShop = async (s: ShopItem) => {
    const prev = await store.getShopping();
    await store.setShopping(prev.filter((x) => x.id !== s.id));
    showUndo(t('plan.deletedShop'), async () => { await store.setShopping(prev); });
  };

  const fabLabel = seg === 'habit' ? t('plan.fabHabit') : seg === 'shopping' ? t('plan.fabShopping') : t('plan.fabTodo');
  const openAdd = () => setAdding(true);
  const handleSegChange = (next: Seg) => {
    setSeg(next);
    setAdding(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title={t('tabs.plan')}
        subtitle={t('plan.subtitle')}
      />
      <View style={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: space.xs }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: theme.surfaceContainer,
            borderRadius: radius.md,
            padding: 3,
          }}
        >
          {([
            { key: 'calendar', label: t('plan.segCalendar') },
            { key: 'todo', label: t('plan.segTodo') },
            { key: 'shopping', label: t('plan.segShopping') },
            { key: 'habit', label: t('plan.segHabit') },
          ] as const).map((s) => {
            const isA = s.key === seg;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => handleSegChange(s.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isA }}
                accessibilityLabel={s.label}
                style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: isA ? theme.primaryContainer : 'transparent', borderRadius: radius.sm }}
              >
                <M3Text role="labelLarge" color={isA ? theme.onPrimaryContainer : theme.onSurfaceVariant}>
                  {s.label}
                </M3Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 「今日」模块已合并进 CalendarSub：选中「今天」时日历详情区同时展示当日任务 + 今日习惯 */}
      {seg === 'todo' && (
        <TodoSub
          tasks={d.tasks}
          today={today}
          onToggle={toggleTask}
          onDelete={deleteTask}
          confirmDelete={confirmDelete}
          bottomInset={bottomInset}
        />
      )}
      {seg === 'habit' && (
        <HabitSub
          habits={d.habits}
          today={today}
          onToggle={toggleHabit}
          onDelete={deleteHabit}
          confirmDelete={confirmDelete}
          bottomInset={bottomInset}
        />
      )}

      {seg === 'shopping' && (
        <View style={{ flex: 1, paddingHorizontal: pageMargin, paddingTop: space.sm }}>
          <ShoppingSub
            items={d.shopping}
            onToggle={toggleShop}
            onDelete={deleteShop}
            confirmDelete={confirmDelete}
            adding={adding}
            onToggleAdding={setAdding}
          />
        </View>
      )}

      {seg === 'calendar' && (
        <CalendarSub
          tasks={d.tasks}
          habits={d.habits}
          today={today}
          onToggle={toggleTask}
          onDelete={deleteTask}
          onToggleHabit={toggleHabit}
          onDeleteHabit={deleteHabit}
          confirmDelete={confirmDelete}
          bottomInset={bottomInset}
        />
      )}

      {shouldShowAddFab(adding) && (
        <FAB icon={ICONS.add} label={fabLabel} onPress={openAdd} />
      )}

      {/* 新增日程 / 习惯：底部 BottomSheet（购物 tab 用内联表单，不走这里） */}
      {seg !== 'shopping' && (
      <AppBottomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        title={seg === 'habit' ? t('plan.addHabit') : t('plan.addSchedule')}
        scroll
      >
        {seg === 'habit' ? (
          <HabitForm onClose={() => setAdding(false)} />
        ) : (
          <ScheduleForm today={today} onClose={() => setAdding(false)} />
        )}
      </AppBottomSheet>
      )}

      {snack && (
        <Snackbar
          message={snack.msg}
          actionLabel={t('common.undo')}
          onAction={() => {
            snack.undo();
            setSnack(null);
          }}
          style={{ bottom: 96 }}
        />
      )}
    </View>
  );
}

/* 48×48 勾选圈：统一最小触控，主色填充表示已完成 */
function CheckCircle({
  checked,
  onToggle,
  a11y,
  theme,
}: {
  checked: boolean;
  onToggle: () => void;
  a11y: string;
  theme: any;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: checked ? theme.primaryContainer : theme.surfaceContainer,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name={checked ? ICONS.check : 'checkbox-blank-circle-outline'}
        size={22}
        color={checked ? theme.onPrimaryContainer : theme.onSurfaceVariant}
      />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* 「今日」模块已合并进 CalendarSub：当选中日期为今天时，日历详情区同时   */
/* 展示当日任务（byDate[today]）+ 今日习惯（HabitRow 列表），不再单列。    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 待办：逾期 / 今天 / 即将到来，按组排列                                  */
/* ------------------------------------------------------------------ */

function TodoSub({
  tasks,
  today,
  onToggle,
  onDelete,
  confirmDelete,
  bottomInset,
}: {
  tasks: Task[];
  today: string;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  bottomInset: number;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const active = tasks.filter((x) => !x.completed);
  const overdue = active
    .filter((x) => classifySchedule(x.date, x.completed, today) === 'overdue')
    .sort((a, b) => a.date.localeCompare(b.date));
  const todayList = active.filter((x) => classifySchedule(x.date, x.completed, today) === 'today');
  const upcoming = active
    .filter((x) => classifySchedule(x.date, x.completed, today) === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows: Row[] = [];
  if (overdue.length > 0) {
    rows.push({ kind: 'section', id: 'sec-overdue', title: t('plan.overdue'), color: theme.error, icon: ICONS.warning });
    overdue.forEach((task) => rows.push({ kind: 'task', id: task.id, task }));
  }
  if (todayList.length > 0) {
    rows.push({ kind: 'section', id: 'sec-today', title: t('plan.today'), color: theme.primary, icon: ICONS.today });
    todayList.forEach((task) => rows.push({ kind: 'task', id: task.id, task }));
  }
  if (upcoming.length > 0) {
    rows.push({ kind: 'section', id: 'sec-upcoming', title: t('plan.upcoming'), color: theme.onSurfaceVariant, icon: ICONS.calendar });
    upcoming.forEach((task) => rows.push({ kind: 'task', id: task.id, task }));
  }
  if (rows.length === 0) {
    rows.push({ kind: 'empty', id: 'empty', icon: ICONS.tasks, title: t('plan.emptyTodo'), hint: t('plan.emptyTodoHint') });
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => {
        if (item.kind === 'section') return <SectionLabel text={item.title} icon={item.icon} />;
        if (item.kind === 'empty') {
          return (
            <View style={{ marginTop: space.xl }}>
              <EmptyState icon={item.icon} title={item.title} hint={item.hint} />
            </View>
          );
        }
        if (item.kind === 'task') return <TaskRow task={item.task} onToggle={onToggle} onDelete={onDelete} confirmDelete={confirmDelete} />;
        return null;
      }}
      contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 习惯：打卡列表                                                       */
/* ------------------------------------------------------------------ */

function HabitSub({
  habits,
  today,
  onToggle,
  onDelete,
  confirmDelete,
  bottomInset,
}: {
  habits: Habit[];
  today: string;
  onToggle: (h: Habit) => void;
  onDelete: (h: Habit) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  bottomInset: number;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const navigation = useNavigation();

  const rows: Row[] = habits.map((h) => ({ kind: 'habit', id: h.id, habit: h }) as Row);
  if (rows.length === 0) {
    rows.push({ kind: 'empty', id: 'empty', icon: ICONS.habit, title: t('plan.emptyHabit'), hint: t('plan.emptyHabitHint') });
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => {
        if (item.kind === 'empty') {
          return (
            <View style={{ marginTop: space.xl }}>
              <EmptyState icon={item.icon} title={item.title} hint={item.hint} />
            </View>
          );
        }
        if (item.kind === 'habit') return <HabitRow habit={item.habit} today={today} onToggle={onToggle} onDelete={onDelete} confirmDelete={confirmDelete} onPress={() => (navigation as any).navigate('HabitDetail', { habitId: item.habit.id })} />;
        return null;
      }}
      contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 日历 / 月视图：纯展示层，复用 Task[]，无存储 / SCHEMA 改动             */
/* ------------------------------------------------------------------ */

function CalendarSub({
  tasks,
  habits,
  today,
  onToggle,
  onDelete,
  onToggleHabit,
  onDeleteHabit,
  confirmDelete,
  bottomInset,
}: {
  tasks: Task[];
  habits: Habit[];
  today: string;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToggleHabit: (h: Habit) => void;
  onDeleteHabit: (h: Habit) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  bottomInset: number;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();

  const [ym, setYm] = useState<string>(today.slice(0, 7)); // 'YYYY-MM'
  const [sel, setSel] = useState<string>(today); // 'YYYY-MM-DD'

  // 按日期把任务分组（含已完成），日期单元格有任务则显示圆点
  const byDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const x of tasks) {
      if (!x.date) continue;
      if (!m[x.date]) m[x.date] = [];
      m[x.date].push(x);
    }
    return m;
  }, [tasks]);

  const [yy, mm] = ym.split('-').map(Number);
  const firstDow = new Date(yy, mm - 1, 1).getDay(); // 0 = 周日，与 week0..6 对齐
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weekLabels = [
    t('plan.week0'),
    t('plan.week1'),
    t('plan.week2'),
    t('plan.week3'),
    t('plan.week4'),
    t('plan.week5'),
    t('plan.week6'),
  ];

  const monthLabel = `${yy}·${`${mm}`.padStart(2, '0')}`;
  const selList = byDate[sel] || [];
  const selHasTasks = selList.length > 0;

  const shift = (delta: number) => {
    const nd = new Date(yy, mm - 1 + delta, 1);
    setYm(`${nd.getFullYear()}-${`${nd.getMonth() + 1}`.padStart(2, '0')}`);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
        <IconButton name={ICONS.chevronLeft} color={theme.onSurfaceVariant} onPress={() => shift(-1)} accessibilityLabel={t('plan.calPrev')} />
        <M3Text role="titleMedium">{monthLabel}</M3Text>
        <IconButton name={ICONS.chevronRight} color={theme.onSurfaceVariant} onPress={() => shift(1)} accessibilityLabel={t('plan.calNext')} />
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {weekLabels.map((w, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <M3Text role="labelSmall" color={theme.onSurfaceVariant}>{w}</M3Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          if (d == null) return <View key={`b${i}`} style={{ width: '14.2857%', aspectRatio: 1 }} />;
          const ds = `${ym}-${`${d}`.padStart(2, '0')}`;
          const has = !!byDate[ds] && byDate[ds].length > 0;
          const isToday = ds === today;
          const isSel = ds === sel;
          return (
            <TouchableOpacity
              key={ds}
              onPress={() => setSel(ds)}
              accessibilityRole="button"
              accessibilityLabel={`${ds}${has ? ' · ' + t('plan.calTasksOnDay') : ''}`}
              style={{ width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isSel ? theme.primaryContainer : 'transparent',
                }}
              >
                <M3Text
                  role="bodyMedium"
                  color={isSel ? theme.onPrimaryContainer : isToday ? theme.primary : theme.onSurface}
                >
                  {d}
                </M3Text>
              </View>
              {has && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    width: 5,
                    height: 5,
                    borderRadius: 2.5,
                    backgroundColor: isSel ? theme.onPrimaryContainer : theme.primary,
                  }}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Notion 风格：日历网格与当日明细之间加一条极细分隔线，统一层级节奏 */}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginTop: space.md, marginBottom: 2 }} />

      <View style={{ marginTop: space.lg }}>
        <SectionLabel text={t('plan.calTasksOnDay')} icon={ICONS.calendar} />
        {selHasTasks ? (
          selList.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} confirmDelete={confirmDelete} />
          ))
        ) : (
          <View style={{ marginTop: space.md }}>
            <EmptyState icon={ICONS.tasks} title={t('plan.calEmpty')} />
          </View>
        )}
      </View>

      {/* 合并「今日」模块：当选中日期为今天时，详情区追加今日习惯列表 */}
      {sel === today && habits.length > 0 && (
        <View style={{ marginTop: space.lg }}>
          <SectionLabel text={t('plan.todayHabits')} icon={ICONS.habit} />
          {habits.map((h) => (
            <HabitRow
              key={h.id}
              habit={h}
              today={today}
              onToggle={onToggleHabit}
              onDelete={onDeleteHabit}
              confirmDelete={confirmDelete}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function SectionLabel({ text, icon }: { text: string; icon?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, marginTop: 10 }}>
      {icon ? <Icon name={icon} size={16} color={theme.onSurfaceVariant} /> : null}
      <M3Text role="labelLarge" color={theme.onSurfaceVariant}>
        {text}
      </M3Text>
    </View>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  confirmDelete,
}: {
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  confirmDelete: (name: string, fn: () => void) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 56,
        paddingVertical: space.sm,
      }}
    >
      <CheckCircle checked={task.completed} onToggle={() => onToggle(task)} a11y={task.completed ? t('plan.markUndone') : t('plan.markDone')} theme={theme} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <M3Text
          role="bodyLarge"
          numberOfLines={1}
          style={task.completed ? { textDecorationLine: 'line-through', color: theme.onSurfaceVariant } : undefined}
        >
          {task.title}
        </M3Text>
        <M3Text role="labelSmall" color={theme.onSurfaceVariant} numberOfLines={1}>
          {`${task.time || t('plan.noTime')} · ${task.category}`}
        </M3Text>
      </View>
      {task.priority !== 'P2' ? (
        <Badge
          text={task.priority}
          color={task.priority === 'P0' ? theme.onErrorContainer : theme.onWarningContainer}
          bg={task.priority === 'P0' ? theme.errorContainer : theme.warningContainer}
        />
      ) : null}
      <IconButton
        name={ICONS.delete}
        color={theme.onSurfaceVariant}
        onPress={() => confirmDelete(task.title, () => onDelete(task))}
        accessibilityLabel={t('plan.deleteA11y', { name: task.title })}
      />
    </View>
  );
}

function HabitRow({
  habit,
  today,
  onToggle,
  onDelete,
  confirmDelete,
  onPress,
}: {
  habit: Habit;
  today: string;
  onToggle: (h: Habit) => void;
  onDelete: (h: Habit) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const rec = habit.records && habit.records[today];
  const done = habit.type === 'check' ? !!rec : habit.type === 'count' ? (rec || 0) >= habit.target : !!rec;
  const label =
    habit.type === 'count'
      ? t('home.todayCount', { cur: rec || 0, target: habit.target })
      : done
        ? t('home.checkedToday')
        : t('home.toCheck');
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 56,
        paddingVertical: space.sm,
      }}
    >
      <CheckCircle checked={done} onToggle={() => onToggle(habit)} a11y={done ? t('home.cancelCheckIn') : t('home.checkIn')} theme={theme} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <M3Text role="bodyLarge" numberOfLines={1}>
          {habit.name}
        </M3Text>
        <M3Text role="labelSmall" color={theme.onSurfaceVariant} numberOfLines={1}>
          {label}
        </M3Text>
      </View>
      <IconButton
        name={ICONS.delete}
        color={theme.onSurfaceVariant}
        onPress={() => confirmDelete(habit.name, () => onDelete(habit))}
        accessibilityLabel={t('plan.deleteA11y', { name: habit.name })}
      />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* 新增表单（BottomSheet 内，scroll 由 Sheet 承载）                       */
/* ------------------------------------------------------------------ */

function ScheduleForm({ today, onClose }: { today: string; onClose: () => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState<Priority>('P1');
  const [category, setCategory] = useState(t('plan.defaultCategory'));
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<TextInput>(null);
  const titleValid = canSubmitSchedule(title);

  const fieldStyle = {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.divider,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceContainer,
  };

  useEffect(() => {
    const id = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const submit = async () => {
    if (busy || !canSubmitSchedule(title)) return;
    setBusy(true);
    try {
      const list = await store.getTasks();
      await store.setTasks([
        ...list,
        { id: uid('t'), title: title.trim(), date, time, priority, category, note: '', completed: false, createdAt: Date.now() },
      ]);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ paddingBottom: space.xl }}>
      <TextField label={t('plan.titleLabel')} value={title} onChangeText={setTitle} placeholder={t('plan.titlePlaceholder')} inputRef={titleRef} />
      {title.length > 0 && !titleValid && (
        <M3Text role="labelMedium" color={theme.error} style={{ marginTop: 4 }}>
          {t('plan.titleRequired')}
        </M3Text>
      )}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <TouchableOpacity onPress={() => setShowDate(true)} accessibilityRole="button" accessibilityLabel={t('plan.pickDate')} style={[fieldStyle, { flex: 1 }]}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('plan.dateLabel')}</M3Text>
          <M3Text role="bodyLarge">{date}</M3Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowTime(true)} accessibilityRole="button" accessibilityLabel={t('plan.pickTime')} style={[fieldStyle, { flex: 1 }]}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('plan.timeLabel')}</M3Text>
          <M3Text role="bodyLarge">{time || t('plan.noTime')}</M3Text>
        </TouchableOpacity>
      </View>
      {showDate && <DateTimePicker mode="date" value={parseDate(date)} onChange={(e, sel) => { setShowDate(false); if (e.type === 'set' && sel) setDate(fmtDate(sel)); }} />}
      {showTime && <DateTimePicker mode="time" value={parseTime(time)} onChange={(e, sel) => { setShowTime(false); if (e.type === 'set' && sel) setTime(fmtTime(sel)); }} />}
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12, marginBottom: 6 }}>{t('plan.priorityLabel')}</M3Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['P0', 'P1', 'P2'] as const).map((p) => (
          <TouchableOpacity key={p} onPress={() => setPriority(p)} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: priority === p ? theme.primary : theme.surfaceContainer }}>
            <M3Text role="labelLarge" color={priority === p ? theme.onPrimary : theme.onSurfaceVariant}>{p}</M3Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ marginTop: 12 }}>
        <TextField label={t('plan.categoryLabel')} value={category} onChangeText={setCategory} placeholder={t('plan.categoryPlaceholder')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <PrimaryButton label={busy ? t('common.processing') : t('common.add')} onPress={submit} disabled={!titleValid || busy} style={{ flex: 1 }} />
        <Button label={t('common.cancel')} variant="text" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function HabitForm({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<HabitType>('check');
  const [target, setTarget] = useState('1');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    const id = setTimeout(() => nameRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const list = await store.getHabits();
      await store.setHabits([
        ...list,
        { id: uid('h'), name: name.trim(), type, target: type === 'check' ? 1 : Number(target) || 1, unit: '', records: {}, createdAt: Date.now() },
      ]);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ paddingBottom: space.xl }}>
      <TextField label={t('plan.habitName')} value={name} onChangeText={setName} placeholder={t('plan.habitNamePlaceholder')} inputRef={nameRef} />
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12, marginBottom: 6 }}>{t('plan.type')}</M3Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['check', 'count', 'value'] as const).map((tp) => (
          <TouchableOpacity key={tp} onPress={() => setType(tp)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: type === tp ? theme.primary : theme.surfaceContainer }}>
            <M3Text role="labelLarge" color={type === tp ? theme.onPrimary : theme.onSurfaceVariant}>
              {tp === 'check' ? t('plan.typeCheck') : tp === 'count' ? t('plan.typeCount') : t('plan.typeValue')}
            </M3Text>
          </TouchableOpacity>
        ))}
      </View>
      {type !== 'check' && (
        <View style={{ marginTop: 12 }}>
          <TextField label={t('plan.dailyGoal')} value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="8" />
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <PrimaryButton label={busy ? t('common.processing') : t('common.add')} onPress={submit} disabled={!name.trim() || busy} style={{ flex: 1 }} />
        <Button label={t('common.cancel')} variant="text" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 待买（次级入口）：从「更多」菜单打开的 Sheet 内完整复用                  */
/* ------------------------------------------------------------------ */

function ShoppingSub({
  items,
  onToggle,
  onDelete,
  confirmDelete,
  adding,
  onToggleAdding,
}: {
  items: ShopItem[];
  onToggle: (s: ShopItem) => void;
  onDelete: (s: ShopItem) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  adding: boolean;
  onToggleAdding: (v: boolean) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | 'pending' | 'bought'>('all');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [priority, setPriority] = useState<ShopPriority>('中');
  const [currency, setCurrency] = useState<Currency>('MYR');
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    if (adding) {
      const id = setTimeout(() => nameRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [adding]);

  const submit = async () => {
    if (!name.trim()) return;
    const list = await store.getShopping();
    await store.setShopping([
      ...list,
      { id: uid('s'), name: name.trim(), category: t('common.other'), priority, estimatedPrice: Number(price) || 0, currency, purchased: false, note: '', createdAt: Date.now() },
    ]);
    setName('');
    setPrice('');
    setPriority('中');
    setCurrency('MYR');
    onToggleAdding(false);
  };

  const shown = items.filter((s) => (filter === 'pending' ? !s.purchased : filter === 'bought' ? s.purchased : true));
  const pending = items.filter((s) => !s.purchased);
  const totalMyr = pending.filter((x) => x.currency === 'MYR').reduce((s, x) => s + x.estimatedPrice, 0);
  const totalCny = pending.filter((x) => x.currency === 'CNY').reduce((s, x) => s + x.estimatedPrice, 0);
  const totalLabel = [totalMyr > 0 ? formatMoney(totalMyr * 100, 'MYR') : null, totalCny > 0 ? formatMoney(totalCny * 100, 'CNY') : null]
    .filter(Boolean)
    .join(' + ') || formatMoney(0, 'MYR');

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <Chip label={t('plan.shopAll')} selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={t('plan.shopPending')} selected={filter === 'pending'} onPress={() => setFilter('pending')} />
        <Chip label={t('plan.shopBought')} selected={filter === 'bought'} onPress={() => setFilter('bought')} />
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ flex: 1, textAlign: 'right' }}>
          {t('plan.pendingSummary', { count: pending.length, total: totalLabel })}
        </M3Text>
      </View>
      {adding && (
        <View style={{ padding: 16, marginBottom: 12, borderRadius: radius.lg, backgroundColor: theme.surfaceContainer }}>
          <M3Text role="titleMedium" style={{ marginBottom: 12 }}>{t('plan.addItem')}</M3Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('plan.itemName')} value={name} onChangeText={setName} placeholder={t('plan.itemNamePlaceholder')} inputRef={nameRef} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={t('plan.estPrice')} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="0" prefix={currency === 'CNY' ? '¥' : 'RM'} />
            </View>
          </View>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12, marginBottom: 6 }}>{t('plan.currency')}</M3Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['CNY', 'MYR'] as const).map((c) => (
              <Chip key={c} label={c === 'CNY' ? t('finance.cnySym') : t('finance.myrSym')} selected={currency === c} onPress={() => setCurrency(c)} />
            ))}
          </View>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12, marginBottom: 6 }}>{t('plan.priority')}</M3Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['高', '中', '低'] as const).map((p) => (
              <TouchableOpacity key={p} onPress={() => setPriority(p)} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: priority === p ? theme.primary : theme.surfaceContainer }}>
                <M3Text role="labelLarge" color={priority === p ? theme.onPrimary : theme.onSurfaceVariant}>
                  {p === '高' ? t('plan.priHigh') : p === '中' ? t('plan.priMid') : t('plan.priLow')}
                </M3Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <PrimaryButton label={t('common.add')} onPress={submit} disabled={!name.trim()} style={{ flex: 1 }} />
            <Button label={t('common.cancel')} variant="text" onPress={() => { setName(''); setPrice(''); setPriority('中'); onToggleAdding(false); }} style={{ flex: 1 }} />
          </View>
        </View>
      )}
      {shown.length === 0 && !adding && <EmptyState icon={ICONS.shopping} title={t('plan.emptyShopping')} />}
      {shown.map((s) => (
        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm }}>
          <TouchableOpacity
            onPress={() => onToggle(s)}
            accessibilityRole="button"
            accessibilityLabel={s.purchased ? t('plan.moveToPending') : t('plan.markBought')}
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: s.purchased ? theme.successContainer : theme.surfaceContainer, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={s.purchased ? ICONS.check : ICONS.shopping} size={22} color={s.purchased ? theme.success : theme.onSurfaceVariant} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <M3Text role="bodyLarge" numberOfLines={1} style={s.purchased ? { textDecorationLine: 'line-through', color: theme.onSurfaceVariant } : undefined}>
              {s.name}
            </M3Text>
            <M3Text role="labelSmall" color={theme.onSurfaceVariant} numberOfLines={1}>
              {`${s.category} · ${s.priority}${s.estimatedPrice ? ' · ' + formatMoney(s.estimatedPrice * 100, s.currency) : ''}`}
            </M3Text>
          </View>
          {s.purchased ? <Badge text={t('plan.shopBought')} color={theme.success} bg={theme.successContainer} /> : null}
          <IconButton name={ICONS.delete} color={theme.onSurfaceVariant} onPress={() => confirmDelete(s.name, () => onDelete(s))} accessibilityLabel={t('plan.deleteA11y', { name: s.name })} />
        </View>
      ))}
    </View>
  );
}
