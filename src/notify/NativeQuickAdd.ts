// Thin JS wrapper over the native QuickAdd bridge (deep links + share payloads).
//
// MainActivity captures ACTION_VIEW deep links and ACTION_SEND shares into a native
// singleton (QuickAddBridge). These methods read-and-clear that singleton so each
// intent is handled exactly once. Works reliably with the activity's singleTask launch
// mode (both cold-start onCreate and warm-start onNewIntent deliver here).

import { NativeModules } from 'react-native';

const Native = NativeModules.NativeQuickAdd;

export interface SharedPayload {
  text: string | null;
  imageUri: string | null;
}

/** Read & clear the pending deep-link URL (e.g. lifeworkbench://quick-add?type=income). */
export function getPendingQuickAddUrl(): Promise<string | null> {
  if (!Native || !Native.getPendingUrl) return Promise.resolve(null);
  return Native.getPendingUrl();
}

/** Read & clear the pending share payload (text/plain + optional image stream). */
export function getPendingShare(): Promise<SharedPayload | null> {
  if (!Native || !Native.getPendingShare) return Promise.resolve(null);
  return Native.getPendingShare();
}
