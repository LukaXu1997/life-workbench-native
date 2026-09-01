import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n, type LangMode } from '../../i18n';
import { Segmented, M3Text } from '../../components/ui';
import { ListGroup } from '../../components/kit';
import { space } from '../../tokens';
import SubPage from './SubPage';

// §四 从原 SettingsScreen 拆出：语言（跟随系统 / 中文 / English）
export default function LanguageSettingsScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t, lang, setLang } = useI18n();

  return (
    <SubPage title={t('settings.language')} onBack={() => navigation.goBack()}>
      <ListGroup>
        <View style={{ padding: space.lg }}>
          <Segmented
            segments={[
              { key: 'system', label: t('settings.langSystem') },
              { key: 'zh', label: t('settings.langZh') },
              { key: 'en', label: t('settings.langEn') },
            ]}
            active={lang}
            onChange={(m) => setLang(m as LangMode)}
          />
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: space.md }}>
            {t('settings.currentLang', {
              lang:
                lang === 'system'
                  ? t('settings.langSystemVal')
                  : lang === 'zh'
                    ? t('settings.langZhVal')
                    : t('settings.langEnVal'),
            })}
          </M3Text>
        </View>
      </ListGroup>
    </SubPage>
  );
}
