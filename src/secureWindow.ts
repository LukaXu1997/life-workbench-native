// Bridge to the native FLAG_SECURE window module (com.luka.lifeworkbench.securewindow).
//
// FLAG_SECURE prevents the system from taking screenshots and from showing the app
// in the recent-tasks thumbnail (privacy mask). JS alone cannot do this — it needs
// the native layer. The module is registered manually in MainApplication.getPackages().
import { NativeModules } from 'react-native';

const NativeSecureWindow = (NativeModules as Record<string, any>).NativeSecureWindow;

/** Enable / disable FLAG_SECURE. No-op when the native module is unavailable. */
export async function setSecureWindow(secure: boolean): Promise<void> {
  if (!NativeSecureWindow || typeof NativeSecureWindow.setSecure !== 'function') return;
  try {
    await NativeSecureWindow.setSecure(secure);
  } catch {
    /* best-effort; ignore if the activity is momentarily unavailable */
  }
}
