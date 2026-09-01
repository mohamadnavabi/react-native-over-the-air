package com.overtheair

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File

/**
 * Boot-time entry point for the OTA bundle, plus the on-disk layout shared with
 * [OverTheAirModule].
 *
 * Each native app version owns an isolated directory so that an OTA bundle
 * built against an older binary is never handed to a newer one:
 *
 * ```
 * filesDir/ota/<nativeAppVersion>/
 *     current/   active bundle + assets
 *     staging/   install in progress; promoted with a single rename
 *     backup/    last confirmed-good bundle, restored if the new one fails to boot
 * ```
 */
object OverTheAir {
    private const val TAG = "OverTheAir"
    private const val PREFS_NAME = "OverTheAir"
    private const val OTA_DIR = "ota"

    internal const val BUNDLE_FILE = "index.android.bundle"

    internal const val KEY_BASE_URL = "baseURL"
    internal const val KEY_ALLOW_INSECURE_HTTP = "allowInsecureHttp"
    private const val KEY_CURRENT_VERSION = "currentBundleVersion"
    private const val KEY_PENDING_VERSION = "pendingBundleVersion"
    private const val KEY_PENDING_LAUNCHED = "pendingBundleLaunched"

    /**
     * Whether [getBundleFilePath] handed an OTA bundle to the host in this
     * process. When false the running JS came from the APK, and a JS-level
     * reload would not pick up a freshly installed bundle.
     */
    @Volatile
    internal var loadedFromOTA: Boolean = false
        private set

    /**
     * Whether the rollback check has already run in this process. A host that
     * asks for the bundle path more than once, or a JS-level reload, must not
     * be mistaken for a fresh launch of an unconfirmed bundle.
     */
    @Volatile
    private var resolvedPendingLaunch: Boolean = false

    /** Returns the native app version (e.g. "1.0"), or "unknown". */
    @JvmStatic
    fun getAppVersion(context: Context): String {
        return try {
            val packageInfo =
                context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "unknown"
        } catch (e: Exception) {
            Log.w(TAG, "Could not read the app version", e)
            "unknown"
        }
    }

    /**
     * Returns the path of the OTA bundle to load, or null to fall back to the
     * bundle packaged in the APK.
     *
     * Call this from `MainApplication` when building the [com.facebook.react.ReactHost].
     * It also performs the rollback check: an update that was handed to a
     * previous launch but never confirmed by `notifyAppReady()` is assumed to
     * have failed and is reverted here.
     */
    @JvmStatic
    fun getBundleFilePath(context: Context): String? {
        val appContext = context.applicationContext
        runCatching { pruneOtherVersions(appContext) }
            .onFailure { Log.w(TAG, "Could not prune stale OTA directories", it) }
        runCatching { resolvePendingLaunch(appContext) }
            .onFailure { Log.w(TAG, "Could not resolve the pending update", it) }

        val bundle = File(currentDir(appContext), BUNDLE_FILE)
        if (!bundle.isFile || bundle.length() == 0L) {
            return null
        }
        loadedFromOTA = true
        return bundle.absolutePath
    }

    internal fun prefs(context: Context): SharedPreferences =
        context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    internal fun versionRoot(context: Context): File =
        File(File(context.applicationContext.filesDir, OTA_DIR), getAppVersion(context))

    internal fun currentDir(context: Context): File = File(versionRoot(context), "current")

    internal fun stagingDir(context: Context): File = File(versionRoot(context), "staging")

    internal fun backupDir(context: Context): File = File(versionRoot(context), "backup")

    internal fun currentVersionKey(context: Context) =
        "$KEY_CURRENT_VERSION.${getAppVersion(context)}"

    internal fun pendingVersionKey(context: Context) =
        "$KEY_PENDING_VERSION.${getAppVersion(context)}"

    internal fun pendingLaunchedKey(context: Context) =
        "$KEY_PENDING_LAUNCHED.${getAppVersion(context)}"

    /** The version that is running or will run: the pending one, else the confirmed one. */
    internal fun installedVersion(context: Context): String {
        val prefs = prefs(context)
        return prefs.getString(pendingVersionKey(context), null)
            ?: prefs.getString(currentVersionKey(context), "")
            ?: ""
    }

    /**
     * Records that the pending bundle is about to be handed to a new React
     * instance, so a crash during that load is caught on the next launch
     * rather than one launch later.
     */
    internal fun markPendingLaunched(context: Context) {
        val prefs = prefs(context)
        if (prefs.getString(pendingVersionKey(context), null) == null) return
        prefs.edit().putBoolean(pendingLaunchedKey(context), true).commit()
    }

    /**
     * Promotes the pending update to confirmed and drops the rollback copy.
     * A no-op when nothing is pending.
     */
    internal fun confirmPendingUpdate(context: Context) {
        val prefs = prefs(context)
        val pending = prefs.getString(pendingVersionKey(context), null) ?: return
        prefs.edit()
            .putString(currentVersionKey(context), pending)
            .remove(pendingVersionKey(context))
            .remove(pendingLaunchedKey(context))
            .commit()
        backupDir(context).deleteRecursively()
        Log.i(TAG, "Bundle $pending confirmed")
    }

    /**
     * Marks the pending update as launched, or rolls it back when a previous
     * launch already tried it and never confirmed.
     *
     * Writes use `commit()` rather than `apply()`: the process may be killed by
     * a bad bundle before an async write reaches disk, which would let the same
     * broken update be retried forever.
     */
    private fun resolvePendingLaunch(context: Context) {
        val prefs = prefs(context)
        if (prefs.getString(pendingVersionKey(context), null) == null) {
            resolvedPendingLaunch = true
            return
        }

        if (resolvedPendingLaunch) {
            // Not a fresh launch: record that the pending bundle was handed
            // out, but never roll back here.
            prefs.edit().putBoolean(pendingLaunchedKey(context), true).commit()
            return
        }
        resolvedPendingLaunch = true

        if (prefs.getBoolean(pendingLaunchedKey(context), false)) {
            rollback(context)
        } else {
            prefs.edit().putBoolean(pendingLaunchedKey(context), true).commit()
        }
    }

    private fun rollback(context: Context) {
        val prefs = prefs(context)
        val pending = prefs.getString(pendingVersionKey(context), null)
        Log.w(TAG, "Bundle $pending never confirmed; rolling back")

        val current = currentDir(context)
        val backup = backupDir(context)
        current.deleteRecursively()
        if (backup.exists()) {
            backup.renameTo(current)
        }
        prefs.edit()
            .remove(pendingVersionKey(context))
            .remove(pendingLaunchedKey(context))
            .commit()
    }

    /** Deletes bundles downloaded for other native app versions. */
    private fun pruneOtherVersions(context: Context) {
        val root = File(context.applicationContext.filesDir, OTA_DIR)
        val keep = getAppVersion(context)
        root.listFiles()?.forEach { child ->
            if (child.isDirectory && child.name != keep) {
                child.deleteRecursively()
            }
        }
    }

    /** Removes every downloaded bundle for the current version. */
    internal fun reset(context: Context) {
        versionRoot(context).deleteRecursively()
        // The host was configured with a bundle path that no longer exists, so
        // a JS-level reload would fail; only a fresh process can recover.
        loadedFromOTA = false
        prefs(context).edit()
            .remove(currentVersionKey(context))
            .remove(pendingVersionKey(context))
            .remove(pendingLaunchedKey(context))
            .commit()
    }
}
