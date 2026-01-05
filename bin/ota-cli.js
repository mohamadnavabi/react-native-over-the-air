#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const command = process.argv[2];
const platform = process.argv[3] || 'all';
const rootDir = process.cwd();
const OUTPUT_DIR = path.join(rootDir, 'ota-server-files');

if (command !== 'bundle') {
  console.log('Usage: npx ota bundle [android|ios|all]');
  process.exit(1);
}

// Ensure clean output directory
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
  } catch (e) {
    console.error(`❌ Bundling failed for ${plt}`);
    return;
  }

  // 2. Packaging
  console.log(`🤐 Packaging...`);
  const filesToZip = [bundleFile];

  const contents = fs.readdirSync(OUTPUT_DIR);
  if (plt === 'android') {
    contents.forEach((file) => {
      if (file.startsWith('drawable-') || file === 'raw') {
        filesToZip.push(file);
      }
    });
  } else {
    if (contents.includes('assets')) {
      filesToZip.push('assets');
    }
  }

  // 3. Zip
  const zipCmd = `zip -r ${zipFile} ${filesToZip.join(' ')}`;
  try {
    execSync(`cd ${OUTPUT_DIR} && ${zipCmd}`, {
      stdio: 'inherit',
      shell: true,
    });

    // 4. Cleanup temp files
    console.log(`🧹 Cleaning up...`);
    contents.forEach((file) => {
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
