import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { M3Text } from '../../components/ui';
import { Card } from '../../components/kit';
import { CHANGELOG, changelogCopy, formatChangelogDate, type ChangelogEntry } from '../../changelog';
import { radius, space } from '../../tokens';
import SubPage from './SubPage';

// 更新内容（版本记录）页面。
//
// 文案来源：src/changelog.ts 的双语静态数据（非运行时机器翻译）。
// 语言切换：useI18n().resolved 变化会触发本组件重新渲染，已打开的页面即时切换，无需重启 App。
// 排版：版本号 / 日期 / 标题 / 更新项四层结构；行容器使用 flexWrap + flex 收缩，
//       在 320dp 小屏与 200% 字号下只会换行，不会截断；页面本身可滚动，底部留出系统手势区。
export default function ChangelogScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();

  return (
    <SubPage
      title={t('settings.notesTitle')}
      subtitle={t('changelog.subtitle', { count: CHANGELOG.length })}
      onBack={() => navigation.goBack()}
    >
      {CHANGELOG.length === 0 ? (
        <Card>
          <M3Text role="bodyMedium" color={theme.onSurfaceVariant}>
            {t('changelog.empty')}
          </M3Text>
        </Card>
      ) : (
        CHANGELOG.map((entry, index) => (
          <VersionCard key={entry.version} entry={entry} isLatest={index === 0} />
        ))
      )}
    </SubPage>
  );
}

function VersionCard({ entry, isLatest }: { entry: ChangelogEntry; isLatest: boolean }) {
  const { theme } = useTheme();
  const { t, resolved } = useI18n();
  const copy = changelogCopy(entry, resolved);

  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: space.sm,
          rowGap: space.xs,
        }}
      >
        <M3Text role="titleMedium" style={{ fontVariant: ['tabular-nums'] }}>
          {entry.version}
        </M3Text>
        {isLatest ? (
          <View
            style={{
              paddingHorizontal: space.sm,
              paddingVertical: 2,
              borderRadius: radius.pill,
              backgroundColor: theme.primaryContainer,
            }}
          >
            <M3Text role="labelSmall" color={theme.onPrimaryContainer}>
              {t('changelog.latest')}
            </M3Text>
          </View>
        ) : null}
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginLeft: 'auto' }}>
          {formatChangelogDate(entry.date, resolved)}
        </M3Text>
      </View>

      <M3Text role="labelLarge" color={theme.primary} style={{ marginTop: space.sm }}>
        {copy.title}
      </M3Text>

      <View style={{ marginTop: space.sm, gap: space.xs }}>
        {copy.items.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <M3Text
              role="bodyMedium"
              color={theme.onSurfaceVariant}
              style={{ flexShrink: 0, paddingRight: space.sm }}
            >
              {'·'}
            </M3Text>
            <M3Text role="bodyMedium" style={{ flex: 1 }}>
              {item}
            </M3Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
