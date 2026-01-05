# Bundle Building Guide for OTA Updates

This guide shows you how to build React Native bundles for use in OTA Updates.

## Method 1: Using Metro Bundler Commands

### Building Bundle for Android

```bash
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output ./bundles/index.android.bundle \
  --assets-dest ./bundles/android-assets
```

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
