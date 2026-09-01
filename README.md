# react-native-over-the-air

Self-hosted OTA (Over-The-Air) updates for React Native, driven by a `manifest.json`
you host yourself.

- HTTPS by default, with SHA-256 verification of every package
- Automatic rollback when an update fails to boot
- Bundles scoped to the native app version, so a Store update never runs a stale bundle
- Download progress events, and incremental packages that ship only changed assets

Requires React Native 0.76+ with the new architecture.

## Installation

```sh
npm install react-native-over-the-air
```

### Android — `MainApplication.kt`

```kotlin
import com.overtheair.OverTheAir

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      // ...
      jsBundleFilePath = OverTheAir.getBundleFilePath(this)
    )
  }
}
```

### iOS — `AppDelegate.swift`

```swift
import OverTheAir

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func bundleURL() -> URL? {
    #if DEBUG
      return super.bundleURL()  // let Metro win in development
    #else
      return OverTheAir.bundleURL() ?? super.bundleURL()
    #endif
  }
}
```

Both calls also run the rollback check, so they must happen on every launch.

## Publishing an update

```bash
npx ota bundle --manifest \
  --app-version 1.0 \
  --base-url https://your-server.com/ota
```

This writes `ota-server-files/` containing `android-package.zip`, `ios-package.zip` and a
`manifest.json`. Upload its contents to the `--base-url` directory and the app picks the
update up on its next `sync()`.

`--app-version` is your **native** version (`versionName` / `CFBundleShortVersionString`).
The bundle version defaults to `version` in `package.json`.

Gitignore `ota-server-files/`, but **commit** `ota-assets-manifest.*.json` — incremental
builds diff against it. See [BUILD_BUNDLE.md](BUILD_BUNDLE.md) for the full CLI reference.

## manifest.json

```json
{
  "android": {
    "1.0": {
      "url": "https://your-server.com/ota/android-package.zip",
      "version": "1.1.0",
      "isMandatory": false,
      "hash": "9f2c…"
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| key (`"1.0"`) | Must match the native app version exactly. No entry means no update. |
| `url` | The `.zip` package, or a bare `.bundle` if your app has no assets. |
| `version` | JS bundle version. Any change from the installed one is an update — publish an older string to roll back. |
| `isMandatory` | Optional. `sync()` installs these without being asked. |
| `hash` | Optional but recommended: SHA-256 of the file at `url`. A mismatch aborts the install. |

## Usage

```js
import { setBaseURL, sync } from 'react-native-over-the-air';

setBaseURL('https://your-server.com/ota');

const result = await sync();
// 'up-to-date' | 'update-installed' | 'update-ignored' | 'error'
```

`sync()` never throws — failures come back as `{ status: 'error', error }`, so calling it
on startup cannot take the app down.

Or drive it yourself:

```js
const update = await checkForUpdates();
if (update) {
  await downloadBundle(update.url, update.version, {
    hash: update.hash,
    onProgress: ({ receivedBytes, totalBytes }) => {},
  });
  reloadBundle();
}
```

### How installs are made safe

A package is streamed to a staging directory, verified, then swapped in with a single
rename — the running bundle is untouched until then. The new bundle stays *pending* until
it boots and `notifyAppReady()` runs (done for you one tick after this module loads). If
the app launches again with an update still unconfirmed, the previous bundle is restored.

## API

| Function | Notes |
| --- | --- |
| `setBaseURL(url, { allowInsecureHttp? })` | Where `manifest.json` lives. Plain `http://` is rejected unless you opt in — only do that against a local dev server. |
| `sync(options?): Promise<SyncResult>` | Checks and installs. Never throws. Options: `installOptionalUpdates` (default `false`), `installMode` (`'onNextRestart'` \| `'immediate'`), `onProgress`. |
| `checkForUpdates(): Promise<UpdateInfo \| null>` | `null` when up to date; **rejects** if the manifest can't be fetched, so an outage is distinguishable from "nothing new". |
| `downloadBundle(url, version, { hash?, onProgress? })` | Downloads, verifies, installs. Resolves `true` or rejects — never resolves `false`. |
| `addDownloadProgressListener(fn)` | Returns `{ remove() }`. |
| `notifyAppReady()` | Confirms the running bundle. Automatic; call it yourself only to gate on a later signal. |
| `isPendingUpdate(): boolean` | True while an update is installed but unconfirmed. |
| `resetToDefault()` | Deletes every downloaded bundle. Takes effect on the next reload. |
| `reloadBundle()` | Applies the installed bundle. In-process on iOS; Android restarts the process on the first OTA install, since the bundle path is fixed when the `ReactHost` is built. |
| `getAppVersion(): string` | Native app version, e.g. `"1.0"`. |
| `getBundleVersion(): string` | Installed bundle version, or `""` while running the packaged one. |

`UpdateInfo` is `{ url, version, isMandatory?, hash? }`.
Rejections carry a code: `NO_BASE_URL`, `MANIFEST_ERROR`, `INVALID_MANIFEST`,
`INSECURE_URL`, `DOWNLOAD_ERROR`, `INTEGRITY_ERROR`, `ALREADY_INSTALLING`.

## License

MIT
