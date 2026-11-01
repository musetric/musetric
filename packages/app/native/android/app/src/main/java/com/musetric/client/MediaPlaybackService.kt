package com.musetric.client

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat

class MediaPlaybackService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification =
      intent?.let { IntentCompat.getParcelableExtra(it, NOTIFICATION_EXTRA, Notification::class.java) }
    if (notification == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
    )
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  companion object {
    const val NOTIFICATION_ID = 2
    private const val NOTIFICATION_EXTRA = "notification"

    fun start(context: Context, notification: Notification) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, MediaPlaybackService::class.java).putExtra(NOTIFICATION_EXTRA, notification),
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MediaPlaybackService::class.java))
    }
  }
}
