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

import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader

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
        connection.setRequestProperty("X-App-Version", OverTheAir.getAppVersion(reactApplicationContext))
        connection.setRequestProperty("X-Platform", "android")

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

        val manifestURLString = if (baseURL.endsWith("/")) "${baseURL}manifest.json" else "$baseURL/manifest.json"
        val connection = URL(manifestURLString).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 10000
        connection.readTimeout = 10000

        if (connection.responseCode != 200) {
          promise.resolve(null)
          return@Thread
        }

        val reader = BufferedReader(InputStreamReader(connection.inputStream))
        val response = StringBuilder()
        var line: String?
        while (reader.readLine().also { line = it } != null) {
          response.append(line)
        }
        reader.close()

        val manifest = JSONObject(response.toString())
        val platformUpdates = manifest.optJSONObject("android") ?: return@Thread promise.resolve(null)
        val appVersion = OverTheAir.getAppVersion(reactApplicationContext)
        val updateInfo = platformUpdates.optJSONObject(appVersion) ?: return@Thread promise.resolve(null)

        val remoteVersion = updateInfo.optString("version")
        val localVersion = sharedPreferences.getString("CurrentBundleVersion_$appVersion", "")

        if (remoteVersion != localVersion) {
          val result: WritableMap = Arguments.createMap()
          result.putString("url", updateInfo.getString("url"))
          result.putString("version", remoteVersion)
          result.putBoolean("isMandatory", updateInfo.optBoolean("isMandatory", false))
          promise.resolve(result)
        } else {
          promise.resolve(null)
        }
      } catch (e: Exception) {
        Log.e("OverTheAir", "Failed to check for updates", e)
        promise.resolve(null)
      }
    }.start()
  }

  override fun saveBundleVersion(version: String) {
    val appVersion = OverTheAir.getAppVersion(reactApplicationContext)
    sharedPreferences.edit().putString("CurrentBundleVersion_$appVersion", version).apply()
  }

  override fun getAppVersion(): String {
    return OverTheAir.getAppVersion(reactApplicationContext)
  }

  override fun getBundleVersion(): String {
    val appVersion = OverTheAir.getAppVersion(reactApplicationContext)
    return sharedPreferences.getString("CurrentBundleVersion_$appVersion", "") ?: ""
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
