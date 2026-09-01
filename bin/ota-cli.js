#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createZip } = require('./lib/zip');

const PLATFORMS = ['android', 'ios'];
const REMOVAL_LIST_NAME = '.ota-remove.json';
const ASSET_MANIFEST_VERSION = 2;

const USAGE = `Usage: npx ota bundle [android|ios|all] [options]

  --entry-file <path>      Metro entry file (default: index.js)
  --dev                    Build a development bundle (default: production)
  --no-minify              Disable minification
  --sourcemap              Write a source map next to the package (not shipped)
  --out-dir <dir>          Output directory (default: ota-server-files)

  --incremental            Ship only assets that changed since the last local build
  --base-manifest <path>   Use a specific asset manifest as the incremental base

  --app-version <version>  Native app version these packages target (the
                           manifest.json key: versionName / CFBundleShortVersionString)
  --bundle-version <v>     JS bundle version (default: version in package.json)
  --base-url <url>         Public URL of the directory that serves the packages
  --manifest               Write manifest.json alongside the packages
  --mandatory              Mark the generated manifest entries as mandatory
`;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    platform: 'all',
    entryFile: 'index.js',
    dev: false,
    minify: true,
    sourcemap: false,
    outDir: 'ota-server-files',
    incremental: false,
    baseManifest: null,
    appVersion: null,
    bundleVersion: null,
    baseURL: null,
    writeManifest: false,
    mandatory: false,
  };

  const takesValue = {
    '--entry-file': 'entryFile',
    '--out-dir': 'outDir',
    '--base-manifest': 'baseManifest',
    '--app-version': 'appVersion',
    '--bundle-version': 'bundleVersion',
    '--base-url': 'baseURL',
  };

  let sawPlatform = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Both `--flag value` and `--flag=value` are accepted.
    const equals = arg.indexOf('=');
    const name =
      arg.startsWith('--') && equals !== -1 ? arg.slice(0, equals) : arg;
    const inlineValue = equals !== -1 ? arg.slice(equals + 1) : null;

    if (takesValue[name]) {
      const value = inlineValue !== null ? inlineValue : argv[++i];
      if (value === undefined) {
        fail(`${name} needs a value.\n\n${USAGE}`);
      }
      options[takesValue[name]] = value;
      continue;
    }

    switch (name) {
      case '--dev':
        options.dev = true;
        break;
      case '--no-minify':
        options.minify = false;
        break;
      case '--sourcemap':
        options.sourcemap = true;
        break;
      case '--incremental':
        options.incremental = true;
        break;
      case '--manifest':
        options.writeManifest = true;
        break;
      case '--mandatory':
        options.mandatory = true;
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (name.startsWith('-')) {
          fail(`Unknown option ${name}.\n\n${USAGE}`);
        }
        // A positional argument: the platform, and only the platform. Anything
        // else is a typo rather than something to silently ignore.
        if (sawPlatform) {
          fail(`Unexpected argument "${arg}".\n\n${USAGE}`);
        }
        if (![...PLATFORMS, 'all'].includes(arg)) {
          fail(
            `Unknown platform "${arg}". Expected android, ios or all.\n\n${USAGE}`
          );
        }
        options.platform = arg;
        sawPlatform = true;
    }
  }

  return options;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead;
    while (
      (bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0
    ) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function walk(dir, baseDir, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const absolute = path.join(dir, name);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      walk(absolute, baseDir, out);
    } else if (stat.isFile()) {
      out[path.relative(baseDir, absolute).split(path.sep).join('/')] =
        sha256File(absolute);
    }
  }
  return out;
}

function readPackageVersion(rootDir) {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
        .version || null
    );
  } catch {
    return null;
  }
}

/**
 * Reads an asset manifest, accepting the flat `{ path: hash }` shape written by
 * older versions of this CLI.
 */
function readAssetManifest(manifestPath) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (parsed && typeof parsed === 'object' && parsed.assets) {
    return parsed;
  }
  return { version: 1, appVersion: null, assets: parsed || {} };
}

function removeEmptyDirectories(dir, root) {
  for (const name of fs.readdirSync(dir)) {
    const absolute = path.join(dir, name);
    if (fs.statSync(absolute).isDirectory()) {
      removeEmptyDirectories(absolute, root);
    }
  }
  if (dir !== root && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}

function build(platform, options, context) {
  console.log(`\n--- Building for ${platform.toUpperCase()} ---`);

  const bundleFile = `index.${platform}.bundle`;
  const zipName = `${platform}-package.zip`;
  const workDir = path.join(context.outDir, `.${platform}-work`);
  const assetManifestPath = path.join(
    context.rootDir,
    `ota-assets-manifest.${platform}.json`
  );

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // 1. Bundle. spawnSync with an argument array: no shell, so paths with
  //    spaces and shell metacharacters are passed through untouched.
  const args = [
    'react-native',
    'bundle',
    '--platform',
    platform,
    '--dev',
    String(options.dev),
    '--minify',
    String(options.minify),
    '--entry-file',
    options.entryFile,
    '--bundle-output',
    path.join(workDir, bundleFile),
    '--assets-dest',
    workDir,
  ];
  if (options.sourcemap) {
    args.push(
      '--sourcemap-output',
      path.join(context.outDir, `${bundleFile}.map`)
    );
  }

  console.log('Generating bundle...');
  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    cwd: context.rootDir,
  });
  if (result.error) {
    throw new Error(
      `Could not run react-native bundle: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(`react-native bundle exited with code ${result.status}`);
  }

  // 2. Everything Metro emitted apart from the bundle itself is an asset.
  //    Listing directories explicitly ("drawable-*", "raw", "assets") misses
  //    anything else Metro decides to write.
  const assetEntries = fs
    .readdirSync(workDir)
    .filter((name) => name !== bundleFile && !name.endsWith('.map'));

  const currentAssets = {};
  for (const entry of assetEntries) {
    const absolute = path.join(workDir, entry);
    if (fs.statSync(absolute).isDirectory()) {
      walk(absolute, workDir, currentAssets);
    } else {
      currentAssets[entry] = sha256File(absolute);
    }
  }

  // 3. Resolve the incremental base.
  let base = null;
  let basePath = null;
  if (options.baseManifest) {
    basePath = path.resolve(context.rootDir, options.baseManifest);
    if (!fs.existsSync(basePath)) {
      throw new Error(`Base manifest not found: ${basePath}`);
    }
  } else if (options.incremental && fs.existsSync(assetManifestPath)) {
    basePath = assetManifestPath;
  }

  if (basePath) {
    base = readAssetManifest(basePath);
    console.log(
      `Incremental base: ${path.relative(context.rootDir, basePath)}`
    );

    // A device only keeps assets for the native app version they were
    // installed under, so an incremental package built against a different
    // native version would arrive with nothing to merge onto and would be
    // missing every skipped asset.
    if (
      options.appVersion &&
      base.appVersion &&
      base.appVersion !== options.appVersion
    ) {
      throw new Error(
        `The base manifest targets app version ${base.appVersion}, but this build targets ` +
          `${options.appVersion}. Devices on ${options.appVersion} start with an empty OTA ` +
          `directory, so an incremental package would be missing assets. Build a full ` +
          `package for the new app version.`
      );
    }
    if (!base.appVersion || !options.appVersion) {
      console.warn(
        'Warning: the incremental base is not tied to a native app version. Pass ' +
          '--app-version so mismatches can be caught.'
      );
    }
  }

  // 4. Drop unchanged assets and record the ones that disappeared, so the
  //    device can prune them rather than accumulating dead files forever.
  const baseAssets = base ? base.assets : {};
  let skipped = 0;
  for (const [assetPath, hash] of Object.entries(currentAssets)) {
    if (baseAssets[assetPath] === hash) {
      fs.rmSync(path.join(workDir, assetPath));
      skipped++;
    }
  }
  const removed = Object.keys(baseAssets)
    .filter((assetPath) => !(assetPath in currentAssets))
    .sort();

  if (skipped > 0) {
    console.log(`Skipped ${skipped} unchanged asset(s).`);
  }
  if (removed.length > 0) {
    console.log(
      `Marked ${removed.length} deleted asset(s) for removal on device.`
    );
    fs.writeFileSync(
      path.join(workDir, REMOVAL_LIST_NAME),
      JSON.stringify({ remove: removed }, null, 2)
    );
  }
  removeEmptyDirectories(workDir, workDir);

  // 5. Package.
  console.log('Packaging...');
  const zipPath = path.join(context.outDir, zipName);
  const entries = fs
    .readdirSync(workDir)
    .filter((name) => !name.endsWith('.map'));
  const { entries: fileCount, bytes } = createZip(workDir, entries, zipPath);

  // 6. Only now is the build durable, so only now may the asset manifest be
  //    replaced. Writing it earlier would make the next incremental build skip
  //    assets that were never actually shipped.
  fs.writeFileSync(
    assetManifestPath,
    JSON.stringify(
      {
        version: ASSET_MANIFEST_VERSION,
        platform,
        appVersion: options.appVersion,
        bundleVersion: context.bundleVersion,
        createdAt: new Date().toISOString(),
        assets: currentAssets,
      },
      null,
      2
    ) + '\n'
  );
  fs.rmSync(workDir, { recursive: true, force: true });

  const hash = sha256File(zipPath);
  console.log(
    `Done: ${path.relative(context.rootDir, zipPath)} ` +
      `(${fileCount} file(s), ${(bytes / 1024).toFixed(1)} KiB)`
  );
  console.log(`  sha256: ${hash}`);

  return { platform, zipName, hash };
}

function writeManifest(packages, options, context) {
  const manifestPath = path.join(context.outDir, 'manifest.json');
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Existing manifest.json is not valid JSON: ${error.message}`
      );
    }
  }

  for (const pkg of packages) {
    const base = options.baseURL.replace(/\/+$/, '');
    manifest[pkg.platform] = manifest[pkg.platform] || {};
    manifest[pkg.platform][options.appVersion] = {
      url: `${base}/${pkg.zipName}`,
      version: context.bundleVersion,
      isMandatory: options.mandatory,
      hash: pkg.hash,
    };
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(context.rootDir, manifestPath)}`);
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }
  if (command !== 'bundle') {
    fail(`Unknown command "${command}".\n\n${USAGE}`);
  }

  const options = parseArgs(argv.slice(1));
  const rootDir = process.cwd();
  const outDir = path.resolve(rootDir, options.outDir);

  if (options.writeManifest) {
    if (!options.baseURL) {
      fail('--manifest also needs --base-url, to build the download URLs.');
    }
    if (!options.appVersion) {
      fail(
        '--manifest also needs --app-version, which is the manifest.json key.'
      );
    }
  }

  const bundleVersion = options.bundleVersion || readPackageVersion(rootDir);
  if (!bundleVersion) {
    fail('Could not determine the bundle version. Pass --bundle-version.');
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const context = { rootDir, outDir, bundleVersion };
  const platforms = options.platform === 'all' ? PLATFORMS : [options.platform];

  const packages = [];
  for (const platform of platforms) {
    try {
      packages.push(build(platform, options, context));
    } catch (error) {
      fail(`${platform}: ${error.message}`);
    }
  }

  if (options.writeManifest) {
    try {
      writeManifest(packages, options, context);
    } catch (error) {
      fail(error.message);
    }
  }

  console.log(
    `\nOTA packages are ready in ${path.relative(rootDir, outDir) || '.'}/`
  );
  if (!options.writeManifest) {
    console.log(
      'Add the sha256 above to your manifest.json as "hash" so the app can'
    );
    console.log(
      'verify the download, or re-run with --manifest --base-url ... --app-version ...'
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, readAssetManifest, sha256File, USAGE };
