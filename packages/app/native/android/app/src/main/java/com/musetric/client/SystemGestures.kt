package com.musetric.client

import android.graphics.Rect
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import kotlin.math.roundToInt

private const val GESTURES_BRIDGE_NAME = "MusetricGestures"

private class GesturesBridge(private val webView: WebView) {
  @JavascriptInterface
  fun exclude(rects: String) {
    val scale = webView.resources.displayMetrics.density
    val items = JSONArray(rects)
    val excluded =
      List(items.length()) { index ->
        val item = items.getJSONObject(index)
        Rect(
          (item.getDouble("left") * scale).roundToInt(),
          (item.getDouble("top") * scale).roundToInt(),
          (item.getDouble("right") * scale).roundToInt(),
          (item.getDouble("bottom") * scale).roundToInt(),
        )
      }
    webView.post { webView.systemGestureExclusionRects = excluded }
  }
}

internal fun attachSystemGestures(webView: WebView) {
  webView.addJavascriptInterface(GesturesBridge(webView), GESTURES_BRIDGE_NAME)
}
