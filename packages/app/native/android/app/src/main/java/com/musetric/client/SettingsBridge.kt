package com.musetric.client

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity

private const val SETTINGS_BRIDGE_NAME = "MusetricSettings"

private class SettingsBridge(private val activity: AppCompatActivity) {
  @JavascriptInterface
  fun openAppSettings() {
    activity.runOnUiThread {
      activity.startActivity(
        Intent(
          Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.fromParts("package", activity.packageName, null),
        ),
      )
    }
  }
}

internal fun attachSettings(activity: AppCompatActivity, webView: WebView) {
  webView.addJavascriptInterface(SettingsBridge(activity), SETTINGS_BRIDGE_NAME)
}
