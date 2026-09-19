package com.musetric.client

import android.app.Activity
import android.os.Build
import android.os.PowerManager
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
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
  private var shown = false
  private var view: WebView? = null

  override fun load(webView: WebView) {
    (activity as AppCompatActivity).lifecycle.addObserver(
      object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
          shown = true
          attach()
        }

        override fun onStop(owner: LifecycleOwner) {
          shown = false
          detach()
        }

        override fun onDestroy(owner: LifecycleOwner) {
          detach()
        }
      },
    )
  }

  @Command
  fun open(invoke: Invoke) {
    url = invoke.parseArgs(OpenExecutorArgs::class.java).url
    activity.runOnUiThread { attach() }
    invoke.resolve()
  }

  private fun attach() {
    val address = url ?: return
    if (!shown || view != null) {
      return
    }
    val created = WebView(activity)
    created.settings.javaScriptEnabled = true
    created.settings.domStorageEnabled = true
    created.addJavascriptInterface(ThermalBridge(activity), "MusetricThermal")
    val root = activity.findViewById<ViewGroup>(android.R.id.content)
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
