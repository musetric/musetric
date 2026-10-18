package com.musetric.client

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRouting
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import org.json.JSONArray
import org.json.JSONObject

private const val BRIDGE_NAME = "MusetricMicrophone"
private const val CLOCK_NAME = "MusetricClock"
private const val PERMISSION_KEY = "musetric.microphone"
private const val ACCESS_DENIED = "microphone-access-denied"
private const val UNAVAILABLE = "microphone-unavailable"
private const val CHUNKS_PER_SECOND = 50
private const val BUFFER_SECONDS = 0.5
private const val HEADER_BYTES = 32
private const val NANOS_PER_SECOND = 1_000_000_000L
private const val NANOS_PER_MILLI = 1_000_000.0
private const val BUILT_IN_GAIN = 3.16f
private const val COMPRESSOR_THRESHOLD_DB = -23.0
private const val COMPRESSOR_RATIO = 1.3
private const val COMPRESSOR_ATTACK_SECONDS = 0.05
private const val COMPRESSOR_RELEASE_SECONDS = 1.0
private const val DETECTOR_CUTOFF_HZ = 100.0
private const val LIMIT = 0.891f
private const val LIMIT_RELEASE_SECONDS = 0.05
private const val TREBLE_SHELF_HZ = 3000.0
private const val TREBLE_SHELF_DB = -7.0
private const val TREBLE_SHELF_Q = 0.707
private const val TREBLE_CUTOFF_HZ = 6500.0
private const val TREBLE_CUTOFF_FIRST_Q = 0.541196
private const val TREBLE_CUTOFF_SECOND_Q = 1.306563

private class MicrophoneClock {
  @JavascriptInterface
  fun now(): Double = System.nanoTime() / NANOS_PER_MILLI
}

private fun smoothing(seconds: Double, sampleRate: Int): Float =
  exp(-1.0 / (seconds * sampleRate)).toFloat()

private class Biquad(
  private val b0: Float,
  private val b1: Float,
  private val b2: Float,
  private val a1: Float,
  private val a2: Float,
) {
  private var first = 0f
  private var second = 0f

  fun process(sample: Float): Float {
    val output = b0 * sample + first
    first = b1 * sample - a1 * output + second
    second = b2 * sample - a2 * output
    return output
  }
}

private fun biquad(b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double) =
  Biquad(
    (b0 / a0).toFloat(),
    (b1 / a0).toFloat(),
    (b2 / a0).toFloat(),
    (a1 / a0).toFloat(),
    (a2 / a0).toFloat(),
  )

private fun lowPass(frequency: Double, q: Double, sampleRate: Int): Biquad {
  val omega = 2 * PI * frequency / sampleRate
  val alpha = sin(omega) / (2 * q)
  val cosine = cos(omega)
  return biquad((1 - cosine) / 2, 1 - cosine, (1 - cosine) / 2, 1 + alpha, -2 * cosine, 1 - alpha)
}

private fun highShelf(frequency: Double, gainDb: Double, q: Double, sampleRate: Int): Biquad {
  val amplitude = 10.0.pow(gainDb / 40)
  val omega = 2 * PI * frequency / sampleRate
  val slope = 2 * sqrt(amplitude) * sin(omega) / (2 * q)
  val cosine = cos(omega)
  return biquad(
    amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + slope),
    -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
    amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - slope),
    (amplitude + 1) - (amplitude - 1) * cosine + slope,
    2 * ((amplitude - 1) - (amplitude + 1) * cosine),
    (amplitude + 1) - (amplitude - 1) * cosine - slope,
  )
}

private class BuiltInProcessing(sampleRate: Int) {
  private val shelf = highShelf(TREBLE_SHELF_HZ, TREBLE_SHELF_DB, TREBLE_SHELF_Q, sampleRate)
  private val firstCutoff = lowPass(TREBLE_CUTOFF_HZ, TREBLE_CUTOFF_FIRST_Q, sampleRate)
  private val secondCutoff = lowPass(TREBLE_CUTOFF_HZ, TREBLE_CUTOFF_SECOND_Q, sampleRate)
  private val threshold = 10.0.pow(COMPRESSOR_THRESHOLD_DB / 10).toFloat()
  private val exponent = ((1 - 1 / COMPRESSOR_RATIO) / 2).toFloat()
  private val attack = smoothing(COMPRESSOR_ATTACK_SECONDS, sampleRate)
  private val release = smoothing(COMPRESSOR_RELEASE_SECONDS, sampleRate)
  private val limitRelease = smoothing(LIMIT_RELEASE_SECONDS, sampleRate)
  private val highPass = (1 / (1 + 2 * PI * DETECTOR_CUTOFF_HZ / sampleRate)).toFloat()
  private var input = 0f
  private var detector = 0f
  private var power = 0f
  private var limiterGain = 1f

  fun process(sample: Float): Float {
    val filtered = secondCutoff.process(firstCutoff.process(shelf.process(sample)))
    val gained = filtered * BUILT_IN_GAIN
    detector = highPass * (detector + gained - input)
    input = gained
    val level = detector * detector
    power = level + (power - level) * if (level > power) attack else release
    val compressed = if (power > threshold) gained * (threshold / power).pow(exponent) else gained
    val peak = abs(compressed)
    val target = if (peak > LIMIT) LIMIT / peak else 1f
    limiterGain =
      if (target < limiterGain) target else target + (limiterGain - target) * limitRelease
    return compressed * limiterGain
  }
}

private class Capture(
  val session: Int,
  val record: AudioRecord,
  val sampleRate: Int,
  val proxy: JavaScriptReplyProxy,
  private val send: (ByteArray) -> Unit,
) {
  @Volatile private var running = true
  @Volatile private var builtIn = false
  private val processing = BuiltInProcessing(sampleRate)
  private val thread = Thread({ pump() }, "musetric-microphone")
  private val routing = AudioRouting.OnRoutingChangedListener { updateRoute() }

  fun start(): Boolean {
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      return false
    }
    updateRoute()
    record.addOnRoutingChangedListener(routing, null)
    thread.start()
    return true
  }

  private fun updateRoute() {
    builtIn = record.routedDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_MIC
  }

  fun stop() {
    running = false
    record.removeOnRoutingChangedListener(routing)
    record.stop()
    if (thread.isAlive) {
      thread.join()
    }
    record.release()
  }

  private fun pump() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val samples = FloatArray(sampleRate / CHUNKS_PER_SECOND)
    val timestamp = AudioTimestamp()
    var position = 0L
    while (running) {
      val read = record.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
      if (read < 0) {
        return
      }
      val timed =
        record.getTimestamp(timestamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS
      if (read > 0 && timed) {
        val offset = (position - timestamp.framePosition) * NANOS_PER_SECOND / sampleRate
        send(encode(timestamp.nanoTime + offset, position, samples, read))
      }
      position += read
    }
  }

  private fun encode(
    captureNanos: Long,
    frame: Long,
    samples: FloatArray,
    count: Int,
  ): ByteArray {
    val buffer =
      ByteBuffer.allocate(HEADER_BYTES + count * Float.SIZE_BYTES).order(ByteOrder.LITTLE_ENDIAN)
    buffer.putDouble(session.toDouble())
    buffer.putDouble(captureNanos / NANOS_PER_MILLI)
    buffer.putDouble(sampleRate.toDouble())
    buffer.putDouble(frame.toDouble())
    val processed = builtIn
    for (index in 0 until count) {
      val sample = samples[index]
      buffer.putFloat(if (processed) processing.process(sample) else sample)
    }
    return buffer.array()
  }
}

private class PendingStart(
  val id: Int,
  val command: JSONObject,
  val proxy: JavaScriptReplyProxy,
)

private fun inputLabel(device: AudioDeviceInfo): String? =
  when (device.type) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> builtInLabel(device)
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "${device.productName} (USB headset)"
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> "${device.productName} (USB)"
    else -> null
  }

private fun builtInLabel(device: AudioDeviceInfo): String {
  val address = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) device.address else ""
  return if (address.isBlank()) "Built-in microphone" else "Built-in microphone ($address)"
}

private fun inputPriority(type: Int): Int =
  when (type) {
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY,
    AudioDeviceInfo.TYPE_USB_HEADSET -> 0
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> 1
    else -> 2
  }

private fun outputLabel(device: AudioDeviceInfo): String? =
  when (device.type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Speaker"
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired headphones"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER -> "${device.productName} (Bluetooth)"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "${device.productName} (USB headset)"
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> "${device.productName} (USB)"
    AudioDeviceInfo.TYPE_HDMI -> "${device.productName} (HDMI)"
    else -> null
  }

private fun outputPriority(type: Int): Int =
  when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER -> 0
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> 1
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> 2
    AudioDeviceInfo.TYPE_HDMI -> 3
    else -> 4
  }

private fun ports(devices: List<AudioDeviceInfo>, label: (AudioDeviceInfo) -> String?) =
  JSONArray(
    devices.map { device ->
      JSONObject().put("id", device.id.toString()).put("label", label(device))
    },
  )

private class MicrophoneBridge(private val activity: AppCompatActivity) :
  WebViewCompat.WebMessageListener {
  private val audioManager = activity.getSystemService(AudioManager::class.java)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val pendingStarts = mutableListOf<PendingStart>()
  private var capture: Capture? = null
  private var session = 0
  private var deviceProxy: JavaScriptReplyProxy? = null
  private val permission: ActivityResultLauncher<String> =
    activity.activityResultRegistry.register(
      PERMISSION_KEY,
      ActivityResultContracts.RequestPermission(),
    ) { granted ->
      onPermission(granted)
    }

  private val deviceCallback =
    object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
        notifyDevices()
      }

      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
        notifyDevices()
      }
    }

  init {
    audioManager.registerAudioDeviceCallback(deviceCallback, mainHandler)
    activity.lifecycle.addObserver(
      object : DefaultLifecycleObserver {
        override fun onDestroy(owner: LifecycleOwner) {
          audioManager.unregisterAudioDeviceCallback(deviceCallback)
          stopCapture()
          permission.unregister()
        }
      },
    )
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
    val id = command.getInt("id")
    deviceProxy = replyProxy
    when (command.getString("type")) {
      "devices" -> reply(replyProxy, id, devices())
      "access" -> reply(replyProxy, id, JSONObject().put("granted", hasAccess()))
      "start" -> requestStart(PendingStart(id, command, replyProxy))
      "stop" -> {
        stopCapture()
        reply(replyProxy, id, JSONObject())
      }
      "openSettings" -> {
        showAppSettings(activity)
        reply(replyProxy, id, JSONObject())
      }
      else -> fail(replyProxy, id, "unknown-command")
    }
  }

  private fun hasAccess() =
    ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun requestStart(pending: PendingStart) {
    if (hasAccess()) {
      open(pending)
      return
    }
    pendingStarts.add(pending)
    if (pendingStarts.size == 1) {
      permission.launch(Manifest.permission.RECORD_AUDIO)
    }
  }

  private fun onPermission(granted: Boolean) {
    val starts = pendingStarts.toList()
    pendingStarts.clear()
    for (pending in starts) {
      if (granted) {
        open(pending)
      } else {
        fail(pending.proxy, pending.id, ACCESS_DENIED)
      }
    }
  }

  private fun open(pending: PendingStart) {
    val sampleRate = pending.command.getInt("sampleRate")
    val device = findInput(pending.command.optString("deviceId"))
    val current = capture
    if (current != null && current.proxy == pending.proxy && current.sampleRate == sampleRate) {
      current.record.setPreferredDevice(device)
      reply(pending.proxy, pending.id, describe(current, device))
      return
    }
    stopCapture()
    val record = createRecord(sampleRate)
    if (record == null) {
      fail(pending.proxy, pending.id, UNAVAILABLE)
      return
    }
    record.setPreferredDevice(device)
    session += 1
    val proxy = pending.proxy
    val next = Capture(session, record, sampleRate, proxy) { bytes ->
      mainHandler.post { proxy.postMessage(bytes) }
    }
    if (!next.start()) {
      next.stop()
      fail(proxy, pending.id, UNAVAILABLE)
      return
    }
    capture = next
    reply(proxy, pending.id, describe(next, device))
  }

  private fun describe(current: Capture, device: AudioDeviceInfo?): JSONObject {
    val routed = device ?: current.record.routedDevice ?: defaultInput(inputs())
    return JSONObject()
      .put("session", current.session)
      .put("deviceId", routed?.id?.toString() ?: "")
      .put("chunkSeconds", 1.0 / CHUNKS_PER_SECOND)
  }

  @SuppressLint("MissingPermission")
  private fun createRecord(sampleRate: Int): AudioRecord? {
    val minimum =
      AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_FLOAT,
      )
    if (minimum <= 0) {
      return null
    }
    val format =
      AudioFormat.Builder()
        .setSampleRate(sampleRate)
        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .build()
    val bufferBytes = maxOf(minimum, (sampleRate * BUFFER_SECONDS).toInt() * Float.SIZE_BYTES)
    val record =
      runCatching {
          AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferBytes)
            .build()
        }
        .getOrNull() ?: return null
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      return null
    }
    return record
  }

  private fun stopCapture() {
    capture?.stop()
    capture = null
  }

  private fun inputs() =
    audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS).filter { inputLabel(it) != null }

  private fun outputs() =
    audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { outputLabel(it) != null }

  private fun findInput(deviceId: String): AudioDeviceInfo? =
    inputs().find { it.id.toString() == deviceId }

  private fun defaultInput(inputs: List<AudioDeviceInfo>): AudioDeviceInfo? =
    inputs.minByOrNull { inputPriority(it.type) }

  private fun defaultOutput(outputs: List<AudioDeviceInfo>): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val media = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
      val routed = audioManager.getAudioDevicesForAttributes(media).firstOrNull()
      val match =
        routed?.let { target ->
          outputs.find { it.type == target.type && it.address == target.address }
        }
      if (match != null) {
        return match
      }
    }
    return outputs.minByOrNull { outputPriority(it.type) }
  }

  private fun devices(): JSONObject {
    val inputs = inputs()
    val outputs = outputs()
    return JSONObject()
      .put("inputs", ports(inputs, ::inputLabel))
      .put("outputs", ports(outputs, ::outputLabel))
      .put("defaultInput", defaultInput(inputs)?.id?.toString())
      .put("defaultOutput", defaultOutput(outputs)?.id?.toString())
  }

  private fun notifyDevices() {
    deviceProxy?.postMessage(JSONObject().put("type", "devicechange").toString())
  }

  private fun reply(proxy: JavaScriptReplyProxy, id: Int, result: JSONObject) {
    proxy.postMessage(JSONObject().put("id", id).put("result", result).toString())
  }

  private fun fail(proxy: JavaScriptReplyProxy, id: Int, error: String) {
    proxy.postMessage(JSONObject().put("id", id).put("error", error).toString())
  }
}

internal fun attachMicrophone(activity: AppCompatActivity, webView: WebView) {
  val supported =
    WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
      WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
  if (!supported) {
    return
  }
  webView.addJavascriptInterface(MicrophoneClock(), CLOCK_NAME)
  WebViewCompat.addWebMessageListener(webView, BRIDGE_NAME, setOf("*"), MicrophoneBridge(activity))
}
