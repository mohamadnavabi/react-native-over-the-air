import OverTheAir from './NativeOverTheAir';

/**
 * Download a bundle from the specified URL
 * @param url The URL of the bundle to download
 * @returns Promise that resolves to true if download was successful
 */
export function downloadBundle(url: string): Promise<boolean> {
  return OverTheAir.downloadBundle(url);
}

/**
 * Set the base URL for OTA updates
 * @param url The base URL where bundles are hosted
 */
export function setBaseURL(url: string): void {
  return OverTheAir.setBaseURL(url);
}

/**
 * Check if there are updates available from the configured base URL
 * @returns Promise that resolves to true if updates are available
 */
export function checkForUpdates(): Promise<boolean> {
  return OverTheAir.checkForUpdates();
}

/**
 * Reload the bundle (triggers app reload)
 */
export function reloadBundle(): void {
  return OverTheAir.reloadBundle();
}
