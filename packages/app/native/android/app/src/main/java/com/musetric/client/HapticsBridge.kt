package com.musetric.client

import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView

private const val HAPTICS_BRIDGE_NAME = "MusetricHaptics"

private class HapticsBridge(private val webView: WebView) {
  @JavascriptInterface
  fun perform(kind: String) {
    val feedback =
      when (kind) {
        "tick" -> HapticFeedbackConstants.CLOCK_TICK
        "detent" -> HapticFeedbackConstants.CONTEXT_CLICK
        "grab" -> HapticFeedbackConstants.LONG_PRESS
        else -> return
      }
    webView.post {
      webView.performHapticFeedback(feedback, HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING)
    }
  }
}

internal fun attachHaptics(webView: WebView) {
  webView.isHapticFeedbackEnabled = false
  webView.addJavascriptInterface(HapticsBridge(webView), HAPTICS_BRIDGE_NAME)
}
