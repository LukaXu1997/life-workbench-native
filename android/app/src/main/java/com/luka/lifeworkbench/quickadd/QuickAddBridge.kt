package com.luka.lifeworkbench.quickadd

import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.luka.lifeworkbench.notify.NotifyConfig

/**
 * Holds the latest deep-link URL and share payload captured from MainActivity intents.
 *
 * MainActivity writes here on every onCreate / onNewIntent; the JS side reads-and-clears
 * via QuickAddModule so each intent is handled exactly once. Works with the activity's
 * singleTask launch mode (cold start + warm start both funnel through here).
 *
 * On a warm relaunch while the app is already foreground, MainActivity.onNewIntent stores
 * the new intent here but JS's AppState 'active' handler does NOT fire (state was already
 * active), so the deep link would never be consumed. To cover that, we also emit a
 * dedicated RN device event the moment a *new* intent is captured, so JS can route it
 * immediately regardless of AppState.
 */
object QuickAddBridge {
  private var pendingUrl: String? = null
  private var pendingShareText: String? = null
  private var pendingShareImage: String? = null
  private var reactContext: ReactApplicationContext? = null

  /** Called by QuickAddModule.initialize() once the React bridge is up. */
  fun setReactContext(ctx: ReactApplicationContext) {
    reactContext = ctx
  }

  fun route(intent: Intent?) {
    if (intent == null) return
    var changed = false
    when (intent.action) {
      Intent.ACTION_VIEW -> {
        val data: Uri? = intent.data
        if (data != null) {
          pendingUrl = data.toString()
          changed = true
        }
      }
      Intent.ACTION_SEND -> {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        // The String-only overload is the only one safe across our minSdk (24). The typed
        // overload (String, Class) is API 33+ and would NoSuchMethodError on older devices.
        @Suppress("DEPRECATION")
        val stream = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (!text.isNullOrBlank()) {
          pendingShareText = text
          changed = true
        }
        val img = stream?.toString()
        if (!img.isNullOrBlank()) {
          pendingShareImage = img
          changed = true
          // Fire-and-forget OCR fallback: when the user enabled real-time capture and
          // shares a payment screenshot, recognize its text into a notify envelope.
          if (NotifyConfig.captureEnabled && stream != null) {
            reactContext?.let { OcrCapture.recognize(it, stream) }
          }
        }
      }
    }
    if (changed) emitIntent()
  }

  /** Wake JS even when the app is already in the foreground (warm relaunch / Tile / Shortcut). */
  private fun emitIntent() {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveReactInstance()) return
    try {
      ctx
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("quickAddIntent", null)
    } catch (_: Exception) {
      // JS not ready; the deep link/share stays in the bridge and is consumed on next mount/active.
    }
  }

  fun consumeUrl(): String? {
    val u = pendingUrl
    pendingUrl = null
    return u
  }

  fun consumeShare(): Pair<String?, String?> {
    val t = pendingShareText
    val i = pendingShareImage
    pendingShareText = null
    pendingShareImage = null
    return Pair(t, i)
  }
}
