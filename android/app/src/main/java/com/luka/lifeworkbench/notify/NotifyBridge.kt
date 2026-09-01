package com.luka.lifeworkbench.notify

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Singleton relay between the long-lived NotificationListenerService and the
 * (possibly not-yet-loaded) React Native JS context. When the JS context is
 * active we emit a live event; otherwise the envelope is already persisted to
 * the durable queue file by the service, so nothing is lost.
 */
object NotifyBridge {
    @Volatile var reactContext: ReactApplicationContext? = null

    fun emit(envJson: String) {
        val ctx = reactContext ?: return
        if (!ctx.hasActiveReactInstance()) return
        try {
            ctx
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onNotifyReceived", envJson)
        } catch (_: Exception) {
            // JS not ready; queue file already holds the envelope.
        }
    }
}
