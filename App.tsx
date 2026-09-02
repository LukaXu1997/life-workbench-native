import React, { useEffect, useCallback, useState } from 'react';
import { View, StatusBar, AppState, ActivityIndicator, DeviceEventEmitter, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import Inter_400Regular from './assets/fonts/Inter_400Regular.ttf';
import Inter_500Medium from './assets/fonts/Inter_500Medium.ttf';
import Inter_600SemiBold from './assets/fonts/Inter_600SemiBold.ttf';
import Inter_700Bold from './assets/fonts/Inter_700Bold.ttf';
import { ThemeProvider, useTheme } from './src/theme-context';
import { I18nProvider } from './src/i18n';
import HomeScreen from './src/screens/HomeScreen';
import TasksScreen from './src/screens/TasksScreen';
import HabitDetailScreen from './src/screens/HabitDetailScreen';
import FinanceScreen from './src/screens/FinanceScreen';
import DiaryScreen from './src/screens/DiaryScreen';
import MeScreen from './src/screens/MeScreen';
import PendingScreen from './src/screens/PendingScreen';
import ConfirmTxnScreen from './src/screens/ConfirmTxnScreen';
import QuickAddScreen from './src/screens/QuickAddScreen';
import AppearanceSettingsScreen from './src/screens/me/AppearanceSettingsScreen';
import LanguageSettingsScreen from './src/screens/me/LanguageSettingsScreen';
import FinancePreferencesScreen from './src/screens/me/FinancePreferencesScreen';
import NotificationSettingsScreen from './src/screens/me/NotificationSettingsScreen';
import DataAndSecurityScreen from './src/screens/me/DataAndSecurityScreen';
import AboutScreen from './src/screens/me/AboutScreen';
import { AppTabBar } from './src/components/AppTabBar';
import { NotifyNavProvider, useNotifyNav } from './src/notify/NotifyNav';
import { ensureReceiverStarted, startNotifyReceiver, getNotifySettings, applyNotifyConfig } from './src/notify/pendingStore';
import { parseQuickAddUrl, parseSharedText } from './src/notify/quickAdd';
import { getPendingQuickAddUrl, getPendingShare } from './src/notify/NativeQuickAdd';
import { navRef } from './src/navigationRef';
import { SystemBars } from 'react-native-edge-to-edge';
import { store } from './src/store';
import { generateRecurring } from './src/recurring';
import { OnboardingWizard } from './src/components/OnboardingWizard';
import { BiometricGate } from './src/components/BiometricGate';
import { setSecureWindow } from './src/secureWindow';
import * as Notifications from 'expo-notifications';
import { ensureNotificationChannels, ensureNotificationHandler, rescheduleAll } from './src/reminder';
import { rootNavigate } from './src/navigationRef';

// ─────────────────────────────────────────────────────────────────────────────
// §二 导航结构
//
// RootStack
//  ├── MainTabs                      ← 四个一级入口，浮动胶囊底栏
//  │    ├── 今日  → TodayStack       ← Home, Diary(速记)
//  │    ├── 计划  → PlanStack        ← Tasks
//  │    ├── 财务  → FinanceStack     ← FinanceHome
//  │    └── 我的  → MeStack          ← MeHome + 7 个设置子页
//  ├── QuickAdd                      ← 快速记账（底栏「+」/ Tile / 分享）
//  ├── PendingTransactions           ← 待确认交易
//  └── ConfirmTransaction            ← 确认单笔交易
//
// 关键点：
//  · 不再有 tabBarButton: () => null 的「隐藏 tab」——「记录/速记」改成
//    今日栈里的一个二级页，用返回键回退。
//  · 二级页在栈里 push，Android 物理返回键 / 手势返回自动按层级回退。
//  · 一级 tab 之外的页面不渲染底栏（AppTabBar 会在嵌套栈深度 > 0 时自动隐藏）。
// ─────────────────────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const TodayNav = createNativeStackNavigator();
const PlanNav = createNativeStackNavigator();
const FinanceNav = createNativeStackNavigator();
const MeNav = createNativeStackNavigator();

const stackOpts = { headerShown: false, animation: 'fade' } as const;

function TodayStack() {
  return (
    <TodayNav.Navigator screenOptions={stackOpts}>
      <TodayNav.Screen name="TodayHome" component={HomeScreen} />
      <TodayNav.Screen name="Diary" component={DiaryScreen} />
    </TodayNav.Navigator>
  );
}

function PlanStack() {
  return (
    <PlanNav.Navigator screenOptions={stackOpts}>
      <PlanNav.Screen name="PlanHome" component={TasksScreen} />
      <PlanNav.Screen name="HabitDetail" component={HabitDetailScreen} />
    </PlanNav.Navigator>
  );
}

function FinanceStack() {
  return (
    <FinanceNav.Navigator screenOptions={stackOpts}>
      <FinanceNav.Screen name="FinanceHome" component={FinanceScreen} />
    </FinanceNav.Navigator>
  );
}

function MeStack() {
  return (
    <MeNav.Navigator screenOptions={stackOpts}>
      <MeNav.Screen name="MeHome" component={MeScreen} />
      <MeNav.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
      <MeNav.Screen name="LanguageSettings" component={LanguageSettingsScreen} />
      <MeNav.Screen name="FinancePreferences" component={FinancePreferencesScreen} />
      <MeNav.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <MeNav.Screen name="DataAndSecurity" component={DataAndSecurityScreen} />
      <MeNav.Screen name="About" component={AboutScreen} />
    </MeNav.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props: any) => <AppTabBar {...props} />}
    >
      <Tab.Screen name="今日" component={TodayStack} />
      <Tab.Screen name="计划" component={PlanStack} />
      <Tab.Screen name="财务" component={FinanceStack} />
      <Tab.Screen name="我的" component={MeStack} />
    </Tab.Navigator>
  );
}

// RootStack 上的三个页面原来是自建 overlay，现在成为真实路由；
// 这两个薄包装只负责把 route.params 转成组件既有的 props，组件本身零改动。
function QuickAddRoute({ route }: any) {
  return <QuickAddScreen draft={route?.params?.draft} />;
}
function ConfirmTxnRoute({ route }: any) {
  return <ConfirmTxnScreen id={route?.params?.id} />;
}

function Root() {
  const nav = useNotifyNav();
  const { theme, isDark } = useTheme();
  const [fontsLoaded] = useFonts({
    MaterialCommunityIcons: require('./assets/fonts/MaterialCommunityIcons.ttf'),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [bioOnEntry, setBioOnEntry] = useState<boolean | null>(null);
  const [bioOnReturn, setBioOnReturn] = useState(false);
  const [bioAutoLockMs, setBioAutoLockMs] = useState(30_000);
  const [bioHideRecents, setBioHideRecents] = useState(false);
  const [bioDeviceFallback, setBioDeviceFallback] = useState(true);
  const [bioSecurity, setBioSecurity] = useState<'standard' | 'high'>('standard');
  const [appInactive, setAppInactive] = useState(false);

  // Load the first-launch flag, the app-lock settings, and the lock security pref
  // (null = still loading so we don't flash app content before the lock gate
  // has made its decision).
  useEffect(() => {
    Promise.all([
      store.getOnboarded(),
      store.getBiometricOnEntry(),
      store.getBiometricOnReturn(),
      store.getBiometricAutoLockMs(),
      store.getBiometricHideRecents(),
      store.getBiometricDeviceFallback(),
      store.getBiometricSecurity(),
    ]).then(([ob, onEntry, onRet, lockMs, hide, fb, sec]) => {
      setOnboarded(ob);
      setBioOnEntry(onEntry);
      setBioOnReturn(onRet);
      setBioAutoLockMs(lockMs);
      setBioHideRecents(hide);
      setBioDeviceFallback(fb);
      setBioSecurity(sec);
    });
  }, []);

  // Apply FLAG_SECURE whenever the setting is loaded or changed, so the recent-tasks
  // preview is hidden (privacy mask). No-op when the native module is unavailable.
  useEffect(() => {
    if (bioOnEntry === null) return;
    setSecureWindow(bioHideRecents);
  }, [bioHideRecents, bioOnEntry]);

  // Recurring transactions: generate any now-due next occurrence on each launch.
  // Pure + forward-only (see src/recurring.ts); no-op when there are no templates.
  useEffect(() => {
    (async () => {
      try {
        const txns = await store.getTxns();
        const { txns: next, added } = generateRecurring(txns);
        if (added.length) await store.setTxns(next);
      } catch {
        /* best-effort; never block launch */
      }
    })();
  }, []);

  // V2.13.0 — reminders: install the notification handler, create the Android
  // channels (task-reminders + habit-reminders), and re-sync every scheduled
  // reminder from the current task + habit stores.
  // Runs once on cold start; foreground re-sync is handled by the AppState listener below.
  useEffect(() => {
    ensureNotificationHandler();
    (async () => {
      try {
        await ensureNotificationChannels();
        await rescheduleAll();
      } catch {
        /* best-effort; never block launch */
      }
    })();
  }, []);

  // Edge-to-edge is enabled natively by react-native-edge-to-edge (it makes both
  // the status & navigation bars transparent on host resume). Here we only drive
  // the *icon contrast* of the bars from the app theme. We deliberately do NOT
  // set a solid status-bar background — that would defeat the transparent bar.
  useEffect(() => {
    StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content', true);
  }, [isDark]);

  // Route a pending deep link (Tile / Shortcut) or share payload into QuickAddScreen.
  const routePendingIntents = useCallback(async () => {
    try {
      const url = await getPendingQuickAddUrl();
      if (url) {
        const draft = parseQuickAddUrl(url);
        if (draft) { nav.openQuickAdd(draft); return; }
      }
      const share = await getPendingShare();
      if (share?.text) nav.openQuickAdd(parseSharedText(share.text));
    } catch { /* ignore */ }
  }, [nav]);

  // Start notification receiver and drain durable queue on foreground return.
  useEffect(() => {
    const off = ensureReceiverStarted();
    // Push the persisted notify config (incl. TnG real-time capture) down to native so
    // the AccessibilityService is active immediately after a cold launch, not only after
    // the user re-opens settings.
    getNotifySettings().then(applyNotifyConfig).catch(() => {});
    routePendingIntents();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startNotifyReceiver();
        routePendingIntents();
        // V2.13.0 — re-sync reminders (tasks + habits) when returning to the foreground.
        rescheduleAll().catch(() => {});
      }
    });
    const sub2 = DeviceEventEmitter.addListener('quickAddIntent', () => routePendingIntents());
    // Re-running onboarding from Settings flips the first-launch flag back to false,
    // which re-shows the wizard overlay (see Root's `onboarded === false` render).
    const sub3 = DeviceEventEmitter.addListener('rerunOnboarding', () => setOnboarded(false));
    // V2.13.0 — tapping a task/habit reminder opens the Plan tab.
    const sub4 = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = response.notification.request.identifier;
      if (id.startsWith('task-') || id.startsWith('habit-')) rootNavigate('MainTabs', { screen: '计划' });
    });
    return () => { off(); sub.remove(); sub2.remove(); sub3.remove(); sub4.remove(); };
  }, [routePendingIntents]);

  // Privacy mask: keep an opaque theme background covering the screen while the app
  // is not active (cold start / backgrounded / resuming). We hold it ~220ms after
  // becoming active so the underlying content paints first — this prevents the
  // night white flash in dark mode. When the lock gate is showing it is also an
  // opaque theme.bg layer, so the two are visually identical and seamless.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setTimeout(() => setAppInactive(false), 220);
      } else {
        setAppInactive(true);
      }
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return <AppLoading />;
  // Keep the splash until flags resolve, so a locked app never flashes content.
  if (onboarded === null || bioOnEntry === null) return <AppLoading />;

  const effectiveEnabled = (bioOnEntry ?? false) || (bioOnReturn ?? false);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar translucent={true} backgroundColor="transparent" barStyle={isDark ? 'light-content' : 'dark-content'} />
      {/* Notion-style transparent system bars: <SystemBars> keeps the status- and
          navigation-bar icon contrast in sync with the app theme. */}
      <SystemBars style={isDark ? 'light' : 'dark'} />
      <BiometricGate
        onEntry={bioOnEntry ?? false}
        onReturn={bioOnReturn ?? false}
        autoLockMs={bioAutoLockMs ?? 30_000}
        deviceFallback={bioDeviceFallback ?? true}
        security={bioSecurity}
      >
        <RootStack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
          <RootStack.Screen name="MainTabs" component={MainTabs} />
          <RootStack.Screen
            name="QuickAdd"
            component={QuickAddRoute}
            options={{ animation: 'slide_from_bottom' }}
          />
          <RootStack.Screen name="PendingTransactions" component={PendingScreen} />
          <RootStack.Screen name="ConfirmTransaction" component={ConfirmTxnRoute} />
        </RootStack.Navigator>

        {onboarded === false && <OnboardingWizard onDone={() => setOnboarded(true)} />}
      </BiometricGate>

      {/* 隐私遮罩：非活跃态（冷启动 / 后台 / 恢复瞬间）盖住屏幕，防止夜间白闪 */}
      {appInactive ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]} pointerEvents="none" />
      ) : null}
    </View>
  );
}

function AppLoading() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <ThemeProvider>
          <NavigationContainer ref={navRef}>
            <NotifyNavProvider>
              <Root />
            </NotifyNavProvider>
          </NavigationContainer>
        </ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
