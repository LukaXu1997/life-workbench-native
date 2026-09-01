import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme, Appearance } from 'react-native';
import { resolveTheme, ThemeMode, Theme, isNightTime } from './theme';
import { isDarkFromMode } from './statusBar';
import { store, onChange } from './store';

interface Ctx {
  theme: Theme;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
}
const ThemeCtx = createContext<Ctx>({ theme: resolveTheme('light'), mode: 'system', isDark: false, setMode: () => {} });

/**
 * ThemeProvider — resolves light/dark theme based on user preference.
 *
 * Detection priority:
 *   1. useColorScheme() hook (reactive, RN's recommended API)
 *   2. Appearance.getColorScheme() fallback (sync read for Android compat)
 *   3. Appearance.addChangeListener (catches mid-session OS toggles)
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const rnHook = useColorScheme();

  // System color scheme state — initialized sync, updated by hook + listener
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    try { return Appearance.getColorScheme() === 'dark'; }
    catch { return false; }
  });

  // Sync hook value into state
  useEffect(() => {
    if (rnHook !== null) setSystemDark(rnHook === 'dark');
  }, [rnHook]);

  // Backup listener for Android compatibility
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (colorScheme != null) setSystemDark(colorScheme === 'dark');
    });
    return () => sub.remove();
  }, []);

  // Minute tick — drives the 'auto' (time-based) mode so the theme flips at the
  // day/night boundary even if the app stays foregrounded.
  const [, setMinute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinute((m) => (m + 1) % 1440), 60_000);
    return () => clearInterval(id);
  }, []);

  // User's chosen mode: 'system' | 'light' | 'dark' | 'auto'
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load persisted preference
  useEffect(() => {
    store.getTheme().then((m) => setModeState((m as ThemeMode) || 'auto'));
    const unsub = onChange(() => {
      store.getTheme().then((m) => setModeState((m as ThemeMode) || 'auto'));
    });
    return () => { unsub(); };
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    store.setTheme(m);
  };

  // Final resolution
  //  · 'dark'                         → always dark
  //  · 'system'                       → follow OS dark setting
  //  · 'auto'                         → dark between 19:00–06:59 (local time)
  //  · 'light'                        → always light
  const autoDark = mode === 'auto' && isNightTime();
  const isDark = mode === 'dark' || (mode === 'system' && systemDark) || autoDark;
  const effectiveMode = isDark ? 'dark' : 'light';
  const theme = resolveTheme(effectiveMode);

  return <ThemeCtx.Provider value={{ theme, mode, isDark, setMode }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  return useContext(ThemeCtx);
}
