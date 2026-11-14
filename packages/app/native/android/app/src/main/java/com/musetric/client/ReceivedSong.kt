package com.musetric.client

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.IntentCompat
import androidx.core.os.BundleCompat
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.UUID
import kotlin.concurrent.thread
import org.json.JSONObject

private const val RECEIVED_BRIDGE_NAME = "MusetricReceivedSong"
private const val RECEIVED_EVENT_SCRIPT =
  "window.dispatchEvent(new Event('musetric:received-song'))"
private const val RECEIVED_AREA = "received"
private const val SOURCE_URI_STATE = "musetric.receivedSong.uri"
private const val SOURCE_TYPE_STATE = "musetric.receivedSong.type"
private const val SIZE_LIMIT = 200L * 1024 * 1024
private const val COPY_LIMIT = 2
private const val BUFFER_BYTES = 8 * 1024

private class Source(val uri: Uri?, val type: String?)

private sealed interface Received {
  class Song(val id: String, val name: String, val type: String, val file: File) : Received

  object Failed : Received
}

private class Taken(val received: Received, val generation: Long)

internal class ReceivedSongs(private val activity: Activity) {
  private val area = File(activity.cacheDir, RECEIVED_AREA)
  private var generation = 0L
  private var source: Source? = null
  private var pending: Received? = null
  private var copies = 0
  private var active: InputStream? = null
  private val taken = mutableMapOf<String, Taken>()
  private var webView: WebView? = null

  init {
    area.deleteRecursively()
  }

  fun start(intent: Intent, state: Bundle?) {
    if (state != null) {
      restore(state)
      return
    }
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
      return
    }
    receive(intent)
  }

  fun receive(intent: Intent) {
    val next =
      when (intent.action) {
        Intent.ACTION_SEND ->
          Source(
            IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java),
            intent.type,
          )
        Intent.ACTION_VIEW -> Source(intent.data, intent.type)
        else -> return
      }
    accept(next)
  }

  fun save(outState: Bundle) {
    synchronized(this) {
      val uri = source?.uri ?: return
      outState.putParcelable(SOURCE_URI_STATE, uri)
      outState.putString(SOURCE_TYPE_STATE, source?.type)
    }
  }

  fun attach(view: WebView) {
    synchronized(this) { webView = view }
    view.addJavascriptInterface(Bridge(), RECEIVED_BRIDGE_NAME)
  }

  private fun restore(state: Bundle) {
    val uri = BundleCompat.getParcelable(state, SOURCE_URI_STATE, Uri::class.java) ?: return
    accept(Source(uri, state.getString(SOURCE_TYPE_STATE)))
  }

  private fun accept(next: Source) {
    val current =
      synchronized(this) {
        supersede()
        source = next
        if (copies >= COPY_LIMIT) {
          pending = Received.Failed
          null
        } else {
          copies += 1
          generation
        }
      }
    if (current == null) {
      notifyPage()
      return
    }
    thread(name = "received-song") { complete(current, copy(current, next)) }
  }

  private fun copy(current: Long, from: Source): Received {
    val uri = from.uri ?: return Received.Failed
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
      return Received.Failed
    }
    val resolver = activity.contentResolver
    var file: File? = null
    var input: InputStream? = null
    try {
      val name = displayName(uri) ?: uri.lastPathSegment ?: return Received.Failed
      val type = resolver.getType(uri) ?: from.type ?: ""
      val opened = resolver.openInputStream(uri) ?: return Received.Failed
      input = opened
      synchronized(this) {
        if (current != generation) {
          return Received.Failed
        }
        active = opened
      }
      val id = UUID.randomUUID().toString()
      area.mkdirs()
      val target = File(area, id)
      file = target
      var size = 0L
      target.outputStream().use { output ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          val count = opened.read(buffer)
          if (count < 0) {
            break
          }
          size += count
          if (size > SIZE_LIMIT) {
            target.delete()
            return Received.Failed
          }
          output.write(buffer, 0, count)
        }
      }
      file = null
      return Received.Song(id, name, type, target)
    } catch (_: Exception) {
      return Received.Failed
    } finally {
      file?.delete()
      closeQuietly(input)
      synchronized(this) {
        if (active === input) {
          active = null
        }
      }
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

  private fun complete(current: Long, result: Received) {
    synchronized(this) {
      copies -= 1
      if (current != generation) {
        discard(result)
        return
      }
      pending = result
    }
    notifyPage()
  }

  private fun notifyPage() {
    activity.runOnUiThread {
      val view = synchronized(this) { webView } ?: return@runOnUiThread
      view.evaluateJavascript(RECEIVED_EVENT_SCRIPT, null)
    }
  }

  private fun supersede() {
    generation += 1
    discard(pending)
    pending = null
    closeQuietly(active)
    active = null
  }

  private fun discard(received: Received?) {
    if (received is Received.Song) {
      received.file.delete()
    }
  }

  private fun closeQuietly(stream: InputStream?) {
    try {
      stream?.close()
    } catch (_: Exception) {}
  }

  private inner class Bridge {
    @JavascriptInterface
    fun waiting(): Boolean =
      synchronized(this@ReceivedSongs) {
        pending != null || (source != null && taken.values.none { it.generation == generation })
      }

    @JavascriptInterface
    fun applying(): Boolean = synchronized(this@ReceivedSongs) { taken.isNotEmpty() }

    @JavascriptInterface
    fun take(): String? =
      synchronized(this@ReceivedSongs) {
        val result = pending ?: return null
        pending = null
        when (result) {
          is Received.Song -> {
            taken[result.id] = Taken(result, generation)
            JSONObject()
              .put("id", result.id)
              .put("name", result.name)
              .put("type", result.type)
              .put("size", result.file.length())
              .toString()
          }
          Received.Failed -> {
            val id = UUID.randomUUID().toString()
            taken[id] = Taken(result, generation)
            JSONObject().put("id", id).put("failed", true).toString()
          }
        }
      }

    @JavascriptInterface
    fun read(id: String, offset: Long, length: Int): String? {
      val song = synchronized(this@ReceivedSongs) { taken[id]?.received } as? Received.Song
      val file = song?.file ?: return null
      RandomAccessFile(file, "r").use { access ->
        access.seek(offset)
        val bytes = ByteArray(length)
        val count = access.read(bytes)
        if (count < 0) {
          return ""
        }
        return Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP)
      }
    }

    @JavascriptInterface
    fun dismiss() {
      synchronized(this@ReceivedSongs) {
        supersede()
        source = null
      }
    }

    @JavascriptInterface
    fun giveBack(id: String) {
      synchronized(this@ReceivedSongs) {
        val entry = taken.remove(id) ?: return
        if (entry.generation == generation) {
          pending = entry.received
        } else {
          discard(entry.received)
        }
      }
    }

    @JavascriptInterface
    fun release(id: String) {
      synchronized(this@ReceivedSongs) {
        val entry = taken.remove(id) ?: return
        discard(entry.received)
        if (entry.generation == generation) {
          source = null
        }
      }
    }
  }
}
