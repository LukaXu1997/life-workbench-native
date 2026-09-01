package com.luka.lifeworkbench.securewindow

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager

/**
 * 原生窗口安全标记桥：对应 Android 的 WindowManager.LayoutParams.FLAG_SECURE。
 * 添加该标记后，系统会禁止对本 Activity 窗口截图，且「最近任务」列表不再缓存
 * 应用预览缩略图——这是「隐藏最近任务画面 / 隐私遮罩」唯一可靠的实现路径，
 * 纯 JS 无法阻止系统级截图与任务缩略图。
 */
class SecureWindowModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NativeSecureWindow"

    @ReactMethod
    fun setSecure(secure: Boolean, promise: Promise) {
        applySecure(secure, 0, promise)
    }

    // currentActivity 可能在 App 刚启动、RN 尚未把 Activity 绑定到上下文时为 null，
    // 因此最多重试若干次（每次间隔 300ms，跑在主线程），直到拿到 Activity 再设置标记。
    private fun applySecure(secure: Boolean, attempt: Int, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            if (attempt >= 20) {
                promise.reject("NO_ACTIVITY", "No current activity to apply FLAG_SECURE")
                return
            }
            Handler(Looper.getMainLooper()).postDelayed({
                applySecure(secure, attempt + 1, promise)
            }, 300)
            return
        }
        activity.runOnUiThread {
            try {
                if (secure) {
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                } else {
                    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
                Log.d("SecureWindow", "FLAG_SECURE applied secure=$secure (attempt=$attempt)")
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e("SecureWindow", "setSecure failed: ${e.message}")
                promise.reject("SET_SECURE_FAILED", e.message)
            }
        }
    }
}
