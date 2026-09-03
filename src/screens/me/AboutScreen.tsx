import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { M3Text } from '../../components/ui';
import { ListGroup, NavRow } from '../../components/kit';
import { Icon, ICONS } from '../../icons';
import { radius, space } from '../../tokens';
import { DISPLAY_VERSION, VERSION_CODE, BUILD_DATE } from '../../version';
import SubPage from './SubPage';

// §四 从原 SettingsScreen 的 AboutCard 拆出：关于 / 版本 / 更新内容
// 版本号仍然唯一来源于 src/version.ts。
// 「查看更新内容」改为跳转到独立的 Changelog 页面（双语产品化文案见 src/changelog.ts）。
export default function AboutScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();

  return (
    <SubPage title={t('me.about')} onBack={() => navigation.goBack()}>
      <ListGroup>
        <View style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.lg,
              backgroundColor: theme.primaryContainer,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={ICONS.today} size={26} color={theme.onPrimaryContainer} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <M3Text role="titleMedium">{t('settings.aboutTitle')}</M3Text>
            <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
              {t('settings.aboutSub', { version: DISPLAY_VERSION })}
            </M3Text>
          </View>
        </View>
      </ListGroup>

      <ListGroup>
        <NavRow icon={ICONS.info} title={t('settings.buildNo', { code: VERSION_CODE })} trailing={null} />
        <NavRow icon={ICONS.calendar} title={t('settings.updateDate', { date: BUILD_DATE })} trailing={null} />
        <NavRow
          icon={ICONS.chart}
          title={t('settings.viewNotes')}
          onPress={() => navigation.navigate('Changelog')}
        />
      </ListGroup>

      <ListGroup footer={t('settings.aboutDesc')} />
    </SubPage>
  );
}
