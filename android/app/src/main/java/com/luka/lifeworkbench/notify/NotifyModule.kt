package com.luka.lifeworkbench.notify

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import java.io.File

class NotifyModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NotifyModule"

    /** Whether the user has granted notification access to this app. */
    @ReactMethod
    fun isListenerEnabled(promise: Promise) {
        try {
            promise.resolve(if (isNotificationListenerEnabled(reactContext)) 1 else 0)
        } catch (_: Exception) {
            promise.resolve(0)
        }
    }

    private fun isNotificationListenerEnabled(context: Context): Boolean {
        val flat = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        ) ?: return false
        if (flat.isEmpty()) return false
        val pkg = context.packageName
        return flat.split(":").any { it.startsWith(pkg) }
    }

    /** Open the system notification-access settings page (user-initiated only). */
    @ReactMethod
    fun openSettings() {
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
        } catch (_: Exception) {
            // No-op if settings cannot be opened.
        }
    }

    /**
     * Whether the user has granted this app the AccessibilityService permission for
     * real-time TnG capture (TxnCaptureService). Reflects the OS grant state, not the
     * in-app toggle — the in-app toggle only requests; this reports the actual grant.
     */
    @ReactMethod
    fun isTxnCaptureEnabled(promise: Promise) {
        try {
            val comp = ComponentName(reactContext.packageName, TxnCaptureService::class.java.name)
            // Ground-truth check: the OS stores the enabled accessibility services as a
            // colon-separated list of flattened component names in Secure settings. The
            // entries use the SHORT form (pkg/.ServiceName), so we compare via ComponentName
            // (which normalizes both short and long forms) rather than raw string equality.
            val flat = Settings.Secure.getString(
                reactContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val bySetting = flat.split(":").any { entry ->
                val c = ComponentName.unflattenFromString(entry)
                c != null && c == comp
            }
            // Secondary check via the AccessibilityManager API (resolveInfo is the canonical
            // ComponentName and avoids the short/long flatten ambiguity of AccessibilityServiceInfo.id).
            val am = reactContext.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
            val byManager = am
                ?.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                ?.any {
                    val si = it.resolveInfo?.serviceInfo
                    si != null && ComponentName(si.packageName, si.name) == comp
                }
                ?: false
            promise.resolve(if (bySetting || byManager) 1 else 0)
        } catch (_: Exception) {
            promise.resolve(0)
        }
    }

    /** Open the system accessibility settings page (user-initiated only). */
    @ReactMethod
    fun openAccessibilitySettings() {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
        } catch (_: Exception) {
            // No-op if settings cannot be opened.
        }
    }

    /** Push the latest enable/pause/allowlist config from JS into the service. */
    @ReactMethod
    fun setConfig(configJson: String) {
        NotifyConfig.update(configJson)
    }

    /** Return and clear the durable envelope queue (called by JS on launch/focus). */
    @ReactMethod
    fun drainQueue(promise: Promise) {
        try {
            val f: File = NotifyConfig.queueFile(reactContext)
            if (!f.exists()) {
                promise.resolve("[]")
                return
            }
            val lines = f.readLines().filter { it.isNotBlank() }
            f.writeText("") // clear after reading
            val arr = JSONArray()
            for (line in lines) arr.put(line)
            promise.resolve(arr.toString())
        } catch (_: Exception) {
            promise.resolve("[]")
        }
    }

    @ReactMethod
    fun clearQueue(promise: Promise) {
        try {
            val f = NotifyConfig.queueFile(reactContext)
            if (f.exists()) f.writeText("")
        } catch (_: Exception) {
            // ignore
        }
        promise.resolve(null)
    }

    override fun initialize() {
        super.initialize()
        NotifyBridge.reactContext = reactContext
    }

    override fun invalidate() {
        NotifyBridge.reactContext = null
        super.invalidate()
    }
}
