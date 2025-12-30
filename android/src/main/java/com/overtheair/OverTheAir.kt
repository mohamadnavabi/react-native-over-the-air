package com.overtheair

import android.content.Context
import java.io.File

object OverTheAir {
    private const val OTA_DIR = "ota"
    private const val BUNDLE_FILE = "index.android.bundle"

    /**
     * Returns the path to the OTA bundle if it exists, otherwise returns null.
     * This should be used in MainApplication to determine which bundle to load.
     */
    fun getBundleFilePath(context: Context): String? {
        val otaBundle = File(context.filesDir, "$OTA_DIR/$BUNDLE_FILE")
        return if (otaBundle.exists()) otaBundle.absolutePath else null
    }

    /**
     * Returns the path where the OTA bundle should be stored.
     * Ensures the parent directory exists.
     */
    internal fun getWorkingPath(context: Context): String {
        val otaDir = File(context.filesDir, OTA_DIR)
        if (!otaDir.exists()) {
            otaDir.mkdirs()
        }
        return File(otaDir, BUNDLE_FILE).absolutePath
    }
}
