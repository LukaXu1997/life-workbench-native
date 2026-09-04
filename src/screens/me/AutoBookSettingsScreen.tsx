import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, TextInput as RNTextInput } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { useData } from '../../useData';
import {
  getRules,
  setAutoBookSettings,
  getAutoBookSettings,
  updateRule,
  setRuleAction,
  deleteRule,
  undoAutoBook,
} from '../../automationStore';
import { getPending } from '../../notify/pendingStore';
import type { AutomationRule, AutoBookSettings } from '../../automation';
import type { Account, PendingRecord } from '../../types';
import { Surface, Switch, M3Text, IconButton } from '../../components/ui';
import { Card, Chip, ConfirmDialog } from '../../components/kit';
import SubPage from './SubPage';
import { Icon, ICONS } from '../../icons';
import { radius, space, pageMargin } from '../../tokens';
import { formatMoney } from '../../money';
import CategoryPicker from '../../components/CategoryPicker';

// §九 自动记账规则管理页。
//  · 总开关 + 支出/收入自动入账上限（仅 UI 层设置，实际入账仍受 canAutoBook 多重限制）
//  · 已学会的规则列表：启用/停用、改账户、改分类、切换「仅自动填充 / 自动入账」、删除
//  · 最近自动入账：可逐笔撤销（undoAutoBook 会恢复待确认并把责任规则降级为仅填充）
//  · 不静默创建规则；规则只在学习满足阈值后由用户在 ConfirmTxn 弹窗中确认创建。
export default function AutoBookSettingsScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const d = useData();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [settings, setSettings] = useState<AutoBookSettings>({
    enabled: false,
    expenseLimitMinor: 5000,
    incomeLimitMinor: 0,
  });
  const [recent, setRecent] = useState<PendingRecord[]>([]);
  const [expStr, setExpStr] = useState('');
  const [incStr, setIncStr] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);

  const reload = useCallback(async () => {
    const [r, s, p] = await Promise.all([getRules(), getAutoBookSettings(), getPending()]);
    setRules(r);
    setSettings(s);
    setRecent(
      p.filter((x) => x.status === 'auto_booked' && (x.createdTxnId || x.txnId))
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Sync the editable limit fields whenever settings load/change.
  useEffect(() => {
    setExpStr(settings.expenseLimitMinor ? (settings.expenseLimitMinor / 100).toString() : '0');
    setIncStr(settings.incomeLimitMinor ? (settings.incomeLimitMinor / 100).toString() : '0');
  }, [settings]);

  const setMaster = async (v: boolean) => {
    const next = { ...settings, enabled: v };
    setSettings(next);
    await setAutoBookSettings(next);
  };

  const commitLimits = async () => {
    const exp = Math.max(0, Math.round((Number(expStr) || 0) * 100));
    const inc = Math.max(0, Math.round((Number(incStr) || 0) * 100));
    const next = { ...settings, expenseLimitMinor: exp, incomeLimitMinor: inc };
    setSettings(next);
    await setAutoBookSettings(next);
  };

  const onUndo = async (rec: PendingRecord) => {
    const txnId = rec.createdTxnId || rec.txnId;
    if (!txnId) return;
    await undoAutoBook(txnId);
    await reload();
  };

  return (
    <SubPage title={t('autoBook.title')} subtitle={t('autoBook.subtitle')} onBack={() => navigation.goBack()}>
      {/* ── 总开关 + 上限 ── */}
      <Card padding={space.lg}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, marginRight: space.md }}>
            <M3Text role="titleMedium">{t('autoBook.master')}</M3Text>
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 2 }}>
              {t('autoBook.masterHint')}
            </M3Text>
          </View>
          <Switch value={settings.enabled} onValueChange={setMaster} accessibilityLabel={t('autoBook.master')} />
        </View>

        <View style={{ marginTop: space.lg }}>
          <M3Text role="labelLarge" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
            {t('autoBook.expenseLimit')}
          </M3Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: theme.divider,
              borderRadius: radius.md,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              minHeight: 52,
            }}
          >
            <M3Text role="bodyLarge" color={theme.onSurfaceVariant} style={{ marginRight: 6 }}>
              RM
            </M3Text>
            <RNTextInput
              value={expStr}
              onChangeText={setExpStr}
              onBlur={commitLimits}
              placeholder="0"
              keyboardType="decimal-pad"
              style={{ flex: 1, fontSize: 16, color: theme.onSurface, paddingVertical: 10 }}
              placeholderTextColor={theme.onSurfaceVariant}
            />
          </View>
        </View>

        <View style={{ marginTop: space.md }}>
          <M3Text role="labelLarge" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
            {t('autoBook.incomeLimit')}
          </M3Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: theme.divider,
              borderRadius: radius.md,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              minHeight: 52,
            }}
          >
            <M3Text role="bodyLarge" color={theme.onSurfaceVariant} style={{ marginRight: 6 }}>
              RM
            </M3Text>
            <RNTextInput
              value={incStr}
              onChangeText={setIncStr}
              onBlur={commitLimits}
              placeholder="0"
              keyboardType="decimal-pad"
              style={{ flex: 1, fontSize: 16, color: theme.onSurface, paddingVertical: 10 }}
              placeholderTextColor={theme.onSurfaceVariant}
            />
          </View>
          <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 6 }}>
            {t('autoBook.limitHint')}
          </M3Text>
        </View>
      </Card>

      {/* ── 已学会的规则 ── */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: space.xl, marginBottom: space.sm, marginLeft: space.xs }}>
        <M3Text role="labelLarge" color={theme.onSurfaceVariant}>
          {t('autoBook.rules')}
        </M3Text>
      </View>

      {rules.length === 0 ? (
        <Surface level={0} style={{ padding: space.lg, borderRadius: radius.card }}>
          <M3Text role="bodyLarge">{t('autoBook.noRules')}</M3Text>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 6 }}>
            {t('autoBook.noRulesHint')}
          </M3Text>
        </Surface>
      ) : (
        rules.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            accounts={d.accounts}
            theme={theme}
            t={t}
            onToggleEnabled={async (v) => {
              await updateRule(rule.id, { enabled: v });
              await reload();
            }}
            onSetAccount={async (id) => {
              await setRuleAction(rule.id, { accountId: id });
              await reload();
            }}
            onSetCategory={async (c) => {
              await setRuleAction(rule.id, { categoryId: c });
              await reload();
            }}
            onSetAutoBook={async (v) => {
              await setRuleAction(rule.id, { autoBook: v });
              await reload();
            }}
            onDelete={() => setDeleteTarget(rule)}
          />
        ))
      )}

      {/* ── 最近自动入账 ── */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: space.xl, marginBottom: space.sm, marginLeft: space.xs }}>
        <M3Text role="labelLarge" color={theme.onSurfaceVariant}>
          {t('autoBook.recentAutoBook')}
        </M3Text>
      </View>

      {recent.length === 0 ? (
        <Surface level={0} style={{ padding: space.lg, borderRadius: radius.card }}>
          <M3Text role="bodyMedium" color={theme.onSurfaceVariant}>
            {t('autoBook.recentEmpty')}
          </M3Text>
        </Surface>
      ) : (
        <Surface level={0} style={{ borderRadius: radius.card, overflow: 'hidden' }}>
          {recent.map((rec, i) => (
            <View
              key={rec.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 12,
                paddingHorizontal: space.lg,
                borderBottomWidth: i < recent.length - 1 ? 1 : 0,
                borderColor: theme.divider,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <M3Text role="bodyLarge" numberOfLines={1}>
                  {rec.merchant || rec.suggestedCategory || rec.sourceAppLabel || rec.sourceApp}
                </M3Text>
                <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 2 }}>
                  {formatMoney(rec.amountMinor, rec.currency)} · {new Date(rec.notifiedAt).toLocaleDateString()}
                </M3Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('autoBook.undo')}
                onPress={() => onUndo(rec)}
                hitSlop={8}
                style={{ paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <M3Text role="labelLarge" color={theme.error}>
                  {t('autoBook.undo')}
                </M3Text>
              </Pressable>
            </View>
          ))}
        </Surface>
      )}

      {/* ── 如何工作 ── */}
      <View style={{ marginTop: space.xl, marginBottom: space.sm, marginLeft: space.xs }}>
        <M3Text role="labelLarge" color={theme.onSurfaceVariant}>
          {t('autoBook.howTitle')}
        </M3Text>
      </View>
      <Surface level={0} style={{ padding: space.lg, borderRadius: radius.card }}>
        <HowRow text={t('autoBook.how1')} theme={theme} />
        <HowRow text={t('autoBook.how2')} theme={theme} style={{ marginTop: 10 }} />
        <HowRow text={t('autoBook.how3')} theme={theme} style={{ marginTop: 10 }} />
      </Surface>

      <ConfirmDialog
        visible={!!deleteTarget}
        title={t('autoBook.delete')}
        message={deleteTarget ? `${t('autoBook.deleteConfirmHint')}` : undefined}
        confirmLabel={t('autoBook.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (deleteTarget) await deleteRule(deleteTarget.id);
          setDeleteTarget(null);
          await reload();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </SubPage>
  );
}

function HowRow({ text, theme, style }: { text: string; theme: any; style?: any }) {
  return (
    <View style={[{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }, style]}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.onSurfaceVariant,
          marginTop: 7,
          marginLeft: 2,
        }}
      />
      <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ flex: 1 }}>
        {text}
      </M3Text>
    </View>
  );
}

function RuleCard({
  rule,
  accounts,
  theme,
  t,
  onToggleEnabled,
  onSetAccount,
  onSetCategory,
  onSetAutoBook,
  onDelete,
}: {
  rule: AutomationRule;
  accounts: Account[];
  theme: any;
  t: (k: string, o?: any) => string;
  onToggleEnabled: (v: boolean) => void;
  onSetAccount: (id: string) => void;
  onSetCategory: (c: string) => void;
  onSetAutoBook: (v: boolean) => void;
  onDelete: () => void;
}) {
  const isIgnore = !!rule.actions.ignore;
  const dir = rule.conditions.direction === 'income' ? 'income' : 'expense';
  const accountName = accounts.find((a) => a.id === rule.actions.accountId)?.name;

  return (
    <Card padding={space.lg} style={{ marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, marginRight: space.md }}>
          <M3Text role="titleMedium" numberOfLines={1}>
            {rule.name}
          </M3Text>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 2 }}>
            {t('autoBook.ruleMatched', { n: rule.stats.matchedCount })} ·{' '}
            {t('autoBook.ruleAutoBooked', { n: rule.stats.autoBookedCount })} ·{' '}
            {t('autoBook.ruleCorrected', { n: rule.stats.correctedCount })}
          </M3Text>
        </View>
        <Switch value={rule.enabled && !isIgnore} onValueChange={onToggleEnabled} accessibilityLabel={rule.name} disabled={isIgnore} />
      </View>

      {isIgnore ? (
        <View style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={ICONS.info} size={16} color={theme.onSurfaceVariant} />
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
            {t('autoBook.ignoredBadge')}
          </M3Text>
        </View>
      ) : (
        <>
          <View style={{ marginTop: space.md }}>
            <M3Text role="labelLarge" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
              {t('autoBook.account')}
            </M3Text>
            {accounts.length === 0 ? (
              <M3Text role="labelMedium" color={theme.error}>
                {t('finance.noAccount')}
              </M3Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {accounts.map((a) => {
                  const sel = a.id === rule.actions.accountId;
                  return (
                    <Pressable
                      key={a.id}
                      accessibilityRole="button"
                      accessibilityLabel={a.name}
                      onPress={() => onSetAccount(a.id)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 999,
                        borderWidth: sel ? 1 : 0,
                        borderColor: sel ? theme.outline : undefined,
                        backgroundColor: sel ? theme.primaryContainer : theme.surfaceContainer,
                      }}
                    >
                      <M3Text role="labelLarge" color={sel ? theme.onPrimaryContainer : theme.onSurface}>
                        {a.name} · {a.currency}
                      </M3Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ marginTop: space.md }}>
            <CategoryPicker
              kind={dir}
              value={rule.actions.categoryId || ''}
              onChange={onSetCategory}
              showLabel
            />
          </View>

          <View style={{ marginTop: space.md }}>
            <M3Text role="labelLarge" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
              {t('autoBook.edit')}
            </M3Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip
                label={t('autoBook.modeFillOnly')}
                selected={!rule.actions.autoBook}
                onPress={() => onSetAutoBook(false)}
              />
              <Chip
                label={t('autoBook.modeAutoBook')}
                selected={!!rule.actions.autoBook}
                onPress={() => onSetAutoBook(true)}
              />
            </View>
          </View>
        </>
      )}

      <View style={{ marginTop: space.lg, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('autoBook.delete')}
          onPress={onDelete}
          hitSlop={8}
          style={{ paddingVertical: 8, paddingHorizontal: 12 }}
        >
          <M3Text role="labelLarge" color={theme.error}>
            {t('autoBook.delete')}
          </M3Text>
        </Pressable>
      </View>
    </Card>
  );
}
