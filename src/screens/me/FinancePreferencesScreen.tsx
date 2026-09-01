import React, { useEffect, useState } from 'react';
import { View, Alert } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { store } from '../../store';
import { M3Text, TextField } from '../../components/ui';
import { ListGroup, PrimaryButton } from '../../components/kit';
import { space } from '../../tokens';
import SubPage from './SubPage';

// §四 从原 SettingsScreen 的 FxTab 拆出：默认币种与汇率
// 业务逻辑保持不变 —— 仍然是 store.getFxRate / setFxRate，默认 1.65。
// 注意：隐藏余额的开关已从本页移除 —— 现在它就是财务概览里净资产旁边的
// 那只眼睛图标（EyeToggle），单一控制点，避免设置里再重复一个开关。
export default function FinancePreferencesScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [rate, setRate] = useState('1.65');

  useEffect(() => {
    store.getFxRate().then((r) => setRate(String(r)));
  }, []);

  const save = async () => {
    await store.setFxRate(Number(rate) || 1.65);
    Alert.alert(t('settings.fxSaved'), t('settings.fxSavedMsg', { rate }));
  };

  return (
    <SubPage title={t('me.currency')} onBack={() => navigation.goBack()}>
      <ListGroup footer={t('settings.fxHint')}>
        <View style={{ padding: space.lg }}>
          <M3Text role="titleMedium" style={{ marginBottom: space.md }}>
            {t('settings.fx')}
          </M3Text>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <M3Text role="bodyLarge">{t('settings.fxLabel')}</M3Text>
            <View style={{ flex: 1 }}>
              <TextField
                value={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
                placeholder="1.65"
              />
            </View>
          </View>
          <PrimaryButton
            label={t('settings.saveFx')}
            onPress={save}
            style={{ marginTop: space.lg }}
          />
        </View>
      </ListGroup>
    </SubPage>
  );
}
