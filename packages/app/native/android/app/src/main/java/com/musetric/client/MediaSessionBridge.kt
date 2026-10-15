package com.musetric.client

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.SystemClock
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import org.json.JSONObject

private const val BRIDGE_NAME = "MusetricMedia"
private const val EVENT_NAME = "musetric:media"
private const val CHANNEL_ID = "playback"
private const val COMMAND_ACTION = "com.musetric.client.MEDIA_COMMAND"
private const val COMMAND_EXTRA = "command"
private const val SESSION_ACTIONS =
  PlaybackState.ACTION_PLAY or
    PlaybackState.ACTION_PAUSE or
    PlaybackState.ACTION_PLAY_PAUSE or
    PlaybackState.ACTION_STOP or
    PlaybackState.ACTION_SEEK_TO

private class MediaState(
  val title: String,
  val durationMs: Long,
  val positionMs: Long,
  val playing: Boolean,
  val speed: Float,
)

internal class MediaSessionBridge(
  private val activity: Activity,
  private val webView: WebView,
) {
  private var session: MediaSession? = null
  private var serviceStarted = false

  private val commands =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        emit(intent.getStringExtra(COMMAND_EXTRA) ?: return, null)
      }
    }

  @JavascriptInterface
  fun update(json: String) {
    val value = JSONObject(json)
    val state =
      MediaState(
        title = value.getString("title"),
        durationMs = value.getLong("durationMs"),
        positionMs = value.getLong("positionMs"),
        playing = value.getBoolean("playing"),
        speed = value.getDouble("speed").toFloat(),
      )
    activity.runOnUiThread { apply(state) }
  }

  @JavascriptInterface
  fun clear() {
    activity.runOnUiThread { release() }
  }

  fun release() {
    val current = session ?: return
    session = null
    current.isActive = false
    current.release()
    activity.unregisterReceiver(commands)
    MediaPlaybackService.stop(activity)
    serviceStarted = false
  }

  private fun apply(state: MediaState) {
    val current = session ?: createSession()
    current.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, activity.getString(R.string.app_name))
        .putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs)
        .build(),
    )
    current.setPlaybackState(
      PlaybackState.Builder()
        .setActions(SESSION_ACTIONS)
        .setState(
          if (state.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          state.positionMs,
          if (state.playing) state.speed else 0f,
          SystemClock.elapsedRealtime(),
        )
        .build(),
    )
    current.isActive = true
    val notification = buildNotification(current, state)
    if (serviceStarted) {
      activity.getSystemService(NotificationManager::class.java)
        .notify(MediaPlaybackService.NOTIFICATION_ID, notification)
    } else {
      MediaPlaybackService.start(activity, notification)
      serviceStarted = true
    }
  }

  private fun createSession(): MediaSession {
    createChannel()
    ContextCompat.registerReceiver(
      activity,
      commands,
      IntentFilter(COMMAND_ACTION),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    val created = MediaSession(activity, BRIDGE_NAME)
    created.setCallback(
      object : MediaSession.Callback() {
        override fun onPlay() = emit("play", null)

        override fun onPause() = emit("pause", null)

        override fun onStop() = emit("pause", null)

        override fun onSeekTo(pos: Long) = emit("seek", pos)
      },
    )
    created.setSessionActivity(openActivity())
    session = created
    return created
  }

  private fun emit(action: String, positionMs: Long?) {
    val detail = JSONObject().put("action", action)
    if (positionMs != null) {
      detail.put("positionMs", positionMs)
    }
    val script = "window.dispatchEvent(new CustomEvent('$EVENT_NAME', { detail: $detail }))"
    webView.post { webView.evaluateJavascript(script, null) }
  }

  private fun buildNotification(current: MediaSession, state: MediaState): Notification {
    val command = if (state.playing) "pause" else "play"
    val action =
      Notification.Action.Builder(
          if (state.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
          command,
          commandIntent(command),
        )
        .build()
    return notificationBuilder()
      .setSmallIcon(R.drawable.ic_playback_notification)
      .setContentTitle(state.title)
      .setContentText(activity.getString(R.string.app_name))
      .setContentIntent(openActivity())
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(action)
      .setStyle(
        Notification.MediaStyle()
          .setMediaSession(current.sessionToken)
          .setShowActionsInCompactView(0),
      )
      .build()
  }

  @Suppress("DEPRECATION")
  private fun notificationBuilder(): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(activity, CHANNEL_ID)
    } else {
      Notification.Builder(activity)
    }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        activity.getString(R.string.playback_channel),
        NotificationManager.IMPORTANCE_LOW,
      )
    activity.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun openActivity(): PendingIntent =
    PendingIntent.getActivity(
      activity,
      0,
      Intent(activity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE,
    )

  private fun commandIntent(command: String): PendingIntent =
    PendingIntent.getBroadcast(
      activity,
      command.hashCode(),
      Intent(COMMAND_ACTION).setPackage(activity.packageName).putExtra(COMMAND_EXTRA, command),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

internal fun attachMediaSession(activity: AppCompatActivity, webView: WebView) {
  val bridge = MediaSessionBridge(activity, webView)
  webView.addJavascriptInterface(bridge, BRIDGE_NAME)
  activity.lifecycle.addObserver(
    object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) {
        bridge.release()
      }
    },
  )
}
