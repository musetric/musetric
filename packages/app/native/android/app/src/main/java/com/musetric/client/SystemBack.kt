package com.musetric.client

import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

private const val BACK_SCRIPT =
  "window.dispatchEvent(new Event('musetric:back', { cancelable: true }))"

internal fun attachSystemBack(activity: AppCompatActivity, webView: WebView) {
  activity.onBackPressedDispatcher.addCallback(
    activity,
    object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(BACK_SCRIPT) { unhandled ->
          if (unhandled != "false") {
            isEnabled = false
            activity.onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    },
  )
}
