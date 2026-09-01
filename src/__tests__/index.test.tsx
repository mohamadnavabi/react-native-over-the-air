import type { Spec } from '../NativeOverTheAir';

type NativeMock = {
  [K in keyof Spec]: jest.Mock;
};

const mockNative: NativeMock = {
  installUpdate: jest.fn(),
  setBaseURL: jest.fn(),
  checkForUpdates: jest.fn(),
  getAppVersion: jest.fn(),
  getBundleVersion: jest.fn(),
  notifyAppReady: jest.fn(),
  isPendingUpdate: jest.fn(),
  resetToDefault: jest.fn(),
  reloadBundle: jest.fn(),
  onDownloadProgress: jest.fn(),
};

jest.mock('../NativeOverTheAir', () => ({
  __esModule: true,
  default: mockNative,
}));

const OTA = require('../index') as typeof import('../index');

const subscription = { remove: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.onDownloadProgress.mockReturnValue(subscription);
  mockNative.installUpdate.mockResolvedValue(true);
});

describe('setBaseURL', () => {
  it('defaults to refusing insecure transports', () => {
    OTA.setBaseURL('https://example.com/ota');
    expect(mockNative.setBaseURL).toHaveBeenCalledWith(
      'https://example.com/ota',
      false
    );
  });

  it('passes the opt-in through', () => {
    OTA.setBaseURL('http://localhost:8080', { allowInsecureHttp: true });
    expect(mockNative.setBaseURL).toHaveBeenCalledWith(
      'http://localhost:8080',
      true
    );
  });
});

describe('downloadBundle', () => {
  it('forwards the expected hash', async () => {
    await OTA.downloadBundle('https://example.com/a.zip', '1.2.0', {
      hash: 'abc',
    });
    expect(mockNative.installUpdate).toHaveBeenCalledWith(
      'https://example.com/a.zip',
      '1.2.0',
      'abc'
    );
  });

  it('passes null rather than undefined when no hash is known', async () => {
    await OTA.downloadBundle('https://example.com/a.zip', '1.2.0');
    expect(mockNative.installUpdate).toHaveBeenCalledWith(
      'https://example.com/a.zip',
      '1.2.0',
      null
    );
  });

  it('removes the progress subscription even when the install fails', async () => {
    mockNative.installUpdate.mockRejectedValue(new Error('HTTP 500'));
    await expect(
      OTA.downloadBundle('https://example.com/a.zip', '1.2.0', {
        onProgress: () => {},
      })
    ).rejects.toThrow('HTTP 500');
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when no listener was given', async () => {
    await OTA.downloadBundle('https://example.com/a.zip', '1.2.0');
    expect(mockNative.onDownloadProgress).not.toHaveBeenCalled();
  });
});

describe('sync', () => {
  it('reports up-to-date when the manifest has nothing newer', async () => {
    mockNative.checkForUpdates.mockResolvedValue(null);
    await expect(OTA.sync()).resolves.toEqual({
      status: 'up-to-date',
      update: null,
    });
    expect(mockNative.installUpdate).not.toHaveBeenCalled();
  });

  it('leaves optional updates alone by default', async () => {
    const update = {
      url: 'https://example.com/a.zip',
      version: '2',
      isMandatory: false,
    };
    mockNative.checkForUpdates.mockResolvedValue(update);
    await expect(OTA.sync()).resolves.toEqual({
      status: 'update-ignored',
      update,
    });
    expect(mockNative.installUpdate).not.toHaveBeenCalled();
  });

  it('installs optional updates when asked to', async () => {
    const update = {
      url: 'https://example.com/a.zip',
      version: '2',
      isMandatory: false,
    };
    mockNative.checkForUpdates.mockResolvedValue(update);
    await expect(OTA.sync({ installOptionalUpdates: true })).resolves.toEqual({
      status: 'update-installed',
      update,
    });
    expect(mockNative.installUpdate).toHaveBeenCalled();
  });

  it('installs mandatory updates and forwards the manifest hash', async () => {
    const update = {
      url: 'https://example.com/a.zip',
      version: '2',
      isMandatory: true,
      hash: 'deadbeef',
    };
    mockNative.checkForUpdates.mockResolvedValue(update);
    await expect(OTA.sync()).resolves.toEqual({
      status: 'update-installed',
      update,
    });
    expect(mockNative.installUpdate).toHaveBeenCalledWith(
      update.url,
      '2',
      'deadbeef'
    );
    expect(mockNative.reloadBundle).not.toHaveBeenCalled();
  });

  it('reloads straight away in immediate mode', async () => {
    mockNative.checkForUpdates.mockResolvedValue({
      url: 'https://example.com/a.zip',
      version: '2',
      isMandatory: true,
    });
    await OTA.sync({ installMode: 'immediate' });
    expect(mockNative.reloadBundle).toHaveBeenCalledTimes(1);
  });

  it('never throws: a manifest failure comes back as an error result', async () => {
    mockNative.checkForUpdates.mockRejectedValue(new Error('offline'));
    const result = await OTA.sync();
    expect(result.status).toBe('error');
    expect(result.error?.message).toBe('offline');
  });

  it('keeps the update on the result when the download fails', async () => {
    const update = {
      url: 'https://example.com/a.zip',
      version: '2',
      isMandatory: true,
    };
    mockNative.checkForUpdates.mockResolvedValue(update);
    mockNative.installUpdate.mockRejectedValue(new Error('INTEGRITY_ERROR'));
    const result = await OTA.sync();
    expect(result).toMatchObject({ status: 'error', update });
    expect(mockNative.reloadBundle).not.toHaveBeenCalled();
  });
});

describe('pass-through helpers', () => {
  it('exposes the native accessors', () => {
    mockNative.getAppVersion.mockReturnValue('1.0');
    mockNative.getBundleVersion.mockReturnValue('1.2.0');
    mockNative.isPendingUpdate.mockReturnValue(true);

    expect(OTA.getAppVersion()).toBe('1.0');
    expect(OTA.getBundleVersion()).toBe('1.2.0');
    expect(OTA.isPendingUpdate()).toBe(true);

    OTA.notifyAppReady();
    OTA.resetToDefault();
    OTA.reloadBundle();
    expect(mockNative.notifyAppReady).toHaveBeenCalled();
    expect(mockNative.resetToDefault).toHaveBeenCalled();
    expect(mockNative.reloadBundle).toHaveBeenCalled();
  });
});
