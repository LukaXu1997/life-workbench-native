package com.luka.lifeworkbench.notify

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Captures notifications from user-allowlisted payment apps ONLY.
 *
 * Privacy boundaries (per design):
 *  - This listener never reads other apps' UIs (no AccessibilityService here).
 *    The separate TxnCaptureService provides Accessibility-based capture for apps
 *    like Touch 'n Go that post NO payment notification; both services share the
 *    same NotifyConfig gating + NotifyEnvelope format + transient queue.
 *  - Never touches the clipboard.
 *  - Never uses an overlay to watch payments.
 *  - Reads only title/text/bigText extras; drops everything else in memory.
 *  - Writes a transient envelope to a private queue file (drained & cleared by JS);
 *    the raw text is NOT persisted anywhere else.
 *  - Never logs notification content.
 */
class NotifyListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        try {
            if (sbn == null) return
            val pkg = sbn.packageName ?: return
            if (!NotifyConfig.isAllowed(pkg)) return
            val n = sbn.notification ?: return
            val extras = n.extras ?: return
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
            if (title.isEmpty() && text.isEmpty() && bigText.isEmpty()) return

            val env = JSONObject().apply {
                put("pkg", pkg)
                put("title", title)
                put("text", text)
                put("bigText", bigText)
                put("postedAt", sbn.postTime)
            }.toString()

            // Durable, transient queue (app-private; cleared by JS after ingest).
            val f = NotifyConfig.queueFile(applicationContext)
            synchronized(NotifyConfig) {
                f.appendText(env + "\n")
            }
            // Best-effort live emit (JS may be active).
            NotifyBridge.emit(env)
        } catch (_: Exception) {
            // Never crash the listener; never log notification content.
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Not needed for this feature.
    }
}
