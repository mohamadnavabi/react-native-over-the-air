package com.overtheair

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

@ReactModule(name = OverTheAirModule.NAME)
class OverTheAirModule(reactContext: ReactApplicationContext) :
  NativeOverTheAirSpec(reactContext) {

  private val sharedPreferences: SharedPreferences =
    reactContext.getSharedPreferences("OverTheAir", Context.MODE_PRIVATE)

  override fun getName(): String {
    return NAME
  }

  private fun getBundlePath(): String {
    return OverTheAir.getWorkingPath(reactApplicationContext)
  }

  override fun setBaseURL(url: String) {
    sharedPreferences.edit().putString("OverTheAirBaseURL", url).apply()
  }

  override fun downloadBundle(url: String, promise: Promise) {
    Thread {
      try {
        val bundleURL = URL(url)
        val connection = bundleURL.openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 30000
        connection.readTimeout = 30000

        val responseCode = connection.responseCode
        if (responseCode < 200 || responseCode >= 300) {
          promise.reject("HTTP_ERROR", "HTTP $responseCode")
          return@Thread
        }

        val inputStream = connection.inputStream
        val bundlePath = getBundlePath()
        val bundleFile = File(bundlePath)
        
        // Create parent directory if it doesn't exist
        bundleFile.parentFile?.mkdirs()

        FileOutputStream(bundleFile).use { outputStream ->
          inputStream.copyTo(outputStream)
        }

        promise.resolve(true)
      } catch (e: Exception) {
        Log.e("OverTheAir", "Failed to download bundle", e)
        promise.reject("DOWNLOAD_ERROR", e.message ?: "Unknown error", e)
      }
    }.start()
  }

  override fun checkForUpdates(promise: Promise) {
    Thread {
      try {
        val baseURL = sharedPreferences.getString("OverTheAirBaseURL", null)
        if (baseURL == null) {
          promise.reject("NO_BASE_URL", "Base URL not set. Call setBaseURL first.")
          return@Thread
        }

        val bundleFileName = "index.android.bundle"
        val bundleURLString = if (baseURL.endsWith("/")) {
          "$baseURL$bundleFileName"
        } else {
          "$baseURL/$bundleFileName"
        }

        val bundleURL = URL(bundleURLString)
        val connection = bundleURL.openConnection() as HttpURLConnection
        connection.requestMethod = "HEAD"
        connection.connectTimeout = 10000
        connection.readTimeout = 10000

        val responseCode = connection.responseCode
        if (responseCode < 200 || responseCode >= 300) {
          promise.resolve(false)
          return@Thread
        }

        val localBundlePath = getBundlePath()
        val localBundleFile = File(localBundlePath)

        if (!localBundleFile.exists()) {
          promise.resolve(true)
          return@Thread
        }

        val localLastModified = localBundleFile.lastModified()
        val localSize = localBundleFile.length()

        var hasUpdate = false
        var canCompare = false

        // Check Last-Modified header
        val lastModifiedString = connection.getHeaderField("Last-Modified")
        if (lastModifiedString != null && lastModifiedString.isNotEmpty()) {
          try {
            val formatter = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US)
            formatter.timeZone = TimeZone.getTimeZone("GMT")
            val remoteLastModified = formatter.parse(lastModifiedString)
            if (remoteLastModified != null) {
              canCompare = true
              if (remoteLastModified.time > localLastModified) {
                hasUpdate = true
              }
            }
          } catch (e: Exception) {
            Log.w("OverTheAir", "Failed to parse Last-Modified header", e)
          }
        }

        // Check Content-Length header
        val contentLengthString = connection.getHeaderField("Content-Length")
        if (contentLengthString != null && contentLengthString.isNotEmpty()) {
          try {
            val remoteContentLength = contentLengthString.toLong()
            if (remoteContentLength > 0) {
              canCompare = true
              if (remoteContentLength != localSize) {
                hasUpdate = true
              }
            }
          } catch (e: Exception) {
            Log.w("OverTheAir", "Failed to parse Content-Length header", e)
          }
        }

        // If we can't reliably compare (no headers), default to true to allow download
        // This ensures users can always try to download if bundle exists on server
        if (!canCompare) {
          hasUpdate = true
        }

        promise.resolve(hasUpdate)
      } catch (e: Exception) {
        Log.e("OverTheAir", "Failed to check for updates", e)
        promise.resolve(false)
      }
    }.start()
  }

  override fun reloadBundle() {
    UiThreadUtil.runOnUiThread {
      try {
        val bundlePath = getBundlePath()
        val bundleFile = File(bundlePath)
        
        if (!bundleFile.exists()) {
          Log.e("OverTheAir", "Bundle file does not exist at: $bundlePath")
        }

        Log.d("OverTheAir", "Reloading app to apply bundle from: $bundlePath")

        val context = reactApplicationContext.applicationContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (intent != null) {
          intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
          context.startActivity(intent)
          System.exit(0)
        } else {
          Log.e("OverTheAir", "Could not get launch intent for package")
          reactApplicationContext.currentActivity?.recreate()
        }
      } catch (e: Exception) {
        Log.e("OverTheAir", "Failed to reload bundle", e)
      }
    }
  }

  companion object {
    const val NAME = "OverTheAir"
  }
}
