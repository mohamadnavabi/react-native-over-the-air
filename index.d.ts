/**
 * Type definitions for react-native-over-the-air
 */

export interface UpdateInfo {
  /**
   * The URL of the bundle to download
   */
  url: string;
  /**
   * The version of the bundle (from manifest)
   */
  version: string;
  /**
   * Whether this update is mandatory
   */
  isMandatory?: boolean;
}

/**
 * Download a bundle from the specified URL and save its version
 * @param url The URL of the bundle to download
 * @param version The version of the bundle (from manifest)
 * @returns Promise that resolves to true if download was successful
 */
export declare function downloadBundle(
  url: string,
  version: string
): Promise<boolean>;

/**
 * Set the base URL for OTA updates
 * @param url The base URL where manifest.json is hosted
 */
export declare function setBaseURL(url: string): void;

/**
 * Check if there are updates available from the manifest.json
 * @returns Promise that resolves to UpdateInfo if updates are available, or null
 */
export declare function checkForUpdates(): Promise<UpdateInfo | null>;

/**
 * Get the current native app version
 * @returns The version string (e.g., "1.0.0")
 */
export declare function getAppVersion(): string;

/**
 * Get the current bundle version (JS bundle version, not native app version)
 * @returns The bundle version string (e.g., "0.0.1") or empty string if no bundle installed
 */
export declare function getBundleVersion(): string;

/**
 * Reload the bundle (triggers app reload)
 */
export declare function reloadBundle(): void;

/**
 * Synchronize the app with the manifest.
 * Automatically handles mandatory updates by downloading them in the background.
 * Non-mandatory updates can be handled manually using checkForUpdates().
 * @returns Promise that resolves when sync is complete
 */
export declare function sync(): Promise<void>;

export type { UpdateInfo };
