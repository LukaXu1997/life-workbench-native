import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { M3Text } from '../../components/ui';
import { ListGroup, NavRow } from '../../components/kit';
import { AppBottomSheet } from '../../components/anim';
import { Icon, ICONS } from '../../icons';
import { radius, space } from '../../tokens';
import { DISPLAY_VERSION, VERSION_CODE, BUILD_DATE, RELEASE_NOTES } from '../../version';
import SubPage from './SubPage';

// §四 从原 SettingsScreen 的 AboutCard 拆出：关于 / 版本 / 更新内容
// 版本号仍然唯一来源于 src/version.ts。
export default function AboutScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [notesOpen, setNotesOpen] = useState(false);

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
        <NavRow icon={ICONS.chart} title={t('settings.viewNotes')} onPress={() => setNotesOpen(true)} />
      </ListGroup>

      <ListGroup footer={t('settings.aboutDesc')} />

      <AppBottomSheet visible={notesOpen} onClose={() => setNotesOpen(false)} title={t('settings.notesTitle')} scroll={false}>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          <M3Text role="bodyMedium" style={{ lineHeight: 22 }}>
            {RELEASE_NOTES}
          </M3Text>
        </ScrollView>
      </AppBottomSheet>
    </SubPage>
  );
}
