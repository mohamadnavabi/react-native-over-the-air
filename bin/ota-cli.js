#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const command = process.argv[2];
const platform = process.argv[3] || 'all';
const rootDir = process.cwd();
const OUTPUT_DIR = path.join(rootDir, 'ota-server-files');

// Parse additional arguments
const args = process.argv.slice(2);
const incrementalFlag = args.includes('--incremental');
const baseManifestPath = args
  .find((arg) => arg.startsWith('--base-manifest='))
  ?.split('=')[1];

if (command !== 'bundle') {
  console.log(
    'Usage: npx ota bundle [android|ios|all] [--incremental] [--base-manifest=path/to/manifest.json]'
  );
  process.exit(1);
}

// Ensure clean output directory
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const getFileHash = (filePath) => {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

const getDirectoryAssets = (dir, baseDir, assets = {}) => {
  if (!fs.existsSync(dir)) return assets;

  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getDirectoryAssets(filePath, baseDir, assets);
    } else {
      const relativePath = path.relative(baseDir, filePath);
      assets[relativePath] = getFileHash(filePath);
    }
  });
  return assets;
};

const build = (plt) => {
  console.log(`\n--- 🚀 Building for ${plt.toUpperCase()} ---`);

  const bundleFile = `index.${plt}.bundle`;
  const zipFile = `${plt}-package.zip`;

  // 1. Bundle
  console.log(`📦 Generating bundle...`);
  const bundleCmd = `npx react-native bundle --platform ${plt} --dev false --entry-file index.js --bundle-output ${path.join(
    OUTPUT_DIR,
    bundleFile
  )} --assets-dest ${OUTPUT_DIR}`;

  try {
    execSync(bundleCmd, { stdio: 'inherit' });
  } catch (_) {
    console.error(`❌ Bundling failed for ${plt}`);
    return;
  }

  // 2. Identify assets
  const assetsDirs = [];
  const contents = fs.readdirSync(OUTPUT_DIR);
  if (plt === 'android') {
    contents.forEach((file) => {
      if (file.startsWith('drawable-') || file === 'raw') {
        assetsDirs.push(file);
      }
    });
  } else {
    if (contents.includes('assets')) {
      assetsDirs.push('assets');
    }
  }

  // 3. Hash current assets
  const currentAssets = {};
  assetsDirs.forEach((dir) => {
    getDirectoryAssets(path.join(OUTPUT_DIR, dir), OUTPUT_DIR, currentAssets);
  });

  // 4. Load base manifest if provided
  let baseAssets = {};
  if (baseManifestPath && fs.existsSync(baseManifestPath)) {
    try {
      baseAssets = JSON.parse(fs.readFileSync(baseManifestPath, 'utf8'));
      console.log(`📖 Loaded base manifest from ${baseManifestPath}`);
    } catch (e) {
      console.warn(`⚠️ Failed to load base manifest: ${e.message}`);
    }
  } else if (incrementalFlag) {
    const localManifest = path.join(rootDir, `ota-assets-manifest.${plt}.json`);
    if (fs.existsSync(localManifest)) {
      try {
        baseAssets = JSON.parse(fs.readFileSync(localManifest, 'utf8'));
        console.log(`📖 Loaded local manifest ota-assets-manifest.${plt}.json`);
      } catch (e) {
        console.warn(`⚠️ Failed to load local manifest: ${e.message}`);
      }
    }
  }

  // 5. Compare and filter
  let skippedCount = 0;
  Object.keys(currentAssets).forEach((assetPath) => {
    if (baseAssets[assetPath] === currentAssets[assetPath]) {
      // Asset is unchanged, remove it from OUTPUT_DIR to exclude from zip
      fs.rmSync(path.join(OUTPUT_DIR, assetPath));
      skippedCount++;
    }
  });

  if (skippedCount > 0) {
    console.log(`⏭️  Skipped ${skippedCount} unchanged assets.`);
  }

  // 6. Clean up empty directories in OUTPUT_DIR (so zip doesn't include them)
  const cleanEmptyDirs = (dir) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        cleanEmptyDirs(filePath);
      }
    });
    if (fs.readdirSync(dir).length === 0 && dir !== OUTPUT_DIR) {
      fs.rmdirSync(dir);
    }
  };
  cleanEmptyDirs(OUTPUT_DIR);

  // 7. Save current manifest for future use
  fs.writeFileSync(
    path.join(rootDir, `ota-assets-manifest.${plt}.json`),
    JSON.stringify(currentAssets, null, 2)
  );
  console.log(`💾 Manifest saved: ota-assets-manifest.${plt}.json`);

  // 8. Packaging
  console.log(`🤐 Packaging...`);
  const filesToZip = [bundleFile];

  // Re-read contents after deletion
  const remainingContents = fs.readdirSync(OUTPUT_DIR);
  remainingContents.forEach((file) => {
    if (assetsDirs.includes(file) && !filesToZip.includes(file)) {
      filesToZip.push(file);
    }
  });

  // 9. Zip
  const zipCmd = `zip -r ${zipFile} ${filesToZip.join(' ')}`;
  try {
    execSync(`cd ${OUTPUT_DIR} && ${zipCmd}`, {
      stdio: 'inherit',
      shell: true,
    });

    // 10. Cleanup temp files
    console.log(`🧹 Cleaning up...`);
    remainingContents.forEach((file) => {
      const filePath = path.join(OUTPUT_DIR, file);
      if (file !== zipFile && !file.endsWith('-package.zip')) {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    });

    console.log(`✅ Success: ota-server-files/${zipFile}`);
  } catch (error) {
    console.error(`❌ Failed to create zip: ${error.message}`);
  }
};

if (platform === 'all' || platform === 'android') build('android');
if (platform === 'all' || platform === 'ios') build('ios');

console.log('\n✨ OTA Packages are ready in the ota-server-files/ directory.');
