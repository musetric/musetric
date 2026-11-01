package com.musetric.client

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.PowerManager
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class OpenExecutorArgs {
  lateinit var url: String
}

@TauriPlugin
class ExecutorViewPlugin(private val activity: Activity) : Plugin(activity) {
  private var url: String? = null
  private var host: Activity? = null
  private var view: WebView? = null

  override fun onResume(activity: AppCompatActivity) {
    show(activity)
  }

  override fun onStop(activity: AppCompatActivity) {
    if (host == activity) {
      host = null
      detach()
    }
  }

  @Command
  fun open(invoke: Invoke) {
    url = invoke.parseArgs(OpenExecutorArgs::class.java).url
    activity.runOnUiThread {
      if ((activity as AppCompatActivity).lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
        show(activity)
      }
    }
    invoke.resolve()
  }

  private fun show(activity: Activity) {
    if (host != activity) {
      detach()
      host = activity
    }
    attach()
  }

  private fun attach() {
    val address = url ?: return
    val shown = host ?: return
    if (view != null) {
      return
    }
    val created = WebView(shown)
    created.setBackgroundColor(Color.TRANSPARENT)
    created.settings.javaScriptEnabled = true
    created.settings.domStorageEnabled = true
    created.addJavascriptInterface(ThermalBridge(shown), "MusetricThermal")
    val root = shown.window.decorView as ViewGroup
    root.addView(created, 0, ViewGroup.LayoutParams(1, 1))
    created.loadUrl(address)
    view = created
  }

  private fun detach() {
    val attached = view ?: return
    view = null
    (attached.parent as? ViewGroup)?.removeView(attached)
    attached.destroy()
  }
}

private class ThermalBridge(private val activity: Activity) {
  @JavascriptInterface
  fun status(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return 0
    }
    return activity.getSystemService(PowerManager::class.java).currentThermalStatus
  }
}
