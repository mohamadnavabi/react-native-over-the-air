'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, readAssetManifest } = require('../ota-cli');
const { createZip, crc32, collectEntries } = require('../lib/zip');

describe('parseArgs', () => {
  it('defaults to building both platforms in production mode', () => {
    const options = parseArgs([]);
    expect(options).toMatchObject({
      platform: 'all',
      entryFile: 'index.js',
      dev: false,
      minify: true,
    });
  });

  it('does not mistake a leading flag for the platform', () => {
    // `ota bundle --incremental` used to read "--incremental" as the platform,
    // match no platform, and exit 0 having built nothing.
    expect(parseArgs(['--incremental'])).toMatchObject({
      platform: 'all',
      incremental: true,
    });
  });

  it('accepts the platform before or after flags', () => {
    expect(parseArgs(['android', '--incremental']).platform).toBe('android');
    expect(parseArgs(['--incremental', 'ios']).platform).toBe('ios');
  });

  it('supports both --flag value and --flag=value', () => {
    expect(parseArgs(['--entry-file', 'src/main.js']).entryFile).toBe(
      'src/main.js'
    );
    expect(parseArgs(['--entry-file=src/main.js']).entryFile).toBe(
      'src/main.js'
    );
  });

  it('rejects unknown platforms and options instead of ignoring them', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exited');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseArgs(['windows'])).toThrow('exited');
    expect(() => parseArgs(['--nope'])).toThrow('exited');
    exit.mockRestore();
    jest.restoreAllMocks();
  });
});

describe('readAssetManifest', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-manifest-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the current format', () => {
    const file = path.join(dir, 'm.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        appVersion: '1.0',
        assets: { 'a.png': 'aa' },
      })
    );
    expect(readAssetManifest(file)).toMatchObject({
      appVersion: '1.0',
      assets: { 'a.png': 'aa' },
    });
  });

  it('still reads the flat map written by older builds', () => {
    const file = path.join(dir, 'legacy.json');
    fs.writeFileSync(file, JSON.stringify({ 'a.png': 'aa' }));
    expect(readAssetManifest(file)).toEqual({
      version: 1,
      appVersion: null,
      assets: { 'a.png': 'aa' },
    });
  });
});

describe('createZip', () => {
  let dir;
  let source;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-zip-'));
    source = path.join(dir, 'src');
    fs.mkdirSync(path.join(source, 'assets', 'nested dir'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(source, 'index.android.bundle'),
      'a'.repeat(4096)
    );
    fs.writeFileSync(
      path.join(source, 'assets', 'nested dir', 'icon.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('matches the reference CRC-32 of "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('walks directories in a stable order', () => {
    expect(collectEntries(source, ['index.android.bundle', 'assets'])).toEqual([
      'index.android.bundle',
      path.join('assets', 'nested dir', 'icon.png'),
    ]);
  });

  it('produces an archive that system unzip round-trips byte for byte', () => {
    const zipPath = path.join(dir, 'package.zip');
    const result = createZip(
      source,
      ['index.android.bundle', 'assets'],
      zipPath
    );
    expect(result.entries).toBe(2);

    // The native side is the real consumer; `unzip` standing in for it catches
    // malformed headers that a JS reader might tolerate.
    cp.execFileSync('unzip', [
      '-qq',
      '-o',
      zipPath,
      '-d',
      path.join(dir, 'out'),
    ]);
    expect(
      fs.readFileSync(path.join(dir, 'out', 'index.android.bundle'))
    ).toEqual(fs.readFileSync(path.join(source, 'index.android.bundle')));
    expect(
      fs.readFileSync(path.join(dir, 'out', 'assets', 'nested dir', 'icon.png'))
    ).toEqual(
      fs.readFileSync(path.join(source, 'assets', 'nested dir', 'icon.png'))
    );
  });

  it('skips symlinks rather than packaging them', () => {
    fs.symlinkSync('/etc/passwd', path.join(source, 'link'));
    expect(collectEntries(source, ['link'])).toEqual([]);
  });
});
