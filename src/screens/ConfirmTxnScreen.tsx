import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useData } from '../useData';
import { usePending } from '../notify/pendingStore';
import { useNotifyNav } from '../notify/NotifyNav';
import { confirmPending, ignorePending } from '../notify/confirmStore';
import { computeFxRate } from '../notify/confirm';
import {
  recordConfirmation,
  makeRuleFromSuggestion,
  addRule,
} from '../automationStore';
import type { RuleSuggestion } from '../automation';
import {
  buildConfirmForm,
  minorToAmountStr,
  shouldSyncForm,
  suggestAccountFor,
} from '../notify/confirmForm';
import {
  Surface,
  TopAppBar,
  Button,
  TextField,
  Chip,
  M3Text,
  IconTile,
  IconButton,
} from '../components/ui';
import { Icon, ICONS } from '../icons';
import CategoryPicker from '../components/CategoryPicker';
import { formatMoney } from '../money';
import type { Account, Currency, PendingRecord } from '../types';

function parseMajor(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export default function ConfirmTxnScreen({ id }: { id: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const d = useData();
  const all = usePending();
  const nav = useNotifyNav();

  const rec = all.find((r) => r.id === id);
  const orig = rec?.matchOfId ? all.find((r) => r.id === rec.matchOfId) : undefined;
  const isMatch = !!rec?.matchOfId && rec?.status === 'matched';

  // ---- editable state ----
  // Initial values are a best-effort seed; the useEffect below re-syncs from the record
  // once it becomes available (covers the "screen renders first, record loads later" case).
  const [amountStr, setAmountStr] = useState(rec ? minorToAmountStr(rec.amountMinor) : '');
  const [currency, setCurrency] = useState<Currency>(rec?.currency ?? 'MYR');
  const [merchant, setMerchant] = useState(rec?.merchant ?? '');
  const [category, setCategory] = useState(rec?.suggestedCategory ?? '');
  const [accountId, setAccountId] = useState(rec?.suggestedAccountId ?? '');
  const [actualCnyStr, setActualCnyStr] = useState(
    isMatch && rec ? minorToAmountStr(rec.amountMinor) : ''
  );
  const [busy, setBusy] = useState(false);
  // Step 5: when the system has learned enough to suggest a rule, surface a prompt
  // so the user decides (never silently create a rule). null = no suggestion.
  const [learn, setLearn] = useState<RuleSuggestion | null>(null);

  // Tracks whether the user has manually edited any field. Once true, auto-sync stops
  // so unrelated state refreshes never clobber their input.
  const [touched, setTouched] = useState(false);
  const syncedIdRef = useRef<string | null>(null);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  const suggested = rec ? suggestAccountFor(rec, d.accounts) : '';

  // Sync form fields from the PendingRecord once it (or its content) is loaded.
  // Mirrors requirement: amountStr / currency / merchant / category / accountId / actualCnyStr.
  useEffect(() => {
    if (!rec) return;
    if (
      !shouldSyncForm({
        rec,
        isMatch,
        syncedId: syncedIdRef.current,
        touched,
        canSuggestAccount: !!suggested,
        currentAccountId: accountIdRef.current,
      })
    ) {
      return;
    }
    const f = buildConfirmForm(rec, d.accounts, isMatch);
    setAmountStr(f.amountStr);
    setCurrency(f.currency);
    setMerchant(f.merchant);
    setCategory(f.category);
    setAccountId(f.accountId);
    setActualCnyStr(f.actualCnyStr);
    syncedIdRef.current = rec.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rec?.id,
    rec?.amountMinor,
    rec?.currency,
    rec?.merchant,
    rec?.suggestedCategory,
    rec?.suggestedAccountId,
    isMatch,
    rec?.matchOfId,
    touched,
    d.accounts,
  ]);

  const account = d.accounts.find((a) => a.id === accountId);
  const settleCur: Currency = account?.currency ?? currency;
  const cross = !!account && account.type === 'credit' && settleCur !== currency;

  const predictedSettle = useMemo(() => {
    if (!rec) return 0;
    if (isMatch && orig) return orig.predictedSettleMinor ?? 0;
    if (rec.predictedSettleMinor && cross)
      return rec.predictedSettleMinor;
    if (cross) return Math.round((parseMajor(amountStr) * d.fx.rateScaled) / 1_000_000);
    return 0;
  }, [rec, isMatch, orig, cross, amountStr, d.fx.rateScaled]);

  // Step 5: the "teach the app" prompt after the 3rd+ confirmation.
  // IMPORTANT: must be declared BEFORE the `if (!rec) return` below so the hook
  // count stays identical on every render (avoids "Rendered more hooks" crash).
  useEffect(() => {
    if (!learn) return;
    Alert.alert(
      t('autoBook.learnTitle'),
      t('autoBook.learnBody', { app: learn.sourceApp || t('common.other') }),
      [
        { text: t('autoBook.learnDecline'), style: 'cancel', onPress: () => handleLearnChoice('decline') },
        { text: t('autoBook.learnFillOnly'), onPress: () => handleLearnChoice('fill') },
        { text: t('autoBook.learnAutoBook'), onPress: () => handleLearnChoice('auto') },
      ]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learn]);

  const handleLearnChoice = async (choice: 'decline' | 'fill' | 'auto') => {
    const s = learn;
    setLearn(null);
    setBusy(false);
    if (!s) {
      nav.goTabs();
      return;
    }
    try {
      if (choice === 'decline') {
        // Remember the choice so we don't prompt again for this signature; the rule
        // is marked ignore (never auto-books) rather than silently dropping the hint.
        await addRule(makeRuleFromSuggestion(s, { autoBook: false, ignore: true }));
      } else {
        await addRule(makeRuleFromSuggestion(s, { autoBook: choice === 'auto' }));
      }
    } catch {
      /* rule creation is best-effort */
    }
    nav.goTabs();
  };

  if (!rec) {
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10 }}>
        <TopAppBar title={t('notify.confirmTitle')} onBack={nav.goTabs} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <M3Text role="bodyLarge" color={theme.onSurfaceVariant}>{t('notify.empty')}</M3Text>
        </View>
      </View>
    );
  }

  const origMinor = orig?.amountMinor ?? rec.amountMinor;
  const actualMinor = isMatch ? parseMajor(actualCnyStr) : 0;
  const actualRate = isMatch && actualMinor > 0 ? computeFxRate('MYR', origMinor, 'CNY', actualMinor) : 0;

  const onConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isMatch) {
        await confirmPending(rec.id, {
          accountId: accountId || undefined,
          actualSettleMinor: actualMinor > 0 ? actualMinor : rec.amountMinor,
        });
      } else {
        const edits = {
          amountMinor: parseMajor(amountStr),
          currency,
          accountId: accountId || undefined,
          category: category.trim() || rec.suggestedCategory,
          merchant: merchant.trim(),
        };
        if (edits.amountMinor <= 0) {
          setBusy(false);
          return;
        }
        await confirmPending(rec.id, edits);
      }

      // Step 5: record the confirmation and ask the user whether to learn a rule.
      // recordConfirmation returns a suggestion ONLY after enough identical confirms
      // (≥3); it never creates a rule itself. If a suggestion exists, we hold on the
      // screen and let the user choose — navigation happens in handleLearnChoice.
      try {
        const learnEdits = isMatch
          ? { accountId: accountId || undefined }
          : {
              accountId: accountId || undefined,
              category: category.trim() || rec.suggestedCategory,
              merchant: merchant.trim(),
            };
        const suggestion = await recordConfirmation(rec.id, learnEdits);
        if (suggestion) {
          setLearn(suggestion);
          return;
        }
      } catch {
        /* learning is best-effort; never block the confirmation */
      }
      nav.goTabs();
    } catch {
      setBusy(false);
    }
  };

  const onIgnore = () => {
    Alert.alert(t('common.confirm'), t('notify.ignoreConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('notify.ignore'),
        style: 'destructive',
        onPress: async () => {
          await ignorePending(rec.id);
          nav.goTabs();
        },
      },
    ]);
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10 }}>
      <TopAppBar
        title={t('notify.confirmTitle')}
        subtitle={rec.sourceAppLabel ?? rec.sourceApp}
        onBack={nav.goTabs}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
        {/* amount headline */}
        <Surface level={0} style={{ padding: 16, borderRadius: 16, marginBottom: 12 }}>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{t('notify.amount')}</M3Text>
          <M3Text role="headlineMedium" style={{ marginTop: 4 }}>
            {formatMoney(isMatch ? origMinor : parseMajor(amountStr), isMatch ? (orig?.currency ?? rec.currency) : currency)}
          </M3Text>
          {rec.needsReview && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}>
              <Icon name={ICONS.warning} size={16} color={theme.warning} />
              <M3Text role="labelMedium" color={theme.warning}>
                {t('notify.needsReview')} · {Math.round(rec.confidence * 100)}%
              </M3Text>
            </View>
          )}
        </Surface>

        {/* posting match (cross-currency RMB card bank-posted) */}
        {isMatch && (
          <Surface level={2} style={{ padding: 14, borderRadius: 16, marginBottom: 12 }}>
            <M3Text role="titleMedium" color={theme.primary} style={{ marginBottom: 8 }}>
              {t('notify.matchedTitle')}
            </M3Text>
            <Row label={t('notify.originalSpend')} value={formatMoney(origMinor, orig?.currency ?? rec.currency)} />
            <Row label={t('notify.predictedSettle')} value={formatMoney(predictedSettle, 'CNY')} />
            <View style={{ marginTop: 10 }}>
              <TextField
                label={t('notify.actualSettle')}
                value={actualCnyStr}
                onChangeText={(v) => {
                  setActualCnyStr(v);
                  setTouched(true);
                }}
                keyboardType="decimal-pad"
                prefix="¥"
              />
            </View>
            {actualRate > 0 && (
              <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 8 }}>
                {t('notify.actualRate')} {actualRate.toFixed(4)}
              </M3Text>
            )}
            <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 6 }}>
              {t('notify.matchHint')}
            </M3Text>
          </Surface>
        )}

        {/* editable amount (normal flow) */}
        {!isMatch && (
          <View style={{ marginBottom: 12 }}>
            <TextField
              label={t('notify.amount')}
              value={amountStr}
              onChangeText={(v) => {
                setAmountStr(v);
                setTouched(true);
              }}
              keyboardType="decimal-pad"
              prefix={currency === 'CNY' ? '¥' : 'RM'}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {(['CNY', 'MYR'] as const).map((c) => (
                <Chip key={c} label={c === 'CNY' ? t('finance.cnySym') : t('finance.myrSym')} selected={currency === c} onPress={() => { setCurrency(c); setTouched(true); }} />
              ))}
            </View>
          </View>
        )}

        {/* account */}
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
          {t('notify.account')}
        </M3Text>
        <AccountChips accounts={d.accounts} selected={accountId} onSelect={(id) => { setAccountId(id); setTouched(true); }} theme={theme} t={t} />

        {/* cross-currency predicted settle note (normal flow) */}
        {cross && predictedSettle > 0 && !isMatch && (
          <Surface level={1} style={{ padding: 12, borderRadius: 12, marginTop: 12 }}>
            <Row label={t('notify.predictedSettle')} value={formatMoney(predictedSettle, settleCur)} />
            <M3Text role="labelSmall" color={theme.onSurfaceVariant}>
              {t('finance.rateLabel')} {d.fx.cnyPerMyr.toFixed(4)} · {t('finance.pending')}
            </M3Text>
          </Surface>
        )}

        {/* merchant + category */}
        {!isMatch && (
          <>
            <View style={{ marginTop: 12 }}>
              <TextField label={t('notify.merchant')} value={merchant} onChangeText={(v) => { setMerchant(v); setTouched(true); }} placeholder={t('finance.merchantPlaceholder')} />
            </View>
            <View style={{ marginTop: 10 }}>
              <CategoryPicker
                kind={rec?.kind === 'income' ? 'income' : 'expense'}
                value={category}
                onChange={(v) => { setCategory(v); setTouched(true); }}
              />
            </View>
          </>
        )}

        {/* source + time */}
        <Surface level={0} style={{ padding: 12, borderRadius: 12, marginTop: 12 }}>
          <Row label={t('notify.source')} value={rec.sourceAppLabel ?? rec.sourceApp} />
          <Row label={t('notify.receiptTime')} value={new Date(rec.notifiedAt).toLocaleString()} />
        </Surface>
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
        }}
      >
        <Button label={t('notify.ignore')} variant="tonal" onPress={onIgnore} style={{ flex: 1 }} />
        <Button
          label={busy ? t('common.processing') : t('notify.confirm')}
          variant="primary"
          onPress={onConfirm}
          disabled={busy}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
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
