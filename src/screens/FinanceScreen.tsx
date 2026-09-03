import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useData } from '../useData';
import { useHideBalances } from '../useHideBalances';
import { store, uid, todayStr, ymStr } from '../store';
import {
  Snackbar,
  Segmented,
  EmptyState,
  M3Text,
  Chip,
  TextField,
  IconButton,
  Button,
  EyeToggle,
} from '../components/ui';
import { Card, ScreenHeader, PrimaryButton, ListGroup, NavRow } from '../components/kit';
import { AnimatedListItem, AnimatedPressable, AnimatedProgress, AnimatedTabIndicator, AppBottomSheet, FadeInContent } from '../components/anim';
import { Amount, BALANCE_MASK } from '../components/Amount';
import { useBottomContentInset } from '../components/layout';
import { Icon, ICONS } from '../icons';
import { ImportFlowModal } from './ImportFlowModal';
import { radius, space, pageMargin, cardGap, touchMin } from '../tokens';
import { budgetStatus } from '../calc';
import { financeSummary, recomputeAccounts, cardSummary, nextDueDate, financeStats } from '../calc';
import {
  formatMoney,
  convertMinor,
  toMinor,
  fromMinor,
  parseBalanceToMinor,
  txnOrigMinor,
  txnOrigCurrency,
  txnIsCard,
  txnSettleMinor,
  txnSettleCurrency,
} from '../money';
import type { Txn, Currency, TxnType, Account, FxSetting } from '../types';
import DateTimePicker from '@react-native-community/datetimepicker';
import { usePendingCount } from '../notify/pendingStore';
import { useNotifyNav } from '../notify/NotifyNav';
import { buildQuickAddTxn } from '../notify/quickAdd';
import CategoryPicker from '../components/CategoryPicker';

// ─────────────────────────────────────────────────────────────────────────────
// §六 财务页只保留三档：概览 / 流水 / 预算
//
//  · 顶部三档等宽，绝不换行（原来 5 档 + flexWrap，窄屏会挤成两行）
//  · 账户、信用卡、支出趋势全部收进「概览」，不再各占一个 tab
//  · 「导入账单」从标题栏常驻按钮改为「更多」菜单里的一项（另有「我的」入口）
//  · 记一笔统一走底栏中间的「+」；本页只在「编辑」时弹出表单（BottomSheet）
//  · 流水用 FlatList（原来是 ScrollView 里 map，几百笔会一次性渲染）
//  · 筛选收进 BottomSheet，不再在页面上堆两行 chips
//  · 双币种在窄屏（<360dp）改竖排；金额一律 tabular-nums，不再自动缩小字号
//  · 单个数字不再各自占一张卡片（§十：少卡片、多留白）
// ─────────────────────────────────────────────────────────────────────────────

// ---- date helpers for native picker (store format: YYYY-MM-DD) ----
function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}
function fmtDate(d: Date): string {
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${day}`;
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
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mi}`;
}
function minorToStr(minor: number): string {
  return (minor / 100).toString();
}
function computeFxRate(origCur: Currency, origMinor: number, settleCur: Currency, settleMinor: number): number {
  if (origMinor === 0) return 1;
  if (origCur === 'MYR' && settleCur === 'CNY') return settleMinor / origMinor;
  if (origCur === 'CNY' && settleCur === 'MYR') return origMinor / settleMinor;
  return 1;
}

type FSeg = 'overview' | 'flow' | 'budget';
type UndoState = { msg: string; undo: () => Promise<void> } | null;

/** 窄屏阈值：小于此宽度时双币种改竖排，避免两列数字互相挤压 */
const NARROW = 360;
/** 等宽数字：金额上下对齐，切换月份时不会左右跳动 */
const TNUM = { fontVariant: ['tabular-nums' as const] };
const SEG_H = 48;

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  let ny = y;
  let nm = m + delta;
  if (nm < 1) {
    nm = 12;
    ny--;
  } else if (nm > 12) {
    nm = 1;
    ny++;
  }
  return `${ny}-${`${nm}`.padStart(2, '0')}`;
}

function MonthNav({ ym, setYm }: { ym: string; setYm: (v: string) => void }) {
  const { t } = useI18n();
  const [y, mRaw] = ym.split('-');
  const m = String(Number(mRaw)); // strip zero-pad: 08 -> 8 (中文 "2026年8月")
  const label = t('finance.ymFormat', { y, m });
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.lg,
        marginBottom: cardGap,
      }}
    >
      <IconButton
        name={ICONS.back}
        size={20}
        onPress={() => setYm(shiftMonth(ym, -1))}
        accessibilityLabel={t('finance.prevMonth')}
      />
      <M3Text role="titleMedium" style={TNUM}>{label}</M3Text>
      <IconButton
        name={ICONS.chevronRight}
        size={20}
        onPress={() => setYm(shiftMonth(ym, 1))}
        accessibilityLabel={t('finance.nextMonth')}
      />
    </View>
  );
}

/**
 * 三档切换：等宽、单行、绝不换行；选中态是一颗滑动胶囊（§九）。
 * 每档触达 48dp 高，整宽 1/3，远大于 48×48 的最小触控要求。
 */
function FinanceTabBar({ seg, setSeg }: { seg: FSeg; setSeg: (s: FSeg) => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const segs: { key: FSeg; label: string }[] = [
    { key: 'overview', label: t('finance.segOverview') },
    { key: 'flow', label: t('finance.segFlow') },
    { key: 'budget', label: t('finance.segBudget') },
  ];
  const [rects, setRects] = useState<Record<string, { x: number; w: number }>>({});
  const onRect = (key: string) => (e: any) => {
    const { x, width } = e.nativeEvent.layout;
    setRects((prev) => {
      const cur = prev[key];
      if (cur && Math.abs(cur.x - x) < 0.5 && Math.abs(cur.w - width) < 0.5) return prev;
      return { ...prev, [key]: { x, w: width } };
    });
  };
  const active = rects[seg];

  return (
    <View style={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: space.xs }}>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: theme.surfaceContainer,
          borderRadius: radius.md,
          padding: 3,
        }}
      >
        <AnimatedTabIndicator
          x={active?.x ?? 0}
          width={active?.w ?? 0}
          height={SEG_H - 6}
          color={theme.surface}
          cornerRadius={radius.sm}
          style={{ top: 3 }}
        />
        {segs.map((s) => {
          const isA = s.key === seg;
          return (
            <TouchableOpacity
              key={s.key}
              onPress={() => setSeg(s.key)}
              onLayout={onRect(s.key)}
              activeOpacity={0.85}
              accessibilityRole="tab"
              accessibilityState={{ selected: isA }}
              accessibilityLabel={s.label}
              style={{ flex: 1, height: SEG_H - 6, alignItems: 'center', justifyContent: 'center' }}
            >
              <M3Text
                role="labelLarge"
                color={isA ? theme.onSurface : theme.onSurfaceVariant}
                numberOfLines={1}
              >
                {s.label}
              </M3Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function FinanceScreen({ route }: any) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const d = useData();
  const nav = useNotifyNav();
  const pendingCount = usePendingCount();
  const [ym, setYm] = useState(ymStr());
  const [editing, setEditing] = useState<Txn | null>(null);
  const [seg, setSeg] = useState<FSeg>(route?.params?.tab === 'flow' || route?.params?.tab === 'budget' ? route.params.tab : 'overview');
  const [snack, setSnack] = useState<UndoState>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const today = todayStr();

  // 从首页「财务主卡 / 最近流水」跳进来时带 tab 参数 → 落到对应档
  const wantTab = route?.params?.tab as FSeg | undefined;
  const [lastWant, setLastWant] = useState(wantTab);
  if (wantTab && wantTab !== lastWant) {
    setLastWant(wantTab);
    if (wantTab !== seg) setSeg(wantTab);
  }

  const deleteTxn = (tx: Txn) => {
    Alert.alert(
      t('common.delete'),
      t('finance.deleteConfirm', { cat: tx.category || tx.note || t('common.other') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const prev = [...d.txns];
            const list = await store.getTxns();
            await store.setTxns(list.filter((x) => x.id !== tx.id));
            setSnack({ msg: t('finance.txnDeleted'), undo: async () => { await store.setTxns(prev); } });
            setTimeout(() => setSnack(null), 5000);
          },
        },
      ]
    );
  };
  const updateTxn = async (tx: Omit<Txn, 'id' | 'createdAt'>) => {
    if (!editing) return;
    const list = await store.getTxns();
    await store.setTxns(list.map((x) => (x.id === editing.id ? { ...x, ...tx } : x)));
    setEditing(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title={t('tabs.finance')}
        subtitle={t('finance.subtitle')}
        action={
          <IconButton
            name={ICONS.menu}
            size={22}
            onPress={() => setMenuOpen(true)}
            accessibilityLabel={t('financeExtra.moreMenu')}
          />
        }
      />

      {pendingCount > 0 && (
        <View style={{ paddingHorizontal: pageMargin, paddingTop: space.sm }}>
          <Pressable
            onPress={() => nav.openPending()}
            accessibilityLabel={t('notify.banner', { n: pendingCount })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minHeight: touchMin,
              backgroundColor: theme.primaryContainer,
              borderRadius: radius.lg,
              paddingVertical: 12,
              paddingHorizontal: 14,
            }}
          >
            <Icon name={ICONS.bell} size={20} color={theme.onPrimaryContainer} />
            <M3Text role="labelLarge" color={theme.onPrimaryContainer} style={{ flex: 1 }}>
              {t('notify.banner', { n: pendingCount })}
            </M3Text>
            <Icon name={ICONS.chevronRight} size={18} color={theme.onPrimaryContainer} />
          </Pressable>
        </View>
      )}

      <FinanceTabBar seg={seg} setSeg={setSeg} />

      {seg === 'overview' && <OverviewTab d={d} ym={ym} setYm={setYm} today={today} onGo={setSeg} />}
      {seg === 'flow' && <FlowTab d={d} ym={ym} setYm={setYm} onDelete={deleteTxn} onEdit={setEditing} />}
      {seg === 'budget' && <BudgetTab d={d} ym={ym} setYm={setYm} />}

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

      {/* 编辑一笔 */}
      <AppBottomSheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={t('finance.editTxn')}
      >
        {editing ? (
          <EditTxnForm
            onUpdate={updateTxn}
            onClose={() => setEditing(null)}
            accounts={d.accounts}
            fx={d.fx}
            initial={editing!}
            t={t}
          />
        ) : null}
      </AppBottomSheet>

      {/* 「更多」菜单 */}
      <AppBottomSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t('financeExtra.moreMenu')}
        scroll={false}
      >
        <ListGroup>
          <NavRow
            icon={ICONS.fileImport}
            title={t('financeExtra.importEntry')}
            subtitle={t('me.importBillHint')}
            onPress={() => {
              setMenuOpen(false);
              nav.openImport();
            }}
          />
          <NavRow
            icon={ICONS.pending}
            title={t('me.pendingTxn')}
            badge={pendingCount}
            onPress={() => {
              setMenuOpen(false);
              nav.openPending();
            }}
          />
        </ListGroup>
      </AppBottomSheet>

      {/* 统一导入流程（TNG / 支付宝 / 微信 / 工作台 JSON 共用同入口）。
          开关由 NotifyNav 持有，所以「我的 → 账单导入」和本页菜单共用同一个弹层。 */}
      <ImportFlowModal
        visible={nav.importOpen}
        onClose={nav.closeImport}
        accounts={d.accounts}
        fx={d.fx}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 概览：总资产 → 本月收支 → 预算使用 → 账户 → 支出趋势                 */
/* ------------------------------------------------------------------ */

function OverviewTab({
  d,
  ym,
  setYm,
  today,
  onGo,
}: {
  d: any;
  ym: string;
  setYm: (v: string) => void;
  today: string;
  onGo: (s: FSeg) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { width, fontScale } = useWindowDimensions();
  // 收/支与资产负债的「两格一行」布局：常规宽度(~393dp)与字号下并排；
  // 仅当屏幕极窄(<340dp)或系统字号过大(>1.3)时才改为纵向堆叠，避免挤压。
  const stackFlow = width < 340 || fontScale > 1.3;
  const bottomInset = useBottomContentInset();

  const summary = useMemo(
    () => financeSummary(d.txns, d.accounts, d.fx, ym),
    [d.txns, d.accounts, d.fx, ym]
  );
  const [hide, setHide] = useHideBalances();
  const ie = summary.stats.incomeExpense;
  const hasPredicted = summary.predictedLiabilitiesMYR !== summary.liabilitiesMYR;
  const nav = useNotifyNav();
  // A+B: 本月结余环比上月 + 储蓄率（纯派生，无存储改动）
  const prevYm = shiftMonth(ym, -1);
  const prevStats = useMemo(() => financeStats(d.txns, prevYm), [d.txns, prevYm]);
  // C: 预算「日均可用」所需——本月剩余天数
  const isCurrentMonth = ym === ymStr();
  const dayOfMonth = Number(today.slice(8));
  const [cy, cm] = ym.split('-').map(Number);
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const daysLeft = isCurrentMonth ? Math.max(1, daysInMonth - dayOfMonth + 1) : daysInMonth;
  // 引导式空态：没有账户，或「没有任何交易且所有账户余额都为 0」时，
  // 不再显示 -RM 0.00 / RM 0.00 这类让人误读的数字，改为引导用户建账/记账。
  const isEmpty =
    d.accounts.length === 0 ||
    (d.txns.length === 0 && summary.accounts.every((a) => (a.balanceMinor ?? 0) === 0));

  // 有数据的币种才展示；都没有则按 CNY 兜底显示一组 0
  const curs: Currency[] = (['MYR', 'CNY'] as Currency[]).filter(
    (c) => ie[c].income > 0 || ie[c].expense > 0
  );
  const shown: Currency[] = curs.length > 0 ? curs : ['CNY'];

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
    >
      <MonthNav ym={ym} setYm={setYm} />

      {/* ① 净资产 — 唯一的大数字（原为「总资产」，但资产端未完整录入时常显示为负，改以净资产为主指标更合理） */}
      {isEmpty ? (
        <Card style={{ alignItems: 'center', paddingVertical: 36 }}>
          <Icon name={ICONS.wallet} size={44} color={theme.onSurfaceVariant} />
          <M3Text role="titleMedium" color={theme.onSurfaceVariant} style={{ marginTop: 14 }}>
            {t('finance.emptyTitle')}
          </M3Text>
          <M3Text role="bodyMedium" color={theme.t3} style={{ marginTop: 6, textAlign: 'center', paddingHorizontal: 16 }}>
            {t('finance.emptyHint')}
          </M3Text>
          <Button
            label={t('finance.emptyCta')}
            variant="primary"
            onPress={() => nav.openQuickAdd()}
            style={{ marginTop: 18, width: 200 }}
          />
        </Card>
      ) : (
        <FadeInContent>
          <Card>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.sm,
              }}
            >
              <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                {t('finance.netWorthApprox')}
              </M3Text>
              <EyeToggle
                hidden={hide}
                onToggle={() => setHide(!hide)}
                accessibilityLabel={t('finance.toggleHideBalances')}
              />
            </View>
            <Amount
              minor={summary.netWorthMYR}
              cur="MYR"
              role="displaySmall"
              weight="500"
              masked={hide}
              color={summary.netWorthMYR < 0 ? theme.error : undefined}
              style={{ marginTop: 2 }}
              accessibilityLabel={t('finance.netWorthApprox') + ' ' + formatMoney(summary.netWorthMYR, 'MYR')}
            />

            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: theme.divider,
                marginVertical: space.lg,
              }}
            />

            <View style={{ flexDirection: stackFlow ? 'column' : 'row', gap: stackFlow ? space.md : space.lg }}>
              <MiniStat
                label={t('finance.liabilitiesApprox')}
                value={summary.liabilitiesMYR}
                cur="MYR"
                masked={hide}
                hint={hasPredicted ? `${t('financeExtra.inclPending')} ${formatMoney(summary.predictedLiabilitiesMYR, 'MYR')}` : undefined}
                tone={summary.liabilitiesMYR > 0 ? theme.error : undefined}
              />
            </View>
          </Card>
        </FadeInContent>
      )}

      {/* ② 本月收 / 支 / 结余 — 一张卡里按币种分块，不再一数字一卡片 */}
      <View style={{ marginTop: cardGap }}>
        <Card>
          <M3Text role="titleMedium">{t('financeExtra.monthFlowTitle')}</M3Text>
          {shown.map((c, i) => {
            const s = ie[c];
            const net = s.income - s.expense;
            const prevNet = prevStats.incomeExpense[c].income - prevStats.incomeExpense[c].expense;
            return (
              <View key={c}>
                {i > 0 ? (
                  <View
                    style={{
                      height: StyleSheet.hairlineWidth,
                      backgroundColor: theme.divider,
                      marginVertical: space.lg,
                    }}
                  />
                ) : (
                  <View style={{ height: space.lg }} />
                )}
                <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                  {c === 'CNY' ? t('finance.cny') : t('finance.myr')}
                </M3Text>
                <View
                  style={{
                    flexDirection: stackFlow ? 'column' : 'row',
                    gap: stackFlow ? space.sm : space.lg,
                    marginTop: space.sm,
                  }}
                >
                  <MiniStat label={t('finance.inc')} value={s.income} cur={c} />
                  <MiniStat label={t('finance.exp')} value={s.expense} cur={c} />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: space.md,
                    gap: space.sm,
                  }}
                >
                  <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                    {t('finance.balance')}
                  </M3Text>
                  <Amount
                    minor={net}
                    cur={c}
                    role="titleMedium"
                    weight="500"
                    masked={hide}
                    color={net < 0 ? theme.error : theme.onSurface}
                    accessibilityLabel={t('finance.balance') + ' ' + formatMoney(net, c)}
                  />
                </View>

                {/* A 储蓄率 + B 环比上月（统一洞察条，纯派生，无存储改动） */}
                <InsightRow
                  label={t('finance.savingsRate')}
                  value={s.income > 0 ? `${Math.round((net / s.income) * 100)}%` : '--'}
                  style={{ marginTop: space.md }}
                />
                {prevNet !== 0 && (
                  <InsightRow
                    label={t('finance.vsLastMonth')}
                    value={`${net >= prevNet ? '▲' : '▼'} ${Math.abs(Math.round((net / prevNet - 1) * 100))}%`}
                    valueColor={net >= prevNet ? theme.income : theme.error}
                    style={{ marginTop: space.sm }}
                  />
                )}
                {(() => {
                  const rf = summary.stats.recurringIncomeExpense[c];
                  if (rf.income <= 0 && rf.expense <= 0) return null;
                  const rnet = rf.income - rf.expense;
                  return (
                    <View style={{ marginTop: space.md }}>
                      <View
                        style={{
                          height: StyleSheet.hairlineWidth,
                          backgroundColor: theme.divider,
                          marginBottom: space.md,
                        }}
                      />
                      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.sm }}>
                        {t('financeExtra.fixedSection')}
                      </M3Text>
                      <View
                        style={{
                          flexDirection: stackFlow ? 'column' : 'row',
                          gap: stackFlow ? space.sm : space.lg,
                        }}
                      >
                        <MiniStat label={t('financeExtra.fixedInc')} value={rf.income} cur={c} />
                        <MiniStat label={t('financeExtra.fixedExp')} value={rf.expense} cur={c} />
                      </View>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: space.md,
                          gap: space.sm,
                        }}
                      >
                        <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('financeExtra.fixedNet')}</M3Text>
                        <Amount
                          minor={rnet}
                          cur={c}
                          role="titleMedium"
                          weight="500"
                          masked={hide}
                          color={rnet < 0 ? theme.error : theme.onSurface}
                          accessibilityLabel={t('financeExtra.fixedNet') + ' ' + formatMoney(rnet, c)}
                        />
                      </View>
                    </View>
                  );
                })()}
              </View>
            );
          })}
        </Card>
      </View>

      {/* ③ 预算使用 */}
      <View style={{ marginTop: cardGap }}>
        <BudgetUsageCard d={d} ym={ym} onGo={onGo} />
      </View>

      {/* ④ 账户（含信用卡） */}
      <View style={{ marginTop: cardGap }}>
        <AccountsSection d={d} today={today} />
      </View>

      {/* ⑤ 支出趋势 */}
      <View style={{ marginTop: cardGap }}>
        <TrendSection d={d} ym={ym} />
      </View>
    </ScrollView>
  );
}

/** 标签在上、数字在下的一格；两格一行，窄屏改竖排。绝不各自包一张卡片。 */
function MiniStat({
  label,
  value,
  cur,
  tone,
  hint,
  masked,
}: {
  label: string;
  /** 整数最小单位金额 */
  value: number;
  cur: Currency;
  tone?: string;
  hint?: string;
  masked?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} numberOfLines={1}>
        {label}
      </M3Text>
      <Amount
        minor={value}
        cur={cur}
        role="titleLarge"
        weight="500"
        masked={masked}
        color={tone ?? theme.onSurface}
        style={{ marginTop: 2 }}
      />
      {hint ? (
        <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 2 }} numberOfLines={1}>
          {hint}
        </M3Text>
      ) : null}
    </View>
  );
}

/** 卡内标题（可带右侧文字动作）。刻意不再引入第二种卡片样式。 */
function CardTitle({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.sm,
      }}
    >
      <M3Text role="titleMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </M3Text>
      {onAction ? (
        <TouchableOpacity
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <M3Text role="labelLarge" color={theme.primary}>
            {actionLabel}
          </M3Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Hairline({ my = space.lg }: { my?: number }) {
  const { theme } = useTheme();
  return (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginVertical: my }} />
  );
}

/** 派生洞察条：左中性灰 caption + 右 tabular 值，纵向等距排列。
 *  统一 储蓄率 / 环比上月 / 预算日均可用 三处的呈现，消除 inline flexWrap 窄屏断行参差。 */
function InsightRow({
  label,
  value,
  valueColor,
  style,
}: {
  label: string;
  value: string;
  valueColor?: string;
  style?: any;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }, style]}
    >
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} numberOfLines={1}>
        {label}
      </M3Text>
      <M3Text role="labelMedium" color={valueColor ?? theme.onSurface} style={TNUM} numberOfLines={1}>
        {value}
      </M3Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 概览 ③ 预算使用（双币种，点进「预算」档调整）                        */
/* ------------------------------------------------------------------ */

function BudgetUsageCard({ d, ym, onGo }: { d: any; ym: string; onGo: (s: FSeg) => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const rows = useMemo(
    () => (['CNY', 'MYR'] as Currency[]).map((c) => budgetStatus(d.txns, d.budgets, ym, c)),
    [d.txns, d.budgets, ym]
  );
  const set = rows.filter((r) => r.hasBudget);
  // C: 预算「日均可用」——本月剩余天数（仅当前月有意义）
  const isCurMonth = ym === ymStr();
  const [bcy, bcm] = ym.split('-').map(Number);
  const bDim = new Date(bcy, bcm, 0).getDate();
  const bDaysLeft = isCurMonth ? Math.max(1, bDim - Number(todayStr().slice(8)) + 1) : bDim;

  return (
    <Card>
      <CardTitle
        title={t('financeExtra.budgetUsage')}
        actionLabel={set.length > 0 ? t('finance.adjustBudget') : t('finance.setBudget')}
        onAction={() => onGo('budget')}
      />
      {set.length === 0 ? (
        <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.md }}>
          {t('finance.budgetNotSet')}
        </M3Text>
      ) : (
        set.map((r, i) => {
          const ratio = r.amountMinor > 0 ? r.used / r.amountMinor : 0;
          const barColor = ratio >= 1 ? theme.error : ratio >= 0.8 ? theme.warning : theme.primary;
          const pct = r.amountMinor > 0 ? Math.round(ratio * 100) : 0;
          return (
            <View key={r.currency} style={{ marginTop: i === 0 ? space.lg : space.lg }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space.sm,
                  marginBottom: space.sm,
                }}
              >
                <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                  {r.currency === 'CNY' ? t('finance.cny') : t('finance.myr')}
                </M3Text>
                <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={TNUM}>
                  {pct}%
                </M3Text>
              </View>
              <AnimatedProgress value={ratio} color={barColor} trackColor={theme.surfaceContainerHigh} height={8} />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space.sm,
                  marginTop: space.sm,
                }}
              >
                <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={TNUM} numberOfLines={1}>
                  {t('finance.usedLabel')} {formatMoney(r.used, r.currency)}
                </M3Text>
                <M3Text
                  role="labelMedium"
                  color={r.remain < 0 ? theme.error : theme.onSurfaceVariant}
                  style={TNUM}
                  numberOfLines={1}
                >
                  {r.remain < 0 ? t('finance.overBudgetLabel') : t('finance.monthRemain')}{' '}
                  {formatMoney(Math.abs(r.remain), r.currency)}
                </M3Text>
              </View>
              {isCurMonth && r.remain > 0 ? (
                <InsightRow
                  label={t('finance.remainingDays', { n: bDaysLeft })}
                  value={`${t('finance.avgDailyAvailable')} ${formatMoney(Math.round(r.remain / bDaysLeft), r.currency)}`}
                  style={{ marginTop: space.sm }}
                />
              ) : null}
            </View>
          );
        })
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 概览 ④ 账户（现金/银行 + 信用卡；账单日/还款日仍可就地编辑）          */
/* ------------------------------------------------------------------ */

function AccountsSection({ d, today }: { d: any; today: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [hide] = useHideBalances();
  const rec = useMemo(() => recomputeAccounts(d.txns, d.accounts), [d.txns, d.accounts]);
  const cash = rec.filter((a) => a.type !== 'credit').sort((a, b) => a.order - b.order);
  const cards = rec.filter((a) => a.type === 'credit').sort((a, b) => a.order - b.order);

  const [editId, setEditId] = useState<string | null>(null);
  const [stmt, setStmt] = useState('');
  const [due, setDue] = useState('');
  const [balEditId, setBalEditId] = useState<string | null>(null);
  const [balText, setBalText] = useState('');

  // 业务逻辑保持不变（§十一）：只改承载它的 UI，不改写入规则
  const setDays = async (id: string) => {
    const accounts = await store.getAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx >= 0) {
      accounts[idx] = {
        ...accounts[idx],
        stmtDay: stmt ? Math.max(1, Math.min(31, Number(stmt) || 1)) : null,
        dueDay: due ? Math.max(1, Math.min(31, Number(due) || 1)) : null,
      };
      await store.setAccounts(accounts);
    }
    setEditId(null);
  };

  // 对账式录入：用户输入「当前真实余额」，我们据此反推 openingBalanceMinor，
  // 使重新计算后的余额精确等于输入值，后续流水继续累加。
  const saveBalance = async (id: string, cur: Currency) => {
    const entered = parseBalanceToMinor(balText, cur);
    if (entered === null) {
      setBalEditId(null);
      return;
    }
    const accounts = await store.getAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx >= 0) {
      const acc = accounts[idx];
      const current = rec.find((r) => r.id === id)?.balanceMinor ?? 0;
      const oldOpening = acc.openingBalanceMinor ?? 0;
      const newOpening = Math.round(oldOpening + (entered - current));
      accounts[idx] = { ...acc, openingBalanceMinor: newOpening };
      await store.setAccounts(accounts);
    }
    setBalEditId(null);
  };

  return (
    <Card>
      <CardTitle title={t('financeExtra.accountsTitle')} />

      {cash.length === 0 && cards.length === 0 ? (
        <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.md }}>
          {t('financeExtra.noAccounts')}
        </M3Text>
      ) : null}

      {cash.length > 0 ? (
        <View style={{ marginTop: space.md }}>
          {cash.map((a, i) => {
            const open = balEditId === a.id;
            const sym = a.currency === 'CNY' ? '¥' : 'RM ';
            return (
              <View key={a.id}>
                {i > 0 ? <Hairline my={0} /> : null}
                <Pressable
                  onPress={() => {
                    if (open) {
                      setBalEditId(null);
                      return;
                    }
                    setBalText(fromMinor(a.balanceMinor || 0, a.currency).toString());
                    setBalEditId(a.id);
                  }}
                  accessibilityLabel={`${a.name} · ${t('finance.setBalanceTitle')}`}
                  accessibilityState={{ expanded: open }}
                  style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingVertical: space.md,
                  }}
                >
                  <Icon name={ICONS.account} size={20} color={theme.onSurfaceVariant} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <M3Text role="bodyLarge" numberOfLines={1}>
                      {a.name}
                    </M3Text>
                    <M3Text role="labelSmall" color={theme.onSurfaceVariant}>
                      {a.currency}
                    </M3Text>
                  </View>
                  <M3Text role="titleMedium" style={TNUM} numberOfLines={1}>
                    {hide ? BALANCE_MASK : formatMoney(a.balanceMinor || 0, a.currency)}
                  </M3Text>
                  <Icon name={ICONS.chevronRight} size={18} color={theme.onSurfaceVariant} />
                </Pressable>

                {open ? (
                  <View style={{ paddingBottom: space.md, gap: space.sm }}>
                    <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                      {t('finance.currentBalance')}
                    </M3Text>
                    <TextField
                      label={t('finance.setBalanceTitle')}
                      value={balText}
                      onChangeText={setBalText}
                      keyboardType="numeric"
                      prefix={sym}
                      placeholder="0.00"
                    />
                    <M3Text role="labelSmall" color={theme.onSurfaceVariant} numberOfLines={2}>
                      {t('finance.balanceEditHint')}
                    </M3Text>
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <PrimaryButton label={t('common.save')} onPress={() => saveBalance(a.id, a.currency)} style={{ flex: 1 }} />
                      <Button label={t('common.cancel')} variant="text" onPress={() => setBalEditId(null)} style={{ flex: 1 }} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {cards.length > 0 ? (
        <View style={{ marginTop: cash.length > 0 ? space.lg : space.md }}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.xs }}>
            {t('financeExtra.creditSection')}
          </M3Text>
          {cards.map((a, i) => {
            const cs = cardSummary(a);
            const dueInfo = a.dueDay ? nextDueDate(a.dueDay, today) : null;
            const open = editId === a.id;
            return (
              <View key={a.id}>
                {i > 0 ? <Hairline my={0} /> : null}
                <Pressable
                  onPress={() => {
                    if (open) {
                      setEditId(null);
                      return;
                    }
                    setStmt(a.stmtDay ? String(a.stmtDay) : '');
                    setDue(a.dueDay ? String(a.dueDay) : '');
                    setEditId(a.id);
                  }}
                  accessibilityLabel={`${a.name} · ${t('financeExtra.setDaysTitle')}`}
                  accessibilityState={{ expanded: open }}
                  style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingVertical: space.md,
                  }}
                >
                  <Icon name={ICONS.creditCard} size={20} color={theme.onSurfaceVariant} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <M3Text role="bodyLarge" numberOfLines={1}>
                      {a.name}
                    </M3Text>
                    <M3Text role="labelSmall" color={dueInfo && dueInfo.daysLeft <= 3 ? theme.error : theme.onSurfaceVariant} numberOfLines={1}>
                      {dueInfo
                        ? `${t('finance.dueOn')} ${dueInfo.date.slice(5)} · ${t('finance.daysLeftN', { n: dueInfo.daysLeft })}`
                        : t('finance.noDue')}
                    </M3Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <M3Text role="titleMedium" color={theme.error} style={TNUM} numberOfLines={1}>
                      {hide ? BALANCE_MASK : formatMoney(cs.outstandingMinor, a.currency)}
                    </M3Text>
                    {cs.unbilledMinor > 0 ? (
                      <M3Text role="labelSmall" color={theme.warning} style={TNUM} numberOfLines={1}>
                        {t('finance.cardUnbilled')} {formatMoney(cs.unbilledMinor, a.currency)}
                      </M3Text>
                    ) : null}
                  </View>
                  <Icon name={ICONS.chevronRight} size={18} color={theme.onSurfaceVariant} />
                </Pressable>

                {open ? (
                  <View style={{ paddingBottom: space.md, gap: space.sm }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: space.sm,
                      }}
                    >
                      <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                        {t('finance.cardCurrentBill')}
                      </M3Text>
                      <M3Text role="bodyLarge" style={TNUM}>
                        {hide ? BALANCE_MASK : formatMoney(cs.currentBillMinor, a.currency)}
                      </M3Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                      <View style={{ flex: 1 }}>
                        <TextField label={t('finance.stmtDay')} value={stmt} onChangeText={setStmt} keyboardType="numeric" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <TextField label={t('finance.dueDayLabel')} value={due} onChangeText={setDue} keyboardType="numeric" />
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <PrimaryButton label={t('common.save')} onPress={() => setDays(a.id)} style={{ flex: 1 }} />
                      <Button label={t('common.cancel')} variant="text" onPress={() => setEditId(null)} style={{ flex: 1 }} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 概览 ⑤ 支出趋势（近 6 个月柱状 + 本月分类占比）                      */
/* ------------------------------------------------------------------ */

function TrendSection({ d, ym }: { d: any; ym: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  // 默认落在真正有支出的币种上：导入过 TNG(MYR) 就直接看到曲线，而不是空的 CNY 图
  const [cur, setCur] = useState<Currency>(() => {
    let myr = 0;
    let cny = 0;
    for (const tx of d.txns as Txn[]) {
      if (tx.type !== 'expense') continue;
      if (txnOrigCurrency(tx) === 'MYR') myr += txnOrigMinor(tx);
      else cny += txnOrigMinor(tx);
    }
    return myr >= cny ? 'MYR' : 'CNY';
  });

  const spendable = (tx: Txn) =>
    tx.type === 'expense' &&
    tx.affectsIncomeExpense !== false &&
    tx.transactionNature !== 'investment' &&
    txnOrigCurrency(tx) === cur;

  const { entries, max, months, maxM } = useMemo(() => {
    const byCat: Record<string, number> = {};
    for (const tx of d.txns as Txn[]) {
      if (!tx.date.startsWith(ym) || !spendable(tx)) continue;
      const key = tx.category || t('finance.uncategorized');
      byCat[key] = (byCat[key] || 0) + txnOrigMinor(tx);
    }
    const es = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const mx = es.length ? Math.max(...es.map((e) => e[1])) : 1;

    const ms: { ym: string; expense: number }[] = [];
    const [cy, cm] = ym.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      let mm = cm - i;
      let yy = cy;
      if (mm < 1) {
        mm += 12;
        yy--;
      }
      const key = `${yy}-${`${mm}`.padStart(2, '0')}`;
      let sum = 0;
      for (const tx of d.txns as Txn[]) {
        if (!tx.date.startsWith(key) || !spendable(tx)) continue;
        sum += txnOrigMinor(tx);
      }
      ms.push({ ym: key, expense: sum });
    }
    return { entries: es, max: mx, months: ms, maxM: Math.max(...ms.map((m) => m.expense), 1) };
  }, [d.txns, ym, cur]);

  const total = entries.reduce((s, e) => s + e[1], 0);
  return (
    <Card>
      <CardTitle title={t('financeExtra.trendTitle')} />
      <View style={{ marginTop: space.md }}>
        <Segmented
          segments={[
            { key: 'CNY', label: t('finance.cny') },
            { key: 'MYR', label: t('finance.myr') },
          ]}
          active={cur}
          onChange={(k) => setCur(k as Currency)}
        />
      </View>

      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.lg }}>
        {t('finance.trend6')}
      </M3Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, height: 104, marginTop: space.sm }}>
        {months.map((mm) => (
          <View key={mm.ym} style={{ flex: 1, justifyContent: 'flex-end', height: '100%', minWidth: 0 }}>
            <View
              style={{
                width: '100%',
                height: `${(mm.expense / maxM) * 100}%`,
                backgroundColor: mm.ym === ym ? theme.primary : theme.primaryContainer,
                borderRadius: radius.sm,
                minHeight: mm.expense > 0 ? 4 : 0,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 6 }}>
        {months.map((mm) => (
          <M3Text
            key={mm.ym}
            role="labelSmall"
            color={theme.onSurfaceVariant}
            style={[TNUM, { flex: 1, textAlign: 'center' }]}
            numberOfLines={1}
          >
            {mm.ym.slice(5)}
          </M3Text>
        ))}
      </View>

      <Hairline />

      {entries.length === 0 ? (
        <M3Text role="bodyMedium" color={theme.onSurfaceVariant}>
          {t('finance.noSpend')}
        </M3Text>
      ) : (
        entries.map(([cat, amt], i) => (
          <View key={cat} style={{ marginTop: i === 0 ? 0 : space.lg }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: space.sm,
                marginBottom: 6,
              }}
            >
              <M3Text role="bodyMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
                {cat}
              </M3Text>
              <M3Text role="labelLarge" color={theme.onSurfaceVariant} style={TNUM} numberOfLines={1}>
                {formatMoney(amt, cur)}
              </M3Text>
              <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={TNUM}>
                {total > 0 ? `${Math.round((amt / total) * 100)}%` : '0%'}
              </M3Text>
            </View>
            <AnimatedProgress value={amt / max} color={theme.primary} trackColor={theme.surfaceContainerHigh} height={6} />
          </View>
        ))
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 流水：FlatList + 筛选 BottomSheet                                   */
/* ------------------------------------------------------------------ */

function FlowTab({
  d,
  ym,
  setYm,
  onDelete,
  onEdit,
}: {
  d: any;
  ym: string;
  setYm: (v: string) => void;
  onDelete: (t: Txn) => void;
  onEdit: (t: Txn) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const bottomInset = useBottomContentInset();
  const [filterOpen, setFilterOpen] = useState(false);
  const [catFilter, setCatFilter] = useState('all');
  const [curFilter, setCurFilter] = useState<'all' | Currency>('all');

  const monthTxns = useMemo(
    () =>
      (d.txns as Txn[]).filter(
        (tx) => tx.date.startsWith(ym) && tx.transactionNature !== 'investment'
      ),
    [d.txns, ym]
  );
  const allCats = useMemo(
    () => Array.from(new Set(monthTxns.map((tx) => tx.category).filter(Boolean))) as string[],
    [monthTxns]
  );
  const list = useMemo(
    () =>
      monthTxns
        .filter(
          (tx) =>
            (curFilter === 'all' || txnOrigCurrency(tx) === curFilter) &&
            (catFilter === 'all' || tx.category === catFilter)
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (b.time || '').localeCompare(a.time || '') ||
            (b.createdAt || 0) - (a.createdAt || 0)
        ),
    [monthTxns, curFilter, catFilter]
  );

  const activeFilters = (curFilter === 'all' ? 0 : 1) + (catFilter === 'all' ? 0 : 1);

  const header = (
    <View>
      <MonthNav ym={ym} setYm={setYm} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
          marginBottom: space.sm,
        }}
      >
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} numberOfLines={1} style={{ flexShrink: 1 }}>
          {t('financeExtra.txnCountN', { n: list.length })}
          {list.length > 0 ? ` · ${t('financeExtra.deleteHint')}` : ''}
        </M3Text>
        <AnimatedPressable
          onPress={() => setFilterOpen(true)}
          accessibilityLabel={t('financeExtra.filterTitle')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: touchMin,
            paddingHorizontal: 14,
            borderRadius: radius.pill,
            backgroundColor: activeFilters > 0 ? theme.primaryContainer : theme.surfaceContainer,
          }}
        >
          <Icon
            name={ICONS.filter}
            size={18}
            color={activeFilters > 0 ? theme.onPrimaryContainer : theme.onSurfaceVariant}
          />
          <M3Text
            role="labelLarge"
            color={activeFilters > 0 ? theme.onPrimaryContainer : theme.onSurfaceVariant}
          >
            {activeFilters > 0 ? `${t('financeExtra.filterTitle')} · ${activeFilters}` : t('financeExtra.filterTitle')}
          </M3Text>
        </AnimatedPressable>
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        data={list}
        keyExtractor={(tx) => tx.id}
        renderItem={({ item, index }) => (
          <AnimatedListItem index={index}>
            <FlowRow
              tx={item}
              first={index === 0}
              last={index === list.length - 1}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          </AnimatedListItem>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon={ICONS.finance} title={t('finance.noTxn')} />}
        contentContainerStyle={{
          paddingHorizontal: pageMargin,
          paddingTop: space.sm,
          paddingBottom: bottomInset,
        }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
      />

      {/* 筛选弹层 */}
      <AppBottomSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title={t('financeExtra.filterTitle')}
      >
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.sm }}>
          {t('finance.allCurrencies')}
        </M3Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
          <Chip label={t('financeExtra.filterAll')} selected={curFilter === 'all'} onPress={() => setCurFilter('all')} />
          <Chip label={t('finance.cny')} selected={curFilter === 'CNY'} onPress={() => setCurFilter('CNY')} />
          <Chip label={t('finance.myr')} selected={curFilter === 'MYR'} onPress={() => setCurFilter('MYR')} />
        </View>

        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.sm }}>
          {t('finance.allCats')}
        </M3Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xl }}>
          <Chip label={t('financeExtra.filterAll')} selected={catFilter === 'all'} onPress={() => setCatFilter('all')} />
          {allCats.map((c) => (
            <Chip key={c} label={c} selected={catFilter === c} onPress={() => setCatFilter(c)} />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <PrimaryButton label={t('financeExtra.filterApply')} onPress={() => setFilterOpen(false)} style={{ flex: 1 }} />
          <Button
            label={t('financeExtra.filterReset')}
            variant="text"
            onPress={() => {
              setCurFilter('all');
              setCatFilter('all');
            }}
            style={{ flex: 1 }}
          />
        </View>
      </AppBottomSheet>
    </>
  );
}

function FlowRow({
  tx,
  first,
  last,
  onDelete,
  onEdit,
}: {
  tx: Txn;
  first: boolean;
  last: boolean;
  onDelete: (t: Txn) => void;
  onEdit: (t: Txn) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const isExp = tx.type === 'expense' || tx.type === 'refund';
  const orig = txnOrigMinor(tx);
  const origCur = txnOrigCurrency(tx);
  const settle = txnSettleMinor(tx);
  const settleCur = txnSettleCurrency(tx);
  const card = txnIsCard(tx);
  const showSettle = card && settleCur !== origCur;

  return (
    <View>
      <AnimatedPressable
        onPress={() => onEdit(tx)}
        onLongPress={() => onDelete(tx)}
        accessibilityLabel={`${tx.category || t('finance.uncategorized')} ${formatMoney(orig, origCur)}`}
        accessibilityHint={t('financeExtra.deleteHint')}
        pressScale={1}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 56,
          paddingHorizontal: space.lg,
          paddingVertical: 10,
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
            borderRadius: 18,
            backgroundColor: isExp ? theme.errorContainer : theme.surfaceContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={isExp ? ICONS.expense : ICONS.income} size={18} color={isExp ? theme.error : theme.onSurfaceVariant} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <M3Text role="bodyLarge" numberOfLines={1}>
            {tx.category || t('finance.uncategorized')}
          </M3Text>
          <M3Text role="labelSmall" color={theme.onSurfaceVariant} numberOfLines={1}>
            {`${tx.date.slice(5)}${tx.time ? ' ' + tx.time : ''}${tx.merchant ? ' · ' + tx.merchant : ''}${tx.note ? ' · ' + tx.note : ''}`}
          </M3Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <M3Text role="titleMedium" color={isExp ? theme.error : theme.onSurface} style={TNUM} numberOfLines={1}>
            {isExp ? '-' : '+'}
            {formatMoney(orig, origCur)}
          </M3Text>
          {showSettle ? (
            <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={TNUM} numberOfLines={1}>
              {card && !tx.isPosted ? t('finance.pending') + ' ' : ''}
              {formatMoney(settle, settleCur)}
            </M3Text>
          ) : null}
        </View>
      </AnimatedPressable>
      {last ? null : (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.divider,
            marginLeft: space.lg + 36 + space.md,
            backgroundColorOpacity: undefined,
          } as any}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 预算档                                                              */
/* ------------------------------------------------------------------ */

function BudgetTab({ d, ym, setYm }: { d: any; ym: string; setYm: (v: string) => void }) {
  const [cur, setCur] = useState<Currency>('CNY');
  const bottomInset = useBottomContentInset();
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
    >
      <MonthNav ym={ym} setYm={setYm} />
      <BudgetCard d={d} ym={ym} cur={cur} showSwitch onCurChange={setCur} />
    </ScrollView>
  );
}

function BudgetCard({
  d,
  ym,
  cur,
  showSwitch,
  onCurChange,
}: {
  d: any;
  ym: string;
  cur: Currency;
  showSwitch?: boolean;
  onCurChange?: (c: Currency) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState('');
  const budget = budgetStatus(d.txns, d.budgets, ym, cur);

  // 写入逻辑保持不变（整数 minor units，按 年月+币种 定位）
  const setBudget = async (amountMinor: number, c: Currency) => {
    const list = await store.getBudgets();
    const idx = list.findIndex((b) => b.yearMonth === ym && b.currency === c);
    if (idx >= 0) list[idx] = { ...list[idx], amountMinor };
    else list.push({ id: uid('b'), yearMonth: ym, currency: c, amountMinor });
    await store.setBudgets(list);
  };

  const usedRatio = budget.amountMinor > 0 ? budget.used / budget.amountMinor : 0;
  const realPct = budget.amountMinor > 0 ? Math.round(usedRatio * 100) : 0;
  const barColor = usedRatio >= 1 ? theme.error : usedRatio >= 0.8 ? theme.warning : theme.primary;
  const isOver = budget.remain < 0;
  const remainText = formatMoney(Math.abs(budget.remain), cur);
  const curPrefix = cur === 'CNY' ? t('finance.cnySym') : t('finance.myrSym');

  const editRow = (
    <View style={{ gap: space.sm, marginTop: space.lg }}>
      <TextField
        label={`${curPrefix} ${t('finance.amountLabel')}`}
        value={val}
        onChangeText={setVal}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <PrimaryButton
          label={t('common.save')}
          onPress={async () => {
            await setBudget(toMinor(Number(val) || 0, cur), cur);
            setEdit(false);
          }}
          style={{ flex: 1 }}
        />
        <Button label={t('common.cancel')} variant="text" onPress={() => setEdit(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );

  return (
    <Card>
      <M3Text role="titleMedium">{t('finance.budgetMonthly')}</M3Text>
      {showSwitch ? (
        <View style={{ marginTop: space.md }}>
          <Segmented
            segments={[
              { key: 'CNY', label: t('finance.cny') },
              { key: 'MYR', label: t('finance.myr') },
            ]}
            active={cur}
            onChange={(k) => {
              if (onCurChange) onCurChange(k as Currency);
              setEdit(false);
            }}
          />
        </View>
      ) : null}

      {budget.hasBudget ? (
        <>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.lg }}>
            {isOver ? t('finance.overBudgetLabel') : t('finance.monthRemain')}
          </M3Text>
          {/* 不再 adjustsFontSizeToFit：headlineMedium 在整宽卡片里放得下 7 位金额，
              自动缩字号反而让同一页出现好几种字号 */}
          <M3Text
            role="headlineMedium"
            color={isOver ? theme.error : theme.onSurface}
            style={[TNUM, { marginTop: 2 }]}
            numberOfLines={1}
          >
            {remainText}
          </M3Text>

          <View style={{ marginTop: space.lg }}>
            <AnimatedProgress value={usedRatio} color={barColor} trackColor={theme.surfaceContainerHigh} height={8} />
          </View>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: space.md,
              gap: space.sm,
            }}
          >
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={TNUM} numberOfLines={1}>
              {t('finance.usedLabel')} {formatMoney(budget.used, cur)}
            </M3Text>
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={TNUM}>
              {realPct}%
            </M3Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: space.xs,
              gap: space.sm,
            }}
          >
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={TNUM} numberOfLines={1}>
              {t('finance.totalBudgetLabel')} {formatMoney(budget.amountMinor, cur)}
            </M3Text>
            <TouchableOpacity
              onPress={() => {
                setVal(minorToStr(budget.amountMinor));
                setEdit(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('finance.adjustBudget')}
              style={{ minHeight: touchMin, justifyContent: 'center', alignItems: 'flex-end', paddingLeft: 12 }}
            >
              <M3Text role="labelLarge" color={theme.primary}>
                {t('finance.adjustBudget')}
              </M3Text>
            </TouchableOpacity>
          </View>

          {edit && editRow}
        </>
      ) : (
        <>
          <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.lg }}>
            {t('finance.budgetNotSetCur', { cur })}
          </M3Text>
          <TouchableOpacity
            onPress={() => {
              setVal('');
              setEdit(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('finance.setBudget')}
            style={{ minHeight: touchMin, justifyContent: 'center', alignItems: 'flex-start' }}
          >
            <M3Text role="labelLarge" color={theme.primary}>
              {t('finance.setBudget')}
            </M3Text>
          </TouchableOpacity>
          {edit && editRow}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 编辑一笔：复用 buildQuickAddTxn 生成规范化 Txn，业务写入规则不变（§十一） */
/* ------------------------------------------------------------------ */

type QuickAddType = 'expense' | 'income' | 'repayment';

function EditTxnForm({
  initial,
  onUpdate,
  onClose,
  accounts,
  fx,
  t,
}: {
  initial: Txn;
  onUpdate: (tx: Omit<Txn, 'id' | 'createdAt'>) => void;
  onClose: () => void;
  accounts: Account[];
  fx: any;
  t: (k: string, o?: any) => string;
}) {
  const { theme: th } = useTheme();
  const startType = initial.type === 'income' || initial.type === 'repayment' ? initial.type : 'expense';
  const [type, setType] = useState<QuickAddType>(startType);
  const [currency, setCurrency] = useState<Currency>(initial.origCurrency ?? 'MYR');
  const [amountStr, setAmountStr] = useState(minorToStr(initial.origAmountMinor ?? 0));
  const [accountId, setAccountId] = useState(initial.accountId ?? '');
  const [category, setCategory] = useState(initial.category ?? '');
  const [merchant, setMerchant] = useState(initial.merchant ?? '');
  const [note, setNote] = useState(initial.note ?? '');
  const [date, setDate] = useState(initial.date ?? todayStr());
  const [time, setTime] = useState(initial.time ?? '');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [recurrence, setRecurrence] = useState<'none' | 'monthly' | 'weekly' | 'yearly'>(initial.recurrence ?? 'none');

  const account = accounts.find((a) => a.id === accountId);
  const settleCur: Currency = account?.currency ?? currency;
  const cross = type === 'expense' && !!account && account.type === 'credit' && account.currency !== currency;
  const origMinor = amountStr && !isNaN(Number(amountStr)) ? Math.round(Number(amountStr) * 100) : 0;
  const predictedSettle = cross && origMinor > 0 ? convertMinor(origMinor, currency, fx.rateScaled) : 0;
  const amountValid = origMinor > 0;

  // 与 QuickAdd 一致的默认账户：还款→信用卡，否则同币种非信用卡
  const defaultAccountId = useMemo(() => {
    if (accountId) return accountId;
    if (type === 'repayment') {
      const c = accounts.find((a) => a.type === 'credit');
      if (c) return c.id;
    }
    const same =
      accounts.find((a) => a.currency === currency && a.type !== 'credit') ??
      accounts.find((a) => a.currency === currency);
    return same?.id ?? accounts[0]?.id ?? '';
  }, [accountId, type, currency, accounts]);
  const effectiveAccountId = accountId || defaultAccountId;

  const onSave = () => {
    if (!amountValid) return;
    const base = buildQuickAddTxn(
      {
        type,
        amountMinor: origMinor,
        currency,
        accountId: effectiveAccountId || undefined,
        merchant,
        category,
        note,
        date,
        time,
        recurrence,
      },
      accounts,
      fx
    );
    // 保留原交易已确定的入账状态（信用卡未入账/已入账），只覆盖可编辑派生字段
    onUpdate({ ...base, isPosted: initial.isPosted, postedAmountMinor: initial.postedAmountMinor });
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: space.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Segmented
        segments={[
          { key: 'expense', label: t('quickadd.segExpense') },
          { key: 'income', label: t('quickadd.segIncome') },
          { key: 'repayment', label: t('quickadd.segRepayment') },
        ]}
        active={type}
        onChange={(k) => setType(k as QuickAddType)}
      />

      {/* 金额 + 币种 */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: space.lg }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={t('quickadd.amount')}
            value={amountStr}
            onChangeText={setAmountStr}
            keyboardType="decimal-pad"
            prefix={currency === 'CNY' ? '¥' : 'RM'}
            placeholder="0.00"
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          {(['CNY', 'MYR'] as const).map((c) => (
            <Chip key={c} label={c === 'CNY' ? t('finance.cnySym') : t('finance.myrSym')} selected={currency === c} onPress={() => setCurrency(c)} />
          ))}
        </View>
      </View>
      {amountStr.length > 0 && !amountValid && (
        <M3Text role="labelMedium" color={th.error} style={{ marginTop: space.xs }}>
          {t('quickadd.amountRequired')}
        </M3Text>
      )}

      {/* 账户 */}
      <M3Text role="labelMedium" color={th.onSurfaceVariant} style={{ marginBottom: space.sm, marginTop: space.lg }}>
        {t('quickadd.account')}
      </M3Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {accounts.map((a) => {
          const sel = a.id === effectiveAccountId;
          return (
            <TouchableOpacity
              key={a.id}
              onPress={() => setAccountId(a.id)}
              accessibilityRole="button"
              accessibilityLabel={a.name}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                borderWidth: sel ? StyleSheet.hairlineWidth : 0,
                borderColor: sel ? th.outline : undefined,
                backgroundColor: sel ? th.primaryContainer : th.surfaceContainer,
              }}
            >
              <M3Text role="labelLarge" color={sel ? th.onPrimaryContainer : th.onSurface}>
                {a.name} · {a.currency}
              </M3Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 跨币种预测结算（信用卡刷外币） */}
      {cross && predictedSettle > 0 && (
        <View
          style={{
            padding: space.md,
            borderRadius: radius.md,
            marginTop: space.lg,
            backgroundColor: th.surfaceContainer,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <M3Text role="labelMedium" color={th.onSurfaceVariant}>{t('finance.predictedSettle')}</M3Text>
            <M3Text role="bodyLarge" style={TNUM}>{formatMoney(predictedSettle, settleCur)}</M3Text>
          </View>
          <M3Text role="labelSmall" color={th.onSurfaceVariant}>
            {t('finance.rateLabel')} {fx.cnyPerMyr.toFixed(4)} · {t('finance.pending')}
          </M3Text>
        </View>
      )}

      {type !== 'repayment' && (
        <View style={{ marginTop: space.lg }}>
          <TextField label={t('quickadd.merchant')} value={merchant} onChangeText={setMerchant} placeholder={t('finance.merchantPlaceholder')} />
        </View>
      )}
      <View style={{ marginTop: space.md }}>
        <CategoryPicker kind={type === 'income' ? 'income' : 'expense'} value={category} onChange={setCategory} />
      </View>
      <View style={{ marginTop: space.md }}>
        <TextField label={t('quickadd.note')} value={note} onChangeText={setNote} placeholder={t('finance.noteOpt')} />
      </View>
      {type !== 'repayment' && (
        <View style={{ marginTop: space.lg }}>
          <M3Text role="labelMedium" color={th.onSurfaceVariant} style={{ marginBottom: space.sm }}>
            {t('quickadd.recurrence')}
          </M3Text>
          <Segmented
            segments={[
              { key: 'none', label: t('common.cancel') },
              { key: 'monthly', label: t('quickadd.monthly') },
              { key: 'weekly', label: t('quickadd.weekly') },
              { key: 'yearly', label: t('quickadd.yearly') },
            ]}
            active={recurrence}
            onChange={(k) => setRecurrence(k as 'none' | 'monthly' | 'weekly' | 'yearly')}
          />
          {recurrence !== 'none' ? (
            <M3Text role="labelSmall" color={th.onSurfaceVariant} style={{ marginTop: space.xs }}>
              {t('quickadd.fixedHint')}
            </M3Text>
          ) : null}
        </View>
      )}

      {/* 日期 + 时间 */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: space.lg }}>
        <TouchableOpacity
          onPress={() => setShowDate(true)}
          accessibilityRole="button"
          accessibilityLabel={t('quickadd.date')}
          style={[editFieldStyle(th), { flex: 1 }]}
        >
          <M3Text role="labelMedium" color={th.onSurfaceVariant}>{t('quickadd.date')}</M3Text>
          <M3Text role="bodyLarge">{date}</M3Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowTime(true)}
          accessibilityRole="button"
          accessibilityLabel={t('quickadd.time')}
          style={[editFieldStyle(th), { flex: 1 }]}
        >
          <M3Text role="labelMedium" color={th.onSurfaceVariant}>{t('quickadd.time')}</M3Text>
          <M3Text role="bodyLarge">{time || t('plan.noTime')}</M3Text>
        </TouchableOpacity>
      </View>
      {showDate && (
        <DateTimePicker mode="date" value={parseDate(date)} onChange={(e, sel) => { setShowDate(false); if (e.type === 'set' && sel) setDate(fmtDate(sel)); }} />
      )}
      {showTime && (
        <DateTimePicker mode="time" value={parseTime(time)} onChange={(e, sel) => { setShowTime(false); if (e.type === 'set' && sel) setTime(fmtTime(sel)); }} />
      )}

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
        <Button label={t('quickadd.cancel')} variant="text" onPress={onClose} style={{ flex: 1 }} />
        <Button label={t('quickadd.save')} variant="primary" onPress={onSave} disabled={!amountValid} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

function editFieldStyle(theme: any) {
  return {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.divider,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceContainer,
  };
}
