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
    private val allowSet = mutableSetOf<String>()

    fun isAllowed(pkg: String): Boolean = enabled && !paused && allowSet.contains(pkg)

    fun update(json: String) {
        try {
            val o = JSONObject(json)
            enabled = o.optBoolean("enabled", false)
            paused = o.optBoolean("paused", false)
            allowSet.clear()
            val arr = o.optJSONArray("allowlist")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val p = arr.optString(i)
                    if (p.isNotEmpty()) allowSet.add(p)
                }
            }
        } catch (_: Exception) {
            // Malformed config: keep previous state, never crash.
        }
    }

    fun queueFile(ctx: Context): File = File(ctx.filesDir, "notify_queue.jsonl")
}
