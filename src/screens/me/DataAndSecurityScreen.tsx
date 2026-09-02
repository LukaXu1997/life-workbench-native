import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import {
  getBiometricDiagnostics,
  supportKind,
  canEnableBiometric,
  verifyNow,
  type BiometricDiagnostics,
  type BiometricSupportKind,
} from '../../biometric';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { store } from '../../store';
import { setSecureWindow } from '../../secureWindow';
import { backupNow, previewRestore, confirmRestore, undoLastRestore } from '../../cloud';
import { Button, M3Text, Switch, TextField } from '../../components/ui';
import { ListGroup, NavRow, PrimaryButton } from '../../components/kit';
import { AppBottomSheet } from '../../components/anim';
import { Icon, ICONS } from '../../icons';
import { radius, space } from '../../tokens';
import type { SbConfig } from '../../types';
import SubPage from './SubPage';

// §四 数据与安全：备份 / 恢复（预览 → 二次确认 → 可撤销）+ 连接配置 + 隐私说明。
// §十二 恢复链路完全保留原有三步：previewRestore → confirmRestore → undoLastRestore，
//       一行业务逻辑都没有改，只是确认弹层换成了统一的 AppBottomSheet。
//
// 「云备份与恢复」原本是独立页面，与本页面在能力上重叠（都需要 Supabase 配置）。
// 现已合并：备份/恢复动作在前，连接表单收进默认折叠的 disclosure，
// 避免一进页面就是一串技术字段——复杂配置不占据首屏，这是 Notion 的处理方式。
const EMPTY_CFG: SbConfig = {
  url: '',
  key: '',
  bucket: 'backup',
  path: 'life-workbench-backup.json',
  enabled: false,
  lastSync: null,
};

// 应用锁不可用时的具体原因 → 文案 key（不再统一为「未设置」）。
// 这与 src/biometric.ts 的 supportKind 一一对应。
const SUPPORT_REASON_KEY: Record<BiometricSupportKind, string> = {
  ok: 'settings.biometricHint',
  no_hardware: 'settings.biometricReasonNoHardware',
  no_supported_types: 'settings.biometricReasonNoSupportedTypes',
  only_device_credential: 'settings.biometricReasonOnlyDeviceCredential',
  face_weak_only: 'settings.biometricReasonFaceWeakOnly',
  native_unavailable: 'settings.biometricReasonNativeUnavailable',
  module_missing: 'settings.biometricReasonModuleMissing',
  exception: 'settings.biometricReasonException',
};

export default function DataAndSecurityScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();

  const [cfg, setCfg] = useState<SbConfig>(EMPTY_CFG);
  const [pass, setPass] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [cfgStatus, setCfgStatus] = useState('');

  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreMeta, setRestoreMeta] = useState<any>(null);
  const [canUndo, setCanUndo] = useState(false);

  const [onEntry, setOnEntry] = useState(false);
  const [onReturn, setOnReturn] = useState(false);
  const [autoLockMs, setAutoLockMs] = useState(30_000);
  const [hideRecents, setHideRecents] = useState(false);
  const [deviceFallback, setDeviceFallback] = useState(true);
  const [diag, setDiag] = useState<BiometricDiagnostics | null>(null);
  const [bioSec, setBioSec] = useState<'standard' | 'high'>('standard');
  const [busyVerify, setBusyVerify] = useState(false);
  const [lockSheetOpen, setLockSheetOpen] = useState(false);

  useEffect(() => {
    store.getSbConfig().then(setCfg);
    store.getSyncPass().then(setPass);
    store.getBiometricOnEntry().then(setOnEntry);
    store.getBiometricOnReturn().then(setOnReturn);
    store.getBiometricAutoLockMs().then(setAutoLockMs);
    store.getBiometricHideRecents().then(setHideRecents);
    store.getBiometricDeviceFallback().then(setDeviceFallback);
    store.getBiometricSecurity().then(setBioSec);
    // 4 项非敏感诊断：是否有硬件 / 支持类型 / 是否已录入 / 安全等级。
    getBiometricDiagnostics().then(setDiag);
  }, []);

  const doBackup = async () => {
    setBusy(true);
    const r = await backupNow();
    setBusy(false);
    setStatus(r.msg);
    store.getSbConfig().then(setCfg);
  };

  const requestPreview = async () => {
    setBusy(true);
    const r = await previewRestore();
    setBusy(false);
    if (r.ok && r.meta) setRestoreMeta(r.meta);
    else setStatus(r.msg);
  };

  const doConfirmRestore = async () => {
    setBusy(true);
    const r = await confirmRestore();
    setBusy(false);
    setRestoreMeta(null);
    setStatus(r.msg);
    if (r.ok) setCanUndo(true);
  };

  const doUndo = async () => {
    setBusy(true);
    const r = await undoLastRestore();
    setBusy(false);
    setStatus(r.msg);
    setCanUndo(false);
  };

  const saveCfg = async () => {
    await store.setSbConfig(cfg);
    await store.setSyncPass(pass);
    setCfgStatus(t('settings.cfgSavedHint'));
  };

  const toggleAutoSync = (v: boolean) => {
    setCfg({ ...cfg, enabled: v });
    store.setSbEnabled(v);
  };

  // 启用 / 关闭「应用锁（进入 App 时验证）」前，必须先进行一次生物识别验证；
  // 验证失败或取消则不改变状态。返回 true 表示验证通过。
  const verifyBeforeChange = async (): Promise<boolean> => {
    if (!canEnable) return false;
    setBusyVerify(true);
    const ok = await verifyNow({
      security: bioSec,
      deviceFallback,
      promptMessage: t('settings.biometricVerifyPrompt'),
    });
    setBusyVerify(false);
    return ok;
  };

  const toggleOnEntry = async (v: boolean) => {
    // 设备不可用（无硬件 / 未录入 / 模块异常）时不允许开启，绝不误锁用户。
    if (!canEnable) return;
    // 启用与关闭前都必须先验证一次；验证未通过则保持原状态。
    const ok = await verifyBeforeChange();
    if (!ok) return;
    setOnEntry(v);
    await store.setBiometricOnEntry(v);
  };

  const toggleOnReturn = async (v: boolean) => {
    setOnReturn(v);
    await store.setBiometricOnReturn(v);
  };

  const toggleHideRecents = async (v: boolean) => {
    setHideRecents(v);
    await store.setBiometricHideRecents(v);
    // 原生 FLAG_SECURE：立即对当前窗口生效，隐藏最近任务预览。
    await setSecureWindow(v);
  };

  const toggleDeviceFallback = async (v: boolean) => {
    setDeviceFallback(v);
    await store.setBiometricDeviceFallback(v);
  };

  const toggleSecurity = async (v: boolean) => {
    const next: 'standard' | 'high' = v ? 'high' : 'standard';
    setBioSec(next);
    await store.setBiometricSecurity(next);
  };

  // 自动锁定时间选项：立即 / 30 秒 / 1 分钟 / 5 分钟。
  const AUTO_LOCK_OPTIONS: { ms: number; key: string }[] = [
    { ms: 0, key: 'settings.biometricAutoLockImmediate' },
    { ms: 30_000, key: 'settings.biometricAutoLock30s' },
    { ms: 60_000, key: 'settings.biometricAutoLock1m' },
    { ms: 300_000, key: 'settings.biometricAutoLock5m' },
  ];
  const autoLockKey =
    (AUTO_LOCK_OPTIONS.find((o) => o.ms === autoLockMs) ?? AUTO_LOCK_OPTIONS[1]).key;

  const chooseAutoLock = async (ms: number) => {
    setAutoLockMs(ms);
    await store.setBiometricAutoLockMs(ms);
    setLockSheetOpen(false);
  };

  const c = restoreMeta?.counts || {};
  const configured = !!(cfg.url && cfg.key);
  const lastSyncText = cfg.lastSync
    ? t('settings.lastSync', { time: new Date(cfg.lastSync).toLocaleString() })
    : undefined;

  // —— 应用锁可用性派生（仅非敏感标量）——
  const kind: BiometricSupportKind | null = diag ? supportKind(diag) : null;
  const canEnable = diag ? canEnableBiometric(diag) : false;

  return (
    <SubPage title={t('me.dataSecurity')} onBack={() => navigation.goBack()}>
      {/* ① 备份 / 恢复动作 —— 最常用的动作放最前 */}
      <ListGroup
        title={t('settings.backupGroup')}
        footer={configured ? undefined : t('settings.cfgRequired')}
      >
        <NavRow
          icon={ICONS.backup}
          title={busy ? t('common.processing') : t('settings.backupNow')}
          subtitle={lastSyncText}
          onPress={configured && !busy ? doBackup : undefined}
          trailing={null}
        />
        <NavRow
          icon={ICONS.restore}
          title={busy ? t('common.processing') : t('settings.restore')}
          onPress={configured && !busy ? requestPreview : undefined}
          trailing={null}
        />
        {canUndo ? (
          <NavRow
            icon={ICONS.sync}
            title={t('settings.undoRestore')}
            onPress={busy ? undefined : doUndo}
            trailing={null}
          />
        ) : null}
      </ListGroup>

      {status ? (
        <M3Text role="labelMedium" color={theme.primary} style={{ marginLeft: space.xs }}>
          {status}
        </M3Text>
      ) : null}

      {/* ② 自动同步 */}
      <ListGroup>
        <NavRow
          icon={ICONS.sync}
          title={t('settings.syncAuto')}
          subtitle={cfg.enabled ? lastSyncText : t('settings.syncAutoHint')}
          trailing={
            <Switch
              value={cfg.enabled}
              onValueChange={toggleAutoSync}
              accessibilityLabel={t('settings.syncAuto')}
            />
          }
        />
      </ListGroup>

      {/* ②½ 应用锁：面容 / 指纹 —— 按诊断结果准确提示，设备不可用时置灰并说明具体原因。
          主开关「进入 App 时验证」默认关闭，启用与关闭前都必须先验证一次。子项在锁关闭时禁用。 */}
      <ListGroup
        title={t('settings.biometric')}
        footer={kind && kind !== 'ok' ? t(SUPPORT_REASON_KEY[kind]) : undefined}
      >
        <NavRow
          icon={ICONS.fingerprint}
          title={t('settings.biometricOnEntry')}
          subtitle={t('settings.biometricOnEntryHint')}
          trailing={
            <Switch
              value={onEntry}
              onValueChange={toggleOnEntry}
              disabled={!canEnable || busyVerify}
              accessibilityLabel={t('settings.biometricOnEntry')}
            />
          }
        />
        <NavRow
          icon={ICONS.clock}
          title={t('settings.biometricOnReturn')}
          subtitle={t('settings.biometricOnReturnHint')}
          trailing={
            <Switch
              value={onReturn}
              onValueChange={toggleOnReturn}
              disabled={!onEntry}
              accessibilityLabel={t('settings.biometricOnReturn')}
            />
          }
        />
        <NavRow
          icon={ICONS.lockClock}
          title={t('settings.biometricAutoLock')}
          subtitle={t('settings.biometricAutoLockHint')}
          value={t(autoLockKey)}
          onPress={onEntry && onReturn ? () => setLockSheetOpen(true) : undefined}
        />
        <NavRow
          icon={ICONS.eyeOff}
          title={t('settings.biometricHideRecents')}
          subtitle={t('settings.biometricHideRecentsHint')}
          trailing={
            <Switch
              value={hideRecents}
              onValueChange={toggleHideRecents}
              disabled={!onEntry}
              accessibilityLabel={t('settings.biometricHideRecents')}
            />
          }
        />
        <NavRow
          icon={ICONS.key}
          title={t('settings.biometricDeviceFallback')}
          subtitle={t('settings.biometricDeviceFallbackHint')}
          trailing={
            <Switch
              value={deviceFallback}
              onValueChange={toggleDeviceFallback}
              disabled={!onEntry}
              accessibilityLabel={t('settings.biometricDeviceFallback')}
            />
          }
        />
        {canEnable ? (
          <NavRow
            icon={ICONS.shield}
            title={t('settings.biometricSecurityTitle')}
            subtitle={t('settings.biometricSecurityHint')}
            trailing={
              <Switch
                value={bioSec === 'high'}
                onValueChange={toggleSecurity}
                disabled={!onEntry}
                accessibilityLabel={t('settings.biometricSecurityTitle')}
              />
            }
          />
        ) : null}
      </ListGroup>

      {/* ③ 连接配置 —— 默认折叠，复杂字段不占据首屏 */}
      <ListGroup footer={t('settings.backupHint')}>
        <NavRow
          icon={ICONS.server}
          title={t('settings.cfgEntry')}
          subtitle={t('settings.cfgEntryHint')}
          value={configured ? t('settings.configured') : t('settings.notConfigured')}
          onPress={() => setAdvOpen((v) => !v)}
          trailing={
            <Icon
              name={advOpen ? ICONS.chevronDown : ICONS.chevronRight}
              size={20}
              color={theme.onSurfaceVariant}
            />
          }
        />
        {advOpen ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <TextField
              label={t('settings.urlLabel')}
              value={cfg.url}
              onChangeText={(v) => setCfg({ ...cfg, url: v })}
              placeholder="https://xxxx.supabase.co"
              autoCapitalize="none"
            />

            <TextField
              label={t('settings.keyLabel')}
              value={cfg.key}
              onChangeText={(v) => setCfg({ ...cfg, key: v })}
              placeholder="eyJ..."
              autoCapitalize="none"
              secureTextEntry={!showKey}
              trailing={
                <TouchableOpacity
                  onPress={() => setShowKey((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.toggleReveal')}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon
                    name={showKey ? ICONS.eyeOff : ICONS.eye}
                    size={20}
                    color={theme.onSurfaceVariant}
                  />
                </TouchableOpacity>
              }
            />

            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t('settings.bucketLabel')}
                  value={cfg.bucket}
                  onChangeText={(v) => setCfg({ ...cfg, bucket: v })}
                  placeholder="backup"
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t('settings.pathLabel')}
                  value={cfg.path}
                  onChangeText={(v) => setCfg({ ...cfg, path: v })}
                  placeholder="life-workbench-backup.json"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <TextField
              label={t('settings.passLabel')}
              value={pass}
              onChangeText={setPass}
              placeholder={t('settings.passHint')}
              secureTextEntry
            />

            <PrimaryButton label={t('settings.saveCfg')} onPress={saveCfg} />

            {cfgStatus ? (
              <M3Text role="labelMedium" color={theme.primary}>
                {cfgStatus}
              </M3Text>
            ) : null}
          </View>
        ) : null}
      </ListGroup>

      {/* ④ 隐私说明 */}
      <ListGroup title={t('settings.privacyTitle')} footer={t('settings.notifyPrivacyText')}>
        <View style={{ padding: space.lg }}>
          <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ lineHeight: 20 }}>
            {t('settings.privacyText')}
          </M3Text>
        </View>
      </ListGroup>

      {/* 恢复二次确认（内容与原实现一致） */}
      <AppBottomSheet
        visible={!!restoreMeta}
        onClose={() => setRestoreMeta(null)}
        title={t('settings.restoreConfirmTitle')}
      >
        <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginBottom: space.md, lineHeight: 20 }}>
          {t('settings.restoreMeta', {
            app: restoreMeta?.appVersion,
            schema: restoreMeta?.schemaVersion,
            time: restoreMeta?.exportedAt ? new Date(restoreMeta.exportedAt).toLocaleString() : '-',
          })}
        </M3Text>
        <View
          style={{
            backgroundColor: theme.surfaceContainer,
            borderRadius: radius.md,
            padding: space.md,
            marginBottom: space.md,
          }}
        >
          <M3Text role="labelMedium">{t('settings.recordCounts')}</M3Text>
          <M3Text role="bodyMedium">
            {t('settings.countLine', {
              tx: c.txns || 0,
              task: c.tasks || 0,
              acc: c.accounts || 0,
              habit: c.habits || 0,
              journal: c.journal || 0,
              inbox: c.inbox || 0,
            })}
          </M3Text>
        </View>
        <M3Text role="labelSmall" color={theme.error} style={{ marginBottom: space.md }}>
          {t('settings.restoreWarn')}
        </M3Text>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label={t('common.cancel')} variant="text" onPress={() => setRestoreMeta(null)} style={{ flex: 1 }} />
          <PrimaryButton
            label={busy ? t('common.processing') : t('settings.confirmRestore')}
            onPress={doConfirmRestore}
            style={{ flex: 1 }}
          />
        </View>
      </AppBottomSheet>

      {/* 自动锁定时间选择（立即 / 30 秒 / 1 分钟 / 5 分钟） */}
      <AppBottomSheet
        visible={lockSheetOpen}
        onClose={() => setLockSheetOpen(false)}
        title={t('settings.biometricAutoLock')}
      >
        <View style={{ gap: space.sm, paddingBottom: space.md }}>
          {AUTO_LOCK_OPTIONS.map((o) => {
            const selected = o.ms === autoLockMs;
            return (
              <TouchableOpacity
                key={o.ms}
                onPress={() => chooseAutoLock(o.ms)}
                accessibilityRole="button"
                accessibilityLabel={t(o.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: space.md,
                  paddingHorizontal: space.lg,
                  backgroundColor: selected ? theme.surfaceContainer : 'transparent',
                  borderRadius: radius.md,
                }}
              >
                <M3Text role="bodyLarge" color={selected ? theme.primary : theme.onSurface}>
                  {t(o.key)}
                </M3Text>
                {selected ? <Icon name={ICONS.check} size={22} color={theme.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </AppBottomSheet>
    </SubPage>
  );
}
