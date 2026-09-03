import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  TextInput,
  TextInputProps,
  TextProps,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { typeRole, TypeRole } from '../typography';
import { radius, elevation, touchMin } from '../tokens';
import { Icon, ICONS } from '../icons';

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

// Per-role ceiling on the system font-scale multiplier that RN may apply.
// Larger roles (display/headline) get a tighter cap so they never blow past the
// container; small labels get a looser cap, allowing accessibility zoom while
// still preventing the tab bar / quick tiles from clipping at extreme scales.
const MAX_FONT_SCALE: Record<TypeRole, number> = {
  displaySmall: 1.3,
  headlineMedium: 1.3,
  titleLarge: 1.4,
  titleMedium: 1.4,
  bodyLarge: 1.5,
  bodyMedium: 1.5,
  labelLarge: 1.3,
  labelMedium: 1.25,
  labelSmall: 1.2,
};

// Inter (bundled via @expo-google-fonts/inter). Family names are weight-specific,
// so map the M3 weight onto the correct file. If the font isn't loaded yet, RN
// gracefully falls back to the system font (no crash).
const INTER_FAMILY: Record<string, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
};

export function M3Text({
  role = 'bodyMedium',
  color,
  style,
  numberOfLines,
  maxFontSizeMultiplier,
  children,
  ...rest
}: {
  role?: TypeRole;
  color?: string;
  /** StyleProp（而不是裸 TextStyle）——允许 style={[TNUM, { marginTop: 2 }]} 这类组合 */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /**
   * Override the per-role system-font-scale ceiling. By default RN scales text once
   * with the system font scale (allowFontScaling), capped at MAX_FONT_SCALE[role].
   * Pass a number to tighten/loosen the cap per caller.
   */
  maxFontSizeMultiplier?: number;
  children: React.ReactNode;
} & Omit<TextProps, 'role' | 'style'>) {
  const { theme } = useTheme();
  const t = typeRole(role);
  const cap = maxFontSizeMultiplier ?? MAX_FONT_SCALE[role];
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={cap}
      style={[
        {
          fontFamily: INTER_FAMILY[t.fontWeight] ?? 'Inter_400Regular',
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          fontWeight: t.fontWeight,
          letterSpacing: t.letterSpacing ?? 0,
          color: color ?? theme.onSurface,
        },
        style,
      ]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ */
/* AutoFitAmount — 自适应金额文本                                       */
/*                                                                     */
/* §一.4 大金额在窄屏/大字体下必须「不换行、不裁切」。                    */
/* 通过 onTextLayout 检测单行是否被截断：若截断则把字号逐步 -2 直到放下   */
/* （minFont 兜底）。位数减少时先回到 maxFont，再交由布局决定是否需要重缩。 */
/* 默认开启 tabular-nums，数字变化时字距稳定、不左右跳动。               */
/* （iOS 的 adjustsFontSizeToFit 在 Android 上是 no-op，这里跨平台统一。）  */
/* ------------------------------------------------------------------ */

export function AutoFitAmount({
  text,
  maxFont = 34,
  minFont = 13,
  color,
  weight = '600',
  tabular = true,
  style,
  maxFontSizeMultiplier = 1.2,
  accessibilityLabel,
}: {
  text: string;
  maxFont?: number;
  minFont?: number;
  color?: string;
  weight?: '400' | '500' | '600' | '700';
  tabular?: boolean;
  style?: StyleProp<TextStyle>;
  maxFontSizeMultiplier?: number;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const [fontSize, setFontSize] = useState(maxFont);
  const prevLen = useRef(text.length);

  // 位数减少时先回到最大字号，再由 onTextLayout 决定是否需要再缩
  useEffect(() => {
    if (text.length < prevLen.current) setFontSize(maxFont);
    prevLen.current = text.length;
  }, [text, maxFont]);

  return (
    <M3Text
      numberOfLines={1}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      accessibilityLabel={accessibilityLabel}
      onTextLayout={(e) => {
        const lines = e.nativeEvent.lines;
        const truncated = lines.length > 1 || (lines.length > 0 && lines[0].text.length < text.length);
        if (truncated && fontSize > minFont) {
          setFontSize((f) => Math.max(minFont, f - 2));
        }
      }}
      style={[
        {
          fontSize,
          lineHeight: Math.round(fontSize * 1.12),
          fontWeight: weight,
          color: color ?? theme.onSurface,
          // 大数字按比例收紧字距（~0.015em），与 M3Text 标题负字距同源，
          // 让金额数字与周围标签观感一致（Notion 招牌细节）。
          letterSpacing: -(fontSize * 0.015),
        },
        tabular ? { fontVariant: ['tabular-nums' as const] } : null,
        style,
      ]}
    >
      {text}
    </M3Text>
  );
}

/* ------------------------------------------------------------------ */
/* Surface (M3 layering via container colors, minimal elevation)       */
/* ------------------------------------------------------------------ */

export function Surface({
  level = 0,
  style,
  onTap,
  children,
}: {
  level?: 0 | 1 | 2 | 3;
  style?: ViewStyle;
  onTap?: () => void;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const bg =
    level === 0
      ? theme.surface
      : level === 1
        ? theme.surfaceContainerLow
        : level === 2
          ? theme.surfaceContainer
          : theme.surfaceContainerHigh;
  const elev = (elevation as any)[level] || {};
  const content = (
    <View style={[{ backgroundColor: bg }, elev, style]}>{children}</View>
  );
  if (onTap) return <TouchableOpacity activeOpacity={0.98} onPress={onTap}>{content}</TouchableOpacity>;
  return content;
}

/* ------------------------------------------------------------------ */
/* Top app bar (M3) — optional blur for scrolled/transparent header     */
/* ------------------------------------------------------------------ */

export function TopAppBar({
  title,
  subtitle,
  onBack,
  actions,
  blur,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  blur?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: insets.top + 10,
        paddingBottom: 10,
        backgroundColor: blur ? 'transparent' : theme.bg,
        borderBottomWidth: blur ? 0 : StyleSheet.hairlineWidth,
        borderColor: theme.divider,
      }}
    >
      {onBack ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={{ minWidth: touchMin, minHeight: touchMin, marginRight: 4, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={ICONS.back} size={24} color={theme.onSurface} />
        </TouchableOpacity>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {subtitle ? <M3Text role="labelMedium" color={theme.onSurfaceVariant}>{subtitle}</M3Text> : null}
        <M3Text role="titleLarge" numberOfLines={1}>{title}</M3Text>
      </View>
      {actions}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* FAB                                                                 */
/* ------------------------------------------------------------------ */

export function FAB({
  icon = ICONS.add,
  label,
  onPress,
}: {
  icon?: string;
  label?: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label || t('common.new')}
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        position: 'absolute',
        right: 16,
        bottom: insets.bottom + 72,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: theme.primary,
        borderRadius: radius.pill,
        paddingVertical: 16,
        paddingHorizontal: label ? 20 : 16,
        minHeight: 56,
        elevation: 2,
      }}
    >
      <Icon name={icon} size={24} color={theme.onPrimary} />
      {label ? <M3Text role="labelLarge" color={theme.onPrimary}>{label}</M3Text> : null}
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Snackbar (used for undo after complete/delete)                       */
/* ------------------------------------------------------------------ */

export function Snackbar({
  message,
  actionLabel,
  onAction,
  style,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 24,
          backgroundColor: theme.surfaceContainerHigh,
          borderRadius: radius.md,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          elevation: 3,
        },
        style,
      ]}
    >
      <M3Text role="bodyMedium" color={theme.onSurface} style={{ flex: 1 }} numberOfLines={1}>
        {message}
      </M3Text>
      {actionLabel ? (
        <TouchableOpacity accessibilityRole="button" onPress={onAction}>
          <M3Text role="labelLarge" color={theme.primary}>{actionLabel}</M3Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Chip (filters / categories / priority)                               */
/* ------------------------------------------------------------------ */

export function Chip({
  label,
  selected,
  onPress,
  icon,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string;
  color?: string;
}) {
  const { theme } = useTheme();
  const sel = !!selected;
  const fg = sel ? theme.onPrimaryContainer : color || theme.onSurfaceVariant;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: sel }}
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        backgroundColor: sel ? theme.primaryContainer : theme.surfaceContainer,
        borderWidth: sel ? StyleSheet.hairlineWidth : 0,
        borderColor: sel ? theme.outline : undefined,
        minHeight: 32,
      }}
    >
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <M3Text role="labelMedium" color={fg}>{label}</M3Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Switch                                                               */
/* ------------------------------------------------------------------ */

export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const { theme, isDark } = useTheme();

  // ── Notion-style dimensions ───────────────────────────────────────────────
  // A compact, flat pill: 40×24 track, 20px thumb, 2px inset. The touch target
  // is expanded to touchMin (≥44) for a11y without enlarging the visual.
  const TRACK_W = 40;
  const TRACK_H = 24;
  const THUMB = 20;
  const PAD = (TRACK_H - THUMB) / 2; // 2
  const OFF_X = PAD;
  const ON_X = TRACK_W - THUMB - PAD;

  // Off-track: a soft neutral grey (Notion off = ~#E9E9E7 light / faint white dark).
  // On-track: the app's near-black primary (light) / white (dark) — same token the
  // rest of the app uses for "selected / on".
  const OFF_TRACK = disabled
    ? isDark
      ? 'rgba(255,255,255,0.10)'
      : 'rgba(0,0,0,0.08)'
    : isDark
    ? 'rgba(255,255,255,0.20)'
    : '#E9E9E7';
  const ON_TRACK = disabled
    ? isDark
      ? 'rgba(255,255,255,0.12)'
      : 'rgba(0,0,0,0.10)'
    : theme.primary;
  // Thumb uses onPrimary so it always contrasts: white thumb on the dark/near-black
  // ON track (light) and dark thumb on the white ON track (dark).
  const THUMB_COLOR = disabled
    ? isDark
      ? 'rgba(255,255,255,0.35)'
      : 'rgba(0,0,0,0.25)'
    : theme.onPrimary;
  const THUMB_BORDER = theme.outline;

  const [anim] = useState(() => new Animated.Value(value ? 1 : 0));
  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 200,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [OFF_X, ON_X] });
  const trackBg = anim.interpolate({ inputRange: [0, 1], outputRange: [OFF_TRACK, ON_TRACK] });

  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      activeOpacity={0.85}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={{
        width: touchMin,
        height: touchMin,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={{
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          backgroundColor: trackBg,
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: THUMB_COLOR,
            borderWidth: 1,
            borderColor: THUMB_BORDER,
            transform: [{ translateX }],
            // hairline depth — keeps the flat Notion look but lifts the thumb
            shadowColor: '#0F0F0F',
            shadowOpacity: 0.18,
            shadowRadius: 1.5,
            shadowOffset: { width: 0, height: 0.5 },
            elevation: 1,
          }}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* EyeToggle — inline hide/show-balance control for the balance hero   */
/* ------------------------------------------------------------------ */

// Notion-flavoured balance reveal: a single, muted-neutral eye icon that lives
// *next to* the amount it controls (not a switch buried in Settings). State is
// conveyed purely by the glyph (eye ↔ eye-off); we deliberately avoid a loud
// "on" colour so it stays quiet and recessive like the rest of the UI.
export function EyeToggle({
  hidden,
  onToggle,
  size = 20,
  accessibilityLabel,
}: {
  hidden: boolean;
  onToggle: () => void;
  size?: number;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const color = theme.onSurfaceVariant;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ checked: !hidden }}
      accessibilityLabel={accessibilityLabel}
      onPress={onToggle}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      activeOpacity={0.5}
      style={{
        width: touchMin,
        height: touchMin,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
      }}
    >
      <Icon name={hidden ? ICONS.eyeOff : ICONS.eye} size={size} color={color} />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* TextField (currency prefix, numeric keyboard, error state, a11y)     */
/* ------------------------------------------------------------------ */

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  prefix,
  trailing,
  error,
  multiline,
  numberOfLines,
  secureTextEntry,
  style,
  inputRef,
  ...rest
}: {
  label?: string;
  value?: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  keyboardType?: TextInputProps['keyboardType'];
  prefix?: string;
  trailing?: React.ReactNode;
  error?: string;
  multiline?: boolean;
  numberOfLines?: number;
  secureTextEntry?: boolean;
  style?: ViewStyle;
  inputRef?: React.RefObject<TextInput>;
} & TextInputProps) {
  const { theme } = useTheme();
  return (
    <View style={style}>
      {label ? <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>{label}</M3Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? theme.error : theme.divider,
          borderRadius: radius.md,
          backgroundColor: theme.surface,
          paddingHorizontal: 12,
          minHeight: touchMin,
        }}
      >
        {prefix ? <M3Text role="bodyLarge" color={theme.onSurfaceVariant} style={{ marginRight: 6 }}>{prefix}</M3Text> : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.onSurfaceVariant}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          numberOfLines={numberOfLines}
          style={{
            flex: 1,
            fontSize: 16,
            color: theme.onSurface,
            paddingVertical: 12,
            minHeight: multiline ? 20 * (numberOfLines || 3) : undefined,
          }}
          {...rest}
        />
        {trailing}
      </View>
      {error ? <M3Text role="labelSmall" color={theme.error} style={{ marginTop: 4 }}>{error}</M3Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Progress indicators                                                  */
/* ------------------------------------------------------------------ */

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
}

export function ProgressIndicator({
  pct,
  color,
  trackColor,
}: {
  pct: number;
  color?: string;
  trackColor?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ height: 6, backgroundColor: trackColor || theme.surfaceContainer, borderRadius: radius.pill, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${clampPct(pct)}%`, backgroundColor: color || theme.primary, borderRadius: radius.pill }} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* State views: empty / loading / error / offline                       */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = ICONS.inbox,
  title,
  hint,
}: {
  icon?: string;
  title?: string;
  hint?: string;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const titleText = title ?? t('common.empty');
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', paddingHorizontal: 24 }}>
      <Icon name={icon} size={40} color={theme.onSurfaceVariant} />
      <M3Text role="titleMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12 }}>{titleText}</M3Text>
      {hint ? <M3Text role="bodyMedium" color={theme.t3} style={{ marginTop: 6, textAlign: 'center' }}>{hint}</M3Text> : null}
    </View>
  );
}

export function LoadingState({ hint }: { hint?: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const hintText = hint ?? t('common.loading');
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.primary} />
      <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: 12 }}>{hintText}</M3Text>
    </View>
  );
}

export function ErrorState({
  title,
  hint,
  onRetry,
}: {
  title?: string;
  hint?: string;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const titleText = title ?? t('common.errorTitle');
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', paddingHorizontal: 24 }}>
      <Icon name={ICONS.warning} size={40} color={theme.error} />
      <M3Text role="titleMedium" color={theme.onSurface} style={{ marginTop: 12 }}>{titleText}</M3Text>
      {hint ? <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: 6, textAlign: 'center' }}>{hint}</M3Text> : null}
      {onRetry ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onRetry}
          style={{ marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.md, backgroundColor: theme.primaryContainer, minHeight: touchMin, alignItems: 'center', justifyContent: 'center' }}
        >
          <M3Text role="labelLarge" color={theme.onPrimaryContainer}>{t('common.retry')}</M3Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function OfflineState({ hint }: { hint?: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const hintText = hint ?? t('common.offlineHint');
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', paddingHorizontal: 24 }}>
      <Icon name={ICONS.wifiOff} size={40} color={theme.onSurfaceVariant} />
      <M3Text role="titleMedium" color={theme.onSurface} style={{ marginTop: 12 }}>{t('common.offlineTitle')}</M3Text>
      <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: 6, textAlign: 'center' }}>{hintText}</M3Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Legacy components (kept for backward compatibility during migration) */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  style,
  onTap,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onTap?: () => void;
}) {
  const { theme } = useTheme();
  const content = (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: theme.r3,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onTap) return <TouchableOpacity activeOpacity={0.97} onPress={onTap}>{content}</TouchableOpacity>;
  return content;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <M3Text role="titleMedium">{children}</M3Text>
      {right}
    </View>
  );
}

/** @deprecated Use TopAppBar for new screens. Kept for current screens. */
export function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 14,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.divider,
        backgroundColor: theme.bg,
      }}
    >
      <View>
        {subtitle ? (
          <M3Text role="labelMedium" color={theme.t2}>{subtitle}</M3Text>
        ) : null}
        <M3Text role="titleLarge" style={{ marginTop: subtitle ? 2 : 0 }}>{title}</M3Text>
      </View>
      {right}
    </View>
  );
}

export function Segmented<T extends string>({
  segments,
  active,
  onChange,
  style,
}: {
  segments: { key: T; label: string }[];
  active: T;
  onChange: (k: T) => void;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          width: '100%',
          backgroundColor: theme.surfaceContainer,
          borderRadius: radius.md,
          padding: 3,
          gap: 3,
        },
        style,
      ]}
    >
      {segments.map((s) => {
        const isActive = s.key === active;
        return (
          <TouchableOpacity
            key={s.key}
            onPress={() => onChange(s.key)}
            style={{
              flex: 1,
              minWidth: 0,
              flexShrink: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 7,
              borderRadius: radius.sm,
              backgroundColor: isActive ? theme.primaryContainer : 'transparent',
            }}
          >
            <M3Text role="labelLarge" color={isActive ? theme.onPrimaryContainer : theme.onSurfaceVariant} numberOfLines={1}>
              {s.label}
            </M3Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <M3Text role="bodyMedium" color={theme.t2}>{label}</M3Text>
      <M3Text role="bodyMedium" color={valueColor || theme.text} style={{ fontWeight: '600' }}>{value}</M3Text>
    </View>
  );
}

export function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 8 }}>
      <Text allowFontScaling={false} style={{ fontSize: 10, fontWeight: '600', color }}>{text}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'ghost',
  style,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'tonal' | 'ghost' | 'text' | 'danger';
  style?: ViewStyle;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const isTonal = variant === 'tonal';
  const isText = variant === 'text';
  const isDanger = variant === 'danger';
  const isPrimary = variant === 'primary';
  const bg = isPrimary ? theme.primary : isTonal ? theme.primaryContainer : isDanger ? theme.error : 'transparent';
  const fg = isPrimary
    ? theme.onPrimary
    : isTonal
      ? theme.onPrimaryContainer
      : isDanger
        ? theme.onError
        : isText
          ? theme.primary
          : theme.onSurface;
  const bordered = variant === 'ghost';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? () => {} : onPress}
      activeOpacity={disabled ? 1 : 0.85}
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: touchMin,
          borderRadius: radius.md,
          paddingHorizontal: 16,
          backgroundColor: bg,
          borderWidth: bordered ? 1 : 0,
          borderColor: bordered ? theme.outline : 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <M3Text role="labelLarge" color={fg}>{label}</M3Text>
    </TouchableOpacity>
  );
}

export function ListRow({
  left,
  title,
  subtitle,
  right,
  onTap,
  onLongPress,
  style,
  accessibilityLabel,
}: {
  left?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onTap?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const inner = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: theme.divider,
          minHeight: touchMin,
        },
        style,
      ]}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <M3Text role="bodyLarge" numberOfLines={1}>{title}</M3Text>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <M3Text role="labelMedium" color={theme.t3} style={{ marginTop: 2 }} numberOfLines={1}>{subtitle}</M3Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {right}
    </View>
  );
  if (onTap || onLongPress)
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        activeOpacity={0.6}
        onPress={onTap}
        onLongPress={onLongPress}
      >
        {inner}
      </TouchableOpacity>
    );
  return inner;
}

/** @deprecated Use ProgressIndicator. Kept for current screens. */
export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ height: 5, backgroundColor: theme.divider, borderRadius: 3, marginTop: 9, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${clampPct(pct)}%`, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

/** @deprecated Use EmptyState. Kept for current screens. */
export function EmptyHint({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ paddingVertical: 36, alignItems: 'center' }}>
      <Text style={{ fontSize: 13, color: theme.t3, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

export function IconTile({ children, bg, color }: { children: React.ReactNode; bg?: string; color?: string }) {
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: radius.sm,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children && typeof children === 'object' ? (
        children
      ) : (
        <Text allowFontScaling={false} style={{ fontSize: 15, color }}>{children as string}</Text>
      )}
    </View>
  );
}

export function IconButton({
  name,
  size = 20,
  color,
  bg,
  onPress,
  accessibilityLabel,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  bg?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[
        {
          width: 36,
          height: 36,
          borderRadius: radius.pill,
          backgroundColor: bg ?? 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color ?? theme.onSurfaceVariant} />
    </TouchableOpacity>
  );
}

const _ = StyleSheet.create({});
export type { TextStyle };
