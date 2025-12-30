# react-native-over-the-air

OTA (Over-The-Air) updates for React Native with self-hosted support

## Installation

```sh
npm install react-native-over-the-air
```

### iOS

```sh
cd ios && pod install && cd ..
```

### Android

To allow HTTP traffic (required if you're using `http://` URLs for your bundle server), add `android:usesCleartextTraffic="true"` to the `<application>` tag in your `android/app/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
      android:name=".MainApplication"
      android:usesCleartextTraffic="true"
      ...>
    </application>
</manifest>
```

**Note:** For production, it's recommended to use HTTPS instead of HTTP for security.

## Usage

### Basic OTA Update Flow

```js
import {
  setBaseURL,
  checkForUpdates,
  downloadBundle,
  reloadBundle,
} from 'react-native-over-the-air';

// 1. Set your self-hosted server URL
setBaseURL('http://your-server.com');

// 2. Check for updates
const hasUpdate = await checkForUpdates();
if (hasUpdate) {
  // 3. Download the new bundle
  const success = await downloadBundle(
    'http://your-server.com/index.android.bundle'
  );
  if (success) {
    // 4. Reload the app to use the new bundle
    reloadBundle();
  }
}
```

### Download Bundle from Direct URL

```js
import { downloadBundle, reloadBundle } from 'react-native-over-the-air';

try {
  const success = await downloadBundle(
    'https://your-server.com/bundles/index.android.bundle'
  );
  if (success) {
    console.log('Bundle downloaded successfully!');
    reloadBundle();
  }
} catch (error) {
  console.error('Failed to download bundle:', error);
}
```

### API Reference

#### `setBaseURL(url: string): void`

Sets the base URL where your bundles are hosted. This URL will be used by `checkForUpdates()`.

- **Parameters:**
  - `url`: The base URL (e.g., `'http://your-server.com'` or `'https://cdn.example.com'`)

#### `checkForUpdates(): Promise<boolean>`

Checks if a new bundle is available from the configured base URL. Looks for `index.android.bundle` or `index.ios.bundle` based on platform.

- **Returns:** Promise that resolves to `true` if an update is available, `false` otherwise
- **Throws:** Error if base URL is not set

#### `downloadBundle(url: string): Promise<boolean>`

Downloads a bundle from the specified URL.

- **Parameters:**
  - `url`: Full URL to the bundle file
- **Returns:** Promise that resolves to `true` if download was successful
- **Throws:** Error if download fails

#### `reloadBundle(): void`

Reloads the app to use the newly downloaded bundle.

### Self-Hosting Setup

1. Build your React Native bundle:

   **Method 1: Using npm scripts (Recommended)**

   ```bash
   npm run bundle:android  # Android only
   npm run bundle:ios      # iOS only
   npm run bundle:all      # Both platforms
   ```

   **Method 2: Using direct commands**

   ```bash
   # For Android
   npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output ./bundles/index.android.bundle --assets-dest ./bundles

   # For iOS
   npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ./bundles/index.ios.bundle --assets-dest ./bundles

   ```

2. Host the bundle files on your server:

   - Place `index.android.bundle` and `index.ios.bundle` in a publicly accessible directory
   - Ensure your server supports CORS if needed
   - Use HTTPS in production for security
   - Enable gzip compression for smaller file sizes

3. Update your app to use the OTA module (see Usage examples above)

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
