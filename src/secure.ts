// Secure storage wrapper — uses Android Keystore-backed expo-secure-store when
// available, and transparently falls back to AsyncStorage (still works, just less
// secure) so the app never crashes if the native module is unavailable.
//
// Only SYNC PASSWORD and SUPABASE ANON KEY go through here. Normal user data
// (txns, accounts, etc.) stays in AsyncStorage as before.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SECURE_KEYS = {
  syncPass: 'wb_life_sync_pass_sec',
  sbKey: 'wb_life_sb_key_sec',
};

type SSModule = {
  isAvailableAsync: () => Promise<boolean>;
  getItemAsync: (k: string) => Promise<string | null>;
  setItemAsync: (k: string, v: string) => Promise<void>;
  deleteItemAsync: (k: string) => Promise<void>;
};

let _ss: SSModule | null | undefined;
function getSS(): SSModule | null {
  if (_ss !== undefined) return _ss;
  try {
    // Lazy require so a missing native module never breaks app startup.
    _ss = require('expo-secure-store') as SSModule;
  } catch {
    _ss = null;
  }
  return _ss;
}

export async function secureGet(key: string): Promise<string> {
  const ss = getSS();
  if (ss) {
    try {
      if (await ss.isAvailableAsync()) {
        const v = await ss.getItemAsync(key);
        return v ?? '';
      }
    } catch {
      /* fall through to AsyncStorage */
    }
  }
  const v = await AsyncStorage.getItem(key);
  return v ?? '';
}

export async function secureSet(key: string, val: string): Promise<void> {
  const ss = getSS();
  if (ss) {
    try {
      if (await ss.isAvailableAsync()) {
        await ss.setItemAsync(key, val);
        return;
      }
    } catch {
      /* fall through to AsyncStorage */
    }
  }
  await AsyncStorage.setItem(key, val);
}

export async function secureDelete(key: string): Promise<void> {
  const ss = getSS();
  if (ss) {
    try {
      if (await ss.isAvailableAsync()) await ss.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  }
  await AsyncStorage.removeItem(key);
}
