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
      // ...
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
    // ...
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
- **isMandatory:** (Optional) flag to indicate an update must be installed.

---

## Building & Publishing Updates

The easiest way to build and package your bundles is to use the built-in CLI tool. It handles bundling and zipping assets automatically for optimal OTA delivery.

### 1. Build Packages

Run this in your project root:

```bash
# Build for all platforms (Recommended)
npx ota bundle

# Or build for a specific platform
npx ota bundle android
npx ota bundle ios
```

This will create an `ota-server-files` directory containing `android-package.zip` and `ios-package.zip`.

### 2. Upload to Server

Place the `.zip` files and your `manifest.json` on your static server or CDN.

### 3. Update Manifest

Update the `url` and increment the `version` in your `manifest.json`:

```json
{
  "android": {
    "1.0": {
      "url": "https://your-server.com/ota/android-package.zip",
      "version": "1.0.1",
      "isMandatory": true
    }
  }
}
```

---

## Usage

### Basic Flow

```js
import { setBaseURL, sync } from 'react-native-over-the-air';

// 1. Point to the folder containing manifest.json
setBaseURL('https://your-server.com/ota-updates');

// 2. Automatically handle mandatory updates in the background
// This will download and install the bundle if isMandatory is true in manifest.json
sync();
```

### Manual Update Flow

```js
import {
  setBaseURL,
  checkForUpdates,
  downloadBundle,
  reloadBundle,
} from 'react-native-over-the-air';

setBaseURL('https://your-server.com/ota-updates');

const checkAppUpdate = async () => {
  const update = await checkForUpdates();
  if (update) {
    const success = await downloadBundle(update.url, update.version);
    if (success) {
      reloadBundle();
    }
  }
};
```

---

## API Reference

#### `setBaseURL(url: string): void`

Sets the base URL where `manifest.json` is hosted.

#### `sync(): Promise<void>`

Synchronizes the app with the manifest. It checks for updates and if an update is marked as `isMandatory: true`, it downloads and installs it automatically in the background without reloading the app.

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

## License

MIT
