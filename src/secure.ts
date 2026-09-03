// Secure storage wrapper — uses Android Keystore-backed expo-secure-store when
// available. Two policies apply:
//
//   STRICT  (sync password): MUST live only in the OS secure store. If the
//            secure store is unavailable or the write fails, we throw rather
//            than silently writing the secret to AsyncStorage. Callers disable
//            cloud backup/sync and surface a recoverable error to the user.
//
//   FALLBACK (Supabase anon key, treated as non-secret): if the secure store is
//            missing, AsyncStorage is an acceptable degraded location.
//
// Only the SYNC PASSWORD and SUPABASE ANON KEY go through here. Normal user data
// (txns, accounts, etc.) stays in AsyncStorage as before.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SECURE_KEYS = {
  syncPass: 'wb_life_sync_pass_sec',
  sbKey: 'wb_life_sb_key_sec',
};

// STRICT keys are never downgraded to plaintext AsyncStorage.
const STRICT_KEYS = new Set<string>([SECURE_KEYS.syncPass]);

/** Thrown when a STRICT secret cannot be written to the OS secure store. */
export class SecureStoreUnavailableError extends Error {
  constructor(key: string) {
    super(
      `Secure store unavailable: cannot safely persist "${key}". ` +
      'Cloud backup/sync has been disabled to avoid storing your password in plaintext.'
    );
    this.name = 'SecureStoreUnavailableError';
  }
}

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

function isStrict(key: string): boolean {
  return STRICT_KEYS.has(key);
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
      /* fall through */
    }
  }
  // STRICT secrets are never read from AsyncStorage — if the OS secure store
  // is unavailable we report "not set" rather than corroborating/leaking
  // anything from an insecure fallback.
  if (isStrict(key)) return '';
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
      /* fall through */
    }
  }
  // STRICT secrets MUST NOT be downgraded to AsyncStorage plaintext. Fail loud.
  if (isStrict(key)) {
    throw new SecureStoreUnavailableError(key);
  }
  await AsyncStorage.setItem(key, val);
}

export async function secureDelete(key: string): Promise<void> {
  const ss = getSS();
  if (ss) {
    try {
      if (await ss.isAvailableAsync()) await ss.deleteItemAsync(key);
    } catch {
      /* ignore native failure */
    }
  }
  // For STRICT secrets there is nothing in AsyncStorage to delete; for FALLBACK
  // secrets we also clear the degraded copy.
  if (!isStrict(key)) {
    await AsyncStorage.removeItem(key);
  }
}
