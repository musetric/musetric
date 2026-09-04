package com.musetric.client

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(ForegroundBridge(this), "MusetricForeground")
    webView.addJavascriptInterface(ThermalBridge(this), "MusetricThermal")
    super.onWebViewCreate(webView)
  }

  fun setProcessingActive(active: Boolean) {
    if (active) {
      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
          ) != PackageManager.PERMISSION_GRANTED
      ) {
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
      }
      ProcessingService.start(this)
      return
    }
    ProcessingService.stop(this)
  }

  override fun onDestroy() {
    ProcessingService.stop(this)
    super.onDestroy()
  }
}

private class ForegroundBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun setActive(active: Boolean) {
    activity.runOnUiThread {
      activity.setProcessingActive(active)
    }
  }
}

private class ThermalBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun status(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return 0
    }
    return activity.getSystemService(PowerManager::class.java).currentThermalStatus
  }
}
