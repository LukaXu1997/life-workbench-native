package com.luka.lifeworkbench.quickadd

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.luka.lifeworkbench.notify.NotifyBridge
import com.luka.lifeworkbench.notify.NotifyConfig
import org.json.JSONObject
import java.util.Locale
import java.util.regex.Pattern

/**
 * On-device OCR fallback for the "auto-bookkeep after TnG payment" feature.
 *
 * When the user SHARES a payment screenshot into this app (explicit user action),
 * we recognize the text with ML Kit (bundled Latin model, fully on-device, no
 * network) and, if it contains an RM amount, emit the same NotifyEnvelope the
 * notification / accessibility pipelines consume (source = "ocr"). pkg is empty
 * because a screenshot has no source package; the recognizer + user confirmation
 * cover merchant/account selection.
 *
 * Privacy: only runs on a screenshot the user explicitly shared with us; the
 * recognized text is NOT persisted except the transient queue file (cleared by JS
 * after ingest), and only when it actually contains a payment amount.
 */
object OcrCapture {
    private val RM_RE = Pattern.compile(
        "RM\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)",
        Pattern.CASE_INSENSITIVE
    )

    fun recognize(context: Context, uri: Uri) {
        try {
            // fromFilePath accepts a content Uri (it opens an InputStream via
            // ContentResolver), so a shared screenshot URI works directly.
            val image = InputImage.fromFilePath(context, uri)
            val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            recognizer.process(image)
                .addOnSuccessListener { visionText ->
                    try {
                        val text = visionText.text ?: ""
                        if (text.isBlank()) return@addOnSuccessListener
                        // Only meaningful if it looks like a payment (has an RM amount).
                        if (!RM_RE.matcher(text).find()) return@addOnSuccessListener
                        val now = System.currentTimeMillis()
                        val env = JSONObject().apply {
                            put("pkg", "")
                            put("title", "")
                            put("text", text)
                            put("bigText", text)
                            put("postedAt", now)
                            put("source", "ocr")
                        }.toString()
                        val f = NotifyConfig.queueFile(context)
                        synchronized(NotifyConfig) {
                            f.appendText(env + "\n")
                        }
                        NotifyBridge.emit(env)
                    } finally {
                        recognizer.close()
                    }
                }
                .addOnFailureListener {
                    // OCR failed (bad image, model not ready): silently ignore; the
                    // user can still bookkeep manually.
                    try {
                        recognizer.close()
                    } catch (_: Exception) {
                        // ignore
                    }
                }
        } catch (_: Exception) {
            // Never crash on a bad image URI or missing permission.
        }
    }
}
