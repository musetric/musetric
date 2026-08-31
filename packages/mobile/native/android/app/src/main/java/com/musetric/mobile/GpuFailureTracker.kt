package com.musetric.mobile

import android.app.ActivityManager
import android.content.Context
import android.util.Log
import java.io.File
import org.json.JSONObject

private const val gpuProcessingMarkerFileName = "gpu-processing.marker"
private const val gpuFailureLogTag = "MusetricGpuFailure"
private const val gpuFailureMessage =
  "Android stopped the GPU processing process. Tap Retry to start it again."

class GpuFailureTracker(context: Context) {
  private val appContext = context.applicationContext
  private val markerFile = File(appContext.filesDir, gpuProcessingMarkerFileName)
  private val projectIdPattern = Regex("[0-9a-f]{32}")

  fun begin(projectId: String) {
    if (projectIdPattern.matches(projectId)) {
      markerFile.writeText(projectId)
    }
  }

  fun finish() {
    if (markerFile.exists() && !markerFile.delete()) {
      Log.w(gpuFailureLogTag, "Could not clear the GPU processing marker")
    }
  }

  fun consumeFailedProjectId(): String? {
    if (!markerFile.exists() || isGpuProcessAlive()) {
      return null
    }
    val projectId = markerFile.readText().trim()
    finish()
    return projectId.takeIf(projectIdPattern::matches)
  }

  fun markSeparationFailed(projectId: String) {
    val projectFile = File(appContext.filesDir, "storage/projects/$projectId/project.json")
    try {
      val project = JSONObject(projectFile.readText())
      val processing = project.optJSONObject("processing") ?: JSONObject().also {
        project.put("processing", it)
      }
      val steps = processing.optJSONObject("steps") ?: JSONObject().also {
        processing.put("steps", it)
      }
      val separation = steps.optJSONObject("separation") ?: JSONObject().also {
        steps.put("separation", it)
      }
      separation.put("status", "failed")
      separation.remove("progress")
      separation.remove("download")
      separation.remove("message")
      separation.put("error", gpuFailureMessage)
      processing.put("done", false)
      projectFile.writeText(project.toString())
    } catch (error: Exception) {
      Log.e(gpuFailureLogTag, "Could not record the GPU processing failure", error)
    }
  }

  private fun isGpuProcessAlive(): Boolean {
    val activityManager = appContext.getSystemService(Context.ACTIVITY_SERVICE)
      as ActivityManager
    val gpuProcessName = "${appContext.packageName}:gpu"
    return activityManager.runningAppProcesses
      ?.any { process -> process.processName == gpuProcessName }
      ?: false
  }
}
