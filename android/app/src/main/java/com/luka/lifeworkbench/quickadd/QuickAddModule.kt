package com.luka.lifeworkbench.quickadd

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class QuickAddModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NativeQuickAdd"

    /** Register the React context so QuickAddBridge can emit the warm-relaunch event to JS. */
    override fun initialize() {
        super.initialize()
        QuickAddBridge.setReactContext(reactContext)
    }

    /** Return and clear the pending deep-link URL (e.g. lifeworkbench://quick-add?type=income). */
    @ReactMethod
    fun getPendingUrl(promise: Promise) {
        promise.resolve(QuickAddBridge.consumeUrl())
    }

    /** Return and clear the pending share payload (text + optional image uri). */
    @ReactMethod
    fun getPendingShare(promise: Promise) {
        val (text, image) = QuickAddBridge.consumeShare()
        val m = WritableNativeMap()
        m.putString("text", text)
        m.putString("imageUri", image)
        promise.resolve(m)
    }
}
