import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FlatList,
  View,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  StyleSheet,
  Switch,
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
import { useBottomContentInset, TAB_BAR_HEIGHT, TAB_BAR_FLOAT_GAP } from '../components/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBottomSheet } from '../components/anim';
import type { Task, SubTask, Habit, ShopItem, Priority, HabitType, ShopPriority, Currency, RepeatFrequency } from '../types';
import {
  shouldShowAddFab,
  classifySchedule,
  canSubmitSchedule,
  initialScheduleForm,
} from '../uiTasks';
import {
  scheduleTaskReminder,
  cancelTaskReminder,
  ensureReminderPermission,
  scheduleHabitReminder,
  cancelHabitReminder,
  LEAD_OPTIONS,
  leadLabel,
} from '../reminder';

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

// ---- 重复任务：按频率偏移日期 ----
const REPEAT_LABELS: Record<Exclude<RepeatFrequency, 'none'>, string> = {
  daily: 'D',
  weekly: 'W',
  monthly: 'M',
  yearly: 'Y',
};
function addPeriod(dateStr: string, freq: RepeatFrequency): string {
  if (!freq || freq === 'none') return dateStr;
  const d = parseDate(dateStr);
  switch (freq) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    default: return dateStr;
  }
  return fmtDate(d);
}

// ---- 搜索 + 排序（V2.9.0）----
type SortKey = 'priority' | 'date' | 'created' | 'alpha';
const SORT_KEYS: SortKey[] = ['priority', 'date', 'created', 'alpha'];
function sortLabel(t: (k: string, p?: Record<string, any>) => string, key: SortKey): string {
  return key === 'priority'
    ? t('plan.sortPriority')
    : key === 'date'
      ? t('plan.sortDate')
      : key === 'created'
        ? t('plan.sortCreated')
        : t('plan.sortAlpha');
}
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
function matchesQuery(task: Task, q: string): boolean {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    (task.title || '').toLowerCase().includes(s) ||
    (task.note || '').toLowerCase().includes(s)
  );
}
function sortTasks(list: Task[], key: SortKey): Task[] {
  const arr = [...list];
  switch (key) {
    case 'priority':
      arr.sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
          a.date.localeCompare(b.date) ||
          a.title.localeCompare(b.title),
      );
      break;
    case 'created':
      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      break;
    case 'alpha':
      arr.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'date':
    default:
      arr.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
      break;
  }
  return arr;
}
function matchesTag(task: Task, tag: string | null): boolean {
  if (!tag) return true;
  return (task.tags || []).includes(tag);
}

/**
 * 待办分栏当前「可见」的未完成任务 —— 搜索 / 标签筛选后的结果。
 * V2.11.0：批量操作的全选与已选计数都以此为准，保证「全选」只作用于屏幕上
 * 看得到的那些任务，不会误伤被筛选条件隐藏掉的条目。
 * TodoSub 自身也复用它派生分组列表，两处口径永远一致。
 */
function visibleTodoTasks(tasks: Task[], searchText: string, activeTag: string | null): Task[] {
  const q = searchText.trim();
  return tasks.filter((x) => !x.completed && matchesQuery(x, q) && matchesTag(x, activeTag));
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
  const [editingTask, setEditingTask] = useState<Task | null>(null); // 编辑（V2.13.4）：非空即打开编辑表单
  const [snack, setSnack] = useState<UndoState>(null);
  // 搜索 + 排序（V2.9.0）：待办 / 日历共用，跨分栏保持同步
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  // 标签筛选（V2.10.0）：待办 / 日历共用，跨分栏保持同步
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const x of d.tasks) (x.tags || []).forEach((tg) => set.add(tg));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [d.tasks]);
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
    const completing = !t2.completed;
    const list = await store.getTasks();
    await store.setTasks(list.map((x) => (x.id === t2.id ? { ...x, completed: !x.completed } : x)));
    // 提醒（V2.12.0）：任务完成即取消其本地通知
    if (completing) await cancelTaskReminder(t2.id);
    // 重复任务：完成时自动生成下一笔（提醒为相对提前量，下一笔自动按自身时间重算）
    if (completing && t2.repeat && t2.repeat !== 'none') {
      const nextDate = addPeriod(t2.date, t2.repeat);
      const nextSubs = (t2.subtasks || []).map((s) => ({ ...s, done: false }));
      const nextTask: Task = {
        id: uid('t'), title: t2.title, date: nextDate, time: t2.time || '',
        priority: t2.priority, category: t2.category, note: t2.note,
        completed: false, createdAt: Date.now(), repeat: t2.repeat,
        ...(nextSubs.length > 0 ? { subtasks: nextSubs } : {}),
        ...(t2.reminder != null ? { reminder: t2.reminder } : {}),
      };
      const updated = await store.getTasks();
      await store.setTasks([...updated, nextTask]);
      if (t2.reminder != null) await scheduleTaskReminder(nextTask);
      showUndo(t('plan.generatedNextRecurring'), async () => {
        const l = await store.getTasks();
        await store.setTasks(l.filter((x) => x.id !== nextTask.id));
        if (t2.reminder != null && !t2.completed) await scheduleTaskReminder(t2); // 撤销生成则恢复原任务提醒
      });
      return;
    }
    showUndo(prev.completed ? t('plan.toggleUndone') : t('plan.toggleDone'), async () => {
      const l = await store.getTasks();
      await store.setTasks(l.map((x) => (x.id === t2.id ? prev : x)));
      if (prev.reminder != null && !prev.completed) await scheduleTaskReminder(prev); // 撤销完成则恢复提醒
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
    await cancelTaskReminder(t2.id); // 提醒（V2.12.0）：删除即取消本地通知
    showUndo(t('plan.deletedTask'), async () => {
      await store.setTasks(prev);
      if (t2.reminder != null && !t2.completed) await scheduleTaskReminder(t2); // 撤销删除则恢复提醒
    });
  };

  // ——— 子任务（Subtasks）：纯派生字段，向后兼容，不动 SCHEMA ———
  const setTaskSubtasks = async (
    taskId: string,
    mutate: (subs: SubTask[]) => SubTask[],
    undoMsg: string,
  ) => {
    const prev = await store.getTasks();
    const next = prev.map((x) => (x.id === taskId ? { ...x, subtasks: mutate(x.subtasks || []) } : x));
    await store.setTasks(next);
    showUndo(undoMsg, async () => { await store.setTasks(prev); });
  };
  const toggleSubtask = (task: Task, subId: string) =>
    setTaskSubtasks(
      task.id,
      (subs) => subs.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
      task.subtasks?.find((s) => s.id === subId)?.done ? t('plan.markSubUndone') : t('plan.markSubDone'),
    );
  const addSubtask = (task: Task, title: string) =>
    setTaskSubtasks(task.id, (subs) => [...subs, { id: uid('st'), title, done: false }], t('plan.addedSubtask'));
  const deleteSubtask = (task: Task, subId: string) =>
    setTaskSubtasks(task.id, (subs) => subs.filter((s) => s.id !== subId), t('plan.deletedSubtask'));
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

  // ——— 多选模式 + 批量操作（V2.11.0，仅作用于「待办」分栏）———
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchTagOpen, setBatchTagOpen] = useState(false);

  // 屏幕上真正可见的待办 —— 全选 / 已选计数都锚定它
  const selectableIds = useMemo(
    () => visibleTodoTasks(d.tasks, searchText, activeTag).map((x) => x.id),
    [d.tasks, searchText, activeTag],
  );
  // 已选集合只保留「仍可见」的 id：筛选条件变化后不会残留影子选中项
  const effectiveSelected = useMemo(() => {
    const s = new Set<string>();
    for (const id of selectableIds) if (selectedIds.has(id)) s.add(id);
    return s;
  }, [selectableIds, selectedIds]);
  const selectedCount = effectiveSelected.size;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;

  const exitSelect = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    setBatchTagOpen(false);
  };
  const enterSelect = (id?: string) => {
    setSelecting(true);
    setSelectedIds(id ? new Set([id]) : new Set());
  };
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));

  /** 批量操作统一入口：拿到变更前的完整列表 → 走 store.setTasks → 挂撤销
   *  reminderIds：本次被完成/删除的任务 id，用于同步取消其本地提醒（V2.12.0） */
  const runBatch = async (
    mutate: (list: Task[]) => Task[],
    msg: string,
    reminderIds?: string[],
  ) => {
    const prev = await store.getTasks();
    const next = mutate(prev);
    await store.setTasks(next);
    if (reminderIds) for (const id of reminderIds) await cancelTaskReminder(id);
    showUndo(msg, async () => {
      await store.setTasks(prev);
      // 撤销后恢复对应提醒（仅未完成的任务）
      if (reminderIds) {
        for (const id of reminderIds) {
          const t0 = prev.find((x) => x.id === id);
          if (t0?.reminder != null && !t0.completed) await scheduleTaskReminder(t0);
        }
      }
    });
    exitSelect();
  };
  const batchComplete = () =>
    runBatch(
      (list) => list.map((x) => (effectiveSelected.has(x.id) ? { ...x, completed: true } : x)),
      t('plan.batchCompleted', { count: selectedCount }),
      [...effectiveSelected],
    );
  const batchDelete = () =>
    runBatch(
      (list) => list.filter((x) => !effectiveSelected.has(x.id)),
      t('plan.batchDeleted', { count: selectedCount }),
      [...effectiveSelected],
    );
  const applyBatchTag = (tag: string) => {
    const clean = tag.trim();
    if (!clean) return;
    setBatchTagOpen(false);
    runBatch(
      (list) =>
        list.map((x) => {
          if (!effectiveSelected.has(x.id)) return x;
          const tags = x.tags || [];
          if (tags.includes(clean)) return x;
          return { ...x, tags: [...tags, clean] };
        }),
      t('plan.batchTagged', { count: selectedCount }),
    );
  };
  const askBatchDelete = () =>
    Alert.alert(t('plan.deleteTitle'), t('plan.confirmBatchDelete', { count: selectedCount }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: batchDelete },
    ]);

  const fabLabel = seg === 'habit' ? t('plan.fabHabit') : seg === 'shopping' ? t('plan.fabShopping') : t('plan.fabTodo');
  const openAdd = () => setAdding(true);
  const openEdit = (task: Task) => setEditingTask(task);
  const handleSegChange = (next: Seg) => {
    setSeg(next);
    setAdding(false);
    exitSelect(); // 换分栏即退出多选，避免选中项跨分栏残留
  };

  // ---- 启动时补生成过期的重复任务 ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await store.getTasks();
      const today = todayStr();
      const toGenerate: Task[] = [];
      for (const t of all) {
        if (!t.completed || !t.repeat || t.repeat === 'none') continue;
        let nextDate = addPeriod(t.date, t.repeat);
        for (let i = 0; i < 20; i++) {
          if (all.some((x) => x.id !== t.id && x.title === t.title && x.date === nextDate && !x.completed && x.repeat === t.repeat)) break;
          if (nextDate > today) break;
          toGenerate.push({ ...t, id: uid('t'), date: nextDate, completed: false, createdAt: Date.now(), subtasks: (t.subtasks || []).map((s) => ({ ...s, done: false })) });
          nextDate = addPeriod(nextDate, t.repeat);
        }
      }
      if (toGenerate.length > 0 && !cancelled) {
        const current = await store.getTasks();
        await store.setTasks([...current, ...toGenerate]);
        // 提醒（V2.13.0）：同步为新生成的重复任务排程提醒（相对提前量随实例时间自动重算）
        for (const g of toGenerate) if (g.reminder != null) await scheduleTaskReminder(g);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* 搜索 + 排序（V2.9.0）：待办 / 日历共用，跨分栏同步 */}
      {(seg === 'todo' || seg === 'calendar') && (
        <View style={{ paddingHorizontal: pageMargin, paddingTop: space.xs, paddingBottom: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextField
                value={searchText}
                onChangeText={setSearchText}
                placeholder={t('plan.searchPlaceholder')}
                trailing={
                  searchText ? (
                    <IconButton
                      name={ICONS.close}
                      size={20}
                      color={theme.onSurfaceVariant}
                      onPress={() => setSearchText('')}
                      accessibilityLabel={t('common.cancel')}
                    />
                  ) : (
                    <Icon name={ICONS.search} size={20} color={theme.onSurfaceVariant} />
                  )
                }
              />
            </View>
            <TouchableOpacity
              onPress={() => {
                const i = SORT_KEYS.indexOf(sortKey);
                setSortKey(SORT_KEYS[(i + 1) % SORT_KEYS.length]);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t('plan.sortBy')}: ${sortLabel(t, sortKey)}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: theme.surfaceContainer, minHeight: touchMin }}
            >
              <Icon name={ICONS.sort} size={18} color={theme.onSurfaceVariant} />
              <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{sortLabel(t, sortKey)}</M3Text>
            </TouchableOpacity>
            {/* 多选模式入口（V2.11.0）：仅待办分栏，长按任务行也可进入 */}
            {seg === 'todo' && (
              <TouchableOpacity
                onPress={() => (selecting ? exitSelect() : enterSelect())}
                accessibilityRole="button"
                accessibilityState={{ selected: selecting }}
                accessibilityLabel={selecting ? t('plan.exitSelect') : t('plan.selectMode')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  backgroundColor: selecting ? theme.primaryContainer : theme.surfaceContainer,
                  minHeight: touchMin,
                }}
              >
                <Icon
                  name={selecting ? ICONS.close : ICONS.tasks}
                  size={18}
                  color={selecting ? theme.onPrimaryContainer : theme.onSurfaceVariant}
                />
                <M3Text role="labelMedium" color={selecting ? theme.onPrimaryContainer : theme.onSurfaceVariant}>
                  {selecting ? t('plan.exitSelect') : t('plan.selectMode')}
                </M3Text>
              </TouchableOpacity>
            )}
          </View>
          {allTags.length > 0 && (
            <View style={{ marginTop: space.xs, flexDirection: 'row', alignItems: 'center' }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                <Chip label={t('plan.allTags')} selected={activeTag === null} onPress={() => setActiveTag(null)} />
                {allTags.map((tg) => (
                  <Chip key={tg} label={tg} selected={activeTag === tg} onPress={() => setActiveTag(activeTag === tg ? null : tg)} />
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* 「今日」模块已合并进 CalendarSub：选中「今天」时日历详情区同时展示当日任务 + 今日习惯 */}
      {seg === 'todo' && (
        <TodoSub
          tasks={d.tasks}
          today={today}
          searchText={searchText}
          sortKey={sortKey}
          activeTag={activeTag}
          onToggle={toggleTask}
          onDelete={deleteTask}
          confirmDelete={confirmDelete}
          onToggleSubtask={toggleSubtask}
          onAddSubtask={addSubtask}
          onDeleteSubtask={deleteSubtask}
          onEdit={openEdit}
          bottomInset={bottomInset}
          selecting={selecting}
          selectedIds={effectiveSelected}
          onToggleSelect={toggleSelect}
          onEnterSelect={enterSelect}
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
          searchText={searchText}
          sortKey={sortKey}
          activeTag={activeTag}
          onToggle={toggleTask}
          onDelete={deleteTask}
          onToggleHabit={toggleHabit}
          onDeleteHabit={deleteHabit}
          confirmDelete={confirmDelete}
          onToggleSubtask={toggleSubtask}
          onAddSubtask={addSubtask}
          onDeleteSubtask={deleteSubtask}
          onEdit={openEdit}
          bottomInset={bottomInset}
        />
      )}

      {/* 多选模式下让位给批量操作条 */}
      {shouldShowAddFab(adding) && !(selecting && seg === 'todo') && (
        <FAB icon={ICONS.add} label={fabLabel} onPress={openAdd} />
      )}

      {/* 批量操作条（V2.11.0）：悬在胶囊底栏之上，仅待办分栏的多选模式出现 */}
      {selecting && seg === 'todo' && (
        <BatchActionBar
          selectedCount={selectedCount}
          allSelected={allSelected}
          disabled={selectedCount === 0}
          onExit={exitSelect}
          onSelectAll={toggleSelectAll}
          onComplete={batchComplete}
          onTag={() => setBatchTagOpen(true)}
          onDelete={askBatchDelete}
        />
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

      {/* 编辑日程（V2.13.4）：复用 ScheduleForm，按所选任务预填，保存时原地更新 */}
      <AppBottomSheet
        visible={editingTask !== null}
        onClose={() => setEditingTask(null)}
        title={t('plan.editSchedule')}
        scroll
      >
        {editingTask && <ScheduleForm today={today} onClose={() => setEditingTask(null)} task={editingTask} />}
      </AppBottomSheet>

      {/* 批量加标签（V2.11.0）：选已有标签或现场新建，选中项统一追加 */}
      <AppBottomSheet
        visible={batchTagOpen}
        onClose={() => setBatchTagOpen(false)}
        title={t('plan.batchTagTitle', { count: selectedCount })}
        scroll
      >
        <BatchTagPanel
          existingTags={allTags}
          onPick={applyBatchTag}
          onCancel={() => setBatchTagOpen(false)}
        />
      </AppBottomSheet>

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

/* 48×48 勾选圈：统一最小触控，主色填充表示已完成。
   square=true → 多选模式的方形复选框（V2.11.0），与「完成」语义做视觉区分 */
function CheckCircle({
  checked,
  onToggle,
  a11y,
  theme,
  size = 48,
  square = false,
}: {
  checked: boolean;
  onToggle: () => void;
  a11y: string;
  theme: any;
  size?: number;
  square?: boolean;
}) {
  const iconSize = Math.round(size * 0.46);
  const fill = square ? theme.primary : theme.primaryContainer;
  const onFill = square ? theme.onPrimary : theme.onPrimaryContainer;
  return (
    <TouchableOpacity
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={8}
      style={{
        width: size,
        height: size,
        borderRadius: square ? size * 0.28 : size / 2,
        backgroundColor: checked ? fill : theme.surfaceContainer,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name={checked ? ICONS.check : square ? 'checkbox-blank-outline' : 'checkbox-blank-circle-outline'}
        size={iconSize}
        color={checked ? onFill : theme.onSurfaceVariant}
      />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* 批量操作条（V2.11.0）：悬在胶囊底栏上方，只在待办分栏的多选模式出现    */
/* ------------------------------------------------------------------ */
function BatchActionBar({
  selectedCount,
  allSelected,
  disabled,
  onExit,
  onSelectAll,
  onComplete,
  onTag,
  onDelete,
}: {
  selectedCount: number;
  allSelected: boolean;
  disabled: boolean;
  onExit: () => void;
  onSelectAll: () => void;
  onComplete: () => void;
  onTag: () => void;
  onDelete: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const actions: Array<{ key: string; label: string; icon: string; fg: string; bg: string; onPress: () => void }> = [
    { key: 'complete', label: t('plan.batchComplete'), icon: ICONS.check, fg: theme.onPrimaryContainer, bg: theme.primaryContainer, onPress: onComplete },
    { key: 'tag', label: t('plan.batchTag'), icon: ICONS.tag, fg: theme.onSurfaceVariant, bg: theme.surfaceContainer, onPress: onTag },
    { key: 'delete', label: t('plan.batchDelete'), icon: ICONS.delete, fg: theme.onErrorContainer, bg: theme.errorContainer, onPress: onDelete },
  ];
  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: insets.bottom + TAB_BAR_FLOAT_GAP + TAB_BAR_HEIGHT + 12,
        backgroundColor: theme.surface,
        borderRadius: radius.xl,
        padding: space.sm,
        shadowColor: '#0F0F0F',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <IconButton
          name={ICONS.close}
          color={theme.onSurfaceVariant}
          onPress={onExit}
          accessibilityLabel={t('plan.exitSelect')}
        />
        <M3Text role="titleMedium" style={{ flex: 1 }} numberOfLines={1}>
          {t('plan.selectedCount', { count: selectedCount })}
        </M3Text>
        <TouchableOpacity
          onPress={onSelectAll}
          accessibilityRole="button"
          accessibilityLabel={allSelected ? t('plan.deselectAll') : t('plan.selectAll')}
          hitSlop={8}
          style={{ paddingVertical: 8, paddingHorizontal: 10, minHeight: touchMin, justifyContent: 'center' }}
        >
          <M3Text role="labelLarge" color={theme.primary}>
            {allSelected ? t('plan.deselectAll') : t('plan.selectAll')}
          </M3Text>
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
        {actions.map((a) => (
          <TouchableOpacity
            key={a.key}
            onPress={disabled ? undefined : a.onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ disabled }}
            activeOpacity={0.85}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: touchMin,
              paddingHorizontal: 6,
              borderRadius: radius.md,
              backgroundColor: a.bg,
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <Icon name={a.icon} size={18} color={a.fg} />
            <M3Text role="labelLarge" color={a.fg} numberOfLines={1}>{a.label}</M3Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* 批量加标签面板（V2.11.0）：已有标签一键套用，或直接新建一个 */
function BatchTagPanel({
  existingTags,
  onPick,
  onCancel,
}: {
  existingTags: string[];
  onPick: (tag: string) => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    onPick(v);
  };
  return (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      {existingTags.length > 0 ? (
        <View>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.xs }}>
            {t('plan.filterByTag')}
          </M3Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {existingTags.map((tg) => (
              <Chip key={tg} label={tg} icon={ICONS.tag} onPress={() => onPick(tg)} />
            ))}
          </View>
        </View>
      ) : null}
      <View>
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.xs }}>
          {t('plan.newTag')}
        </M3Text>
        <TextField
          value={text}
          onChangeText={setText}
          placeholder={t('plan.tagPlaceholder')}
          onSubmitEditing={submit}
          returnKeyType="done"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('plan.addTag')} variant="tonal" onPress={submit} disabled={text.trim().length === 0} />
        </View>
      </View>
    </View>
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
  searchText,
  sortKey,
  activeTag,
  onToggle,
  onDelete,
  confirmDelete,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onEdit,
  bottomInset,
  selecting,
  selectedIds,
  onToggleSelect,
  onEnterSelect,
}: {
  tasks: Task[];
  today: string;
  searchText: string;
  sortKey: SortKey;
  activeTag: string | null;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  onToggleSubtask: (task: Task, subId: string) => void;
  onAddSubtask: (task: Task, title: string) => void;
  onDeleteSubtask: (task: Task, subId: string) => void;
  onEdit: (t: Task) => void;
  bottomInset: number;
  /** 多选模式（V2.11.0） */
  selecting: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEnterSelect: (id: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const q = searchText.trim();
  const filtering = q.length > 0 || activeTag !== null;
  const active = visibleTodoTasks(tasks, searchText, activeTag);
  const overdue = sortTasks(
    active.filter((x) => classifySchedule(x.date, x.completed, today) === 'overdue'),
    sortKey,
  );
  const todayList = sortTasks(
    active.filter((x) => classifySchedule(x.date, x.completed, today) === 'today'),
    sortKey,
  );
  const upcoming = sortTasks(
    active.filter((x) => classifySchedule(x.date, x.completed, today) === 'upcoming'),
    sortKey,
  );

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
    if (filtering) {
      rows.push({ kind: 'empty', id: 'empty', icon: ICONS.search, title: t('plan.noResults'), hint: t('plan.noResultsHint') });
    } else {
      rows.push({ kind: 'empty', id: 'empty', icon: ICONS.tasks, title: t('plan.emptyTodo'), hint: t('plan.emptyTodoHint') });
    }
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
        if (item.kind === 'task')
          return (
            <TaskRow
              task={item.task}
              onToggle={onToggle}
              onDelete={onDelete}
              confirmDelete={confirmDelete}
              onToggleSubtask={onToggleSubtask}
              onAddSubtask={onAddSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onEdit={() => onEdit(item.task)}
              selecting={selecting}
              selected={selectedIds.has(item.task.id)}
              onToggleSelect={onToggleSelect}
              onEnterSelect={onEnterSelect}
            />
          );
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
  searchText,
  sortKey,
  activeTag,
  onToggle,
  onDelete,
  onToggleHabit,
  onDeleteHabit,
  confirmDelete,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onEdit,
  bottomInset,
}: {
  tasks: Task[];
  habits: Habit[];
  today: string;
  searchText: string;
  sortKey: SortKey;
  activeTag: string | null;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToggleHabit: (h: Habit) => void;
  onDeleteHabit: (h: Habit) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  onToggleSubtask: (task: Task, subId: string) => void;
  onAddSubtask: (task: Task, title: string) => void;
  onDeleteSubtask: (task: Task, subId: string) => void;
  onEdit: (t: Task) => void;
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
  const q = searchText.trim();
  const filtering = q.length > 0 || activeTag !== null;
  const selList = sortTasks((byDate[sel] || []).filter((x) => matchesQuery(x, q) && matchesTag(x, activeTag)), sortKey);
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
            <TaskRow
              key={task.id}
              task={task}
              onToggle={onToggle}
              onDelete={onDelete}
              confirmDelete={confirmDelete}
              onToggleSubtask={onToggleSubtask}
              onAddSubtask={onAddSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onEdit={() => onEdit(task)}
            />
          ))
        ) : (
          <View style={{ marginTop: space.md }}>
            {filtering ? (
              <EmptyState icon={ICONS.search} title={t('plan.noResults')} hint={t('plan.noResultsHint')} />
            ) : (
              <EmptyState icon={ICONS.tasks} title={t('plan.calEmpty')} />
            )}
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

function SubTaskList({
  task,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
}: {
  task: Task;
  onToggleSubtask: (task: Task, subId: string) => void;
  onAddSubtask: (task: Task, title: string) => void;
  onDeleteSubtask: (task: Task, subId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const subs = task.subtasks || [];
  return (
    <View style={{ paddingLeft: 48 + space.md, paddingBottom: space.sm }}>
      {subs.map((s) => (
        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 }}>
          <CheckCircle
            checked={s.done}
            size={32}
            onToggle={() => onToggleSubtask(task, s.id)}
            a11y={s.done ? t('plan.markSubUndone') : t('plan.markSubDone')}
            theme={theme}
          />
          <M3Text
            role="bodyMedium"
            numberOfLines={1}
            style={[s.done && { textDecorationLine: 'line-through', color: theme.onSurfaceVariant }, { flex: 1 }]}
          >
            {s.title}
          </M3Text>
          <IconButton
            name={ICONS.delete}
            color={theme.onSurfaceVariant}
            onPress={() => onDeleteSubtask(task, s.id)}
            accessibilityLabel={t('plan.deleteSubtaskA11y', { name: s.title })}
          />
        </View>
      ))}
      {adding ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surfaceContainer }} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('plan.subtaskPlaceholder')}
            placeholderTextColor={theme.onSurfaceVariant}
            style={{ flex: 1, color: theme.onSurface, fontSize: 15 }}
            autoFocus
            onSubmitEditing={() => {
              const v = text.trim();
              if (v) {
                onAddSubtask(task, v);
                setText('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (!text.trim()) setAdding(false);
            }}
          />
        </View>
      ) : (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setAdding(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 }}
        >
          <Icon name={ICONS.add} size={20} color={theme.onSurfaceVariant} />
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
            {t('plan.addSubtask')}
          </M3Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  confirmDelete,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  // 编辑（V2.13.4）：点击行主体打开预填编辑表单，按钮区（勾选/删除/展开）不触发
  onEdit,
  // 多选模式（V2.11.0）—— 全部可选，日历分栏不传即退化为普通行
  selecting = false,
  selected = false,
  onToggleSelect,
  onEnterSelect,
}: {
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  confirmDelete: (name: string, fn: () => void) => void;
  onToggleSubtask: (task: Task, subId: string) => void;
  onAddSubtask: (task: Task, title: string) => void;
  onDeleteSubtask: (task: Task, subId: string) => void;
  onEdit?: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEnterSelect?: (id: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const subs = task.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const total = subs.length;
  const hasSubs = total > 0 && !selecting;
  // 选中高亮：用负外边距 + 等量内边距补回来，避免行内文字在进出多选时左右跳动
  const highlight: any = selecting && selected
    ? {
        backgroundColor: theme.surfaceContainerHigh,
        borderRadius: radius.md,
        marginHorizontal: -space.sm,
        paddingHorizontal: space.sm,
      }
    : null;
  return (
    <View>
      <TouchableOpacity
        activeOpacity={1}
        onLongPress={selecting || !onEnterSelect ? undefined : () => onEnterSelect(task.id)}
        accessibilityRole="button"
        accessibilityLabel={task.title}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            minHeight: 56,
            paddingVertical: space.sm,
          },
          highlight,
        ]}
      >
        {selecting ? (
          <CheckCircle
            square
            checked={selected}
            onToggle={() => onToggleSelect?.(task.id)}
            a11y={t('plan.selectTaskA11y', { name: task.title })}
            theme={theme}
          />
        ) : (
          <CheckCircle checked={task.completed} onToggle={() => onToggle(task)} a11y={task.completed ? t('plan.markUndone') : t('plan.markDone')} theme={theme} />
        )}
        <TouchableOpacity
          style={{ flex: 1, minWidth: 0 }}
          onPress={onEdit}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('plan.editA11y', { name: task.title })}
          disabled={!onEdit}
        >
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
          {task.tags && task.tags.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
              {task.tags.map((tg) => (
                <View key={tg} style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: radius.sm, backgroundColor: theme.surfaceContainer }}>
                  <M3Text role="labelSmall" color={theme.onSurfaceVariant}>#{tg}</M3Text>
                </View>
              ))}
            </View>
          ) : null}
        </TouchableOpacity>
        {hasSubs ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <M3Text role="labelSmall" color={theme.onSurfaceVariant}>
              {t('plan.subtaskProgress', { done, total })}
            </M3Text>
            <IconButton
              name={expanded ? ICONS.chevronDown : ICONS.chevronRight}
              color={theme.onSurfaceVariant}
              onPress={() => setExpanded((e) => !e)}
              accessibilityLabel={t('plan.toggleSubtasks')}
            />
          </View>
        ) : null}
        {task.repeat && task.repeat !== 'none' ? (
          <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: theme.surfaceContainer }}>
            <M3Text role="labelSmall" color={theme.primary}>
              {REPEAT_LABELS[task.repeat] || task.repeat}
            </M3Text>
          </View>
        ) : null}
        {task.priority !== 'P2' ? (
          <Badge
            text={task.priority}
            color={task.priority === 'P0' ? theme.onErrorContainer : theme.onWarningContainer}
            bg={task.priority === 'P0' ? theme.errorContainer : theme.warningContainer}
          />
        ) : null}
        {!selecting && (
          <IconButton
            name={ICONS.delete}
            color={theme.onSurfaceVariant}
            onPress={() => confirmDelete(task.title, () => onDelete(task))}
            accessibilityLabel={t('plan.deleteA11y', { name: task.title })}
          />
        )}
      </TouchableOpacity>
      {hasSubs && expanded ? (
        <SubTaskList
          task={task}
          onToggleSubtask={onToggleSubtask}
          onAddSubtask={onAddSubtask}
          onDeleteSubtask={onDeleteSubtask}
        />
      ) : null}
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

function ScheduleForm({ today, onClose, task }: { today: string; onClose: () => void; task?: Task }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const editing = !!task;
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.date ?? today);
  const [time, setTime] = useState(task?.time ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'P1');
  const [category, setCategory] = useState(task?.category ?? t('plan.defaultCategory'));
  const [repeat, setRepeat] = useState<RepeatFrequency>(task?.repeat ?? 'none');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState<string[]>(task?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  // 提醒：相对提前量；编辑时按任务已有值预填
  const [reminderOn, setReminderOn] = useState(task?.reminder != null);
  const [reminderLead, setReminderLead] = useState<number>(task?.reminder ?? 30); // 提前分钟数
  const [showLeadPicker, setShowLeadPicker] = useState(false); // 内联下拉面板
  const titleRef = useRef<TextInput>(null);
  const titleValid = canSubmitSchedule(title);
  const reminderInPast =
    reminderOn &&
    (() => {
      const w = new Date(`${date}T${time || '09:00'}`);
      return !isNaN(w.getTime()) && w.getTime() <= Date.now();
    })();

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
    if (busy || !canSubmitSchedule(title) || reminderInPast) return;
    setBusy(true);
    try {
      const list = await store.getTasks();
      const reminder = reminderOn ? reminderLead : undefined;
      // 编辑：原地更新，保留 id / createdAt / completed / note / subtasks 等不可编辑字段
      const saved: Task = task
        ? {
            ...task,
            title: title.trim(),
            date,
            time,
            priority,
            category,
            repeat: repeat !== 'none' ? repeat : undefined,
            tags: tags.length > 0 ? tags : undefined,
            reminder,
          }
        : {
            id: uid('t'),
            title: title.trim(),
            date,
            time,
            priority,
            category,
            note: '',
            completed: false,
            createdAt: Date.now(),
            repeat: repeat !== 'none' ? repeat : undefined,
            ...(tags.length > 0 ? { tags } : {}),
            ...(reminder != null ? { reminder } : {}),
          };
      if (task) {
        await store.setTasks(list.map((x) => (x.id === task.id ? saved : x)));
        // 提醒：先取消旧排程，再按新值重排（关闭提醒则不再排程）
        await cancelTaskReminder(task.id);
        if (reminder != null) await scheduleTaskReminder(saved);
      } else {
        await store.setTasks([...list, saved]);
        if (reminder != null) await scheduleTaskReminder(saved);
      }
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
      {/* 提醒 */}
      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('plan.reminder')}</M3Text>
          <Switch
            value={reminderOn}
            onValueChange={async (v) => {
              if (v) {
                const ok = await ensureReminderPermission();
                if (!ok) {
                  Alert.alert(t('plan.reminderPermissionDenied'));
                  return;
                }
                if (!time) setTime('09:00'); // 无时间则默认 09:00，仍可改
                setReminderLead(30);
              }
              setShowLeadPicker(false);
              setReminderOn(v);
            }}
            trackColor={{ false: theme.divider, true: theme.primaryContainer }}
            thumbColor={reminderOn ? theme.primary : theme.onSurfaceVariant}
            style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
          />
        </View>
        {reminderOn && (
          <>
            <TouchableOpacity
              onPress={() => setShowLeadPicker((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t('plan.reminderLead')}
              style={[fieldStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }]}
            >
              <View>
                <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('plan.reminderLead')}</M3Text>
                <M3Text role="bodyLarge" color={theme.onSurface} style={{ marginTop: 2 }}>{leadLabel(reminderLead)}</M3Text>
              </View>
              <Icon name={showLeadPicker ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={theme.onSurfaceVariant} />
            </TouchableOpacity>
            {showLeadPicker && (
              <View style={{ marginTop: 6, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: radius.md, backgroundColor: theme.surfaceContainer }}>
                {LEAD_OPTIONS.map((opt) => {
                  const selected = reminderLead === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => { setReminderLead(opt); setShowLeadPicker(false); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 14 }}
                    >
                      <M3Text role="bodyLarge" color={selected ? theme.primary : theme.onSurface}>{leadLabel(opt)}</M3Text>
                      {selected && <Icon name={ICONS.check} size={18} color={theme.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 8 }}>{t('plan.reminderHint')}</M3Text>
            {reminderInPast && (
              <M3Text role="labelMedium" color={theme.error} style={{ marginTop: 4 }}>{t('plan.reminderPast')}</M3Text>
            )}
          </>
        )}
      </View>
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
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12, marginBottom: 6 }}>{t('plan.repeat')}</M3Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((r) => (
          <TouchableOpacity key={r} onPress={() => setRepeat(r)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: repeat === r ? theme.primary : theme.surfaceContainer }}>
            <M3Text role="labelLarge" color={repeat === r ? theme.primary : theme.onSurfaceVariant}>
              {r === 'none' ? t('plan.repeatNone') : r === 'daily' ? t('plan.repeatDaily') : r === 'weekly' ? t('plan.repeatWeekly') : r === 'monthly' ? t('plan.repeatMonthly') : t('plan.repeatYearly')}
            </M3Text>
          </TouchableOpacity>
        ))}
      </View>
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12, marginBottom: 6 }}>{t('plan.tags')}</M3Text>
      {tags.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {tags.map((tg) => (
            <View key={tg} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: theme.primaryContainer }}>
              <M3Text role="labelMedium" color={theme.onPrimaryContainer}>#{tg}</M3Text>
              <TouchableOpacity onPress={() => setTags(tags.filter((x) => x !== tg))} accessibilityRole="button" accessibilityLabel={t('plan.deleteTagA11y', { name: tg })} hitSlop={4}>
                <Icon name={ICONS.close} size={14} color={theme.onPrimaryContainer} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={tagInput}
            onChangeText={setTagInput}
            placeholder={t('plan.tagPlaceholder')}
            onSubmitEditing={() => {
              const v = tagInput.trim();
              if (v && !tags.includes(v)) setTags([...tags, v]);
              if (v) setTagInput('');
            }}
            trailing={
              <IconButton
                name={ICONS.add}
                size={20}
                color={theme.onSurfaceVariant}
                onPress={() => {
                  const v = tagInput.trim();
                  if (v && !tags.includes(v)) setTags([...tags, v]);
                  if (v) setTagInput('');
                }}
                accessibilityLabel={t('plan.addTag')}
              />
            }
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <PrimaryButton label={busy ? t('common.processing') : editing ? t('common.save') : t('common.add')} onPress={submit} disabled={!titleValid || busy || reminderInPast} style={{ flex: 1 }} />
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
  // 习惯每日提醒（V2.13.0）
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState('09:00');
  const [showReminderTime, setShowReminderTime] = useState(false);
  const nameRef = useRef<TextInput>(null);

  const fieldStyle = {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.divider,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceContainer,
  };

  useEffect(() => {
    const id = setTimeout(() => nameRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const list = await store.getHabits();
      const newHabit: Habit = {
        id: uid('h'),
        name: name.trim(),
        type,
        target: type === 'check' ? 1 : Number(target) || 1,
        unit: '',
        records: {},
        createdAt: Date.now(),
        ...(reminderOn ? { reminderTime } : {}),
      };
      await store.setHabits([...list, newHabit]);
      if (reminderOn) await scheduleHabitReminder(newHabit);
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
      {/* 习惯每日提醒（V2.13.0） */}
      <View style={{ marginTop: 12 }}>
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
              <DateTimePicker mode="time" value={parseTime(reminderTime)} onChange={(e, sel) => { setShowReminderTime(false); if (e.type === 'set' && sel) setReminderTime(fmtTime(sel)); }} />
            )}
          </>
        )}
      </View>
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
