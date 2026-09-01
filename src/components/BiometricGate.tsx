import React, { useEffect, useRef, useState } from 'react';
import { View, AppState } from 'react-native';
// 必须用命名空间导入：该包无 default 导出（详见 src/biometric.ts 顶部说明）。
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { M3Text } from './ui';
import { PrimaryButton } from './kit';
import { Icon, ICONS } from '../icons';
import { space } from '../tokens';
import { store } from '../store';
import {
  getBiometricDiagnostics,
  isEligible,
  mapAuthError,
  securityLevelFor,
  type BiometricDiagnostics,
  type BiometricAuthKind,
  type BiometricSecurityPref,
} from '../biometric';

// 默认自动锁定时间：App 进入后台超过 30 秒后回到前台重新验证（用户可在设置中改）。
// 该值由 autoLockMs prop 注入，不再写死。

// 锁屏页「具体认证错误 → 文案 key」的映射。每类错误单独提示，
// 不再统一为「当前设备暂未设置面容或指纹」。
const AUTH_ERROR_KEY: Record<Exclude<BiometricAuthKind, 'success'>, string> = {
  user_cancel: 'settings.biometricErrUserCancel',
  auth_failed: 'settings.biometricErrAuthFailed',
  locked: 'settings.biometricErrLocked',
  not_enrolled: 'settings.biometricErrNotEnrolled',
  not_available: 'settings.biometricErrNotAvailable',
  passcode_not_set: 'settings.biometricErrPasscodeNotSet',
  exception: 'settings.biometricErrException',
};

/**
 * 应用锁网关：开启后，在冷启动、以及离开超过 30 秒后回到前台时，
 * 以全屏遮罩挡住应用内容，直到系统面容 / 指纹验证通过。
 *
 * 设计取向（Notion 风格）：
 *  · 大量留白、单一主操作、克制的文案，不出现刺眼的「错误 / 警告」。
 *  · 进入即自动唤起系统生物识别弹窗；验证失败仅保持锁定，并按**具体错误**给出说明。
 *  · 设备不可用（无硬件 / 未录入 / 模块异常）时自动放行，绝不把用户锁在外面。
 */
export function BiometricGate({
  onEntry = false,
  onReturn = false,
  autoLockMs = 30_000,
  deviceFallback = true,
  security = 'standard',
  children,
}: {
  /** 进入 App 时验证（冷启动锁）。 */
  onEntry?: boolean;
  /** 回到 App 时重新验证（离开超过 autoLockMs 后再次验证）。 */
  onReturn?: boolean;
  /** 自动锁定时间（毫秒）：0=立即，30000=30 秒，60000=1 分钟，300000=5 分钟。 */
  autoLockMs?: number;
  /** 生物识别失败时是否允许用设备密码回退。 */
  deviceFallback?: boolean;
  security?: BiometricSecurityPref;
  children: React.ReactNode;
}) {
  // effectiveEnabled：进入或回到 App 任一开启即需要锁。
  const enabled = onEntry || onReturn;
  // 冷启动初始已认证态：仅「回到 App 时验证」开启（onEntry 关闭）时，启动即视为已认证，
  // 待用户首次切到后台再返回时才重新锁定；onEntry 开启则启动即要求验证。
  const [authed, setAuthed] = useState(() => !onEntry);
  const { theme } = useTheme();
  const { t } = useI18n();
  const [diag, setDiag] = useState<BiometricDiagnostics | null>(null);
  const [lastError, setLastError] = useState<BiometricAuthKind | null>(null);
  const [busy, setBusy] = useState(false);
  const bgAtRef = useRef<number>(0);

  const level = securityLevelFor(security);
  // 仅当设备在该安全级别下真正可用时才锁定；否则自动放行。
  const eligible = diag ? isEligible(diag, level) : false;

  // 启动期诊断：仅读取非敏感结果（是否有硬件 / 支持类型 / 是否已录入 / 等级）。
  useEffect(() => {
    let active = true;
    getBiometricDiagnostics().then((d) => {
      if (active) setDiag(d);
    });
    store.getBiometricLastError().then((e) => {
      if (active && e) setLastError(mapAuthError(e));
    });
    return () => {
      active = false;
    };
  }, []);

  const prompt = async () => {
    if (!enabled || !eligible) return;
    setBusy(true);
    try {
      // 兼容配置：弱级别优先，允许人脸 / 指纹 / 设备密码；不强制 strong。
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: t('settings.biometricPrompt'),
        cancelLabel: t('settings.biometricCancel'),
        fallbackLabel: t('settings.biometricFallback'),
        disableDeviceFallback: !deviceFallback,
        biometricsSecurityLevel: level,
      });
      if (r.success) {
        setAuthed(true);
        setLastError(null);
        await store.setBiometricLastError(null);
      } else {
        // 记录**具体**错误码（非敏感），并按分类给出不同提示。
        const kind = mapAuthError(r.error);
        setLastError(kind);
        await store.setBiometricLastError(r.error ?? 'unknown');
      }
    } catch {
      // authenticateAsync 本身抛异常（极少见）：归为异常类。
      setLastError('exception');
      await store.setBiometricLastError('exception');
    } finally {
      setBusy(false);
    }
  };

  // 启用且设备可用后立即要求验证一次。
  useEffect(() => {
    if (enabled && eligible && !authed) prompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eligible]);

  // 回到前台（仅「回到 App 时重新验证」开启、且离开超过 autoLockMs）时重新锁定并唤起验证。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        bgAtRef.current = Date.now();
      } else if (state === 'active') {
        // 仅 onReturn 开启、且确实离开过（bgAt 已被记录，非冷启动）才重锁，
        // 避免冷启动（无 background 事件、bgAt 仍为 0）被误判为「已离开过」。
        if (
          onReturn &&
          enabled &&
          eligible &&
          authed &&
          bgAtRef.current > 0 &&
          Date.now() - bgAtRef.current >= autoLockMs
        ) {
          setAuthed(false);
          setTimeout(() => prompt(), 60);
        }
      }
    });
    return () => sub.remove();
  }, [enabled, eligible, authed, onReturn, autoLockMs, prompt]);

  const locked = enabled && eligible && !authed;
  if (!locked) return <>{children}</>;

  // 锁屏提示：优先展示上一次认证的具体错误；首次锁定则展示通用引导文案。
  const hintKey =
    lastError && lastError !== 'success' ? AUTH_ERROR_KEY[lastError] : 'settings.biometricLockHint';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.xl,
      }}
    >
      <View
        style={{
          width: 92,
          height: 92,
          borderRadius: 46,
          backgroundColor: theme.surfaceContainer,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.lg,
        }}
      >
        <Icon name={ICONS.fingerprint} size={46} color={theme.primary} />
      </View>
      <M3Text role="headlineMedium" color={theme.onSurface} style={{ marginBottom: space.xs }}>
        {t('settings.biometricLocked')}
      </M3Text>
      <M3Text
        role="bodyMedium"
        color={theme.onSurfaceVariant}
        style={{ marginBottom: space.xl, textAlign: 'center', maxWidth: 300 }}
      >
        {t(hintKey)}
      </M3Text>
      <PrimaryButton
        label={t('settings.biometricUnlock')}
        onPress={prompt}
        loading={busy}
        fullWidth
        style={{ maxWidth: 320 }}
      />
    </View>
  );
}
