import { NativeModules, DeviceEventEmitter } from 'react-native';
import type { NotifyEnvelope } from './types';

const Native = NativeModules.NotifyModule;

export interface NotifyConfigInput {
  enabled: boolean;
  paused: boolean;
  allowlist: string[];
  captureEnabled?: boolean; // TnG real-time capture (AccessibilityService) active
  captureAllowlist?: string[]; // packages the accessibility service may read
}

/** Whether the user has granted notification access to this app. */
export function isListenerEnabled(): Promise<boolean> {
  return Native.isListenerEnabled().then((v: number) => v === 1);
}

/** Open the system notification-access settings page (call only on explicit user action). */
export function openNotifySettings(): void {
  Native.openSettings();
}

/** Whether the OS has granted this app the AccessibilityService permission for TnG capture. */
export function isTxnCaptureEnabled(): Promise<boolean> {
  return Native.isTxnCaptureEnabled().then((v: number) => v === 1);
}

/** Open the system accessibility settings page (call only on explicit user action). */
export function openAccessibilitySettings(): void {
  Native.openAccessibilitySettings();
}

/** Push the latest enable/pause/allowlist config down to the native service. */
export function setNotifyConfig(cfg: NotifyConfigInput): void {
  Native.setConfig(JSON.stringify(cfg));
}

/** Return and clear the durable envelope queue (called by JS on launch / focus). */
export function drainNotifyQueue(): Promise<NotifyEnvelope[]> {
  return Native.drainQueue().then((s: string) => {
    let arr: string[] = [];
    try {
      arr = JSON.parse(s) as string[];
    } catch {
      arr = [];
    }
    return arr
      .map((line) => {
        try {
          return JSON.parse(line) as NotifyEnvelope;
        } catch {
          return null;
        }
      })
      .filter((e): e is NotifyEnvelope => e !== null);
  });
}

export function clearNotifyQueue(): Promise<void> {
  return Native.clearQueue();
}

/** Subscribe to live notification events emitted by the native service. */
export function onNotifyReceived(cb: (env: NotifyEnvelope) => void): () => void {
  const sub = DeviceEventEmitter.addListener('onNotifyReceived', (json: string) => {
    try {
      cb(JSON.parse(json) as NotifyEnvelope);
    } catch {
      // ignore malformed payloads
    }
  });
  return () => sub.remove();
}
