import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../theme-context';
import { ScreenHeader } from '../../components/kit';
import { useSubPageBottomInset } from '../../components/layout';
import { FadeInContent } from '../../components/anim';
import { pageMargin, space } from '../../tokens';

/**
 * §二 二级页面统一骨架。
 *  · 顶部一定有返回键（ScreenHeader onBack），标题降一级
 *  · 没有浮动底栏，所以底部只需避开系统手势条 → useSubPageBottomInset
 *  · 进入时整体淡入上浮（减弱动效时退化为极短淡入）
 */
export default function SubPage({
  title,
  subtitle,
  onBack,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { theme } = useTheme();
  const bottom = useSubPageBottomInset();

  const body = (
    <FadeInContent style={{ gap: space.md }}>{children}</FadeInContent>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title={title} subtitle={subtitle} onBack={onBack} />
      {scroll ? (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: pageMargin,
            paddingTop: space.sm,
            paddingBottom: bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: pageMargin, paddingTop: space.sm }}>{body}</View>
      )}
    </View>
  );
}
