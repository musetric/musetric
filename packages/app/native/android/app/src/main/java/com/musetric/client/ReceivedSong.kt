package com.musetric.client

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.WebView
import androidx.core.content.IntentCompat
import androidx.core.os.BundleCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.concurrent.thread
import org.json.JSONObject

private const val RECEIVED_BRIDGE_NAME = "MusetricReceivedSong"
private const val RECEIVED_AREA = "received"
private const val LOG_TAG = "MusetricReceivedSong"
private const val SOURCE_URI_STATE = "musetric.receivedSong.uri"
private const val SOURCE_TYPE_STATE = "musetric.receivedSong.type"
private const val SIZE_LIMIT = 200L * 1024 * 1024
private const val BUFFER_BYTES = 8 * 1024
private const val CHUNK_BYTES = 1024 * 1024
private const val GONE_MESSAGE = """{"type":"gone"}"""

private val chunkReader = Executors.newSingleThreadExecutor()

private class Copied(val file: File, val name: String, val type: String, val size: Long)

private class Share(val id: String, val uri: Uri?, val type: String?) {
  var input: InputStream? = null
  var copied: Copied? = null
  var failed = false
}

internal class ReceivedSongs(private val activity: Activity) : WebViewCompat.WebMessageListener {
  private val area = File(activity.cacheDir, RECEIVED_AREA)
  private val mainHandler = Handler(Looper.getMainLooper())
  private var share: Share? = null
  private var page: JavaScriptReplyProxy? = null

  init {
    area.deleteRecursively()
  }

  fun start(intent: Intent, state: Bundle?) {
    if (state != null) {
      val uri = BundleCompat.getParcelable(state, SOURCE_URI_STATE, Uri::class.java) ?: return
      accept(uri, state.getString(SOURCE_TYPE_STATE))
      return
    }
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
      return
    }
    receive(intent)
  }

  fun receive(intent: Intent) {
    val uri =
      when (intent.action) {
        Intent.ACTION_SEND ->
          IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        Intent.ACTION_VIEW -> intent.data
        else -> return
      }
    accept(uri, intent.type)
  }

  fun save(outState: Bundle) {
    val current = synchronized(this) { share } ?: return
    val uri = current.uri ?: return
    outState.putParcelable(SOURCE_URI_STATE, uri)
    outState.putString(SOURCE_TYPE_STATE, current.type)
  }

  fun attach(webView: WebView) {
    val supported =
      WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
    if (supported) {
      WebViewCompat.addWebMessageListener(webView, RECEIVED_BRIDGE_NAME, setOf("*"), this)
    }
  }

  override fun onPostMessage(
    view: WebView,
    message: WebMessageCompat,
    sourceOrigin: Uri,
    isMainFrame: Boolean,
    replyProxy: JavaScriptReplyProxy,
  ) {
    val data = message.data
    if (!isMainFrame || message.type != WebMessageCompat.TYPE_STRING || data == null) {
      return
    }
    val command = JSONObject(data)
    when (command.getString("type")) {
      "subscribe" -> {
        page = replyProxy
        replyProxy.postMessage(describe())
      }
      "read" -> read(replyProxy, command.getString("id"), command.getLong("offset"))
      "finish" -> finish(command.getString("id"))
    }
  }

  private fun accept(uri: Uri?, type: String?) {
    val next = Share(UUID.randomUUID().toString(), uri, type)
    synchronized(this) {
      share?.let(::discard)
      share = next
    }
    publish()
    thread(name = "received-song") { complete(next, copy(next)) }
  }

  private fun copy(next: Share): Copied? {
    val uri = next.uri ?: return null
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
      Log.w(LOG_TAG, "Refused a shared song that is not a content uri")
      return null
    }
    val target = File(area, next.id)
    return try {
      val resolver = activity.contentResolver
      val name = displayName(uri) ?: uri.lastPathSegment ?: return null
      val type = resolver.getType(uri) ?: next.type ?: ""
      val input = resolver.openInputStream(uri) ?: return null
      input.use {
        synchronized(this) {
          if (share !== next) {
            return null
          }
          next.input = input
        }
        area.mkdirs()
        val size = target.outputStream().use { output -> transfer(input, output) }
        if (size == null) {
          Log.w(LOG_TAG, "Refused a shared song larger than the upload limit")
          target.delete()
          null
        } else {
          Copied(target, name, type, size)
        }
      }
    } catch (error: Exception) {
      Log.w(LOG_TAG, "Could not copy a shared song", error)
      target.delete()
      null
    }
  }

  private fun transfer(input: InputStream, output: OutputStream): Long? {
    val buffer = ByteArray(BUFFER_BYTES)
    var size = 0L
    while (true) {
      val count = input.read(buffer)
      if (count < 0) {
        return size
      }
      size += count
      if (size > SIZE_LIMIT) {
        return null
      }
      output.write(buffer, 0, count)
    }
  }

  private fun displayName(uri: Uri): String? =
    activity.contentResolver
      .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor ->
        if (!cursor.moveToFirst()) {
          return@use null
        }
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column < 0) null else cursor.getString(column)
      }

  private fun complete(next: Share, copied: Copied?) {
    synchronized(this) {
      if (share !== next) {
        copied?.file?.delete()
        return
      }
      next.input = null
      next.copied = copied
      next.failed = copied == null
    }
    publish()
  }

  private fun discard(old: Share) {
    try {
      old.input?.close()
    } catch (_: Exception) {}
    old.copied?.file?.delete()
  }

  private fun describe(): String {
    val described =
      synchronized(this) {
        val current = share ?: return@synchronized JSONObject.NULL
        val copied = current.copied
        val song = JSONObject().put("id", current.id)
        when {
          copied != null ->
            song
              .put("status", "ready")
              .put("name", copied.name)
              .put("type", copied.type)
              .put("size", copied.size)
          current.failed -> song.put("status", "failed")
          else -> song.put("status", "copying")
        }
      }
    return JSONObject().put("type", "share").put("share", described).toString()
  }

  private fun publish() {
    mainHandler.post { page?.postMessage(describe()) }
  }

  private fun read(proxy: JavaScriptReplyProxy, id: String, offset: Long) {
    chunkReader.execute {
      val chunk = readChunk(id, offset)
      mainHandler.post {
        if (chunk == null) proxy.postMessage(GONE_MESSAGE) else proxy.postMessage(chunk)
      }
    }
  }

  private fun readChunk(id: String, offset: Long): ByteArray? {
    val file = synchronized(this) { share?.takeIf { it.id == id }?.copied?.file } ?: return null
    return try {
      RandomAccessFile(file, "r").use { access ->
        val length = (access.length() - offset).coerceIn(0L, CHUNK_BYTES.toLong()).toInt()
        val chunk = ByteArray(length)
        access.seek(offset)
        access.readFully(chunk)
        chunk
      }
    } catch (error: Exception) {
      Log.w(LOG_TAG, "Could not read a shared song", error)
      null
    }
  }

  private fun finish(id: String) {
    synchronized(this) {
      val current = share?.takeIf { it.id == id } ?: return
      discard(current)
      share = null
    }
    publish()
  }
}
