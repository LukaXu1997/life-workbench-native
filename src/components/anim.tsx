import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme-context';
import { radius, space, elevation } from '../tokens';
import { M3Text } from './ui';
import { formatMoney } from '../money';
import type { Currency } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// §九 统一动效层
//
// 设计原则（克制）：
//  · 只有「状态变化」才动：切换、展开、完成、进入。装饰性动画一律不做。
//  · 时长收敛在 120–320ms；主交互 180–220ms。
//  · 不做循环、不做弹跳回弹、不做无限脉冲。
//  · 尊重系统「减弱动态效果」：关闭 spring / 旋转 / 位移，只保留极短淡入。
// ─────────────────────────────────────────────────────────────────────────────

/** 标准缓动：进场减速，符合 Material 的 emphasized-decelerate 手感 */
export const EASE = Easing.bezier(0.2, 0, 0, 1);
/** 退场缓动 */
export const EASE_OUT = Easing.bezier(0.4, 0, 1, 1);

export const DUR = {
  press: 110,
  tab: 200,
  fade: 180,
  rise: 220,
  progress: 320,
  sheetIn: 260,
  sheetOut: 180,
  collapse: 200,
  /** 余额数字过渡：位数切换时的平滑滚动 */
  balance: 380,
} as const;

/** 近临界阻尼：有弹性手感但肉眼看不到回弹 */
export const SPRING = { damping: 22, stiffness: 260, mass: 0.85 } as const;

/**
 * 动效总开关。所有动画组件都通过它读取「是否减弱动态效果」。
 * 屏幕代码也可以直接用它来决定要不要做位移。
 */
export function useMotion() {
  const reduced = useReducedMotion();
  return { reduced, DUR, SPRING, EASE, EASE_OUT };
}

// 必须在 UI 线程可用：被 AppBottomSheet 的 useAnimatedStyle 工作集调用，
// 不加 'worklet' 时 UI 线程上它是 undefined → “Object is not a function”。
const clamp01 = (v: number) => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. AnimatedPressable — 按压反馈（替代到处手写 activeOpacity）
// ─────────────────────────────────────────────────────────────────────────────
type APProps = {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 按下时缩放到多少，默认 0.97；减弱动效时自动忽略 */
  pressScale?: number;
  /** 按下时不透明度，默认 0.92 */
  pressOpacity?: number;
  accessibilityRole?: any;
  accessibilityLabel?: string;
  accessibilityState?: any;
  accessibilityHint?: string;
  hitSlop?: number;
  testID?: string;
};

/**
 * 单节点按压层：直接用 Animated 包裹 Pressable。
 *
 * 早期实现是 <Pressable><Animated.View style={style}>，即外层 Pressable 不带任何
 * style。这会导致调用方写在 style 里的布局属性（典型如 flex: 1）作用在**里层**
 * View 上——而里层的父级 Pressable 是内容宽度（收缩到文字宽度），于是：
 *   · 首页四个快捷入口无法等分整行（§二.1 严格等宽失效，只能按文字长度排布）
 *   · 行式按压区（流水行）无法撑满卡片宽度，背景色只覆盖内容区
 * 收敛为单节点后，flex:1 直接作用在真正的 flex 子元素上，两者都自动正确。
 */
const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

export function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  pressScale = 0.97,
  pressOpacity = 0.92,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  accessibilityHint,
  hitSlop,
  testID,
}: APProps) {
  const { reduced } = useMotion();
  const p = useSharedValue(0);

  const aStyle = useAnimatedStyle(() => {
    const t = p.value;
    // 减弱动效：只做不透明度，不做缩放
    if (reduced) return { opacity: 1 - t * (1 - pressOpacity) };
    return {
      opacity: 1 - t * (1 - pressOpacity),
      transform: [{ scale: 1 - t * (1 - pressScale) }],
    };
  }, [reduced, pressScale, pressOpacity]);

  const down = () => {
    p.value = withTiming(1, { duration: DUR.press, easing: EASE_OUT });
  };
  const up = () => {
    p.value = reduced
      ? withTiming(0, { duration: DUR.press })
      : withSpring(0, SPRING);
  };

  return (
    <AnimatedPressableBase
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={down}
      onPressOut={up}
      disabled={disabled}
      hitSlop={hitSlop}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      accessibilityHint={accessibilityHint}
      style={[style, aStyle, disabled && { opacity: 0.45 }]}
    >
      {children}
    </AnimatedPressableBase>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. AnimatedTabIndicator — 滑动胶囊（底栏 / 分段控件共用）
// ─────────────────────────────────────────────────────────────────────────────
export function AnimatedTabIndicator({
  x,
  width,
  height,
  color,
  cornerRadius,
  style,
}: {
  x: number;
  width: number;
  height: number;
  color: string;
  cornerRadius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduced } = useMotion();
  const tx = useSharedValue(x);
  const w = useSharedValue(width);
  const first = useRef(true);

  useEffect(() => {
    // 首帧直接落位，避免从 0 滑入
    if (first.current || reduced) {
      first.current = false;
      tx.value = x;
      w.value = width;
      return;
    }
    tx.value = withTiming(x, { duration: DUR.tab, easing: EASE });
    w.value = withTiming(width, { duration: DUR.tab, easing: EASE });
  }, [x, width, reduced]);

  const s = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    width: w.value,
  }));

  // width 为 0 时（尚未测量）不渲染，避免闪一个小方块
  if (width <= 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          height,
          borderRadius: cornerRadius ?? height / 2,
          backgroundColor: color,
        },
        style,
        s,
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AnimatedProgress — 预算进度条（不会每次重挂载都从 0 重播）
// ─────────────────────────────────────────────────────────────────────────────
export function AnimatedProgress({
  value,
  color,
  trackColor,
  height = 8,
  style,
}: {
  /** 0–1 */
  value: number;
  color: string;
  trackColor: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduced } = useMotion();
  const target = clamp01(value);
  // 初始值 = 真实值：重新进入页面时直接落位，不重播
  const pct = useSharedValue(target);
  const [trackW, setTrackW] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      pct.value = target;
      return;
    }
    pct.value = reduced ? target : withTiming(target, { duration: DUR.progress, easing: EASE });
  }, [target, reduced]);

  // 关键修复：useAnimatedStyle 内只能用数字类 style，不能用百分比字符串，
  // 否则 UI 线程会抛 “Object is not a function”。改为测量容器宽度后按数值动画。
  const s = useAnimatedStyle(() => ({ width: trackW * pct.value }));

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - trackW) > 0.5) setTrackW(w);
      }}
      style={[
        { height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[{ height: '100%', borderRadius: height / 2, backgroundColor: color }, s]} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. AnimatedListItem — 列表逐条淡入上浮（替代滑出式动画）
// ─────────────────────────────────────────────────────────────────────────────
export function AnimatedListItem({
  index = 0,
  children,
  style,
  /** 每条延迟，默认 22ms；最多累积 6 条，避免长列表越往下越慢 */
  stagger = 22,
  maxStaggerCount = 6,
  /**
   * §五.6 是否播放进入动画。为 false 时直接落位（不淡入/不上浮），
   * 用于「页面返回」避免列表逐条重播。默认 true（首次进入播放）。
   */
  play = true,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  stagger?: number;
  maxStaggerCount?: number;
  play?: boolean;
}) {
  const { reduced } = useMotion();
  const skip = reduced || !play;
  const o = useSharedValue(skip ? 1 : 0);
  const ty = useSharedValue(skip ? 0 : 8);

  useEffect(() => {
    if (skip) {
      o.value = 1;
      ty.value = 0;
      return;
    }
    const d = Math.min(index, maxStaggerCount) * stagger;
    if (reduced) {
      // 减弱动效：不做位移，只做一次极短淡入
      ty.value = 0;
      o.value = withTiming(1, { duration: 120 });
      return;
    }
    o.value = withDelay(d, withTiming(1, { duration: DUR.fade, easing: EASE }));
    ty.value = withDelay(d, withTiming(0, { duration: DUR.rise, easing: EASE }));
    // 只在挂载时执行一次
  }, []);

  const s = useAnimatedStyle(() => ({
    opacity: o.value,
    transform: [{ translateY: ty.value }],
  }));

  return <Animated.View style={[style, s]}>{children}</Animated.View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. FadeInContent — 卡片/区块进入时的整体淡入
// ─────────────────────────────────────────────────────────────────────────────
export function FadeInContent({
  children,
  delay = 0,
  style,
  rise = 6,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  rise?: number;
}) {
  const { reduced } = useMotion();
  const o = useSharedValue(reduced ? 1 : 0);
  const ty = useSharedValue(reduced ? 0 : rise);

  useEffect(() => {
    if (reduced) {
      ty.value = 0;
      o.value = withTiming(1, { duration: 120 });
      return;
    }
    o.value = withDelay(delay, withTiming(1, { duration: DUR.fade, easing: EASE }));
    ty.value = withDelay(delay, withTiming(0, { duration: DUR.rise, easing: EASE }));
  }, []);

  const s = useAnimatedStyle(() => ({
    opacity: o.value,
    transform: [{ translateY: ty.value }],
  }));

  return <Animated.View style={[style, s]}>{children}</Animated.View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. AnimatedCollapse — 完成任务后整行收起（配合 Snackbar 撤销）
// ─────────────────────────────────────────────────────────────────────────────
export function AnimatedCollapse({
  collapsed,
  children,
  onCollapsed,
  style,
}: {
  collapsed: boolean;
  children: React.ReactNode;
  onCollapsed?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduced } = useMotion();
  const [h, setH] = useState(0);
  const k = useSharedValue(1); // 1 = 展开

  useEffect(() => {
    if (collapsed) {
      const done = (finished?: boolean) => {
        'worklet';
        if (finished && onCollapsed) runOnJS(onCollapsed)();
      };
      k.value = withTiming(0, { duration: reduced ? 100 : DUR.collapse, easing: EASE_OUT }, done);
    } else {
      k.value = reduced ? 1 : withTiming(1, { duration: DUR.collapse, easing: EASE });
    }
  }, [collapsed, reduced]);

  const s = useAnimatedStyle(() => {
    if (h <= 0) return { opacity: k.value };
    return { height: h * k.value, opacity: k.value, overflow: 'hidden' as const };
  }, [h]);

  return (
    <Animated.View style={[style, s]}>
      <View onLayout={(e) => { const nh = e.nativeEvent.layout.height; if (nh > 0 && Math.abs(nh - h) > 0.5) setH(nh); }}>
        {children}
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. AppBottomSheet — 遮罩淡入 + 面板弹入（替代 Modal animationType="slide"）
// ─────────────────────────────────────────────────────────────────────────────
export function AppBottomSheet({
  visible,
  onClose,
  title,
  children,
  /** 内容是否需要滚动（表单类建议 true） */
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { theme } = useTheme();
  const { reduced } = useMotion();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const sheetH = useSharedValue(360);
  const prog = useSharedValue(0); // 0 = 收起, 1 = 展开

  useEffect(() => {
    if (visible) {
      setMounted(true);
      prog.value = reduced
        ? withTiming(1, { duration: 120 })
        : withSpring(1, SPRING);
    } else {
      prog.value = withTiming(
        0,
        { duration: reduced ? 100 : DUR.sheetOut, easing: EASE_OUT },
        (finished) => {
          'worklet';
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [visible, reduced]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: clamp01(prog.value) }));

  const sheetStyle = useAnimatedStyle(() => {
    const p = clamp01(prog.value); // 夹紧：spring 轻微过冲时面板不会浮离底边
    if (reduced) return { opacity: p };
    return { transform: [{ translateY: (1 - p) * sheetH.value }] };
  }, [reduced]);

  if (!mounted) return null;

  const maxH = winH * 0.9;
  const Body: any = scroll ? ScrollView : View;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={title ? `${title} — 关闭` : '关闭'}
          />
        </Animated.View>

        <Animated.View
          onLayout={(e) => {
            const hh = e.nativeEvent.layout.height;
            if (hh > 0) sheetH.value = hh;
          }}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              maxHeight: maxH,
              paddingBottom: space.xxl + insets.bottom,
              ...(elevation as any)[3],
            },
            sheetStyle,
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.divider }]} />
          {title ? (
            <M3Text role="titleMedium" color={theme.onSurface} style={{ marginBottom: space.lg }}>
              {title}
            </M3Text>
          ) : null}
          <Body
            {...(scroll
              ? { showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' as const }
              : {})}
          >
            {children}
          </Body>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. AnimatedBalance — 余额平滑数字过渡（§五.4）
//
// 只有「余额值真正变化」时才滚动；首帧直接落位（与「页面返回不重播」一致）。
// 数字用 tabular-nums 保证字距稳定；并用 onTextLayout 自适应窄屏，绝不换行/裁切。
// 开启「减弱动态效果」时直接跳变，不做位移动画。
// ─────────────────────────────────────────────────────────────────────────────
export function AnimatedBalance({
  minor,
  cur,
  maxFont = 34,
  minFont = 13,
  color,
  weight = '600',
  style,
  maxFontSizeMultiplier = 1.2,
  accessibilityLabel,
}: {
  /** 整数最小单位金额（与 formatMoney 一致） */
  minor: number;
  cur: Currency;
  maxFont?: number;
  minFont?: number;
  color?: string;
  weight?: '400' | '500' | '600' | '700';
  style?: StyleProp<TextStyle>;
  maxFontSizeMultiplier?: number;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const { reduced } = useMotion();
  const [display, setDisplay] = useState(() => formatMoney(minor, cur));
  const [fontSize, setFontSize] = useState(maxFont);
  const prevTargetLen = useRef(display.length);
  const currentRef = useRef(minor); // 当前动画所处的金额值，便于打断时平滑续接
  const rafRef = useRef<number | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    const targetStr = formatMoney(minor, cur);
    // 位数减少时先回到最大字号，再由 onTextLayout 决定是否需要再缩
    if (targetStr.length < prevTargetLen.current) setFontSize(maxFont);
    prevTargetLen.current = targetStr.length;

    // 首帧与「减弱动态效果」：直接落位，不播放过渡（页面返回时也不重播）
    if (!mounted.current || reduced) {
      mounted.current = true;
      currentRef.current = minor;
      setDisplay(targetStr);
      return;
    }

    const from = currentRef.current;
    if (from === minor) {
      setDisplay(targetStr);
      return;
    }
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / DUR.balance);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const cur2 = from + (minor - from) * e;
      currentRef.current = cur2;
      setDisplay(formatMoney(Math.round(cur2), cur));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        currentRef.current = minor;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [minor, cur, reduced]);

  return (
    <M3Text
      numberOfLines={1}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      accessibilityLabel={accessibilityLabel}
      onTextLayout={(e) => {
        const lines = e.nativeEvent.lines;
        const truncated = lines.length > 1 || (lines.length > 0 && lines[0].text.length < display.length);
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
          fontVariant: ['tabular-nums' as const],
          // 大数字按比例收紧字距（~0.015em），与 M3Text 标题负字距同源，
          // 让 hero/金额数字与周围标签观感一致（Notion 招牌细节）。
          letterSpacing: -(fontSize * 0.015),
        },
        style,
      ]}
    >
      {display}
    </M3Text>
  );
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: space.md,
    paddingHorizontal: space.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: space.lg,
  },
});
