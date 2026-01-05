# react-native-over-the-air

OTA (Over-The-Air) updates for React Native with self-hosted support and manifest-based versioning.

## Features

- 🚀 **Self-Hosted:** Host your own bundles on any static server or CDN.
- 📱 **Versioning:** Automatic native app version detection (CodePush style).
- 📜 **Manifest Support:** Control updates via a `manifest.json` file.
- ⚡ **TurboModule:** High-performance native implementation.
- 📦 **Simple API:** Easy to integrate into your existing app.

## Installation

```sh
npm install react-native-over-the-air
```

### Native Setup (Required)

To enable the app to load OTA bundles, you need to add a small piece of code to your native files.

#### Android (`MainApplication.kt`)

Import `OverTheAir` and use `getBundleFilePath` in your `reactHost` implementation:

```kotlin
import com.overtheair.OverTheAir // 1. Add import

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      ...
      jsBundleFilePath = OverTheAir.getBundleFilePath(this) // 2. Add this line
    )
  }
  // ...
}
```

#### iOS (`AppDelegate.swift`)

Import `OverTheAir` and override the `bundleURL` method:

```swift
import OverTheAir // 1. Add import

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  // ...
  override func bundleURL() -> URL? {
    ...
    return OverTheAir.bundleURL() ?? super.bundleURL() // 2. Add this line
  }
}
```

---

## Server Setup (manifest.json)

Instead of manually managing bundle URLs, this library uses a `manifest.json` file. Host this file at your `baseURL`.

### Manifest Structure

```json
{
  "android": {
    // Native version name
    "1.0": {
      "url": "https://your-server.com/bundles/android-v1.bundle",
      "version": "0.0.1",
      "isMandatory": false
    }
  },
  "ios": {
    // Native marketing version
    "1.0": {
      "url": "https://your-server.com/bundles/ios-v1.bundle",
      "version": "0.0.1",
      "isMandatory": true
    }
  }
}
```

**Important Fields:**

- **Key (e.g., "1.0"):** This must **exactly match** your native app's version (`versionName` in `build.gradle` for Android, `CFBundleShortVersionString` in `Info.plist` for iOS).
- **url:** The direct link to your compiled JS bundle file.
- **version:** This should match your `package.json` version. This is the bundle version that gets displayed to users via `getBundleVersion()`. Increment this whenever you release a new JS bundle.
- **isMandatory:** (Optional) Flag to indicate an update must be installed.

**Version Strategy:**

- **Native App Version** (`versionName`): Only changes when you publish a new app version to the store (e.g., `1.0` → `1.1`).
- **Bundle Version** (`package.json` version): Changes with every OTA update (e.g., `0.0.1` → `0.0.2` → `0.0.3`). This allows multiple JS updates without republishing to the store.

---

## Usage

### Basic Flow

```js
import {
  setBaseURL,
  checkForUpdates,
  downloadBundle,
  reloadBundle,
} from 'react-native-over-the-air';

// 1. Point to the folder containing manifest.json
setBaseURL('https://your-server.com/ota-updates');

const syncApp = async () => {
  try {
    // 2. Check manifest for updates compatible with current native version
    const update = await checkForUpdates();

    if (update) {
      console.log(`New version ${update.version} available!`);

      // 3. Download the bundle
      const success = await downloadBundle(update.url, update.version);

      if (success) {
        // 4. Reload to apply
        reloadBundle();
      }
    }
  } catch (error) {
    console.error('OTA Error:', error);
  }
};
```

### API Reference

#### `setBaseURL(url: string): void`

Sets the base URL where `manifest.json` is hosted.

#### `checkForUpdates(): Promise<UpdateInfo | null>`

Fetches the manifest and compares it with the current native version and installed bundle.

- **Returns:** `UpdateInfo` object or `null` if no update is needed.
- `UpdateInfo`: `{ url: string, version: string, isMandatory: boolean }`

#### `downloadBundle(url: string, version: string): Promise<boolean>`

Downloads the bundle and marks the specific version as installed.

#### `reloadBundle(): void`

Triggers a native app reload to apply the new bundle.

#### `getAppVersion(): string`

Returns the current native app version (e.g., "1.0"). This matches the `versionName` in `build.gradle` or `CFBundleShortVersionString` in `Info.plist`.

#### `getBundleVersion(): string`

Returns the current bundle version (e.g., "0.0.1"). This matches the `version` field from `package.json` and is updated whenever a new bundle is downloaded. Returns empty string if no bundle is installed.

---

## Self-Hosting Guide

1. **Build Bundles:**
   ```bash
   npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output ./index.android.bundle
   npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ./index.ios.bundle
   ```
2. **Upload:** Place bundles and your `manifest.json` on your server.
3. **Update Manifest:** Increment the `version` field in `manifest.json` whenever you upload a new bundle.

## License

MIT
