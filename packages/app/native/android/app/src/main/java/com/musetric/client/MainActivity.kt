package com.musetric.client

import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var mainWebView: WebView? = null
  private val receivedSongs by lazy { ReceivedSongs(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    if (!BuildConfig.PUBLISHED) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    installSplashScreen()
    super.onCreate(savedInstanceState)
    receivedSongs.start(intent, savedInstanceState)
    enableEdgeToEdge()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    receivedSongs.receive(intent)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    receivedSongs.save(outState)
  }

  override fun onDestroy() {
    super.onDestroy()
    val finished = mainWebView ?: return
    (finished.parent as? ViewGroup)?.removeView(finished)
    finished.destroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    mainWebView = webView
    applyWebViewInsets(webView)
    shareDownloads(this, webView)
    attachMediaSession(this, webView)
    attachSettings(this, webView)
    attachMicrophone(this, webView)
    attachHaptics(webView)
    attachSystemBack(this, webView)
    attachSystemGestures(webView)
    receivedSongs.attach(webView)
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
