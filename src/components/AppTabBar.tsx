import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackActions } from '@react-navigation/native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useNotifyNav } from '../notify/NotifyNav';
import { usePendingCount } from '../notify/pendingStore';
import { Icon, ICONS } from '../icons';
import { elevation, touchMin, pageMargin } from '../tokens';
import { M3Text } from './ui';
import { AnimatedTabIndicator, DUR, EASE, EASE_OUT, SPRING, useMotion } from './anim';

// Floating capsule tab bar. Four entries + a centered green "+" that opens the
// global quick-add sheet (not a route).
//
// §一  第四项由「设置 / cog」正式改为「我的 / account-circle」。
// §九  选中态不再是「瞬间换底色」，而是一颗胶囊在四个位置之间滑动（200ms），
//      配合图标 0.92→1 缩放与文字淡入；中间「+」按下有回弹与旋转。
//      系统开启「减弱动态效果」时全部退化为瞬时/极短淡入。
type TabDef = { name: string; icon: string; labelKey: string };

const TABS: TabDef[] = [
  { name: '今日', icon: ICONS.today, labelKey: 'tabs.today' },
  { name: '计划', icon: ICONS.plan, labelKey: 'tabs.plan' },
  { name: '财务', icon: ICONS.finance, labelKey: 'tabs.finance' },
  { name: '我的', icon: ICONS.me, labelKey: 'tabs.me' },
];

const BAR_H = 56;
const TAB_H = 46;

export function AppTabBar({ state, navigation }: any) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const nav = useNotifyNav();
  const pendingCount = usePendingCount();
  const insets = useSafeAreaInsets();

  const activeRoute = state.routes[state.index];
  const activeName = activeRoute?.name;

  // §二 嵌套栈深度 > 0 说明当前处于二级页（我的→各设置子页 / 今日→速记）。
  // 二级页是全屏页面，有自己的返回键，不应该再被浮动底栏压住 → 直接不渲染。
  const nestedDepth = (activeRoute?.state?.index as number | undefined) ?? 0;
  const onSubPage = nestedDepth > 0;

  // 点 tab 的标准语义：
  //  · 已在该 tab 且处于二级页 → 回到该栈的根（popToTop）
  //  · 否则切换 tab
  const pressTab = (name: string) => {
    const route = state.routes.find((r: any) => r.name === name);
    if (!route) return;
    const isFocused = route.key === activeRoute?.key;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    if (isFocused) {
      const depth = (route.state?.index as number | undefined) ?? 0;
      if (depth > 0 && route.state?.key) {
        navigation.dispatch({ ...StackActions.popToTop(), target: route.state.key });
      }
      return;
    }
    navigation.navigate(name);
  };

  // 测量每个 tab 相对于 row 的位置，供滑动胶囊使用
  const [rects, setRects] = useState<Record<string, { x: number; w: number }>>({});
  const onTabLayout = (name: string) => (e: any) => {
    const { x, width } = e.nativeEvent.layout;
    setRects((prev) => {
      const cur = prev[name];
      if (cur && Math.abs(cur.x - x) < 0.5 && Math.abs(cur.w - width) < 0.5) return prev;
      return { ...prev, [name]: { x, w: width } };
    });
  };
  const activeRect = rects[activeName];

  // layout: [0][1] [ + ] [2][3]
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2, 4);

  // §二 二级页不显示浮动底栏（它有自己的返回键，且是全屏内容）
  if (onSubPage) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          left: pageMargin,
          right: pageMargin,
          bottom: insets.bottom + 8,
          backgroundColor: theme.surface,
          borderColor: theme.divider,
          // Flat, Notion-like: hairline border + very subtle lift only.
          ...(elevation as any)[1],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.row}>
        {/* 滑动胶囊：横跨整个 row 的坐标系，因此能从「计划」平滑滑到「财务」 */}
        <AnimatedTabIndicator
          x={activeRect?.x ?? 0}
          width={activeRect?.w ?? 0}
          height={TAB_H}
          cornerRadius={TAB_H / 2}
          color={theme.primaryContainer}
          style={{ top: (BAR_H - TAB_H) / 2 }}
        />

        {left.map((def) => (
          <TabButton
            key={def.name}
            def={def}
            isActive={def.name === activeName}
            pendingCount={pendingCount}
            onLayout={onTabLayout(def.name)}
            onPress={() => pressTab(def.name)}
          />
        ))}

        <CenterAddButton label={t('quickadd.title')} onPress={() => nav.openQuickAdd()} />

        {right.map((def) => (
          <TabButton
            key={def.name}
            def={def}
            isActive={def.name === activeName}
            pendingCount={pendingCount}
            onLayout={onTabLayout(def.name)}
            onPress={() => pressTab(def.name)}
          />
        ))}
      </View>
    </View>
  );
}

function TabButton({
  def,
  isActive,
  pendingCount,
  onLayout,
  onPress,
}: {
  def: TabDef;
  isActive: boolean;
  pendingCount: number;
  onLayout: (e: any) => void;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { reduced } = useMotion();
  const badge = def.name === '财务' && pendingCount > 0;

  const act = useSharedValue(isActive ? 1 : 0);
  const first = useRef(true);

  useEffect(() => {
    const target = isActive ? 1 : 0;
    if (first.current || reduced) {
      first.current = false;
      act.value = target;
      return;
    }
    act.value = withTiming(target, { duration: DUR.tab, easing: EASE });
  }, [isActive, reduced]);

  // 图标 0.92 → 1（减弱动效时恒为 1，不做缩放）
  const iconStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    return { transform: [{ scale: 0.92 + act.value * 0.08 }] };
  }, [reduced]);

  // 文字淡入（未选中 0.72 → 选中 1）
  const labelStyle = useAnimatedStyle(() => ({ opacity: 0.72 + act.value * 0.28 }), []);

  const fg = isActive ? theme.onPrimaryContainer : theme.onSurfaceVariant;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={t(def.labelKey)}
      onPress={onPress}
      onLayout={onLayout}
      style={styles.tabBtn}
    >
      <Animated.View style={[{ position: 'relative' }, iconStyle]}>
        <Icon name={def.icon} size={24} color={fg} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: theme.error }]}>
            <M3Text role="labelSmall" allowFontScaling={false} style={{ color: theme.onError, fontSize: 9, lineHeight: 12 }}>
              {pendingCount > 99 ? '99+' : String(pendingCount)}
            </M3Text>
          </View>
        ) : null}
      </Animated.View>
      <Animated.View style={labelStyle}>
        <M3Text role="labelMedium" color={fg} maxFontSizeMultiplier={1.15} numberOfLines={1} style={{ marginTop: 3 }}>
          {t(def.labelKey)}
        </M3Text>
      </Animated.View>
    </Pressable>
  );
}

function CenterAddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme();
  const { reduced } = useMotion();
  const p = useSharedValue(0);

  const aStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: 1 - p.value * 0.15 };
    return {
      transform: [{ scale: 1 - p.value * 0.08 }, { rotate: `${p.value * 45}deg` }],
    };
  }, [reduced]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => {
        p.value = withTiming(1, { duration: DUR.press, easing: EASE_OUT });
      }}
      onPressOut={() => {
        p.value = reduced ? withTiming(0, { duration: DUR.press }) : withSpring(0, SPRING);
      }}
    >
        <Animated.View
          style={[
            styles.fab,
            {
              backgroundColor: theme.primary,
              ...(elevation as any)[1],
            },
            aStyle,
          ]}
        >
          <Icon name={ICONS.add} size={24} color={theme.onPrimary} />
        </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    height: BAR_H,
    borderRadius: BAR_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabBtn: {
    flex: 1,
    minWidth: touchMin,
    height: TAB_H,
    borderRadius: TAB_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
