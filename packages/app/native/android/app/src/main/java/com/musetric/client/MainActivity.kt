package com.musetric.client

import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(ThermalBridge(this), "MusetricThermal")
    super.onWebViewCreate(webView)
    applyWebViewInsets(webView)
  }

  private fun applyWebViewInsets(webView: WebView) {
    val insetTypes =
      WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout() or
        WindowInsetsCompat.Type.ime()
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val insets = windowInsets.getInsets(insetTypes)
      val container = view.parent as? ViewGroup ?: view
      container.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(webView)
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
