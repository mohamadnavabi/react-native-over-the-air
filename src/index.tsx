import OverTheAir, {
  type DownloadProgressEvent,
  type UpdateInfo,
} from './NativeOverTheAir';

export type { UpdateInfo, DownloadProgressEvent };

/**
 * When an update should take effect.
 * - `onNextRestart` (default): the bundle is installed and used the next time
 *   the app is launched by the user.
 * - `immediate`: the app is reloaded as soon as the install completes.
 */
export type InstallMode = 'immediate' | 'onNextRestart';

export type SyncStatus =
  /** The manifest has no entry newer than the installed bundle. */
  | 'up-to-date'
  /** An update was downloaded, verified and installed. */
  | 'update-installed'
  /** An update exists but was left for the caller to install. */
  | 'update-ignored'
  /** The manifest could not be fetched, or the download/verification failed. */
  | 'error';

export interface SyncResult {
  status: SyncStatus;
  /** The update described by the manifest, when there was one. */
  update: UpdateInfo | null;
  /** Populated when `status` is `'error'`. */
  error?: Error;
}

export interface SyncOptions {
  /**
   * Install non-mandatory updates as well. Defaults to `false`, which only
   * installs entries flagged `isMandatory` and reports the rest as
   * `'update-ignored'`.
   */
  installOptionalUpdates?: boolean;
  /** Defaults to `'onNextRestart'`. */
  installMode?: InstallMode;
  onProgress?: (progress: DownloadProgressEvent) => void;
}

export interface DownloadOptions {
  /**
   * Expected lowercase hex SHA-256 of the artifact. The install is aborted and
   * the promise rejects when the downloaded bytes do not match.
   */
  hash?: string | null;
  onProgress?: (progress: DownloadProgressEvent) => void;
}

export interface BaseURLOptions {
  /**
   * Permit a plain `http://` base URL. Off by default: an unauthenticated
   * transport lets anyone on the network replace the JS that your app runs.
   * Only enable this for local development.
   */
  allowInsecureHttp?: boolean;
}

/**
 * Subscribes to download progress for the in-flight install.
 * @returns A subscription; call `remove()` to stop listening.
 */
export function addDownloadProgressListener(
  listener: (progress: DownloadProgressEvent) => void
): { remove: () => void } {
  return OverTheAir.onDownloadProgress(listener);
}

/**
 * Sets the base URL where `manifest.json` is hosted.
 * @throws If the URL is not HTTPS and `allowInsecureHttp` was not set.
 */
export function setBaseURL(url: string, options?: BaseURLOptions): void {
  return OverTheAir.setBaseURL(url, options?.allowInsecureHttp === true);
}

/**
 * Fetches the manifest and compares it with the native app version and the
 * installed bundle.
 * @returns `UpdateInfo` when an update is available, `null` when up to date.
 * @throws If the base URL is unset, or the manifest cannot be fetched/parsed.
 */
export function checkForUpdates(): Promise<UpdateInfo | null> {
  return OverTheAir.checkForUpdates();
}

/**
 * Downloads a bundle, verifies it and installs it atomically.
 *
 * The previously installed bundle is untouched until the new one has been
 * fully written and verified, and is kept as a rollback target until
 * {@link notifyAppReady} confirms the new bundle booted.
 *
 * @returns `true` on success. Rejects with a coded error otherwise; it never
 * resolves `false`.
 */
export async function downloadBundle(
  url: string,
  version: string,
  options?: DownloadOptions
): Promise<boolean> {
  const subscription = options?.onProgress
    ? OverTheAir.onDownloadProgress(options.onProgress)
    : null;
  try {
    return await OverTheAir.installUpdate(url, version, options?.hash ?? null);
  } finally {
    subscription?.remove();
  }
}

/**
 * Confirms that the running bundle works, so it is not rolled back on the next
 * launch. Called automatically once this module has loaded and the first tick
 * of the JS bundle has completed; call it manually only if you want to gate
 * confirmation on a later signal of your own.
 */
export function notifyAppReady(): void {
  return OverTheAir.notifyAppReady();
}

/** True while an update is installed but has not yet been confirmed. */
export function isPendingUpdate(): boolean {
  return OverTheAir.isPendingUpdate();
}

/**
 * Deletes every downloaded bundle and reverts to the bundle shipped inside the
 * app binary. Takes effect on the next reload.
 */
export function resetToDefault(): void {
  return OverTheAir.resetToDefault();
}

/** Returns the native app version (e.g. `"1.0"`). */
export function getAppVersion(): string {
  return OverTheAir.getAppVersion();
}

/**
 * Returns the version of the installed JS bundle, or an empty string when the
 * app is still running the bundle shipped in the binary.
 */
export function getBundleVersion(): string {
  return OverTheAir.getBundleVersion();
}

/** Reloads the app so the installed bundle takes effect. */
export function reloadBundle(): void {
  return OverTheAir.reloadBundle();
}

/**
 * Checks the manifest and installs the update it describes.
 *
 * Unlike {@link checkForUpdates} this never throws: failures are reported as
 * `{ status: 'error', error }` so a sync on startup cannot crash the app.
 */
export async function sync(options?: SyncOptions): Promise<SyncResult> {
  let update: UpdateInfo | null = null;
  try {
    update = await checkForUpdates();
    if (!update) {
      return { status: 'up-to-date', update: null };
    }

    if (!update.isMandatory && options?.installOptionalUpdates !== true) {
      return { status: 'update-ignored', update };
    }

    await downloadBundle(update.url, update.version, {
      hash: update.hash,
      onProgress: options?.onProgress,
    });

    if (options?.installMode === 'immediate') {
      reloadBundle();
    }
    return { status: 'update-installed', update };
  } catch (error) {
    return {
      status: 'error',
      update,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// Reaching this point means the bundle parsed and started executing. Deferring
// to the next tick additionally rules out a bundle that throws during module
// initialisation, which would otherwise be confirmed before it ever rendered.
setTimeout(() => {
  try {
    OverTheAir.notifyAppReady();
  } catch {
    // The module is unavailable (e.g. under test); nothing to confirm.
  }
}, 0);
