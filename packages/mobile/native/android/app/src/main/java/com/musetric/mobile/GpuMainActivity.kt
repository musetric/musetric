package com.musetric.mobile

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.webkit.WebView

class GpuMainActivity : MainActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      WebView.setDataDirectorySuffix("gpu")
    }
    super.onCreate(savedInstanceState)
  }

  override fun onBackPressed() {
    setResult(Activity.RESULT_OK)
    super.onBackPressed()
  }
}
