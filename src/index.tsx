import OverTheAir, { type UpdateInfo } from './NativeOverTheAir';

export type { UpdateInfo };

/**
 * Download a bundle from the specified URL and save its version
 * @param url The URL of the bundle to download
 * @param version The version of the bundle (from manifest)
 * @returns Promise that resolves to true if download was successful
 */
export async function downloadBundle(
  url: string,
  version: string
): Promise<boolean> {
  const success = await OverTheAir.downloadBundle(url);
  if (success) {
    OverTheAir.saveBundleVersion(version);
  }
  return success;
}

/**
 * Set the base URL for OTA updates
 * @param url The base URL where manifest.json is hosted
 */
export function setBaseURL(url: string): void {
  return OverTheAir.setBaseURL(url);
}

/**
 * Check if there are updates available from the manifest.json
 * @returns Promise that resolves to UpdateInfo if updates are available, or null
 */
export function checkForUpdates(): Promise<UpdateInfo | null> {
  return OverTheAir.checkForUpdates();
}

/**
 * Get the current native app version
 * @returns The version string (e.g., "1.0.0")
 */
export function getAppVersion(): string {
  return OverTheAir.getAppVersion();
}

/**
 * Get the current bundle version (JS bundle version, not native app version)
 * @returns The bundle version string (e.g., "0.0.1") or empty string if no bundle installed
 */
export function getBundleVersion(): string {
  return OverTheAir.getBundleVersion();
}

/**
 * Reload the bundle (triggers app reload)
 */
export function reloadBundle(): void {
  return OverTheAir.reloadBundle();
}

/**
 * Synchronize the app with the manifest.
 * Automatically handles mandatory updates by downloading them in the background.
 * Non-mandatory updates can be handled manually using checkForUpdates().
 * @returns Promise that resolves when sync is complete
 */
export async function sync(): Promise<void> {
  try {
    const update = await checkForUpdates();
    if (update && update.isMandatory) {
      console.log(
        `[OTA] Mandatory update ${update.version} found, downloading...`
      );
      const success = await downloadBundle(update.url, update.version);
      if (success) {
        console.log(
          `[OTA] Mandatory update ${update.version} installed successfully.`
        );
      } else {
        console.warn(
          `[OTA] Failed to download mandatory update ${update.version}.`
        );
      }
    }
  } catch (error) {
    console.error('[OTA] Sync failed:', error);
  }
}
