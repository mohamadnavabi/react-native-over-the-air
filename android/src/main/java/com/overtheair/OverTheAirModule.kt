package com.overtheair

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

@ReactModule(name = OverTheAirModule.NAME)
class OverTheAirModule(reactContext: ReactApplicationContext) :
  NativeOverTheAirSpec(reactContext) {

  private val prefs by lazy { OverTheAir.prefs(reactApplicationContext) }
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "OverTheAir").apply { isDaemon = true }
  }
  private val installing = AtomicBoolean(false)
  private var lastProgressAt = 0L

  override fun getName(): String = NAME

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  override fun setBaseURL(url: String, allowInsecureHttp: Boolean) {
    prefs.edit()
      .putString(OverTheAir.KEY_BASE_URL, url)
      .putBoolean(OverTheAir.KEY_ALLOW_INSECURE_HTTP, allowInsecureHttp)
      .apply()
  }

  override fun getAppVersion(): String =
    OverTheAir.getAppVersion(reactApplicationContext)

  override fun getBundleVersion(): String =
    OverTheAir.installedVersion(reactApplicationContext)

  override fun isPendingUpdate(): Boolean =
    prefs.getString(OverTheAir.pendingVersionKey(reactApplicationContext), null) != null

  override fun notifyAppReady() {
    OverTheAir.confirmPendingUpdate(reactApplicationContext)
  }

  override fun resetToDefault() {
    OverTheAir.reset(reactApplicationContext)
  }

  override fun checkForUpdates(promise: Promise) {
    executor.execute {
      try {
        val baseURL = prefs.getString(OverTheAir.KEY_BASE_URL, null)
        if (baseURL.isNullOrBlank()) {
          promise.reject("NO_BASE_URL", "Base URL not set. Call setBaseURL first.")
          return@execute
        }

        val manifestURL =
          if (baseURL.endsWith("/")) "${baseURL}manifest.json" else "$baseURL/manifest.json"

        val body = openConnection(manifestURL, noCache = true).let { connection ->
          try {
            connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
          } finally {
            connection.disconnect()
          }
        }

        val manifest = JSONObject(body)
        val platformUpdates = manifest.optJSONObject(PLATFORM)
        if (platformUpdates == null) {
          promise.resolve(null)
          return@execute
        }

        val appVersion = OverTheAir.getAppVersion(reactApplicationContext)
        val entry = platformUpdates.optJSONObject(appVersion)
        if (entry == null) {
          promise.resolve(null)
          return@execute
        }

        val url = entry.optString("url").takeIf { it.isNotBlank() }
        val remoteVersion = entry.optString("version").takeIf { it.isNotBlank() }
        if (url == null || remoteVersion == null) {
          promise.reject(
            "INVALID_MANIFEST",
            "The manifest entry for $PLATFORM/$appVersion is missing \"url\" or \"version\"."
          )
          return@execute
        }

        if (remoteVersion == OverTheAir.installedVersion(reactApplicationContext)) {
          promise.resolve(null)
          return@execute
        }

        val result: WritableMap = Arguments.createMap()
        result.putString("url", url)
        result.putString("version", remoteVersion)
        result.putBoolean("isMandatory", entry.optBoolean("isMandatory", false))
        entry.optString("hash").takeIf { it.isNotBlank() }?.let { result.putString("hash", it) }
        promise.resolve(result)
      } catch (e: Throwable) {
        Log.e(NAME, "Failed to check for updates", e)
        promise.reject(errorCode(e, "MANIFEST_ERROR"), e.message ?: e.toString(), e)
      }
    }
  }

  override fun installUpdate(url: String, version: String, hash: String?, promise: Promise) {
    if (!installing.compareAndSet(false, true)) {
      promise.reject("ALREADY_INSTALLING", "Another update is already being installed.")
      return
    }
    executor.execute {
      val staging = OverTheAir.stagingDir(reactApplicationContext)
      val download = File(OverTheAir.versionRoot(reactApplicationContext), "download.tmp")
      try {
        staging.deleteRecursively()
        if (!staging.mkdirs()) {
          throw IOException("Could not create the staging directory at $staging")
        }

        // Seed from the active bundle so an incremental package, which only
        // carries changed assets, merges onto what is already installed.
        val current = OverTheAir.currentDir(reactApplicationContext)
        if (current.isDirectory) {
          current.copyRecursively(staging, overwrite = true)
        }

        val connection = openConnection(url, noCache = false)
        val actualHash = try {
          downloadTo(connection, download)
        } finally {
          connection.disconnect()
        }

        if (hash != null && !hash.equals(actualHash, ignoreCase = true)) {
          throw SecurityException(
            "Bundle integrity check failed: expected $hash but got $actualHash"
          )
        }

        if (url.substringBefore('?').lowercase(Locale.ROOT).endsWith(".zip")) {
          download.inputStream().use { extractZip(it, staging) }
        } else {
          download.copyTo(File(staging, OverTheAir.BUNDLE_FILE), overwrite = true)
        }

        applyRemovalList(staging)

        val bundle = File(staging, OverTheAir.BUNDLE_FILE)
        if (!bundle.isFile || bundle.length() == 0L) {
          throw IOException(
            "The package does not contain a usable ${OverTheAir.BUNDLE_FILE}"
          )
        }

        promote(staging, version)
        promise.resolve(true)
      } catch (e: Throwable) {
        Log.e(NAME, "Failed to install update $version", e)
        staging.deleteRecursively()
        promise.reject(errorCode(e, "DOWNLOAD_ERROR"), e.message ?: e.toString(), e)
      } finally {
        download.delete()
        installing.set(false)
      }
    }
  }

  override fun reloadBundle() {
    runOnMainThread {
      val application = reactApplicationContext.applicationContext
      // A JS reload re-reads the same bundle path, which now holds the new
      // bundle. That only works if the host was started from an OTA bundle in
      // the first place; otherwise the path was never configured and only a
      // fresh process will pick the update up.
      val reactHost = (application as? ReactApplication)?.reactHost
      if (OverTheAir.loadedFromOTA && reactHost != null) {
        OverTheAir.markPendingLaunched(reactApplicationContext)
        reactHost.reload("OverTheAir: applying update")
        return@runOnMainThread
      }

      val intent = application.packageManager.getLaunchIntentForPackage(application.packageName)
      if (intent == null) {
        Log.e(NAME, "No launch intent for ${application.packageName}; cannot restart")
        return@runOnMainThread
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      application.startActivity(intent)
      // Give the new task a moment to start before tearing this process down.
      Handler(Looper.getMainLooper()).postDelayed({
        android.os.Process.killProcess(android.os.Process.myPid())
      }, RESTART_DELAY_MS)
    }
  }

  // region networking

  private fun openConnection(urlString: String, noCache: Boolean): HttpURLConnection {
    val allowInsecure = prefs.getBoolean(OverTheAir.KEY_ALLOW_INSECURE_HTTP, false)
    var target = urlString
    var redirects = 0

    while (true) {
      val url = URL(target)
      if (!allowInsecure && !url.protocol.equals("https", ignoreCase = true)) {
        throw InsecureUrlException(
          "Refusing to load $target over ${url.protocol}. Serve updates over HTTPS, " +
            "or opt in with setBaseURL(url, { allowInsecureHttp: true })."
        )
      }

      val connection = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        // Handled below so that http -> https hops work, which
        // HttpURLConnection refuses to follow on its own.
        instanceFollowRedirects = false
        // Keep Content-Length meaningful for progress, and hash the bytes the
        // server actually published.
        setRequestProperty("Accept-Encoding", "identity")
        setRequestProperty("X-App-Version", OverTheAir.getAppVersion(reactApplicationContext))
        setRequestProperty("X-Platform", PLATFORM)
        if (noCache) {
          setRequestProperty("Cache-Control", "no-cache")
          setRequestProperty("Pragma", "no-cache")
        }
      }

      val code = connection.responseCode
      if (code in 300..399) {
        val location = connection.getHeaderField("Location")
        connection.disconnect()
        if (location.isNullOrBlank()) {
          throw IOException("HTTP $code for $target without a Location header")
        }
        if (++redirects > MAX_REDIRECTS) {
          throw IOException("Too many redirects while fetching $urlString")
        }
        target = URL(url, location).toString()
        continue
      }
      if (code !in 200..299) {
        connection.disconnect()
        throw IOException("HTTP $code for $target")
      }
      return connection
    }
  }

  /** Streams the response to [destination] and returns its lowercase hex SHA-256. */
  private fun downloadTo(connection: HttpURLConnection, destination: File): String {
    destination.parentFile?.mkdirs()
    val total = connection.contentLengthLong.coerceAtLeast(0L)
    val digest = MessageDigest.getInstance("SHA-256")
    var received = 0L
    lastProgressAt = 0L

    connection.inputStream.use { input ->
      FileOutputStream(destination).use { output ->
        val buffer = ByteArray(BUFFER_SIZE)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          if (read == 0) continue
          output.write(buffer, 0, read)
          digest.update(buffer, 0, read)
          received += read
          maybeEmitProgress(received, total)
        }
        output.flush()
        output.fd.sync()
      }
    }
    emitProgress(received, total)
    return digest.digest().toHex()
  }

  private fun maybeEmitProgress(received: Long, total: Long) {
    val now = SystemClock.uptimeMillis()
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = now
    emitProgress(received, total)
  }

  private fun emitProgress(received: Long, total: Long) {
    val event: WritableMap = Arguments.createMap()
    event.putDouble("receivedBytes", received.toDouble())
    event.putDouble("totalBytes", total.toDouble())
    emitOnDownloadProgress(event)
  }

  // endregion

  // region install

  private fun extractZip(source: InputStream, destination: File) {
    val root = destination.canonicalFile
    val prefix = root.path + File.separator
    ZipInputStream(source).use { zip ->
      var entry = zip.nextEntry
      while (entry != null) {
        val target = File(root, entry.name).canonicalFile
        // Zip Slip: compare against the directory *plus a separator*, otherwise
        // a sibling such as "current-evil" satisfies a bare prefix test.
        if (!target.path.startsWith(prefix)) {
          throw SecurityException("Package contains an out-of-bounds entry: ${entry.name}")
        }
        if (entry.isDirectory) {
          target.mkdirs()
        } else {
          target.parentFile?.mkdirs()
          FileOutputStream(target).use { output ->
            val buffer = ByteArray(BUFFER_SIZE)
            while (true) {
              val read = zip.read(buffer)
              if (read < 0) break
              output.write(buffer, 0, read)
            }
          }
        }
        zip.closeEntry()
        entry = zip.nextEntry
      }
    }
  }

  /**
   * Deletes assets the CLI recorded as removed since the base build. Without
   * this an incremental package can only ever add files, so assets dropped
   * from the app would linger on device forever.
   */
  private fun applyRemovalList(staging: File) {
    val listFile = File(staging, REMOVAL_LIST_NAME)
    if (!listFile.isFile) return
    try {
      val entries = JSONObject(listFile.readText()).optJSONArray("remove") ?: return
      val prefix = staging.canonicalFile.path + File.separator
      for (i in 0 until entries.length()) {
        val relative = entries.optString(i)
        if (relative.isNullOrBlank()) continue
        val target = File(staging, relative).canonicalFile
        if (target.path.startsWith(prefix)) {
          target.deleteRecursively()
        } else {
          Log.w(NAME, "Ignoring out-of-bounds removal entry: $relative")
        }
      }
    } catch (e: Exception) {
      Log.w(NAME, "Could not apply the removal list", e)
    } finally {
      listFile.delete()
    }
  }

  /** Swaps [staging] in as the active bundle, keeping a rollback copy. */
  private fun promote(staging: File, version: String) {
    val context = reactApplicationContext
    val current = OverTheAir.currentDir(context)
    val backup = OverTheAir.backupDir(context)
    val pendingKey = OverTheAir.pendingVersionKey(context)
    val replacingUnconfirmed = prefs.getString(pendingKey, null) != null

    if (replacingUnconfirmed) {
      // What is active has not proven itself yet, so it is not a rollback
      // target; keep the older backup, which is the last confirmed bundle.
      current.deleteRecursively()
    } else {
      backup.deleteRecursively()
      if (current.exists() && !current.renameTo(backup)) {
        current.deleteRecursively()
      }
    }

    if (!staging.renameTo(current)) {
      if (!current.exists() && backup.exists()) {
        backup.renameTo(current)
      }
      throw IOException("Could not activate the downloaded bundle")
    }

    prefs.edit()
      .putString(pendingKey, version)
      .putBoolean(OverTheAir.pendingLaunchedKey(context), false)
      .commit()
  }

  // endregion

  private fun runOnMainThread(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      Handler(Looper.getMainLooper()).post { block() }
    }
  }

  /** Keeps the rejection codes identical to the iOS implementation. */
  private fun errorCode(error: Throwable, fallback: String): String = when (error) {
    is InsecureUrlException -> "INSECURE_URL"
    is SecurityException -> "INTEGRITY_ERROR"
    else -> fallback
  }

  private class InsecureUrlException(message: String) : SecurityException(message)

  private fun ByteArray.toHex(): String {
    val out = StringBuilder(size * 2)
    for (byte in this) {
      out.append(HEX[(byte.toInt() shr 4) and 0x0F])
      out.append(HEX[byte.toInt() and 0x0F])
    }
    return out.toString()
  }

  companion object {
    const val NAME = "OverTheAir"

    private const val PLATFORM = "android"
    private const val REMOVAL_LIST_NAME = ".ota-remove.json"
    private const val BUFFER_SIZE = 8192
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val MAX_REDIRECTS = 5
    private const val PROGRESS_INTERVAL_MS = 100L
    private const val RESTART_DELAY_MS = 100L
    private val HEX = "0123456789abcdef".toCharArray()
  }
}
