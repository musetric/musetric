package com.musetric.client

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent

private const val PLAYBACK_REFRESH_RATE = 60f
private const val GESTURE_TAIL_MS = 2000L

internal class PlaybackRefreshRate(private val activity: Activity) {
  private val handler = Handler(Looper.getMainLooper())
  private var playing = false
  private var touching = false
  private val gestureOver = Runnable {
    touching = false
    apply()
  }

  fun follow(playing: Boolean) {
    this.playing = playing
    apply()
  }

  fun touch(event: MotionEvent) {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        handler.removeCallbacks(gestureOver)
        touching = true
        apply()
      }
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> handler.postDelayed(gestureOver, GESTURE_TAIL_MS)
    }
  }

  private fun apply() {
    val rate = if (playing && !touching) PLAYBACK_REFRESH_RATE else 0f
    val params = activity.window.attributes
    if (params.preferredRefreshRate == rate) {
      return
    }
    params.preferredRefreshRate = rate
    activity.window.attributes = params
  }
}
