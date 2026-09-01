import React from 'react';
import { useI18n } from '../../i18n';
import NotifySettingsTab from '../NotifySettingsTab';
import SubPage from './SubPage';

// §四 从原 SettingsScreen 拆出：通知识别记账。
// 复用既有 NotifySettingsTab（权限、白名单、置信度、隐私说明），
// 识别/解析/去重逻辑一行未改，只是换了承载页面。
export default function NotificationSettingsScreen({ navigation }: { navigation: any }) {
  const { t } = useI18n();
  return (
    <SubPage title={t('settings.notifications')} onBack={() => navigation.goBack()}>
      <NotifySettingsTab />
    </SubPage>
  );
}
