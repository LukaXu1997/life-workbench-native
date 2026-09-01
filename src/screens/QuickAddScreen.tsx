import React, { useMemo, useState } from 'react';
import { ScrollView, View, TouchableOpacity, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useData } from '../useData';
import { useNotifyNav } from '../notify/NotifyNav';
import { saveQuickAdd } from '../notify/quickAddStore';
import { todayStr } from '../store';
import {
  Surface,
  TopAppBar,
  Button,
  TextField,
  Chip,
  Segmented,
  M3Text,
  IconTile,
} from '../components/ui';
import CategoryPicker from '../components/CategoryPicker';
import { Icon, ICONS } from '../icons';
import { formatMoney, convertMinor } from '../money';
import type { Account, Currency, TxnType } from '../types';
import type { QuickAddDraft } from '../notify/quickAdd';
import { radius } from '../tokens';

// ---- date/time helpers (store format: YYYY-MM-DD / HH:MM) ----
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

type QuickAddType = 'expense' | 'income' | 'repayment' | 'fixed';

export default function QuickAddScreen({ draft }: { draft?: QuickAddDraft }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const d = useData();
  const nav = useNotifyNav();

  const initialType = (draft?.type === 'income' || draft?.type === 'repayment' ? draft.type : 'expense') as QuickAddType;

  const [type, setType] = useState<QuickAddType>(initialType);
  const [fixedKind, setFixedKind] = useState<'expense' | 'income'>('expense');
  const [recFreq, setRecFreq] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [currency, setCurrency] = useState<Currency>(draft?.currency ?? 'MYR');
  const [amountStr, setAmountStr] = useState(draft?.amountMinor ? minorToStr(draft.amountMinor) : '');
  const [category, setCategory] = useState(draft?.category ?? '');
  const [merchant, setMerchant] = useState(draft?.merchant ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [accountId, setAccountId] = useState(draft?.accountId ?? '');
  const [date, setDate] = useState(draft?.date ?? todayStr());
  const [time, setTime] = useState(draft?.time ?? '');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const account = d.accounts.find((a) => a.id === accountId);
  const settleCur: Currency = account?.currency ?? currency;
  const cross =
    (type === 'expense' || (type === 'fixed' && fixedKind === 'expense')) &&
    !!account &&
    account.type === 'credit' &&
    account.currency !== currency;
  const origMinor = amountStr && !isNaN(Number(amountStr)) ? Math.round(Number(amountStr) * 100) : 0;
  const predictedSettle = cross && origMinor > 0 ? convertMinor(origMinor, currency, d.fx.rateScaled) : 0;
  const amountValid = origMinor > 0;

  // default account when none selected: credit card for repayment, else same-currency non-credit
  const defaultAccountId = useMemo(() => {
    if (accountId) return accountId;
    if (type === 'repayment') {
      const c = d.accounts.find((a) => a.type === 'credit');
      if (c) return c.id;
    }
    const same =
      d.accounts.find((a) => a.currency === currency && a.type !== 'credit') ??
      d.accounts.find((a) => a.currency === currency);
    return same?.id ?? d.accounts[0]?.id ?? '';
  }, [accountId, type, currency, d.accounts]);

  const effectiveAccountId = accountId || defaultAccountId;
  const catKind: 'expense' | 'income' =
    type === 'income' ? 'income' : type === 'fixed' ? fixedKind : 'expense';

  const onSave = async () => {
    if (busy || !amountValid) return;
    setBusy(true);
    try {
      const effectiveType: TxnType = type === 'fixed' ? fixedKind : (type as TxnType);
      await saveQuickAdd({
        type: effectiveType,
        amountMinor: origMinor,
        currency,
        accountId: effectiveAccountId || undefined,
        merchant: merchant.trim(),
        category: category.trim(),
        note: note.trim(),
        date,
        time,
        recurrence: type === 'fixed' ? recFreq : undefined,
      });
      setSaved(true);
      setTimeout(() => nav.goTabs(), 700);
    } catch {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10 }}>
        <TopAppBar title={t('quickadd.title')} onBack={nav.goTabs} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <IconTile bg={theme.successContainer} color={theme.success}>
            <Icon name={ICONS.check} size={22} color={theme.success} />
          </IconTile>
          <M3Text role="titleMedium" style={{ marginTop: 12 }}>{t('quickadd.savedToast')}</M3Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10 }}>
      <TopAppBar title={t('quickadd.title')} subtitle={draft?.shared ? t('quickadd.sharedTitle') : t('quickadd.subtitle')} onBack={nav.goTabs} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
        {draft?.shared && (
          <Surface level={1} style={{ padding: 12, borderRadius: 12, marginBottom: 12 }}>
            <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('quickadd.fromShare')}</M3Text>
            <M3Text role="bodyMedium" numberOfLines={3}>{draft.note}</M3Text>
          </Surface>
        )}

        {/* type — Notion-style vertical option list */}
        <TypeOptionList
          value={type}
          fixedKind={fixedKind}
          onChange={setType}
          onFixedKindChange={setFixedKind}
          recFreq={recFreq}
          onRecFreqChange={setRecFreq}
          theme={theme}
          t={t}
        />

        {/* amount + currency */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
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
          <M3Text role="labelMedium" color={theme.error} style={{ marginTop: 4 }}>
            {t('quickadd.amountRequired')}
          </M3Text>
        )}

        {/* account */}
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6, marginTop: 12 }}>
          {t('quickadd.account')}
        </M3Text>
        <AccountChips accounts={d.accounts} selected={effectiveAccountId} onSelect={setAccountId} theme={theme} t={t} />

        {/* cross-currency predicted settle */}
        {cross && predictedSettle > 0 && (
          <Surface level={1} style={{ padding: 12, borderRadius: 12, marginTop: 12 }}>
            <Row label={t('finance.predictedSettle')} value={formatMoney(predictedSettle, settleCur)} />
            <M3Text role="labelSmall" color={theme.onSurfaceVariant}>
              {t('finance.rateLabel')} {d.fx.cnyPerMyr.toFixed(4)} · {t('finance.pending')}
            </M3Text>
          </Surface>
        )}

        {/* fields */}
        {type !== 'repayment' && (
          <View style={{ marginTop: 12 }}>
            <TextField
              label={t('quickadd.merchant')}
              value={merchant}
              onChangeText={setMerchant}
              placeholder={t('finance.merchantPlaceholder')}
            />
          </View>
        )}
        <View style={{ marginTop: 10 }}>
          <CategoryPicker kind={catKind} value={category} onChange={setCategory} />
        </View>
        <View style={{ marginTop: 10 }}>
          <TextField label={t('quickadd.note')} value={note} onChangeText={setNote} placeholder={t('finance.noteOpt')} />
        </View>

        {/* date + time */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => setShowDate(true)}
            accessibilityRole="button"
            accessibilityLabel={t('quickadd.date')}
            style={[fieldStyle(theme), { flex: 1 }]}
          >
            <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('quickadd.date')}</M3Text>
            <M3Text role="bodyLarge">{date}</M3Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowTime(true)}
            accessibilityRole="button"
            accessibilityLabel={t('quickadd.time')}
            style={[fieldStyle(theme), { flex: 1 }]}
          >
            <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('quickadd.time')}</M3Text>
            <M3Text role="bodyLarge">{time || t('plan.noTime')}</M3Text>
          </TouchableOpacity>
        </View>
        {showDate && (
          <DateTimePicker mode="date" value={parseDate(date)} onChange={(e, sel) => { setShowDate(false); if (e.type === 'set' && sel) setDate(fmtDate(sel)); }} />
        )}
        {showTime && (
          <DateTimePicker mode="time" value={parseTime(time)} onChange={(e, sel) => { setShowTime(false); if (e.type === 'set' && sel) setTime(fmtTime(sel)); }} />
        )}
      </ScrollView>

      {/* actions */}
      <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 20,
          flexDirection: 'row',
          gap: 10,
          backgroundColor: theme.bg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.divider,
          borderRadius: radius.lg,
          padding: 10,
        }}
      >
        <Button label={t('quickadd.cancel')} variant="text" onPress={nav.goTabs} style={{ flex: 1 }} />
        <Button
          label={busy ? t('common.processing') : t('quickadd.save')}
          variant="primary"
          onPress={onSave}
          disabled={busy || !amountValid}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

function fieldStyle(theme: any) {
  return {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.divider,
    borderRadius: 12,
    backgroundColor: theme.surfaceContainer,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
      <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{label}</M3Text>
      <M3Text role="bodyLarge">{value}</M3Text>
    </View>
  );
}

function AccountChips({
  accounts,
  selected,
  onSelect,
  theme,
  t,
}: {
  accounts: Account[];
  selected: string;
  onSelect: (id: string) => void;
  theme: any;
  t: (k: string, o?: any) => string;
}) {
  if (accounts.length === 0) {
    return (
      <M3Text role="labelMedium" color={theme.error} style={{ marginTop: 4 }}>
        {t('finance.noAccount')}
      </M3Text>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {accounts.map((a) => {
        const sel = a.id === selected;
        return (
          <TouchableOpacity
            key={a.id}
            onPress={() => onSelect(a.id)}
            accessibilityRole="button"
            accessibilityLabel={a.name}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: sel ? StyleSheet.hairlineWidth : 0,
              borderColor: sel ? theme.outline : undefined,
              backgroundColor: sel ? theme.primaryContainer : theme.surfaceContainer,
            }}
          >
            <M3Text role="labelLarge" color={sel ? theme.onPrimaryContainer : theme.onSurface}>
              {a.name} · {a.currency}
            </M3Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---- Notion-style vertical option list for the quick-add transaction type ----
const TYPE_OPTIONS: { key: QuickAddType; icon: string; labelKey: string }[] = [
  { key: 'expense', icon: ICONS.expense, labelKey: 'quickadd.segExpense' },
  { key: 'income', icon: ICONS.income, labelKey: 'quickadd.segIncome' },
  { key: 'repayment', icon: ICONS.repayment, labelKey: 'quickadd.segRepayment' },
  { key: 'fixed', icon: ICONS.recurring, labelKey: 'quickadd.segFixed' },
];

function TypeOptionList({
  value,
  fixedKind,
  onChange,
  onFixedKindChange,
  recFreq,
  onRecFreqChange,
  theme,
  t,
}: {
  value: QuickAddType;
  fixedKind: 'expense' | 'income';
  onChange: (k: QuickAddType) => void;
  onFixedKindChange: (k: 'expense' | 'income') => void;
  recFreq: 'monthly' | 'weekly' | 'yearly';
  onRecFreqChange: (k: 'monthly' | 'weekly' | 'yearly') => void;
  theme: any;
  t: (k: string, o?: any) => string;
}) {
  return (
    <View>
      {TYPE_OPTIONS.map((opt) => {
        const sel = opt.key === value;
        const selBg = sel
          ? opt.key === 'fixed'
            ? fixedKind === 'income'
              ? theme.incomeContainer
              : theme.expenseContainer
            : opt.key === 'income'
              ? theme.incomeContainer
              : opt.key === 'expense'
                ? theme.expenseContainer
                : theme.warningContainer // repayment
          : theme.surfaceContainer;
        const selFg = sel
          ? opt.key === 'fixed'
            ? fixedKind === 'income'
              ? theme.onIncomeContainer
              : theme.onExpenseContainer
            : opt.key === 'income'
              ? theme.onIncomeContainer
              : opt.key === 'expense'
                ? theme.onExpenseContainer
                : theme.onWarningContainer // repayment
          : theme.onSurface;
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => onChange(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={t(opt.labelKey)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 14,
              paddingHorizontal: 14,
              borderRadius: 12,
              marginBottom: 8,
              backgroundColor: sel ? selBg : theme.surfaceContainer,
            }}
          >
            <Icon name={opt.icon} size={22} color={sel ? selFg : theme.onSurfaceVariant} />
            <M3Text role="labelLarge" color={sel ? selFg : theme.onSurface}>
              {t(opt.labelKey)}
            </M3Text>
            <View style={{ flex: 1 }} />
            {sel ? <Icon name={ICONS.check} size={20} color={selFg} /> : null}
          </TouchableOpacity>
        );
      })}
      {value === 'fixed' ? (
        <View style={{ marginTop: 2, marginBottom: 8 }}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
            {t('quickadd.fixedDirection')}
          </M3Text>
          <Segmented
            segments={[
              { key: 'expense', label: t('quickadd.fixedExpense') },
              { key: 'income', label: t('quickadd.fixedIncome') },
            ]}
            active={fixedKind}
            onChange={(k) => onFixedKindChange(k as 'expense' | 'income')}
          />
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6, marginTop: 12 }}>
            {t('quickadd.recurrence')}
          </M3Text>
          <Segmented
            segments={[
              { key: 'monthly', label: t('quickadd.monthly') },
              { key: 'weekly', label: t('quickadd.weekly') },
              { key: 'yearly', label: t('quickadd.yearly') },
            ]}
            active={recFreq}
            onChange={(k) => onRecFreqChange(k as 'monthly' | 'weekly' | 'yearly')}
          />
          <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 6 }}>
            {t('quickadd.fixedHint')}
          </M3Text>
        </View>
      ) : null}
    </View>
  );
}
