import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { Segmented, M3Text } from '../../components/ui';
import { ListGroup } from '../../components/kit';
import { space } from '../../tokens';
import type { ThemeMode } from '../../theme';
import SubPage from './SubPage';

// §四 从原 SettingsScreen 拆出：外观（跟随系统 / 浅色 / 深色）
export default function AppearanceSettingsScreen({ navigation }: { navigation: any }) {
  const { theme, mode, setMode } = useTheme();
  const { t } = useI18n();

  return (
    <SubPage title={t('settings.appearance')} onBack={() => navigation.goBack()}>
      <ListGroup>
        <View style={{ padding: space.lg }}>
          <Segmented
            segments={[
              { key: 'system', label: t('settings.appearanceSystem') },
              { key: 'auto', label: t('settings.appearanceAuto') },
              { key: 'light', label: t('settings.appearanceLight') },
              { key: 'dark', label: t('settings.appearanceDark') },
            ]}
            active={mode}
            onChange={(m) => setMode(m as ThemeMode)}
          />
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.md }}>
            {t('settings.currentMode', {
              mode:
                mode === 'system'
                  ? t('settings.modeSystem')
                  : mode === 'auto'
                    ? t('settings.modeAuto')
                    : mode === 'dark'
                      ? t('settings.modeDark')
                      : t('settings.modeLight'),
            })}
          </M3Text>
        </View>
      </ListGroup>
    </SubPage>
  );
}
