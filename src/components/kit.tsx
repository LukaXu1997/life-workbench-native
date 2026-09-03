import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ViewStyle,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator as RNActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { M3Text } from './ui';
import { Icon, ICONS } from '../icons';
import { radius, elevation, space, pageMargin, cardGap, touchMin, controlMinH } from '../tokens';

/* ------------------------------------------------------------------ */
/* ScreenHeader — personalized welcome, date, pending + avatar/bell   */
/* ------------------------------------------------------------------ */

export function ScreenHeader({
  title,
  subtitle,
  pendingCount = 0,
  onNotification,
  onAvatar,
  avatarLabel,
  action,
  onBack,
}: {
  title: string;
  subtitle?: string;
  pendingCount?: number;
  onNotification?: () => void;
  onAvatar?: () => void;
  avatarLabel?: string;
  action?: React.ReactNode;
  /**
   * §二 二级页面返回按钮。传入即渲染左侧 48×48 返回键，
   * 标题同时降一级（titleLarge），以区分一级页面的 headlineMedium。
   */
  onBack?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: pageMargin,
        paddingTop: insets.top + 14,
        paddingBottom: 8,
        backgroundColor: theme.bg,
      }}
    >
      {onBack ? (
        <IconButton
          name={ICONS.back}
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={{ marginLeft: -12, marginRight: 2 }}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <M3Text role={onBack ? 'titleLarge' : 'headlineMedium'} numberOfLines={1}>
          {title}
        </M3Text>
        {subtitle ? (
          <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </M3Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingTop: 2 }}>
        {action}
        {onNotification ? (
          <IconButton
            name={ICONS.bell}
            accessibilityLabel={t('common.notification')}
            badge={pendingCount > 0 ? pendingCount : undefined}
            onPress={onNotification}
          />
        ) : null}
        {onAvatar ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={avatarLabel || t('tabs.settings')}
            onPress={onAvatar}
            activeOpacity={0.85}
            style={{
              minWidth: touchMin,
              minHeight: touchMin,
              width: 40,
              height: 40,
              borderRadius: radius.pill,
              backgroundColor: theme.primaryContainer,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4,
            }}
          >
            <Icon name={ICONS.mood} size={20} color={theme.onPrimaryContainer} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Card / PrimaryCard — white rounded cards, weak border, light shadow */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  style,
  onTap,
  padding = space.lg,
  level = 0,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onTap?: () => void;
  padding?: number;
  level?: 0 | 1 | 2;
}) {
  const { theme, isDark } = useTheme();
  // level=1 == "recessed / inset" surface (see HomeScreen today-plan card).
  // M3 container tones flip between light & dark: a recessed surface is DARKER than
  // its parent in both modes, but the token order inverts — surfaceContainerHigh is
  // darker than `surface` in light (correct inset) yet lighter than `surface` in dark
  // (would read as RAISED). So in dark we drop to the page bg to keep the inset look.
  const bg =
    level === 0
      ? theme.surface
      : level === 1
        ? isDark
          ? theme.bg
          : theme.surfaceContainerHigh
        : theme.surfaceContainer;
  const content = (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.card,
          padding,
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

export function PrimaryCard({
  children,
  style,
  onTap,
  padding = space.lg,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onTap?: () => void;
  padding?: number;
}) {
  const { theme } = useTheme();
  const content = (
    <View
      style={[
        {
          backgroundColor: theme.primaryContainer,
          borderRadius: radius.card,
          padding,
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

/* ------------------------------------------------------------------ */
/* Section header inside a card                                        */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  icon,
  title,
  actionLabel,
  onAction,
}: {
  icon?: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Icon name={icon} size={20} color={theme.primary} /> : null}
        <M3Text role="titleMedium">{title}</M3Text>
      </View>
      {onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel || t('common.viewAll')}
          onPress={onAction}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <M3Text role="labelLarge" color={theme.primary}>
            {actionLabel || t('common.viewAll')}
          </M3Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* IconButton — 48x48 min, circular, optional filled bg, optional badge */
/* ------------------------------------------------------------------ */

export function IconButton({
  name,
  size = 22,
  color,
  bg,
  onPress,
  accessibilityLabel,
  badge,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  bg?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  badge?: number;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        {
          width: touchMin,
          height: touchMin,
          borderRadius: radius.pill,
          backgroundColor: bg ?? 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color ?? theme.onSurfaceVariant} />
      {badge != null && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: theme.error,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: theme.onError, fontSize: 10, fontWeight: '700' }}>
            {badge > 99 ? '99+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* ActionTile — quick action (记账 / 待办 / 习惯 / 速记)                */
/* ------------------------------------------------------------------ */

export function ActionTile({
  icon,
  label,
  onPress,
  color,
  style,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  color?: string;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const fg = color || theme.primary;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 14,
          paddingHorizontal: 6,
          backgroundColor: theme.surface,
          borderRadius: radius.lg,
          minHeight: 76,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: theme.primaryContainer,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <Icon name={icon} size={22} color={fg} />
      </View>
      <M3Text role="labelLarge" numberOfLines={1} style={{ textAlign: 'center' }}>
        {label}
      </M3Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* ListItem — unified list row (leading / title / subtitle / trailing)  */
/* ------------------------------------------------------------------ */

export function ListItem({
  leading,
  title,
  subtitle,
  trailing,
  onTap,
  onLongPress,
  divider = true,
  accessibilityLabel,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onTap?: () => void;
  onLongPress?: () => void;
  divider?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderColor: theme.divider,
        minHeight: touchMin,
      }}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <M3Text role="bodyLarge" numberOfLines={1}>{title}</M3Text>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </M3Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {trailing}
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

/* ------------------------------------------------------------------ */
/* ListGroup / NavRow — 分组列表（§三 「我的」、§十 少卡片多留白）        */
/* ------------------------------------------------------------------ */

/**
 * 分组列表容器。一个 group = 一块 surface + 若干 NavRow + 细分隔线。
 * 刻意不加 border 和 shadow（§十：不同时使用边框+底色+阴影），
 * 层级只靠 surface 与页面 bg 的色差 + 分组标题的留白建立。
 */
export function ListGroup({
  title,
  children,
  style,
  footer,
}: {
  title?: string;
  children?: React.ReactNode;
  style?: ViewStyle;
  footer?: string;
}) {
  const { theme } = useTheme();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ marginBottom: cardGap }, style]}>
      {title ? (
        <M3Text
          role="labelMedium"
          color={theme.onSurfaceVariant}
          style={{ marginBottom: space.sm, marginLeft: space.xs }}
        >
          {title}
        </M3Text>
      ) : null}
      {rows.length > 0 ? (
        <View style={{ backgroundColor: theme.surface, borderRadius: radius.card, overflow: 'hidden' }}>
          {rows.map((child, i) => (
            <View key={i}>
              {i > 0 ? (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: theme.divider,
                    marginLeft: 52,
                  }}
                />
              ) : null}
              {child}
            </View>
          ))}
        </View>
      ) : null}
      {footer ? (
        <M3Text
          role="labelSmall"
          color={theme.onSurfaceVariant}
          style={{ marginTop: space.sm, marginLeft: space.xs, lineHeight: 16 }}
        >
          {footer}
        </M3Text>
      ) : null}
    </View>
  );
}

/**
 * 分组列表中的一行：线性图标 + 标题(+副标题) + 右侧值/徽标 + chevron。
 * 高度 ≥52dp，整行可点（触达远大于 48×48）。
 */
export function NavRow({
  icon,
  title,
  subtitle,
  value,
  badge,
  onPress,
  danger,
  trailing,
  accessibilityLabel,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  value?: string;
  badge?: number;
  onPress?: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const fg = danger ? theme.error : theme.onSurface;
  const iconColor = danger ? theme.error : theme.onSurfaceVariant;

  const body = (
    <>
      {icon ? (
        <View style={{ width: 24, alignItems: 'center' }}>
          <Icon name={icon} size={22} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <M3Text role="bodyLarge" color={fg} numberOfLines={1}>
          {title}
        </M3Text>
        {subtitle ? (
          <M3Text
            role="labelMedium"
            color={theme.onSurfaceVariant}
            numberOfLines={2}
            style={{ marginTop: 1 }}
          >
            {subtitle}
          </M3Text>
        ) : null}
      </View>
      {badge && badge > 0 ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            paddingHorizontal: 6,
            backgroundColor: theme.error,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <M3Text role="labelSmall" style={{ color: theme.onError, fontSize: 11, lineHeight: 14 }}>
            {badge > 99 ? '99+' : String(badge)}
          </M3Text>
        </View>
      ) : null}
      {value ? (
        <M3Text role="labelLarge" color={theme.onSurfaceVariant} numberOfLines={1}>
          {value}
        </M3Text>
      ) : null}
      {trailing !== undefined
        ? trailing
        : onPress
          ? <Icon name={ICONS.chevronRight} size={20} color={theme.onSurfaceVariant} />
          : null}
    </>
  );

  const rowStyle = {
    minHeight: 52,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
  };

  if (!onPress) return <View style={rowStyle}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      style={({ pressed }) => [
        rowStyle,
        { backgroundColor: pressed ? theme.surfaceContainer : 'transparent' },
      ]}
    >
      {body}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* TextField — min height 52, radius md, outline border, a11y label    */
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
  keyboardType?: any;
  prefix?: string;
  trailing?: React.ReactNode;
  error?: string;
  multiline?: boolean;
  numberOfLines?: number;
  secureTextEntry?: boolean;
  style?: ViewStyle;
  inputRef?: React.RefObject<any>;
} & Omit<React.ComponentProps<typeof Text>, 'tabIndex'>) {
  const { theme } = useTheme();
  return (
    <View style={style}>
      {label ? (
        <M3Text role="labelLarge" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
          {label}
        </M3Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? theme.error : theme.divider,
          borderRadius: radius.md,
          backgroundColor: theme.surface,
          paddingHorizontal: 14,
          minHeight: controlMinH,
        }}
      >
        {prefix ? (
          <M3Text role="bodyLarge" color={theme.onSurfaceVariant} style={{ marginRight: 6 }}>
            {prefix}
          </M3Text>
        ) : null}
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
            paddingVertical: 10,
            minHeight: multiline ? 20 * (numberOfLines || 3) : undefined,
          }}
          {...rest}
        />
        {trailing}
      </View>
      {error ? (
        <M3Text role="labelMedium" color={theme.error} style={{ marginTop: 4 }}>
          {error}
        </M3Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* BottomSheet — global quick add / modal sheet                        */
/* ------------------------------------------------------------------ */

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: screenH * 0.92,
            backgroundColor: theme.surface,
            borderTopLeftRadius: radius.xxl,
            borderTopRightRadius: radius.xxl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: pageMargin,
            ...(elevation as any)[3],
          }}
          // prevent the backdrop press from bubbling when tapping the sheet itself
          // eslint-disable-next-line react/jsx-no-leaked-render
        >
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.divider,
              alignSelf: 'center',
              marginBottom: 12,
            }}
          />
          {title ? (
            <M3Text role="titleLarge" style={{ marginBottom: 12 }}>
              {title}
            </M3Text>
          ) : null}
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Chip — pill filter / category, selected uses primaryContainer       */
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
        paddingVertical: 7,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        backgroundColor: sel ? theme.primaryContainer : theme.surfaceContainer,
        borderWidth: sel ? StyleSheet.hairlineWidth : 0,
        borderColor: sel ? theme.outline : undefined,
        minHeight: 36,
      }}
    >
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <M3Text role="labelLarge" color={fg}>{label}</M3Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* PrimaryButton — min height 52dp, brand color, a11y label           */
/* ------------------------------------------------------------------ */

export function PrimaryButton({
  label,
  onPress,
  icon,
  fullWidth,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const fg = theme.onPrimary;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      onPress={onPress}
      activeOpacity={0.88}
      disabled={disabled || loading}
      style={[
        {
          minHeight: controlMinH,
          height: controlMinH,
          borderRadius: radius.md,
          backgroundColor: disabled ? theme.onSurfaceVariant : theme.primary,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: space.lg,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.6 : 1,
        },
        fullWidth && { width: '100%' },
        style,
      ]}
    >
      {loading ? (
        <RNActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={20} color={fg} />
      ) : null}
      <M3Text role="labelLarge" style={{ color: fg, textAlign: 'center' }}>
        {label}
      </M3Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* ConfirmDialog — destructive action confirmation modal               */
/* ------------------------------------------------------------------ */

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const confirmBg = destructive ? theme.error : theme.primary;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: pageMargin }}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      >
        <Pressable
          onPress={() => {}}
          style={[
            {
              width: '100%',
              maxWidth: 360,
              backgroundColor: theme.surface,
              borderRadius: radius.lg,
              padding: space.lg,
              ...(elevation as any)[3],
            },
          ]}
        >
          <M3Text role="titleMedium" style={{ marginBottom: 6 }}>
            {title}
          </M3Text>
          {message ? (
            <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 18 }}>
              {message}
            </M3Text>
          ) : (
            <View style={{ marginBottom: 18 }} />
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={cancelLabel || t('common.cancel')}
              onPress={onCancel}
              activeOpacity={0.8}
              style={{
                minHeight: controlMinH,
                borderRadius: radius.md,
                paddingHorizontal: space.lg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <M3Text role="labelLarge" color={theme.onSurfaceVariant}>
                {cancelLabel || t('common.cancel')}
              </M3Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={confirmLabel || t('common.confirm')}
              onPress={onConfirm}
              activeOpacity={0.8}
              style={{
                minHeight: controlMinH,
                borderRadius: radius.md,
                paddingHorizontal: space.lg,
                backgroundColor: confirmBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <M3Text role="labelLarge" style={{ color: destructive ? theme.onError : theme.onPrimary }}>
                {confirmLabel || t('common.confirm')}
              </M3Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
      <View style={{ height: insets.bottom }} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Helper: responsive column count from available width                */
/* ------------------------------------------------------------------ */

export function useColumns() {
  const { width } = useWindowDimensions();
  // Per spec: below 360dp use a single full-width column; then scale up.
  if (width < 360) return 1;
  if (width < 560) return 2;
  if (width < 840) return 3;
  return 4;
}
