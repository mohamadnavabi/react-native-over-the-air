# Building OTA packages

## The CLI

`npx ota bundle` runs Metro, collects the assets, and writes a ready-to-upload ZIP per
platform into `ota-server-files/`.

```bash
# Both platforms
npx ota bundle

# One platform
npx ota bundle android
npx ota bundle ios
```

### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--entry-file <path>` | `index.js` | Metro entry point |
| `--dev` | off | Build a development bundle |
| `--no-minify` | minified | Disable minification |
| `--sourcemap` | off | Write a source map beside the package (not shipped inside it) |
| `--out-dir <dir>` | `ota-server-files` | Output directory |
| `--incremental` | off | Ship only assets that changed since the last local build |
| `--base-manifest <path>` | — | Use a specific asset manifest as the incremental base |
| `--app-version <v>` | — | Native app version these packages target |
| `--bundle-version <v>` | `version` in `package.json` | JS bundle version |
| `--base-url <url>` | — | Public URL of the directory serving the packages |
| `--manifest` | off | Write `manifest.json` next to the packages |
| `--mandatory` | off | Mark generated manifest entries as mandatory |

The CLI exits non-zero if Metro fails or the package cannot be written, so it is safe to
run in CI.

### Generating manifest.json

```bash
npx ota bundle --manifest \
  --app-version 1.0 \
  --bundle-version 1.1.0 \
  --base-url https://your-server.com/ota
```

`--manifest` merges into an existing `manifest.json` in the output directory rather than
replacing it, so entries for other app versions survive. Each entry gets the package's
SHA-256 as `hash`; the app refuses to install a package whose bytes do not match.

Without `--manifest`, the CLI still prints each package's SHA-256 so you can paste it into
a manifest you maintain by hand.

## Incremental packages

With many or large assets, most of a release is bytes the device already has.

```bash
npx ota bundle android --incremental --app-version 1.0
```

After every successful build the CLI writes `ota-assets-manifest.<platform>.json` — a
hash per asset. `--incremental` diffs the new build against that file and:

- omits assets whose hash is unchanged;
- records assets that disappeared in a `.ota-remove.json` inside the package, which the
  native side acts on so deleted assets are pruned rather than accumulating forever.

The native side merges a package onto what is already installed, so the two halves fit
together.

**Commit `ota-assets-manifest.*.json`.** It is the base for the next incremental build, so
it has to be shared between machines and CI. `ota-server-files/` should be gitignored.

To diff against a specific release instead of your last local build:

```bash
npx ota bundle android --base-manifest ./releases/1.1.0/ota-assets-manifest.android.json
```

### Incremental packages and native releases

Downloaded bundles are stored per native app version. A device that has just installed a
new build from the store starts with an **empty** OTA directory, so an incremental package
would arrive with nothing to merge onto and would be missing every skipped asset.

Always ship a **full** package for the first release on a new native version. The CLI
enforces this when it can: the asset manifest records the `--app-version` it was built for,
and a build whose `--app-version` differs from its base manifest fails rather than
producing a broken package.

## Building manually

The CLI is a thin wrapper around Metro, so you can do this yourself.

```bash
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output ./bundles/index.android.bundle \
  --assets-dest ./bundles

npx react-native bundle \
  --platform ios \
  --dev false \
  --entry-file index.js \
  --bundle-output ./bundles/index.ios.bundle \
  --assets-dest ./bundles
```

Then package everything Metro emitted, with the bundle at the root of the archive:

```bash
cd bundles
zip -r android-package.zip .   # or ios-package.zip
shasum -a 256 android-package.zip
```

The layout inside the ZIP must match what Metro produced: `index.<platform>.bundle` at the
top level, assets in the directories Metro created next to it (`drawable-*` and `raw` on
Android, `assets` on iOS). Put the SHA-256 in your manifest as `hash`.

If your app has no assets at all, you can point the manifest `url` straight at the
`.bundle` file; the library detects the extension and skips unpacking.

## Hosting

- **Use HTTPS.** The library refuses plain `http://` unless you explicitly opt in with
  `setBaseURL(url, { allowInsecureHttp: true })`, which is for local development only.
- **Set `hash` in the manifest.** Without it, whoever controls the CDN controls the
  JavaScript your app runs.
- **Do not cache `manifest.json`.** The library sends `Cache-Control: no-cache`, but a CDN
  that ignores it will pin your users to an old release. Cache the `.zip` files instead —
  their URLs change per release.
- **Serve the packages with `Content-Length`.** Progress reporting needs it; downloads work
  without it, but `totalBytes` will be `0`.
- Gzip on the server is fine and does not affect the hash: the library requests
  `Accept-Encoding: identity` so it verifies the bytes you published.

### CORS

Only needed if the packages are served from a different origin than expected:

```nginx
location /ota/ {
  add_header 'Access-Control-Allow-Origin' '*';
  add_header 'Access-Control-Allow-Methods' 'GET, HEAD, OPTIONS';
}
```

## Testing locally

```bash
npx ota bundle android --manifest --app-version 1.0 --base-url http://localhost:8080
cd ota-server-files && python3 -m http.server 8080
```

In the app:

```js
setBaseURL('http://localhost:8080', { allowInsecureHttp: true });
```

## Troubleshooting

**Metro fails to bundle.** Run from the project root, check `node_modules` is installed,
and retry with a cleared cache (`npx react-native start --reset-cache` once, then rebuild).

**The update installs but the app still runs the old code.** The bundle is *pending* until
you reload. On Android the first OTA install restarts the process, because the bundle path
is fixed when the `ReactHost` is built.

**The update keeps rolling back.** The new bundle is crashing before it finishes loading;
the library restores the previous one on the next launch. Build the same package with
`--dev` and run it locally to see the error.

**Images are missing after an incremental update.** The package was built against a base
manifest from a different native app version — see above. Ship a full package.

**`INTEGRITY_ERROR`.** The bytes served do not match the manifest `hash`. Usually a stale
CDN copy, or a manifest updated before the upload finished.
