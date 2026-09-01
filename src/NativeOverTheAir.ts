import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

export interface UpdateInfo {
  /** Absolute URL of the bundle (or `.zip` package) to download. */
  url: string;
  /** Bundle version advertised by the manifest. */
  version: string;
  /** Whether the host app should install this update without asking. */
  isMandatory?: boolean;
  /** Lowercase hex SHA-256 of the downloaded artifact, when the manifest provides one. */
  hash?: string;
}

export interface DownloadProgressEvent {
  /** Bytes written so far. */
  receivedBytes: number;
  /** Total bytes expected, or 0 when the server sends no Content-Length. */
  totalBytes: number;
}

export interface Spec extends TurboModule {
  /**
   * Downloads `url` into a staging directory, verifies it against `hash`
   * (when non-null), then atomically promotes it to the active bundle and
   * records `version` as pending. Rejects on any failure; the previously
   * installed bundle is left untouched.
   */
  installUpdate(
    url: string,
    version: string,
    hash: string | null
  ): Promise<boolean>;
  setBaseURL(url: string, allowInsecureHttp: boolean): void;
  /**
   * Rejects with a coded error when the manifest cannot be fetched or parsed,
   * so callers can tell "no update" (null) from "server unreachable".
   */
  checkForUpdates(): Promise<UpdateInfo | null>;
  getAppVersion(): string;
  getBundleVersion(): string;
  /** Confirms the currently running bundle so it is not rolled back. */
  notifyAppReady(): void;
  /** True while an update has been installed but not yet confirmed. */
  isPendingUpdate(): boolean;
  /** Removes every downloaded bundle and reverts to the packaged one. */
  resetToDefault(): void;
  reloadBundle(): void;
  readonly onDownloadProgress: CodegenTypes.EventEmitter<DownloadProgressEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('OverTheAir');
