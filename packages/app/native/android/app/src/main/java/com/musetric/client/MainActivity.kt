package com.musetric.client

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // AndroidX swaps Theme.SplashScreen for the AppCompat post-splash theme
    // before the Tauri activity applies its AppCompat-dependent decor.
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
  }
}
