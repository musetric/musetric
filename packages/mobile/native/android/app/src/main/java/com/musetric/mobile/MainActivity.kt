package com.musetric.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

open class MainActivity : TauriActivity() {
  private var gpuActivityStarted = false
  private var gpuFailureDetected = false
  private var startupReady = false
  private var waitingForStartupNotificationPermission = false
  private var pendingPermission: PermissionRequest? = null
  private lateinit var tauriChromeClient: RustWebChromeClient
  private val gpuFailureTracker by lazy { GpuFailureTracker(this) }
  private val requestMediaPermissions = registerForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions(),
  ) {
    completePendingPermission()
  }
  private val requestNotificationPermission = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) {
    waitingForStartupNotificationPermission = false
    resumeGpuRenderer()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // AndroidX swaps Theme.SplashScreen for the AppCompat post-splash theme.
    // The window background and the HTML splash then keep the same frontend
    // mark on screen while WebView initializes.
    installSplashScreen().setKeepOnScreenCondition { !startupReady }
    super.onCreate(savedInstanceState)
    tauriChromeClient = RustWebChromeClient(this)
  }

  override fun onWebViewCreate(webView: WebView) {
    // Tauri begins loading the document from its implementation of this hook.
    // Install the bridge first so the first JavaScript evaluation can always
    // release the single native splash after React has painted.
    webView.addJavascriptInterface(StartupBridge(this), "MusetricStartup")
    webView.addJavascriptInterface(ForegroundBridge(this), "MusetricForeground")
    webView.addJavascriptInterface(ThermalBridge(this), "MusetricThermal")
    webView.addJavascriptInterface(
      SeparationExecutorBridge(
        executor = {
          if (this is GpuMainActivity) "webgpu" else "standby"
        },
        beginSeparation = { projectId -> gpuFailureTracker.begin(projectId) },
        finishSeparation = { gpuFailureTracker.finish() },
        retryProcessing = {
          runOnUiThread {
            startGpuActivityForManualRetry()
          }
        },
      ),
      "MusetricExecution",
    )
    super.onWebViewCreate(webView)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
        val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val layoutParams = view.layoutParams as? ViewGroup.MarginLayoutParams
          ?: return@setOnApplyWindowInsetsListener insets
        layoutParams.setMargins(
          systemBars.left,
          systemBars.top,
          systemBars.right,
          systemBars.bottom,
        )
        view.layoutParams = layoutParams
        insets
      }
      webView.post {
        ViewCompat.requestApplyInsets(webView)
      }
    }
    webView.post {
      webView.webChromeClient = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
          handlePermissionRequest(request)
        }

        override fun onShowFileChooser(
          view: WebView,
          callback: ValueCallback<Array<android.net.Uri?>?>,
          parameters: FileChooserParams,
        ): Boolean = tauriChromeClient.onShowFileChooser(view, callback, parameters)

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
          val text = message.message()
          if (
            text.contains("Mobile project processing failed") ||
              text.contains("WebGPU separation failed")
          ) {
            android.util.Log.e(
              "MusetricWeb",
              "${message.messageLevel()}: $text (${message.sourceId()}:${message.lineNumber()})",
            )
          }
          return tauriChromeClient.onConsoleMessage(message)
        }

        override fun onReceivedTitle(view: WebView, title: String) {
          tauriChromeClient.onReceivedTitle(view, title)
        }
      }
    }
  }

  fun markStartupReady() {
    startupReady = true
  }

  fun setProcessingActive(active: Boolean) {
    if (active) {
      if (
        this !is GpuMainActivity &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
      ) {
        requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
      ProcessingService.start(this)
      return
    }
    ProcessingService.stop(this)
  }

  override fun onPostResume() {
    super.onPostResume()
    if (this is GpuMainActivity) {
      return
    }
    if (
      !waitingForStartupNotificationPermission &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
    ) {
      waitingForStartupNotificationPermission = true
      requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
      return
    }
    resumeGpuRenderer()
  }

  private fun resumeGpuRenderer() {
    val failedProjectId = gpuFailureTracker.consumeFailedProjectId()
    if (failedProjectId !== null) {
      gpuFailureTracker.markSeparationFailed(failedProjectId)
      gpuFailureDetected = true
      return
    }
    if (gpuFailureDetected) {
      return
    }
    startGpuActivityIfNeeded()
  }

  private fun startGpuActivityIfNeeded() {
    if (this is GpuMainActivity || gpuActivityStarted) {
      return
    }
    gpuActivityStarted = true
    // The GPU WebView runs in :gpu, but stays in this task. A distinct task is
    // shown as a second, often black, card by Samsung Recents.
    startActivity(Intent(this, GpuMainActivity::class.java))
  }

  private fun startGpuActivityForManualRetry() {
    if (this is GpuMainActivity) {
      return
    }
    gpuFailureTracker.finish()
    gpuFailureDetected = false
    gpuActivityStarted = false
    startGpuActivityIfNeeded()
  }

  private fun handlePermissionRequest(request: PermissionRequest) {
    val missingPermissions = request.resources
      .mapNotNull { resource -> permissionForResource(resource) }
      .filterNot { permission -> hasPermission(permission) }
      .distinct()
    if (missingPermissions.isEmpty()) {
      grantAvailableResources(request)
      return
    }
    pendingPermission?.deny()
    pendingPermission = request
    requestMediaPermissions.launch(missingPermissions.toTypedArray())
  }

  private fun completePendingPermission() {
    val request = pendingPermission ?: return
    pendingPermission = null
    grantAvailableResources(request)
  }

  private fun grantAvailableResources(request: PermissionRequest) {
    val resources = request.resources.filter { resource ->
      permissionForResource(resource)?.let(::hasPermission) == true
    }
    if (resources.isEmpty()) {
      request.deny()
      return
    }
    if (resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
      val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    }
    request.grant(resources.toTypedArray())
  }

  private fun permissionForResource(resource: String): String? = when (resource) {
    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
    else -> null
  }

  private fun hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  override fun onDestroy() {
    val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
    audioManager.mode = AudioManager.MODE_NORMAL
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

private class StartupBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun ready() {
    activity.runOnUiThread {
      activity.markStartupReady()
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

private class SeparationExecutorBridge(
  private val executor: () -> String,
  private val beginSeparation: (String) -> Unit,
  private val finishSeparation: () -> Unit,
  private val retryProcessing: () -> Unit,
) {
  @JavascriptInterface
  fun separationExecutor(): String = executor()

  @JavascriptInterface
  fun beginSeparation(projectId: String) {
    beginSeparation.invoke(projectId)
  }

  @JavascriptInterface
  fun finishSeparation() {
    finishSeparation.invoke()
  }

  @JavascriptInterface
  fun retryProcessing() {
    retryProcessing.invoke()
  }

  @JavascriptInterface
  fun reportSeparationStage(executor: String, stage: String) {
    if (executor == "webgpu") {
      android.util.Log.i(
        "MusetricExecution",
        "executor=$executor; stage=$stage",
      )
    }
  }
}
