// Test-only shim for the crypto/secure unit suite.
//
// Under plain Node (where the real AsyncStorage native module is unavailable —
// it throws "window is not defined") the FALLBACK key policy (sbKey downgrade to
// AsyncStorage) cannot be exercised. We inject a deterministic in-memory stub
// into require.cache BEFORE secure.ts is loaded, so secureSet(SECURE_KEYS.sbKey)
// writes to the stub and secureGet reads it back. This file must be imported
// first by the test suite so the cache is patched before secure.ts requires the
// module.
const mem: Record<string, string> = {};

const AsyncStub = {
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(k in mem ? mem[k] : null),
    setItem: (k: string, v: string) => {
      mem[k] = String(v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      delete mem[k];
      return Promise.resolve();
    },
    clear: () => {
      for (const k of Object.keys(mem)) delete mem[k];
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve(Object.keys(mem)),
  },
};

const id = require.resolve('@react-native-async-storage/async-storage');
// Cast: we intentionally install a minimal stub in the require cache; the full
// NodeModule shape is not needed for the test's purposes.
require.cache[id] = {
  id,
  filename: id,
  loaded: true,
  exports: AsyncStub,
} as any;
