package com.luka.lifeworkbench.notify

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.util.Locale
import java.util.regex.Pattern

/**
 * Real-time TnG (and other allowlisted e-wallet) payment capture via the Android
 * AccessibilityService.
 *
 * Why this exists: Touch 'n Go does NOT post a system notification when a payment
 * succeeds, so the NotificationListenerService (NotifyListener) never sees the
 * transaction. This service reads ONLY the on-screen TEXT NODES of allowlisted
 * packages while the user is on a payment-success screen and emits the very same
 * NotifyEnvelope the notification pipeline consumes (source = "accessibility").
 *
 * Privacy boundaries (per design, explicit and intentional):
 *  - Reads text nodes only — never takes screenshots, never reads the clipboard,
 *    never uses an overlay to watch payments.
 *  - Only acts on packages the user explicitly selected for capture
 *    (NotifyConfig.isCaptureAllowed), and only when the feature is enabled.
 *  - The extracted screen text is NOT persisted anywhere except the transient queue
 *    file (cleared by JS after ingest), exactly like notifications.
 *  - Never logs screen content. Diagnostics below record ONLY package name, a boolean
 *    match result, and the screen text length — never the text itself.
 */

/** Debug switch. Diagnostics record package name + boolean match flags + screen length
 *  (no screen text, no amount). Set to false for a production-stable build. */
private const val DIAGNOSE = false
private const val TAG = "TxnCapture"
private fun d(msg: String) { if (DIAGNOSE) Log.d(TAG, msg) }

class TxnCaptureService : AccessibilityService() {

    // Success-screen keywords (case-insensitive). A capture requires BOTH an amount
    // (RM for MYR e-wallets, ¥/元 for CN apps like Pinduoduo) AND one of these
    // keywords on the same screen, to avoid grabbing a wallet/cart home screen (which
    // also shows a balance) or other non-payment views.
    private val SUCCESS_KEYWORDS = listOf(
        "berjaya",      // Malay: "Transaksi Berjaya" (TnG success)
        "success",
        "successful",
        "completed",
        "paid",
        "dibayar",      // Malay: paid
        "支付成功",
        "交易成功",
        "付款成功",
        "完成",
        "成功"
    )

    // RM amount: "RM 12.50" / "RM12.50" / "RM 1,234.00"  (MYR e-wallets: TnG, Grab, …)
    private val RM_RE = Pattern.compile(
        "RM\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)",
        Pattern.CASE_INSENSITIVE
    )

    // CNY amount: "¥12.50" / "￥12.50" / "12.50元"  (CN apps: Pinduoduo 拼多多, …)
    private val CNY_RE = Pattern.compile(
        "[¥￥]\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)",
        Pattern.CASE_INSENSITIVE
    )
    private val YUAN_RE = Pattern.compile(
        "(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)\\s*元",
        Pattern.CASE_INSENSITIVE
    )

    // Same-screen dedup: last emitted signature + time, to suppress the burst of
    // window-content-changed events a single success screen generates.
    @Volatile private var lastSig: String? = null
    @Volatile private var lastEmit: Long = 0
    private val DEDUP_MS = 6000L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        try {
            if (event == null) return
            val type = event.eventType
            if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
                type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            ) return

            val pkg = event.packageName?.toString() ?: return
            d("event type=${typeToString(type)} pkg=$pkg")
            // Only act on user-allowlisted packages for capture (gated by enable too).
            val allow = NotifyConfig.isCaptureAllowed(pkg)
            d("allow=$allow")
            if (!allow) return

            var root = rootInActiveWindow
            if (root == null) {
                d("root=null (no active window)")
                return
            }
            // WebView/H5 success pages sometimes populate nodes a tick later; one refresh
            // retry helps when the event fires just before the content is attached.
            if (!root.refresh()) {
                d("root.refresh()=false")
            }
            val sb = StringBuilder()
            collectText(root, sb)
            val screen = sb.toString()
            d("screenLen=${screen.length}")
            if (screen.isBlank()) return

            // Require an amount (RM for MYR e-wallets, ¥/元 for CN apps like Pinduoduo)
            // AND a success keyword on the same screen.
            val rmM = RM_RE.matcher(screen)
            val rm = rmM.find()
            val cnyM = CNY_RE.matcher(screen)
            val cny = cnyM.find()
            val yuanM = YUAN_RE.matcher(screen)
            val yuan = yuanM.find()
            d("rm=$rm cny=$cny yuan=$yuan")
            if (!rm && !cny && !yuan) return
            val amount = if (rm) rmM.group(0) else if (cny) cnyM.group(0) else yuanM.group(0)
            val low = screen.lowercase(Locale.ROOT)
            val hasSuccess = SUCCESS_KEYWORDS.any { low.contains(it) }
            d("success=$hasSuccess")
            if (!hasSuccess) return

            // Build a stable signature for dedup (package + amount + leading screen text).
            val sig = "$pkg|$amount|${screen.take(120)}"
            val now = System.currentTimeMillis()
            if (sig == lastSig && now - lastEmit < DEDUP_MS) return
            lastSig = sig
            lastEmit = now

            val env = JSONObject().apply {
                put("pkg", pkg)
                put("title", "") // accessibility has no title/text split like notifications
                put("text", screen)
                put("bigText", screen)
                put("postedAt", now)
                put("source", "accessibility")
            }.toString()

            // Durable, transient queue (app-private; cleared by JS after ingest).
            val f = NotifyConfig.queueFile(applicationContext)
            synchronized(NotifyConfig) {
                f.appendText(env + "\n")
            }
            // Best-effort live emit (JS may be active).
            NotifyBridge.emit(env)
            d("CAPTURED pkg=$pkg")
        } catch (_: Exception) {
            // Never crash the service; never log screen content.
        }
    }

    private fun typeToString(type: Int): String = when (type) {
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "WINDOW_STATE"
        AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "WINDOW_CONTENT"
        else -> type.toString()
    }

    private fun collectText(node: AccessibilityNodeInfo?, out: StringBuilder) {
        if (node == null) return
        val txt = node.text
        if (txt != null && txt.isNotBlank()) {
            out.append(txt).append("\n")
        }
        val cnt = node.childCount
        for (i in 0 until cnt) {
            collectText(node.getChild(i), out)
        }
    }

    override fun onInterrupt() {
        // No-op.
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        d("service connected")
        // Nothing extra: capture config is pushed from JS via NotifyModule.setConfig.
    }
}
