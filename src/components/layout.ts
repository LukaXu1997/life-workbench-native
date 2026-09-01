import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space } from '../tokens';

// §八 统一底部安全间距
// 之前每个页面各自手写 paddingBottom: 40 / 96 / 130 / 140，导致浮动胶囊底栏
// 在不同页面/不同导航模式（手势 vs 三键）下遮挡最后一条内容。
// 这里把「底栏几何」收成唯一来源：AppTabBar 是 absolute 定位，
//   height = TAB_BAR_HEIGHT，bottom = insets.bottom + TAB_BAR_FLOAT_GAP
// 所以任何滚动容器的底部留白 = 底栏总占位 + 一个呼吸间距。

/** 浮动胶囊底栏自身高度（与 AppTabBar BAR_H 保持一致） */
export const TAB_BAR_HEIGHT = 56;
/** 底栏相对安全区再上浮的距离（与 AppTabBar bottom: insets.bottom + 8 一致） */
export const TAB_BAR_FLOAT_GAP = 8;
/** 内容与底栏之间的呼吸间距 */
export const CONTENT_BREATH = space.lg; // 16

/**
 * 有底栏的一级页面（今日 / 计划 / 财务 / 我的）使用。
 * 返回 ScrollView / FlatList contentContainerStyle 的 paddingBottom。
 */
export function useBottomContentInset(extra = 0) {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_FLOAT_GAP + CONTENT_BREATH + insets.bottom + extra;
}

/**
 * 没有底栏的二级页面（我的 → 各设置子页、待确认、确认交易等）使用。
 * 只需要避开系统手势条 / 导航栏，不需要为胶囊底栏留位。
 */
export function useSubPageBottomInset(extra = 0) {
  const insets = useSafeAreaInsets();
  return space.xxl + insets.bottom + extra; // 24 + inset
}
