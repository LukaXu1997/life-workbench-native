// First-launch onboarding wizard.
//
// The root cause of the earlier "net worth shows negative" confusion was that the
// app auto-creates four zero-balance accounts on first run and never asks the user
// to set opening balances. This wizard fixes that: on first launch it walks the
// user through naming their accounts and entering each one's current balance, so
// net worth / assets start out correct. It is re-runnable from Settings.

import React, { useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { store, defaultAccounts, uid } from '../store';
import { parseBalanceToMinor } from '../money';
import type { Account, Currency, AccountType } from '../types';
import { M3Text, TextField, Button, Chip, Surface } from './ui';
import { Icon, ICONS } from '../icons';

interface Row {
  id: string;
  name: string;
  currency: Currency;
  type: AccountType;
  balanceStr: string;
}

function curSym(c: Currency): string {
  return c === 'CNY' ? '¥' : 'RM';
}

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0); // 0 welcome · 1 accounts · 2 done
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const accs = await store.getAccounts();
      const base = accs.length ? accs : defaultAccounts();
      const mapped: Row[] = base.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        type: a.type,
        balanceStr:
          a.openingBalanceMinor != null
            ? (a.openingBalanceMinor / 100).toString()
            : a.balanceMinor != null
              ? (a.balanceMinor / 100).toString()
              : '',
      }));
      setRows(mapped);
      setLoaded(true);
    })();
  }, []);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { id: uid('a'), name: '', currency: 'MYR', type: 'debit', balanceStr: '' },
    ]);

  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const finish = async () => {
    const baseAccs = await store.getAccounts();
    const byId = new Map(baseAccs.map((a) => [a.id, a]));
    const saved: Account[] = rows.map((r, i) => {
      const bal = parseBalanceToMinor(r.balanceStr, r.currency);
      const ex = byId.get(r.id);
      const fallbackName = r.currency === 'CNY' ? t('onboarding.defaultNameCny') : t('onboarding.defaultNameMyr');
      return {
        id: r.id,
        name: r.name.trim() || fallbackName,
        type: r.type,
        currency: r.currency,
        openingBalanceMinor: bal ?? 0,
        includeInNetWorth: true,
        showOnHome: true,
        order: i,
        createdAt: ex?.createdAt ?? Date.now(),
        creditLimitMinor: ex?.creditLimitMinor,
        currentBillMinor: ex?.currentBillMinor,
        unbilledMinor: ex?.unbilledMinor,
        repaidMinor: ex?.repaidMinor,
        stmtDay: ex?.stmtDay,
        dueDay: ex?.dueDay,
      };
    });
    await store.setAccounts(saved);
    await store.setOnboarded(true);
    onDone();
  };

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.bg,
        zIndex: 100,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
        {step === 0 && (
          <Welcome onStart={() => setStep(1)} onSkip={async () => { await store.setOnboarded(true); onDone(); }} />
        )}

        {step === 1 && (
          <View>
            <M3Text role="titleLarge">{t('onboarding.accountsTitle')}</M3Text>
            <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: 6, marginBottom: 16 }}>
              {t('onboarding.accountsHint')}
            </M3Text>

            {rows.map((r) => (
              <Surface key={r.id} level={1} style={{ padding: 14, borderRadius: 14, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={t('onboarding.namePlaceholder')}
                      value={r.name}
                      onChangeText={(v) => update(r.id, { name: v })}
                      placeholder={t('onboarding.namePlaceholder')}
                    />
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding.remove')}
                    onPress={() => removeRow(r.id)}
                    style={{ padding: 8, marginTop: 18 }}
                  >
                    <Icon name={ICONS.delete} size={20} color={theme.onSurfaceVariant} />
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={t('onboarding.balancePlaceholder')}
                      value={r.balanceStr}
                      onChangeText={(v) => update(r.id, { balanceStr: v })}
                      keyboardType="decimal-pad"
                      prefix={curSym(r.currency)}
                      placeholder="0.00"
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 18 }}>
                    {(['CNY', 'MYR'] as const).map((c) => (
                      <Chip
                        key={c}
                        label={c}
                        selected={r.currency === c}
                        onPress={() => update(r.id, { currency: c })}
                      />
                    ))}
                  </View>
                </View>
              </Surface>
            ))}

            <TouchableOpacity
              accessibilityRole="button"
              onPress={addRow}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 14,
                borderRadius: 14,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.outline,
                borderStyle: 'dashed',
                marginBottom: 8,
              }}
            >
              <Icon name={ICONS.add} size={20} color={theme.primary} />
              <M3Text role="labelLarge" color={theme.primary}>{t('onboarding.addAccount')}</M3Text>
            </TouchableOpacity>

            <Button label={t('onboarding.start')} variant="primary" onPress={() => setStep(2)} style={{ marginTop: 8 }} />
          </View>
        )}

        {step === 2 && (
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Icon name={ICONS.check} size={56} color={theme.primary} />
            <M3Text role="titleLarge" style={{ marginTop: 16 }}>{t('onboarding.doneTitle')}</M3Text>
            <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: 8, textAlign: 'center' }}>
              {t('onboarding.doneSub')}
            </M3Text>
            <Button label={t('onboarding.enter')} variant="primary" onPress={finish} style={{ marginTop: 24, width: 200 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Welcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ alignItems: 'center', paddingTop: 48 }}>
      <Icon name={ICONS.wallet} size={64} color={theme.primary} />
      <M3Text role="headlineMedium" style={{ marginTop: 20, textAlign: 'center' }}>{t('onboarding.welcome')}</M3Text>
      <M3Text role="bodyLarge" color={theme.onSurfaceVariant} style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 8 }}>
        {t('onboarding.welcomeSub')}
      </M3Text>
      <Button label={t('onboarding.start')} variant="primary" onPress={onStart} style={{ marginTop: 32, width: 240 }} />
      <TouchableOpacity accessibilityRole="button" onPress={onSkip} style={{ marginTop: 12, padding: 10 }}>
        <M3Text role="labelLarge" color={theme.onSurfaceVariant}>{t('onboarding.skip')}</M3Text>
      </TouchableOpacity>
    </View>
  );
}
