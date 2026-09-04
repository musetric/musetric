package com.musetric.client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class ProcessingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createNotificationChannel()
    val notification = NotificationCompat.Builder(this, notificationChannelId)
      .setContentTitle("Musetric is processing audio")
      .setContentText("Keep Musetric open until the current task is complete.")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 35) {
      startForeground(
        notificationId,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
      )
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        notificationId,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(notificationId, notification)
    }
    return START_NOT_STICKY
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      notificationChannelId,
      "Audio processing",
      NotificationManager.IMPORTANCE_LOW,
    )
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val notificationChannelId = "audio_processing"
    private const val notificationId = 1

    fun start(context: Context) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, ProcessingService::class.java),
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ProcessingService::class.java))
    }
  }
}
