package com.luka.lifeworkbench.pdf

import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.InputStream

/**
 * Local, on-device PDF text extractor for the unified importer.
 *
 * Privacy / security contract:
 *  - No file is uploaded anywhere; extraction is done entirely in-process.
 *  - The PDF password (if any) is ONLY ever passed as a method argument. It is
 *    never written to disk, logs, shared prefs, or any other storage.
 *  - For scanned (text-layer-less) PDFs we return scanned=true with empty text
 *    and NO OCR (Phase 4 scope).
 */
class PdfTextExtractorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PdfTextExtractor"

    @ReactMethod
    fun extractText(uri: String, password: String?, promise: Promise) {
        var input: InputStream? = null
        var doc: PDDocument? = null
        try {
            // PDFBox-Android needs its resource loader initialized once per process.
            PDFBoxResourceLoader.init(reactContext.applicationContext)

            val ctx: Context = reactContext.applicationContext
            val contentUri = Uri.parse(uri)
            input = ctx.contentResolver.openInputStream(contentUri)
                ?: return promise.reject("NO_FILE", "Cannot open file: $uri")

            // Password is used ONLY for this single load call and discarded.
            doc = if (password.isNullOrEmpty()) {
                PDDocument.load(input)
            } else {
                PDDocument.load(input, password)
            }

            val stripper = PDFTextStripper()
            stripper.sortByPosition = true
            val text = stripper.getText(doc) ?: ""
            val scanned = text.trim().isEmpty()

            val result: WritableMap = Arguments.createMap()
            result.putString("text", text)
            result.putBoolean("encrypted", false)
            result.putBoolean("wrongPassword", false)
            result.putBoolean("scanned", scanned)
            promise.resolve(result)
        } catch (e: InvalidPasswordException) {
            // Encrypted PDF: either no password was given, or the given one was wrong.
            val result: WritableMap = Arguments.createMap()
            result.putString("text", "")
            result.putBoolean("encrypted", true)
            result.putBoolean("wrongPassword", !password.isNullOrEmpty())
            result.putBoolean("scanned", false)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("PDF_EXTRACT_FAILED", e.message ?: "PDF extract failed")
        } finally {
            try { doc?.close() } catch (_: Exception) { /* no-op */ }
            try { input?.close() } catch (_: Exception) { /* no-op */ }
        }
    }
}
