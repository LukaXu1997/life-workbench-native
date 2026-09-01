import { createNavigationContainerRef } from '@react-navigation/native';

// §二 全局导航引用。
// NotifyNavProvider 位于 NavigationContainer 之下、RootStack 之上，
// 因此无法用 useNavigation()；改用容器 ref 直接派发到 RootStack。
export const navRef = createNavigationContainerRef<any>();

export function rootNavigate(name: string, params?: object) {
  if (!navRef.isReady()) return;
  // 泛型为 any 时 navigate 的重载推断会退化成 never，这里显式放宽
  (navRef.navigate as (n: string, p?: object) => void)(name, params);
}

export function rootGoBack() {
  if (navRef.isReady() && navRef.canGoBack()) navRef.goBack();
}
