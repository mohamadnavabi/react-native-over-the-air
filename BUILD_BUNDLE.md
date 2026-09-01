# Bundle Building Guide for OTA Updates

This guide shows you how to build React Native bundles for use in OTA Updates.

## Recommended Method: Using the OTA CLI

The easiest way to build and package your bundles for both Android and iOS is to use the built-in CLI tool. It handles bundling and zipping assets automatically.

### Building for all platforms
```bash
npx ota bundle
```

### Building for a specific platform
```bash
npx ota bundle android
# OR
npx ota bundle ios
```

### Incremental Builds (Optimized Asset Packaging)

If your app has many assets and you only want to include new or changed assets in the OTA package, you can use incremental builds. This significantly reduces the size of the update for users.

#### How it works:
1. The CLI calculates hashes for all assets in the current build.
2. It compares them with a manifest from a previous build.
3. Assets that haven't changed are excluded from the ZIP package.
4. The React Native app on the device will keep existing assets in the OTA directory and only update the ones included in the new ZIP.

#### Usage:

**1. Using the local manifest (automatic):**
The CLI automatically saves a manifest named `ota-assets-manifest.{platform}.json` in your project root after each build. To build incrementally against the last build, use the `--incremental` flag:

```bash
npx ota bundle android --incremental
```

**2. Using a specific base manifest:**
If you want to ensure the update is incremental relative to a specific version (e.g., the version currently in the App Store), you can provide a base manifest:

```bash
npx ota bundle android --base-manifest=./path/to/base-manifest.android.json
```

> **Note:** For incremental updates to work reliably, the native side must not clear the OTA directory between updates. This library handles this automatically by versioning OTA directories per native app version.

The CLI will create an `ota-server-files` directory containing:
- `android-package.zip` (for Android)
- `ios-package.zip` (for iOS)

## Alternative Method 1: Using Metro Bundler Commands manually

### Building Bundle for iOS

```bash
npx react-native bundle \
  --platform ios \
  --dev false \
  --entry-file index.js \
  --bundle-output ./bundles/index.ios.bundle \
  --assets-dest ./bundles/ios-assets
```

### Building Bundle for Both Platforms

```bash
# Android
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output ./bundles/index.android.bundle --assets-dest ./bundles/android-assets

# iOS
npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ./bundles/index.ios.bundle --assets-dest ./bundles/ios-assets
```

## Method 2: Using npm scripts

You can add these scripts to your project's `package.json`:

```json
{
  "scripts": {
    "bundle:android": "react-native bundle --platform android --dev false --entry-file index.js --bundle-output ./bundles/index.android.bundle --assets-dest ./bundles/android-assets",
    "bundle:ios": "react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ./bundles/index.ios.bundle --assets-dest ./bundles/ios-assets",
    "bundle:all": "npm run bundle:android && npm run bundle:ios"
  }
}
```

Then run:

```bash
npm run bundle:android  # Android only
npm run bundle:ios      # iOS only
npm run bundle:all      # Both platforms
```

## Method 3: Using Node.js Script (Optional)

If you need more customization, you can create a `build-bundles.js` file:

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENTRY_FILE = process.argv[2] || 'index.js';
const BUNDLE_DIR = './bundles';

// Create directory
if (!fs.existsSync(BUNDLE_DIR)) {
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });
}

console.log(`Building bundles from entry file: ${ENTRY_FILE}`);
console.log(`Output directory: ${BUNDLE_DIR}\n`);

const platforms = ['android', 'ios'];

platforms.forEach((platform) => {
  console.log(`Building ${platform} bundle...`);

  const bundleOutput = path.join(BUNDLE_DIR, `index.${platform}.bundle`);
  const assetsDest = path.join(BUNDLE_DIR, `${platform}-assets`);

  try {
    execSync(
      `npx react-native bundle --platform ${platform} --dev false --entry-file ${ENTRY_FILE} --bundle-output ${bundleOutput} --assets-dest ${assetsDest}`,
      { stdio: 'inherit' }
    );
    console.log(`✓ ${platform} bundle built successfully!\n`);
  } catch (error) {
    console.error(`✗ Failed to build ${platform} bundle`);
    process.exit(1);
  }
});

console.log('✓ All bundles built successfully!');
```

Run it:

```bash
node build-bundles.js
# Or with custom entry point:
node build-bundles.js index.js
```

## Important Bundle Command Options

### `--platform`

Target platform: `android` or `ios`

### `--dev`

- `false`: For production (smaller and optimized code)
- `true`: For development (includes warnings and debug info)

### `--entry-file`

Your application's entry point file (usually `index.js`)

### `--bundle-output`

Bundle output path

### `--assets-dest`

Assets output path (images, fonts, etc.)

### Additional Options

```bash
# Minify bundle
--minify true

# Source map
--sourcemap-output ./bundles/index.android.bundle.map

# Reset cache
--reset-cache
```

## Hosting Bundles and Assets

If your bundle includes assets (images, fonts, etc.), you should package them together in a ZIP file.

### 1. Build the bundle with assets

```bash
# Android
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output ./bundles/index.android.bundle --assets-dest ./bundles

# iOS
npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ./bundles/index.ios.bundle --assets-dest ./bundles
```

### 2. Create a ZIP package

For assets to work, the directory structure inside the ZIP must match what Metro produces.

**For Android:**

```bash
cd bundles
zip -r android-package.zip index.android.bundle drawable-* raw
```

**For iOS:**

```bash
cd bundles
zip -r ios-package.zip index.ios.bundle assets
```

### 3. Update manifest.json

In your `manifest.json`, point to the `.zip` file instead of the `.bundle` file.

```json
{
  "android": {
    "1.0": {
      "url": "https://your-server.com/bundles/android-package.zip",
      "version": "1.0.1",
      "isMandatory": true
    }
  }
}
```

The library will automatically detect the `.zip` extension, download it, and extract it to the correct OTA directory.

## Hosting Bundles

After building bundles:

1. **Upload to Server:**

   ```bash
   # Example with SCP
   scp bundles/index.android.bundle user@server:/var/www/html/bundles/
   scp bundles/index.ios.bundle user@server:/var/www/html/bundles/
   ```

2. **Configure CORS (if needed):**
   If bundles are served from a different domain, you need to configure CORS:

   ```nginx
   # Nginx example
   location /bundles/ {
     add_header 'Access-Control-Allow-Origin' '*';
     add_header 'Access-Control-Allow-Methods' 'GET, HEAD, OPTIONS';
   }
   ```

3. **HTTPS in Production:**
   Always use HTTPS in production for security.

## Complete Example

```bash
# 1. Build bundles
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output ./bundles/index.android.bundle --assets-dest ./bundles
npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ./bundles/index.ios.bundle --assets-dest ./bundles

# 2. Check bundle sizes
ls -lh bundles/*.bundle

# 3. Test bundle (optional)
# You can test the bundle with a local HTTP server:
cd bundles
python3 -m http.server 8080
# Then in the app: setBaseURL('http://localhost:8080')
```

## Important Notes

- ✅ Always use `--dev false` for production
- ✅ Compress bundles (gzip) on the server to reduce file size
- ✅ Use HTTPS in production
- ✅ Version control: add a version number or hash to the bundle name
- ✅ Also host assets if you use assets

## Troubleshooting

### Bundle Not Building

- Make sure you're in the project root directory
- Make sure `node_modules` is installed
- Use `--reset-cache`

### Bundle Size Too Large

- Use `--dev false`
- Make sure source maps are excluded
- Use compression on the server

### Bundle Not Working

- Check that the entry file is correct
- Make sure all dependencies are installed
- Check console errors
