import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions, ListRenderItem } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useData } from '../useData';
import { store, todayStr, ymStr } from '../store';
import type { Currency, Habit, Txn } from '../types';
import { financeStats, upcomingItems, creditCard, relDate } from '../calc';
import { formatMoney, txnOrigCurrency, txnOrigMinor } from '../money';
import { Card, ScreenHeader, SectionHeader, ListItem } from '../components/kit';
import { Snackbar, EmptyState, M3Text } from '../components/ui';
import { AnimatedBalance, AnimatedListItem, AnimatedPressable, FadeInContent } from '../components/anim';
import { Amount } from '../components/Amount';
import { useBottomContentInset } from '../components/layout';
import { Icon, ICONS } from '../icons';
import { radius, pageMargin, cardGap, space, touchMin } from '../tokens';
import { useNotifyNav } from '../notify/NotifyNav';
import { usePendingCount } from '../notify/pendingStore';

// ─────────────────────────────────────────────────────────────────────────────
// §五 今日（首页）— 财务优先
//
// 信息顺序（从上到下，重要度递减）：
//   1. 问候 + 日期（谁、什么时候）
//   2. 财务主卡：本月结余是全屏最大的数字；MYR / CNY 分开列，不做汇率合并
//   3. 快捷操作：一行四个，不换行
//   4. 最近流水：FlatList，5 条
//   5. 今日计划：待办 + 习惯（可就地勾选 + 撤销）
//   6. 即将到期：只在真的有内容时才出现
//
// 排版硬约束：
//   · 所有金额用 fontVariant: ['tabular-nums']，切换月份/币种时数字不跳动
//   · 主数字不使用 adjustsFontSizeToFit / minimumFontScale——不允许缩到看不清
//   · 窄屏（<360dp）收入/支出改为纵向堆叠，绝不横向挤压
//   · 底部留白统一由 useBottomContentInset() 计算，浮动底栏不遮挡最后一条
// ─────────────────────────────────────────────────────────────────────────────

/** 窄屏阈值：小于此宽度时所有并排布局改为纵向 */
const NARROW = 360;

/** 等宽数字，避免金额变化时字距抖动 */
const TNUM = { fontVariant: ['tabular-nums' as const] };

/**
 * §五.6 列表进入动画只在「首次进入」播放，页面返回时不要全部重播。
 * 用模块级标记在整个 App 会话内只播放一次（新增项也复用同一列表，
 * 此处仅保证返回首页不重播逐条淡入）。
 */
let homeRecentIntroPlayed = false;

type ActionItem = {
  kind: 'task' | 'habit' | 'shop';
  id: string;
  title: string;
  sub: string;
  priority?: string;
};

function isHabitDone(h: Habit, today: string): boolean {
  const rec = h.records && h.records[today];
  return h.type === 'check' ? !!rec : h.type === 'count' ? (rec ?? 0) >= h.target : !!rec;
}

function prioRank(p?: string): number {
  return p === 'P0' ? 0 : p === 'P1' ? 1 : p === 'P2' ? 2 : 3;
}

/** 流水条目的展示语义：支出/退款 = 负向，收入 = 正向，转账/还款 = 中性 */
function txnTone(t: Txn): 'out' | 'in' | 'neutral' {
  if (t.type === 'expense') return 'out';
  if (t.type === 'income') return 'in';
  if (t.type === 'refund') return 'in';
  return 'neutral';
}

export default function HomeScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { t, resolved } = useI18n();
  const d = useData();
  const nav = useNotifyNav();
  const pendingCount = usePendingCount();
  const today = todayStr();
  const { width: screenW, fontScale } = useWindowDimensions();
  const narrow = screenW < NARROW;
  const bottomInset = useBottomContentInset();

  // §五.6 首次挂载后标记「已播放」，之后返回首页不再重播逐条淡入
  useEffect(() => {
    homeRecentIntroPlayed = true;
  }, []);

  /* ---------------------------------------------------------------- */
  /* 业务数据（复用既有 helper，不重写记账逻辑）                        */
  /* ---------------------------------------------------------------- */

  // financeStats 返回整数最小单位，且已经尊重 affectsIncomeExpense / refund 冲减，
  // 所以本月收支不会把「理财 / 转账 / 充值」算进来。
  const stats = useMemo(() => financeStats(d.txns, ymStr()), [d.txns]);
  const cny = stats.incomeExpense.CNY;
  const myr = stats.incomeExpense.MYR;

  const netOf = (c: Currency) => (c === 'CNY' ? cny.income - cny.expense : myr.income - myr.expense);
  const volOf = (c: Currency) => (c === 'CNY' ? cny.income + cny.expense : myr.income + myr.expense);

  // 主币种 = 本月活动量更大的那个。这样 MYR 为主的月份就把 RM 放大，
  // 不会出现「主数字永远是 ¥0.00」的情况。
  const primary: Currency = volOf('MYR') > volOf('CNY') ? 'MYR' : 'CNY';
  const secondary: Currency = primary === 'CNY' ? 'MYR' : 'CNY';
  const showSecondary = volOf(secondary) > 0;

  const up = upcomingItems(d.tasks, today);
  const card = creditCard(d.cardDays, d.txns, today);

  const recent = useMemo(
    () =>
      [...d.txns]
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (b.time || '').localeCompare(a.time || '') ||
            (b.createdAt || 0) - (a.createdAt || 0)
        )
        .slice(0, 5),
    [d.txns]
  );

  const todayTasks = d.tasks
    .filter((x) => !x.completed && x.date === today)
    .sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || (a.time || '').localeCompare(b.time || ''));
  const todayHabits = d.habits.filter((h) => !isHabitDone(h, today));

  /* ---------------------------------------------------------------- */
  /* 就地完成 / 打卡 + 撤销（逻辑保持原样）                            */
  /* ---------------------------------------------------------------- */

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snack, setSnack] = useState<{ msg: string; onUndo: () => void } | null>(null);
  const showSnack = (msg: string, onUndo: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    setSnack({ msg, onUndo });
    timer.current = setTimeout(() => setSnack(null), 4000);
  };

  const completeTask = async (id: string, completed: boolean) => {
    const list = await store.getTasks();
    await store.setTasks(list.map((x) => (x.id === id ? { ...x, completed } : x)));
  };
  const setHabitToday = async (h: Habit, value: number) => {
    const list = await store.getHabits();
    const rec = { ...(h.records || {}) };
    if (value <= 0) delete rec[today];
    else rec[today] = value;
    await store.setHabits(list.map((x) => (x.id === h.id ? { ...x, records: rec } : x)));
  };
  const setShopPurchased = async (id: string, purchased: boolean) => {
    const list = await store.getShopping();
    await store.setShopping(list.map((s) => (s.id === id ? { ...s, purchased } : s)));
  };

  const onToggle = async (item: ActionItem) => {
    const title = item.title;
    try {
      if (item.kind === 'task') {
        await completeTask(item.id, true);
        showSnack(t('home.completedTask', { name: title }), () => {
          completeTask(item.id, false);
          setSnack(null);
        });
      } else if (item.kind === 'habit') {
        const h = d.habits.find((x) => x.id === item.id);
        if (!h) return;
        const prev = (h.records && h.records[today]) || 0;
        const target = h.type === 'count' ? h.target : 1;
        await setHabitToday(h, target);
        showSnack(t('home.checkedIn', { name: title }), () => {
          setHabitToday(h, prev);
          setSnack(null);
        });
      } else {
        await setShopPurchased(item.id, true);
        showSnack(t('home.bought', { name: title }), () => {
          setShopPurchased(item.id, false);
          setSnack(null);
        });
      }
    } catch {
      // storage error: UI reverts via the data reload; nothing else to do
    }
  };

  /* ---------------------------------------------------------------- */
  /* 导航目标                                                          */
  /* ---------------------------------------------------------------- */

  const goFinance = (tab?: 'overview' | 'txns' | 'budget') =>
    navigation.navigate('财务', { screen: 'FinanceHome', params: tab ? { tab } : undefined });
  const goPlan = (seg?: 'today' | 'todo' | 'habit') =>
    navigation.navigate('计划', { screen: 'PlanHome', params: seg ? { seg } : undefined });

  /* ---------------------------------------------------------------- */
  /* 问候 / 日期                                                       */
  /* ---------------------------------------------------------------- */

  const now = new Date();
  const wdZh = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const wdEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
  const wd = resolved === 'en' ? wdEn : wdZh;
  const dateSub = t('home.dateFormat', { m: now.getMonth() + 1, d: now.getDate(), w: wd });
  const hh = now.getHours();
  const greetKey =
    hh < 5
      ? 'greetDawn'
      : hh < 12
        ? 'greetMorning'
        : hh < 14
          ? 'greetNoon'
          : hh < 18
            ? 'greetAfternoon'
            : hh < 22
              ? 'greetEvening'
              : 'greetNight';
  const greetTitle = t('home.' + greetKey, { name: 'Luka' });

  /* ---------------------------------------------------------------- */
  /* 2. 财务主卡                                                       */
  /* ---------------------------------------------------------------- */

  const MoneyColumn = ({
    label,
    icon,
    tone,
    cnyMinor,
    myrMinor,
  }: {
    label: string;
    icon: string;
    tone: string;
    cnyMinor: number;
    myrMinor: number;
  }) => {
    // 主币种在前，另一币种紧随其下（纵向分列，不做汇率合并、不并成一行）
    const lines: Array<{ cur: Currency; minor: number }> = [
      { cur: primary, minor: primary === 'CNY' ? cnyMinor : myrMinor },
    ];
    if (showSecondary) lines.push({ cur: secondary, minor: secondary === 'CNY' ? cnyMinor : myrMinor });
    return (
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name={icon} size={14} color={tone} />
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} numberOfLines={1}>
            {label}
          </M3Text>
        </View>
        {lines.map((l) => (
          <Amount
            key={l.cur}
            minor={l.minor}
            cur={l.cur}
            role="titleMedium"
            color={theme.onSurface}
            maxFontSizeMultiplier={1.2}
            style={{ marginTop: 2 }}
          />
        ))}
      </View>
    );
  };

  const netPrimary = netOf(primary);
  const netSecondary = netOf(secondary);
  const netPrimaryColor = netPrimary < 0 ? theme.expense : theme.onSurface;
  const netSecondaryColor = netSecondary < 0 ? theme.expense : theme.onSurfaceVariant;

  const renderHero = () => (
    <Card onTap={() => goFinance('overview')} padding={space.lg} style={{ marginBottom: cardGap }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
          {t('home.monthBalance')}
        </M3Text>
        <M3Text role="labelMedium" color={theme.primary}>
          {t('home.openFinance')}
        </M3Text>
      </View>

      {/* §五.4 主余额：平滑数字过渡 + 自适应窄屏 + tabular-nums（字距不跳动）。
          AnimatedBalance 在值变化时滚动到新值，首帧/返回页面直接落位，不重播。 */}
      <AnimatedBalance
        minor={netPrimary}
        cur={primary}
        maxFont={34}
        color={netPrimaryColor}
        style={{ marginTop: 2 }}
        accessibilityLabel={t('home.monthBalance') + ' ' + formatMoney(netPrimary, primary)}
      />

      {showSecondary ? (
        <AnimatedBalance
          minor={netSecondary}
          cur={secondary}
          maxFont={22}
          weight="500"
          color={netSecondaryColor}
          style={{ marginTop: 2 }}
          accessibilityLabel={formatMoney(netSecondary, secondary)}
        />
      ) : null}

      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: theme.divider,
          marginVertical: space.md,
        }}
      />

      <View style={{ flexDirection: narrow ? 'column' : 'row', gap: narrow ? space.md : space.lg }}>
        <MoneyColumn
          label={t('home.monthIncome')}
          icon={ICONS.income}
          tone={theme.onSurfaceVariant}
          cnyMinor={cny.income}
          myrMinor={myr.income}
        />
        <MoneyColumn
          label={t('home.monthExpense')}
          icon={ICONS.expense}
          tone={theme.expense}
          cnyMinor={cny.expense}
          myrMinor={myr.expense}
        />
      </View>
    </Card>
  );

  /* ---------------------------------------------------------------- */
  /* 3. 快捷操作（一行四个，不换行）                                   */
  /* ---------------------------------------------------------------- */

  const quickActions = [
    { key: 'txn', icon: ICONS.finance, label: t('home.quickTxn'), onPress: () => nav.openQuickAdd() },
    { key: 'task', icon: ICONS.tasks, label: t('home.quickTask'), onPress: () => goPlan('todo') },
    { key: 'habit', icon: ICONS.habit, label: t('home.quickHabit'), onPress: () => goPlan('habit') },
    { key: 'note', icon: ICONS.inbox, label: t('home.quickNote'), onPress: () => navigation.navigate('Diary') },
  ];

  const renderQuick = () => {
    // §二 四个入口严格等宽：一行四列，每个 flex:1 等分，不随文字长度改变尺寸；
    // 图标统一 24dp、标题统一 14sp，图标/文字/容器垂直居中对齐完全一致。
    return (
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: cardGap }}>
        {quickActions.map((a) => (
          <AnimatedPressable
            key={a.key}
            onPress={a.onPress}
            accessibilityLabel={a.label}
            pressScale={0.97}
            style={{
              flex: 1,
              minHeight: 72,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: space.md,
              borderRadius: radius.lg,
              backgroundColor: theme.surface,
            }}
          >
            <Icon name={a.icon} size={24} color={theme.primary} />
            <M3Text
              role="labelLarge"
              color={theme.onSurface}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={{ marginTop: 6, textAlign: 'center' }}
            >
              {a.label}
            </M3Text>
          </AnimatedPressable>
        ))}
      </View>
    );
  };

  /* ---------------------------------------------------------------- */
  /* 4. 最近流水（FlatList 的 data 就是它，避免嵌套虚拟列表）           */
  /* ---------------------------------------------------------------- */

  const renderTxn: ListRenderItem<Txn> = ({ item, index }) => {
    const tone = txnTone(item);
    const fg = tone === 'out' ? theme.expense : tone === 'in' ? theme.income : theme.onSurfaceVariant;
    const bg =
      tone === 'out' ? theme.expenseContainer : tone === 'in' ? theme.incomeContainer : theme.surfaceContainerHigh;
    const sign = tone === 'out' ? '-' : tone === 'in' ? '+' : '';
    const cur = txnOrigCurrency(item);
    const first = index === 0;
    const last = index === recent.length - 1;
    const sub = [relDate(item.date), item.time, item.note].filter(Boolean).join(' · ');

    return (
      // §五.6 仅在首次进入时播放逐条淡入；返回首页不重播
      <AnimatedListItem index={index} play={!homeRecentIntroPlayed}>
        <AnimatedPressable
          onPress={() => goFinance('txns')}
          accessibilityLabel={`${item.category} ${sign}${formatMoney(txnOrigMinor(item), cur)}`}
          pressScale={1}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            minHeight: 56,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            backgroundColor: theme.surface,
            borderTopLeftRadius: first ? radius.card : 0,
            borderTopRightRadius: first ? radius.card : 0,
            borderBottomLeftRadius: last ? radius.card : 0,
            borderBottomRightRadius: last ? radius.card : 0,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.pill,
              backgroundColor: bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={tone === 'out' ? ICONS.expense : tone === 'in' ? ICONS.income : ICONS.swap} size={17} color={fg} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <M3Text role="bodyLarge" numberOfLines={1}>
              {item.category || item.merchant || t('finance.uncategorized')}
            </M3Text>
            {sub ? (
              <M3Text role="labelMedium" color={theme.onSurfaceVariant} numberOfLines={1} style={{ marginTop: 1 }}>
                {sub}
              </M3Text>
            ) : null}
          </View>
          <M3Text role="titleMedium" color={fg} numberOfLines={1} style={TNUM}>
            {sign}
            {formatMoney(txnOrigMinor(item), cur)}
          </M3Text>
        </AnimatedPressable>
        {!last ? (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginLeft: 64 }} />
        ) : null}
      </AnimatedListItem>
    );
  };

  /* ---------------------------------------------------------------- */
  /* 5. 今日计划                                                       */
  /* ---------------------------------------------------------------- */

  const Checkbox = ({ done, a11y, onPress }: { done: boolean; a11y: string; onPress: () => void }) => (
    <AnimatedPressable
      onPress={onPress}
      accessibilityLabel={a11y}
      accessibilityState={{ checked: done }}
      hitSlop={8}
      pressScale={0.88}
      style={{
        minWidth: touchMin,
        minHeight: touchMin,
        marginLeft: -space.md,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name={done ? 'check-circle' : 'checkbox-blank-circle-outline'}
        size={24}
        color={done ? theme.primary : theme.outline}
      />
    </AnimatedPressable>
  );

  const PriorityBadge = ({ p }: { p?: string }) =>
    p && p !== 'P2' ? (
      <View
        style={{
          backgroundColor: theme.warningContainer,
          borderRadius: radius.pill,
          paddingHorizontal: 8,
          paddingVertical: 2,
        }}
      >
        <M3Text role="labelSmall" color={theme.onWarningContainer}>
          {p}
        </M3Text>
      </View>
    ) : null;

  const renderTodayPlan = () => {
    const rows: React.ReactNode[] = [];
    todayTasks.slice(0, 3).forEach((x) => {
      const sub = `${x.time || t('plan.noTime')} · ${x.category}`;
      rows.push(
        <ListItem
          key={'t' + x.id}
          accessibilityLabel={t('plan.markDone') + ' ' + x.title}
          leading={
            <Checkbox
              done={false}
              a11y={t('plan.markDone') + ' ' + x.title}
              onPress={() => onToggle({ kind: 'task', id: x.id, title: x.title, sub })}
            />
          }
          title={x.title}
          subtitle={sub}
          trailing={<PriorityBadge p={x.priority} />}
        />
      );
    });
    todayHabits.slice(0, 4).forEach((hb) => {
      const done = isHabitDone(hb, today);
      rows.push(
        <ListItem
          key={'h' + hb.id}
          accessibilityLabel={(done ? t('home.cancelCheckIn') : t('home.checkIn')) + ' ' + hb.name}
          leading={
            <Checkbox
              done={done}
              a11y={done ? t('home.cancelCheckIn') : t('home.checkIn')}
              onPress={() => onToggle({ kind: 'habit', id: hb.id, title: hb.name, sub: '' })}
            />
          }
          title={hb.name}
          subtitle={
            hb.type === 'count'
              ? t('home.todayCount', { cur: hb.records?.[today] || 0, target: hb.target })
              : done
                ? t('home.checkedToday')
                : t('home.toCheck')
          }
        />
      );
    });

    return (
      // §一.2 降低视觉权重：用 recessed 容器色（level=1）让它从主卡中后退，
      // 不再与本月结余/最近流水抢视觉焦点。
      <Card level={1} style={{ marginBottom: cardGap }}>
        <SectionHeader
          icon={ICONS.today}
          title={t('home.todayPlanTitle')}
          actionLabel={t('common.viewAll')}
          onAction={() => goPlan('today')}
        />
        {rows.length === 0 ? (
          <EmptyState icon={ICONS.check} title={t('home.noTasks')} hint={t('home.noTasksHint')} />
        ) : (
          rows
        )}
      </Card>
    );
  };

  /* ---------------------------------------------------------------- */
  /* 6. 即将到期（没有内容就整块不渲染）                                */
  /* ---------------------------------------------------------------- */

  const hasUpcoming = up.length > 0 || card.show;

  const renderUpcoming = () => {
    if (!hasUpcoming) return null;
    return (
      <Card style={{ marginBottom: cardGap }}>
        <SectionHeader icon={ICONS.calendar} title={t('home.scheduleTitle')} />
        {card.show ? (
          <ListItem
            accessibilityLabel={t('home.creditCard')}
            leading={
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.sm,
                  backgroundColor: card.warn ? theme.errorContainer : theme.surfaceContainerHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon
                  name={ICONS.creditCard}
                  size={18}
                  color={card.warn ? theme.error : theme.onSurfaceVariant}
                />
              </View>
            }
            title={t('home.creditCard')}
            subtitle={`${card.due} · ${t('finance.daysLeftN', { n: card.daysLeft })}`}
            divider={up.length > 0}
            trailing={
              <Amount
                minor={Math.round(card.owe * 100)}
                cur="CNY"
                role="titleMedium"
                color={card.warn ? theme.error : theme.onSurface}
              />
            }
          />
        ) : null}
        {up.map((s, i) => (
          <ListItem
            key={s.id}
            onTap={() => goPlan('todo')}
            accessibilityLabel={s.title}
            divider={i < up.length - 1}
            leading={
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.sm,
                  backgroundColor: theme.surfaceContainerHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={ICONS.calendar} size={18} color={theme.onSurfaceVariant} />
              </View>
            }
            title={s.title}
            subtitle={`${relDate(s.date)}${s.time ? ' ' + s.time : ''} · ${s.category}`}
            trailing={<PriorityBadge p={s.priority} />}
          />
        ))}
      </Card>
    );
  };

  /* ---------------------------------------------------------------- */
  /* 组装                                                              */
  /* ---------------------------------------------------------------- */

  const header = (
    <FadeInContent>
      {renderHero()}
      {renderQuick()}
      <View style={{ paddingHorizontal: space.xs }}>
        <SectionHeader
          icon={ICONS.finance}
          title={t('home.recentTxns')}
          actionLabel={t('common.viewAll')}
          onAction={() => goFinance('txns')}
        />
      </View>
    </FadeInContent>
  );

  const footer = (
    <View style={{ marginTop: recent.length > 0 ? cardGap : 0 }}>
      {renderTodayPlan()}
      {renderUpcoming()}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title={greetTitle}
        subtitle={dateSub}
        pendingCount={pendingCount}
        onNotification={() => nav.openPending()}
      />
      <FlatList
        data={recent}
        renderItem={renderTxn}
        keyExtractor={(x) => x.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <Card>
            <EmptyState icon={ICONS.finance} title={t('home.noRecentTxns')} hint={t('home.noRecentTxnsHint')} />
          </Card>
        }
        contentContainerStyle={{ padding: pageMargin, paddingBottom: bottomInset }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
      {snack && <Snackbar message={snack.msg} actionLabel={t('common.undo')} onAction={snack.onUndo} />}
    </View>
  );
}
