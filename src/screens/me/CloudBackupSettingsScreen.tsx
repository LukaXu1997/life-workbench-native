import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme-context';
import { useI18n } from '../../i18n';
import { store } from '../../store';
import { M3Text, TextField, Switch } from '../../components/ui';
import { ListGroup, NavRow, PrimaryButton } from '../../components/kit';
import { Icon, ICONS } from '../../icons';
import { space } from '../../tokens';
import type { SbConfig } from '../../types';
import SubPage from './SubPage';

// §四 云备份「高级连接配置」。只负责 Supabase 连接参数与同步密码，
// 具体的备份 / 恢复动作在「数据与安全」页。
// §十二 敏感项永不展示明文：Key 与同步密码默认遮蔽，Key 需手动点眼睛才显示，
//       同步密码始终 secureTextEntry，且不写日志。
export default function CloudBackupSettingsScreen({ navigation }: { navigation: any }) {
  const { theme } = useTheme();
  const { t } = useI18n();

  const [cfg, setCfg] = useState<SbConfig>({
    url: '',
    key: '',
    bucket: 'backup',
    path: 'life-workbench-backup.json',
    enabled: false,
    lastSync: null,
  });
  const [pass, setPass] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    store.getSbConfig().then(setCfg);
    store.getSyncPass().then(setPass);
  }, []);

  const save = async () => {
    await store.setSbConfig(cfg);
    await store.setSyncPass(pass);
    setStatus(t('settings.cfgSaved'));
  };

  return (
    <SubPage title={t('me.cloudBackup')} onBack={() => navigation.goBack()}>
      <ListGroup title={t('settings.supabase')} footer={t('settings.backupHint')}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <TextField
            label={t('settings.urlLabel')}
            value={cfg.url}
            onChangeText={(v) => setCfg({ ...cfg, url: v })}
            placeholder="https://xxxx.supabase.co"
            autoCapitalize="none"
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <TextField
                label={t('settings.keyLabel')}
                value={cfg.key}
                onChangeText={(v) => setCfg({ ...cfg, key: v })}
                placeholder="eyJ..."
                autoCapitalize="none"
                secureTextEntry={!showKey}
              />
            </View>
            <TouchableOpacity
              onPress={() => setShowKey((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t('settings.toggleReveal')}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name={showKey ? ICONS.eyeOff : ICONS.eye} size={20} color={theme.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField
                label={t('settings.bucketLabel')}
                value={cfg.bucket}
                onChangeText={(v) => setCfg({ ...cfg, bucket: v })}
                placeholder="backup"
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label={t('settings.pathLabel')}
                value={cfg.path}
                onChangeText={(v) => setCfg({ ...cfg, path: v })}
                placeholder="life-workbench-backup.json"
                autoCapitalize="none"
              />
            </View>
          </View>

          <TextField
            label={t('settings.passLabel')}
            value={pass}
            onChangeText={setPass}
            placeholder={t('settings.passHint')}
            secureTextEntry
          />

          <PrimaryButton label={t('settings.saveCfg')} onPress={save} />

          {status ? (
            <M3Text role="labelMedium" color={theme.primary}>
              {status}
            </M3Text>
          ) : null}
        </View>
      </ListGroup>

      <ListGroup>
        <NavRow
          icon={ICONS.sync}
          title={t('settings.syncAuto')}
          subtitle={
            cfg.lastSync
              ? t('settings.lastSync', { time: new Date(cfg.lastSync).toLocaleString() })
              : undefined
          }
          trailing={
            <Switch
              value={cfg.enabled}
              onValueChange={(v) => {
                setCfg({ ...cfg, enabled: v });
                store.setSbEnabled(v);
              }}
              accessibilityLabel={t('settings.sync')}
            />
          }
        />
      </ListGroup>
    </SubPage>
  );
}
