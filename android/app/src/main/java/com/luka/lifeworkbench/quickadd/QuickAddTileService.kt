package com.luka.lifeworkbench.quickadd

import android.content.Intent
import android.net.Uri
import android.service.quicksettings.TileService

/**
 * Quick Settings tile → opens the app straight into the "quick add" (expense) screen
 * via a deep link. Single tap, no extra permission beyond the existing notification
 * access the feature already requests.
 */
class QuickAddTileService : TileService() {
  override fun onClick() {
    super.onClick()
    val intent = Intent(Intent.ACTION_VIEW).apply {
      data = Uri.parse("lifeworkbench://quick-add?type=expense")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    // The Intent overload remains the only one compatible with our minSdk (24); the
    // PendingIntent overload is API 34+ only.
    @Suppress("DEPRECATION")
    startActivityAndCollapse(intent)
  }
}
