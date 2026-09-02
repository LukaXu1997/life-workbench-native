package com.luka.lifeworkbench.notify

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * In-memory configuration shared between the RN module (writes) and the
 * NotificationListenerService (reads). Never stores raw notification text.
 */
object NotifyConfig {
    @Volatile var enabled: Boolean = false
    @Volatile var paused: Boolean = false
    @Volatile var captureEnabled: Boolean = false
    private val allowSet = mutableSetOf<String>()
    private val captureAllowSet = mutableSetOf<String>()

    /** Gating for the NotificationListenerService (banks / e-wallets that POST a notification). */
    fun isAllowed(pkg: String): Boolean = enabled && !paused && allowSet.contains(pkg)

    /**
     * Gating for the AccessibilityService (TxnCaptureService). Independent of the
     * notification feature's `paused` flag so TnG real-time capture can run on its own
     * toggle. Only packages the user explicitly selected for screen capture are read.
     */
    fun isCaptureAllowed(pkg: String): Boolean = captureEnabled && captureAllowSet.contains(pkg)

    fun update(json: String) {
        try {
            val o = JSONObject(json)
            enabled = o.optBoolean("enabled", false)
            paused = o.optBoolean("paused", false)
            captureEnabled = o.optBoolean("captureEnabled", false)
            allowSet.clear()
            val arr = o.optJSONArray("allowlist")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val p = arr.optString(i)
                    if (p.isNotEmpty()) allowSet.add(p)
                }
            }
            captureAllowSet.clear()
            val carr = o.optJSONArray("captureAllowlist")
            if (carr != null) {
                for (i in 0 until carr.length()) {
                    val p = carr.optString(i)
                    if (p.isNotEmpty()) captureAllowSet.add(p)
                }
            }
        } catch (_: Exception) {
            // Malformed config: keep previous state, never crash.
        }
    }

    fun queueFile(ctx: Context): File = File(ctx.filesDir, "notify_queue.jsonl")
}
