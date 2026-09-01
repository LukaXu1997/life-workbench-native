// Pure (React-Native-free) helpers for status-bar appearance.
// Kept RN-free so it can be unit-tested under plain Node AND imported by
// theme-context.tsx / App.tsx without pulling in react-native in tests.

export type ThemeMode = 'light' | 'dark' | 'system';

/** Resolve whether the active theme is dark from the app mode + system setting. */
export function isDarkFromMode(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark);
}

/**
 * Map a dark/light theme to the Android StatusBar icon style.
 *  - light theme  -> 'dark-content'  (dark icons on a light bar)
 *  - dark theme   -> 'light-content' (light icons on a dark bar)
 */
export function barStyleFor(isDark: boolean): 'dark-content' | 'light-content' {
  return isDark ? 'light-content' : 'dark-content';
}
