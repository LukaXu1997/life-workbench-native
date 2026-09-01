// 生物识别诊断与错误映射（V2.3.3 重写）。
//
// 设计原则（用户明确要求）：
//  · 不把一切失败统一提示为「当前设备暂未设置面容或指纹」。
//  · 分别执行并**仅记录非敏感结果**：是否有硬件 / 支持哪些类型 / 是否已录入 /
//    enrolledLevel / 最后一次认证错误码。绝不记录任何指纹、人脸或设备凭据数据。
//  · 正确的检查顺序：hasHardware → supportedTypes → isEnrolled → getEnrolledLevel
//    →（条件满足后）authenticateAsync → 捕获 authenticateAsync 返回的**具体** error。
//  · Android 生物识别不是普通运行时授权，不需要弹权限申请框；USE_BIOMETRIC 已在
//    Manifest 声明并随 APK 打包，原生模块与 AndroidX BiometricPrompt 均已就绪。
//
// 参照：expo-local-authentication@16.0.5
//  · AuthenticationType: FINGERPRINT=1, FACIAL_RECOGNITION=2, IRIS=3
//  · SecurityLevel:     NONE=0, SECRET=1, BIOMETRIC_WEAK=2, BIOMETRIC_STRONG=3
//  · LocalAuthenticationError 14 个字面量（见 mapAuthError）

// ⚠️ expo-local-authentication@16.0.5 的 build/LocalAuthentication.js **只有具名导出，
// 没有 export default**。若写成 `import LocalAuthentication from 'expo-local-authentication'`，
// 运行时 LocalAuthentication === undefined，调用 .hasHardwareAsync() 会抛 TypeError，
// 并被诊断的 try/catch 误记为 native_unavailable（这正是 V2.3.2/2.3.3 的真实根因）。
// 因此必须使用命名空间导入。
import * as LocalAuthentication from 'expo-local-authentication';
import { AuthenticationType, SecurityLevel } from 'expo-local-authentication';

export type BiometricSecurityPref = 'standard' | 'high';

/** 原生 authenticateAsync 使用的 Android 安全级别。 */
export function securityLevelFor(pref: BiometricSecurityPref): 'weak' | 'strong' {
  // standard 允许弱识别（部分 Android 人脸属弱识别），兼容性最好；
  // high 仅允许强识别或设备密码。
  return pref === 'high' ? 'strong' : 'weak';
}

/**
 * 启动期诊断结果（全部为非敏感标量，可安全展示与持久化）。
 * 调用任何一项抛错时，记录 error 标记，其余字段保持默认值。
 */
export interface BiometricDiagnostics {
  hasHardware: boolean;
  /** 系统向本 App 暴露的生物识别类型（指纹/面容/虹膜）。空数组表示系统未提供可用方式。 */
  supportedTypes: AuthenticationType[];
  /** 设备是否已录入可供 App 使用的生物识别。 */
  isEnrolled: boolean;
  /** 已录入生物识别的安全等级。 */
  enrolledLevel: SecurityLevel;
  /** 诊断过程中原生模块不可用或发生异常。 */
  error?: 'native_unavailable' | 'exception' | 'module_missing';
  /** 最后一次失败的底层原因（仅供诊断区展示，非敏感）。 */
  errorDetail?: string;
}

/** 启动期「是否可用于应用锁」的支持分类（不含认证时的临时锁定等运行时错误）。 */
export type BiometricSupportKind =
  | 'ok' // 设备可用、已录入、可用于应用锁
  | 'no_hardware' // 无生物识别硬件
  | 'no_supported_types' // 有硬件但系统未向 App 提供可用类型（如人脸仅用于解锁手机）
  | 'only_device_credential' // 有硬件与类型，但未录入任何生物识别，仅剩系统锁屏密码
  | 'face_weak_only' // 仅录入弱人脸（如 2D 人脸），第三方 App 支持有限
  | 'native_unavailable' // 原生模块不可用
  | 'module_missing' // JS 侧未取到 expo-local-authentication 导出（打包/引用问题）
  | 'exception'; // 诊断调用异常

/**
 * 依次执行 4 项诊断。每一项独立 try/catch，互不连坐；
 * 任一项抛错只影响该项结果，整体仍返回结构化诊断对象。
 */
export async function getBiometricDiagnostics(): Promise<BiometricDiagnostics> {
  const base: BiometricDiagnostics = {
    hasHardware: false,
    supportedTypes: [],
    isEnrolled: false,
    enrolledLevel: SecurityLevel.NONE,
  };

  // 守卫：先确认 JS 侧确实拿到了模块导出。若这里失败，属于打包/引用错误，
  // 与「设备没有硬件」或「原生模块不可用」是完全不同的问题，必须分开提示。
  if (typeof LocalAuthentication?.hasHardwareAsync !== 'function') {
    base.error = 'module_missing';
    base.errorDetail = 'expo-local-authentication export not found';
    return base;
  }

  try {
    base.hasHardware = await LocalAuthentication.hasHardwareAsync();
  } catch (e) {
    base.error = 'native_unavailable';
    base.errorDetail = e instanceof Error ? e.message : String(e);
    return base;
  }

  try {
    base.supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
  } catch (e) {
    base.error = 'exception';
    base.errorDetail = e instanceof Error ? e.message : String(e);
  }

  try {
    base.isEnrolled = await LocalAuthentication.isEnrolledAsync();
  } catch (e) {
    base.error = 'exception';
    base.errorDetail = e instanceof Error ? e.message : String(e);
  }

  try {
    base.enrolledLevel = await LocalAuthentication.getEnrolledLevelAsync();
  } catch {
    // getEnrolledLevel 失败不影响其余结论，仅 level 保持 NONE
  }

  return base;
}

/** 将诊断结果归类为支持分类（用于设置页准确提示，而非统一「未设置」）。 */
export function supportKind(d: BiometricDiagnostics): BiometricSupportKind {
  if (d.error === 'module_missing') return 'module_missing';
  if (d.error === 'native_unavailable') return 'native_unavailable';
  if (d.error === 'exception') return 'exception';
  if (!d.hasHardware) return 'no_hardware';
  if (d.supportedTypes.length === 0) return 'no_supported_types';
  if (!d.isEnrolled) return 'only_device_credential';
  // 已录入且系统提供了类型
  const onlyFace =
    d.supportedTypes.length === 1 &&
    d.supportedTypes[0] === AuthenticationType.FACIAL_RECOGNITION;
  if (onlyFace && d.enrolledLevel === SecurityLevel.BIOMETRIC_WEAK) {
    return 'face_weak_only';
  }
  return 'ok';
}

/**
 * 该设备在给定的安全级别下是否可真正用于应用锁（即是否应锁定屏幕）。
 *  · standard(weak)：有硬件 + 有类型 + 已录入 即可（弱人脸也可）。
 *  · high(strong)：在上述基础上还要求 enrolledLevel 为 BIOMETRIC_STRONG。
 * 不可用时返回 false → 网关自动放行，绝不把用户锁在外面。
 */
export function isEligible(d: BiometricDiagnostics, level: 'weak' | 'strong'): boolean {
  if (d.error) return false;
  if (!d.hasHardware || d.supportedTypes.length === 0 || !d.isEnrolled) return false;
  if (level === 'strong' && d.enrolledLevel !== SecurityLevel.BIOMETRIC_STRONG) return false;
  return true;
}

/** 设置页「是否允许开启应用锁」：弱级别下可用即允许（覆盖 ok 与 face_weak_only）。 */
export function canEnableBiometric(d: BiometricDiagnostics): boolean {
  if (d.error) return false;
  return d.hasHardware && d.supportedTypes.length > 0 && d.isEnrolled;
}

/** 认证后具体错误分类（锁屏按此显示不同文案）。 */
export type BiometricAuthKind =
  | 'success'
  | 'user_cancel' // 用户 / 系统 / App 取消
  | 'auth_failed' // 验证失败
  | 'locked' // 系统临时锁定
  | 'not_enrolled' // 未录入
  | 'not_available' // 当前识别方式不受第三方 App 支持（如仅手机解锁人脸）
  | 'passcode_not_set' // 未设置设备锁屏密码
  | 'exception'; // 其他 / 调用异常

/** 将 authenticateAsync 返回的 LocalAuthenticationError 映射到具体分类。 */
export function mapAuthError(error?: string): BiometricAuthKind {
  switch (error) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return 'user_cancel';
    case 'authentication_failed':
      return 'auth_failed';
    case 'lockout':
      return 'locked';
    case 'not_enrolled':
      return 'not_enrolled';
    case 'not_available':
      return 'not_available';
    case 'passcode_not_set':
      return 'passcode_not_set';
    // invalid_context / unable_to_process / timeout / no_space / unknown /
    // user_fallback / 其它或未定义 → 统一归为异常
    default:
      return 'exception';
  }
}

/**
 * 设置页「启用 / 关闭应用锁前」的一次性验证助手。
 * 成功返回 true；用户取消 / 验证失败 / 异常 均返回 false。
 * 用于：打开「进入 App 时验证」前必须先验证一次，验证成功才保存为开启；
 *      关闭时也必须再次验证，不能直接关闭。
 */
export async function verifyNow(opts?: {
  security?: BiometricSecurityPref;
  deviceFallback?: boolean;
  promptMessage?: string;
  cancelLabel?: string;
  fallbackLabel?: string;
}): Promise<boolean> {
  if (typeof LocalAuthentication?.authenticateAsync !== 'function') return false;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: opts?.promptMessage ?? '验证身份以继续',
      cancelLabel: opts?.cancelLabel ?? '取消',
      fallbackLabel: opts?.fallbackLabel ?? '使用锁屏密码',
      disableDeviceFallback: !opts?.deviceFallback,
      biometricsSecurityLevel: securityLevelFor(opts?.security ?? 'standard'),
    });
    return !!r.success;
  } catch {
    return false;
  }
}

export { AuthenticationType, SecurityLevel };
