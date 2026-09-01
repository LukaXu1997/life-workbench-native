import React, { useCallback } from 'react';
import { ScrollView, View, Alert } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { usePending, actionablePending } from '../notify/pendingStore';
import { clearPending } from '../notify/confirmStore';
import { useNotifyNav } from '../notify/NotifyNav';
import {
  Surface,
  TopAppBar,
  ListRow,
  IconTile,
  M3Text,
  Badge,
  EmptyState,
  IconButton,
} from '../components/ui';
import { Icon, ICONS } from '../icons';
import { formatMoney } from '../money';
import type { PendingRecord } from '../types';

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PendingScreen() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const all = usePending();
  const pending = actionablePending(all);
  const nav = useNotifyNav();

  const onClear = useCallback(() => {
    Alert.alert(t('notify.clear'), t('notify.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('notify.clear'),
        style: 'destructive',
        onPress: () => clearPending(),
      },
    ]);
  }, [t]);

  const renderRow = (rec: PendingRecord) => {
    const isExp = rec.kind !== 'income';
    const color = isExp ? theme.error : theme.success;
    const bg = isExp ? theme.errorContainer : theme.successContainer;
    const statusBadge =
      rec.status === 'matched'
        ? { text: t('notify.matched'), color: theme.onPrimaryContainer, bg: theme.primaryContainer }
        : rec.needsReview
        ? { text: t('notify.needsReview'), color: theme.onErrorContainer, bg: theme.errorContainer }
        : { text: t('notify.pending'), color: theme.onSurfaceVariant, bg: theme.surfaceContainerHigh };
    return (
      <ListRow
        key={rec.id}
        onTap={() => nav.openConfirm(rec.id)}
        left={
          <IconTile bg={bg} color={color}>
            <Icon name={isExp ? ICONS.expense : ICONS.income} size={18} color={color} />
          </IconTile>
        }
        title={rec.merchant || rec.suggestedCategory || rec.sourceAppLabel || rec.sourceApp}
        subtitle={`${formatMoney(rec.amountMinor, rec.currency)} · ${rec.sourceAppLabel ?? rec.sourceApp} · ${fmtTime(rec.notifiedAt)}`}
        right={
          <View style={{ alignItems: 'flex-end' }}>
            <Badge text={statusBadge.text} color={statusBadge.color} bg={statusBadge.bg} />
            {rec.confidence < 1 && (
              <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ marginTop: 4 }}>
                {Math.round(rec.confidence * 100)}%
              </M3Text>
            )}
          </View>
        }
      />
    );
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10 }}>
      <TopAppBar
        title={t('notify.pendingTitle')}
        subtitle={t('notify.subtitle')}
        onBack={nav.goTabs}
        actions={
          pending.length > 0 ? (
            <IconButton name={ICONS.delete} accessibilityLabel={t('notify.clear')} onPress={onClear} />
          ) : null
        }
      />
      {pending.length === 0 ? (
        <EmptyState icon={ICONS.pending} title={t('notify.empty')} hint={t('notify.emptyHint')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <Surface level={0} style={{ borderRadius: 16, overflow: 'hidden' }}>
            {pending.map((rec, i) => (
              <View key={rec.id}>
                {i > 0 && <View style={{ height: 1, backgroundColor: theme.divider }} />}
                {renderRow(rec)}
              </View>
            ))}
          </Surface>
        </ScrollView>
      )}
    </View>
  );
}
