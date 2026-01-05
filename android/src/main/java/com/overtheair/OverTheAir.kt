package com.overtheair

import android.content.Context
import java.io.File

object OverTheAir {
    private const val OTA_DIR = "ota"
    private const val BUNDLE_FILE = "index.android.bundle"

    /**
     * Returns the native app version (e.g., "1.0.0").
     */
    fun getAppVersion(context: Context): String {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }

    /**
     * Returns the path to the OTA bundle for the CURRENT app version if it exists.
     * This ensures that if the app is updated from the Store, the old OTA bundle is ignored.
     */
    fun getBundleFilePath(context: Context): String? {
        val appVersion = getAppVersion(context)
        val otaBundle = File(context.filesDir, "$OTA_DIR/$appVersion/$BUNDLE_FILE")
        return if (otaBundle.exists()) otaBundle.absolutePath else null
    }

    /**
     * Returns the working directory for the current version's OTA bundle.
     */
    internal fun getWorkingPath(context: Context): String {
        val appVersion = getAppVersion(context)
        val otaDir = File(context.filesDir, "$OTA_DIR/$appVersion")
        if (!otaDir.exists()) {
            otaDir.mkdirs()
        }
        return File(otaDir, BUNDLE_FILE).absolutePath
    }
}
