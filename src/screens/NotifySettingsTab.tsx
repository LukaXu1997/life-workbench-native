import React, { useEffect, useState } from 'react';
import { View, AppState, Alert } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { store } from '../store';
import { Surface, M3Text, Switch, TextField, Chip, IconTile, Button, IconButton } from '../components/ui';
import { Icon, ICONS } from '../icons';
import { radius } from '../tokens';
import type { NotifySettings } from '../types';
import {
  getNotifySettings,
  setNotifySettings,
  notifyListenerEnabled,
  openNotificationSettings,
  tngCaptureEnabled,
  openTxnCaptureSettings,
  TXN_CAPTURE_PACKAGES,
  usePendingCount,
} from '../notify/pendingStore';
import { clearPending } from '../notify/confirmStore';
import { APP_LABELS } from '../notify/ingest';

// Settings + permission surface for the "auto-bookkeep after payment" feature.
// Privacy contract:
//  - The enable switch only *requests* access; the system grant is opened only on an
//    explicit user tap (the "Grant in system settings" button), never automatically.
//  - If the OS revokes notification access, the native service stops forwarding and this
//    UI reflects the degraded state (graceful degrade) — nothing is silently lost.

const CONF_PRESETS = [0.3, 0.5, 0.7];

function clampConf(v: number): number {
  if (!isFinite(v)) return 0.4;
  return Math.max(0, Math.min(1, v));
}

export default function NotifySettingsTab() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const pendingCount = usePendingCount();

  const [s, setS] = useState<NotifySettings | null>(null);
  const [permOn, setPermOn] = useState(false);
  const [captureOn, setCaptureOn] = useState(false);
  const [rate, setRate] = useState('1.65');
  const [confText, setConfText] = useState('0.4');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [settings, fxRate, perm, capture] = await Promise.all([
        getNotifySettings(),
        store.getFxRate(),
        notifyListenerEnabled(),
        tngCaptureEnabled(),
      ]);
      if (!alive) return;
      setS(settings);
      setRate(String(fxRate));
      setConfText(String(settings.confidenceFloor));
      setPermOn(perm);
      setCaptureOn(capture);
    };
    load();
    // Re-check OS permission whenever the app returns to the foreground (e.g. after the
    // user granted/revoked access in system settings and came back).
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        notifyListenerEnabled().then((p) => alive && setPermOn(p));
        tngCaptureEnabled().then((c) => alive && setCaptureOn(c));
      }
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const update = (patch: Partial<NotifySettings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    setNotifySettings(next);
  };

  const toggleEnabled = (v: boolean) => {
    update({ enabled: v });
    // Do NOT auto-open system settings. The user must tap the grant button explicitly.
  };

  const toggleTngCapture = (v: boolean) => {
    if (!s) return;
    // Ensure every supported capture package is in the allowlist so the
    // accessibility captureAllowlist (sent to native) includes them all — TnG, Grab,
    // Shopee, Lazada, Boost, MAE, BigPay, and Pinduoduo (拼多多, CNY). (Harmless to
    // also add them to the notification listener: these apps post no payment
    // notification anyway.)
    let allowlist = s.allowlist;
    if (v) {
      for (const pkg of TXN_CAPTURE_PACKAGES) {
        if (!allowlist.includes(pkg)) allowlist = [...allowlist, pkg];
      }
    }
    update({ tngCapture: v, allowlist });
    // Do NOT auto-open system settings. The user must tap the grant button explicitly.
  };

  const toggleAllow = (pkg: string) => {
    if (!s) return;
    const has = s.allowlist.includes(pkg);
    const allowlist = has ? s.allowlist.filter((p) => p !== pkg) : [...s.allowlist, pkg];
    update({ allowlist });
  };

  const setConf = (text: string) => {
    setConfText(text);
    const v = clampConf(parseFloat(text));
    update({ confidenceFloor: v });
  };

  const doClear = () => {
    if (pendingCount <= 0) return;
    Alert.alert(t('settings.notifyClear'), t('settings.notifyClearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: () => clearPending().catch(() => {}),
      },
    ]);
  };

  if (!s) {
    return <View style={{ padding: 16 }} />;
  }

  const allowEntries = Object.entries(APP_LABELS);
  const showPermissionWarning = s.enabled && !permOn;

  return (
    <Surface level={0} style={{ padding: 16, borderRadius: radius.lg, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <IconTile bg={theme.primaryContainer} color={theme.onPrimaryContainer}>
          <Icon name={ICONS.bell} size={18} color={theme.onPrimaryContainer} />
        </IconTile>
        <M3Text role="titleMedium">{t('settings.notifications')}</M3Text>
      </View>
      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 12 }}>
        {t('settings.notifyEnableHint')}
      </M3Text>

      {/* Enable switch + permission status */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 6,
        }}
      >
        <M3Text role="bodyLarge">{t('settings.notifyEnable')}</M3Text>
        <Switch
          value={s.enabled}
          onValueChange={toggleEnabled}
          accessibilityLabel={t('settings.notifyEnable')}
        />
      </View>

      {s.enabled ? (
        showPermissionWarning ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 8,
              padding: 12,
              borderRadius: radius.md,
              backgroundColor: theme.errorContainer,
            }}
          >
            <Icon name={ICONS.warning} size={20} color={theme.onErrorContainer} />
            <View style={{ flex: 1 }}>
              <M3Text role="labelMedium" color={theme.onErrorContainer}>
                {t('settings.notifyPermissionOff')}
              </M3Text>
            </View>
            <Button
              label={t('settings.notifyOpenSettings')}
              variant="primary"
              onPress={openNotificationSettings}
              style={{ paddingHorizontal: 12 }}
            />
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 8,
              padding: 12,
              borderRadius: radius.md,
              backgroundColor: theme.successContainer,
            }}
          >
            <Icon name={ICONS.check} size={20} color={theme.onSuccessContainer} />
            <M3Text role="labelMedium" color={theme.onSuccessContainer} style={{ flex: 1 }}>
              {t('settings.notifyPermissionOn')}
            </M3Text>
            <IconButton
              name={ICONS.settings}
              size={18}
              color={theme.onSuccessContainer}
              onPress={openNotificationSettings}
              accessibilityLabel={t('settings.notifyOpenSettings')}
            />
          </View>
        )
      ) : null}

      {s.enabled ? (
        <>
          {/* App allowlist */}
          <M3Text role="titleMedium" style={{ marginTop: 16, marginBottom: 4 }}>
            {t('settings.notifyAllowlist')}
          </M3Text>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 10 }}>
            {t('settings.notifyAllowlistHint')}
          </M3Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {allowEntries.map(([pkg, label]) => (
              <Chip
                key={pkg}
                label={label}
                selected={s.allowlist.includes(pkg)}
                onPress={() => toggleAllow(pkg)}
              />
            ))}
          </View>
          {s.allowlist.length === 0 ? (
            <M3Text role="labelSmall" color={theme.onWarningContainer} style={{ marginTop: 8 }}>
              {t('settings.notifyNoneSelected')}
            </M3Text>
          ) : null}

          {/* Pause */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
              paddingVertical: 6,
            }}
          >
            <M3Text role="bodyLarge">{t('settings.notifyPause')}</M3Text>
            <Switch
              value={s.paused}
              onValueChange={(v) => update({ paused: v })}
              accessibilityLabel={t('settings.notifyPause')}
            />
          </View>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 2 }}>
            {t('settings.notifyPauseHint')}
          </M3Text>

          {/* Confidence floor */}
          <M3Text role="titleMedium" style={{ marginTop: 16, marginBottom: 4 }}>
            {t('settings.notifyConfidence')}
          </M3Text>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 10 }}>
            {t('settings.notifyConfidenceHint')}
          </M3Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ width: 110 }}>
              <TextField
                value={confText}
                onChangeText={setConf}
                keyboardType="decimal-pad"
                placeholder="0.4"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', flex: 1 }}>
              {CONF_PRESETS.map((p) => (
                <Chip
                  key={p}
                  label={String(p)}
                  selected={Math.abs(clampConf(parseFloat(confText)) - p) < 1e-6}
                  onPress={() => setConf(String(p))}
                />
              ))}
            </View>
          </View>

          {/* Prediction rate note (reuses the global Exchange rate setting) */}
          <View
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: radius.md,
              backgroundColor: theme.surfaceContainer,
            }}
          >
            <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
              {t('settings.notifyFxNote', { rate })}
            </M3Text>
          </View>

          {/* Clear pending */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
            }}
          >
            <View style={{ flex: 1, marginRight: 10 }}>
              <M3Text role="labelLarge">{t('settings.notifyPending')}</M3Text>
              <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                {t('notify.banner', { n: pendingCount })}
              </M3Text>
            </View>
            <Button
              label={t('settings.notifyClear', { n: pendingCount })}
              variant={pendingCount > 0 ? 'danger' : 'ghost'}
              disabled={pendingCount <= 0}
              onPress={doClear}
              style={{ paddingHorizontal: 12 }}
            />
          </View>
        </>
      ) : null}

      {/* TnG real-time capture (AccessibilityService primary + OCR screenshot fallback) */}
      <View
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTopWidth: 1,
          borderColor: theme.divider,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <IconTile bg={theme.primaryContainer} color={theme.onPrimaryContainer}>
            <Icon name={ICONS.creditCard} size={18} color={theme.onPrimaryContainer} />
          </IconTile>
          <M3Text role="titleMedium">{t('settings.tngCapture')}</M3Text>
        </View>
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 12 }}>
          {t('settings.tngCaptureHint')}
        </M3Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 6,
          }}
        >
          <M3Text role="bodyLarge">{t('settings.tngCapture')}</M3Text>
          <Switch
            value={!!s.tngCapture}
            onValueChange={toggleTngCapture}
            accessibilityLabel={t('settings.tngCapture')}
          />
        </View>

        {s.tngCapture ? (
          captureOn ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                marginTop: 8,
                padding: 12,
                borderRadius: radius.md,
                backgroundColor: theme.successContainer,
              }}
            >
              <Icon name={ICONS.check} size={20} color={theme.onSuccessContainer} />
              <M3Text role="labelMedium" color={theme.onSuccessContainer} style={{ flex: 1 }}>
                {t('settings.tngCaptureOn')}
              </M3Text>
              <IconButton
                name={ICONS.settings}
                size={18}
                color={theme.onSuccessContainer}
                onPress={openTxnCaptureSettings}
                accessibilityLabel={t('settings.tngCaptureOpenSettings')}
              />
            </View>
          ) : (
            <View
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: radius.md,
                backgroundColor: theme.errorContainer,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name={ICONS.warning} size={20} color={theme.onErrorContainer} />
                <View style={{ flex: 1 }}>
                  <M3Text role="labelMedium" color={theme.onErrorContainer}>
                    {t('settings.tngCaptureOff')}
                  </M3Text>
                </View>
                <Button
                  label={t('settings.tngCaptureOpenSettings')}
                  variant="primary"
                  onPress={openTxnCaptureSettings}
                  style={{ paddingHorizontal: 12 }}
                />
              </View>
              <M3Text
                role="labelSmall"
                color={theme.onErrorContainer}
                style={{ marginTop: 8, lineHeight: 18 }}
              >
                {t('settings.tngCaptureManualHint')}
              </M3Text>
            </View>
          )
        ) : null}
      </View>

      {/* Privacy note */}
      <View style={{ marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderColor: theme.divider }}>
        <M3Text role="labelMedium" style={{ marginBottom: 4 }}>
          {t('settings.notifyPrivacy')}
        </M3Text>
        <M3Text role="labelSmall" color={theme.onSurfaceVariant} style={{ lineHeight: 18 }}>
          {t('settings.notifyPrivacyText')}
        </M3Text>
      </View>
    </Surface>
  );
}
