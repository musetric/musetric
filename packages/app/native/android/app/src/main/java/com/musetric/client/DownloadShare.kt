package com.musetric.client

import android.app.Activity
import android.content.Intent
import android.webkit.URLUtil
import android.webkit.WebView
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.Executors

private const val SHARED_AREA = "shared"
private const val FALLBACK_TYPE = "application/octet-stream"
private val encodedFilename = Regex("filename\\*=UTF-8''([^;]+)")

internal fun shareDownloads(activity: Activity, webView: WebView) {
  val executor = Executors.newSingleThreadExecutor()
  webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
    executor.execute {
      val file = runCatching { fetch(activity, url, contentDisposition) }.getOrNull()
      if (file != null) {
        activity.runOnUiThread { share(activity, file, mimeType) }
      }
    }
  }
}

private fun fetch(activity: Activity, url: String, contentDisposition: String?): File {
  val encoded = encodedFilename.find(contentDisposition.orEmpty())?.groupValues?.get(1)
  val name =
    encoded?.let { URLDecoder.decode(it, Charsets.UTF_8.name()) }
      ?: URLUtil.guessFileName(url, contentDisposition, null)
  val area = File(activity.cacheDir, SHARED_AREA)
  area.deleteRecursively()
  area.mkdirs()
  val file = File(area, name)
  val connection = URL(url).openConnection() as HttpURLConnection
  try {
    connection.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
  } finally {
    connection.disconnect()
  }
  return file
}

private fun share(activity: Activity, file: File, mimeType: String?) {
  val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
  val intent =
    Intent(Intent.ACTION_SEND).apply {
      type = mimeType ?: FALLBACK_TYPE
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  activity.startActivity(Intent.createChooser(intent, null))
}
