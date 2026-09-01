import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import {
  setBaseURL,
  downloadBundle,
  checkForUpdates,
  reloadBundle,
  resetToDefault,
  isPendingUpdate,
  getAppVersion,
  getBundleVersion,
  sync,
  type DownloadProgressEvent,
} from 'react-native-over-the-air';

// Replace this with the folder on your own server that hosts manifest.json.
const DEFAULT_BASE_URL = 'https://ravanshenas.net/bundles';
const PACKAGE_FILE_NAME = `${Platform.OS}-package.zip`;

function formatProgress(progress: DownloadProgressEvent | null): string {
  if (!progress) {
    return '';
  }
  const received = (progress.receivedBytes / 1024).toFixed(0);
  if (!progress.totalBytes) {
    return `${received} KiB`;
  }
  const percent = Math.round(
    (progress.receivedBytes / progress.totalBytes) * 100
  );
  const total = (progress.totalBytes / 1024).toFixed(0);
  return `${percent}%  (${received} / ${total} KiB)`;
}

export default function App() {
  const [baseURLInput, setBaseURLInput] = useState(DEFAULT_BASE_URL);
  const [packageURL, setPackageURL] = useState(
    `${DEFAULT_BASE_URL}/${PACKAGE_FILE_NAME}`
  );
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<DownloadProgressEvent | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [bundleVersion, setBundleVersion] = useState('');
  const [pending, setPending] = useState(false);

  const refreshVersions = useCallback(() => {
    setAppVersion(getAppVersion());
    setBundleVersion(getBundleVersion());
    setPending(isPendingUpdate());
  }, []);

  useEffect(() => {
    // The base URL only has to be set once, not on every keystroke.
    setBaseURL(DEFAULT_BASE_URL);
    refreshVersions();
  }, [refreshVersions]);

  const handleSetBaseURL = () => {
    const url = baseURLInput.trim();
    if (!url) {
      Alert.alert('Error', 'Please enter a base URL');
      return;
    }
    try {
      // Plain http is rejected unless you opt in, which you should only do
      // against a local development server.
      setBaseURL(url, { allowInsecureHttp: url.startsWith('http://') });
      setPackageURL(`${url.replace(/\/+$/, '')}/${PACKAGE_FILE_NAME}`);
      setStatus(`Base URL set to: ${url}`);
    } catch (error: any) {
      Alert.alert('Error', `Failed to set base URL: ${error.message}`);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    setProgress(null);
    setStatus('Syncing...');
    // sync() reports failures in its result rather than throwing.
    const result = await sync({
      installOptionalUpdates: true,
      onProgress: setProgress,
    });
    refreshVersions();
    setLoading(false);
    setProgress(null);

    switch (result.status) {
      case 'up-to-date':
        setStatus('Already running the latest bundle.');
        break;
      case 'update-ignored':
        setStatus(
          `Optional update ${result.update?.version} was not installed.`
        );
        break;
      case 'update-installed':
        setStatus(`Installed ${result.update?.version}. Reload to apply.`);
        Alert.alert(
          'Update installed',
          'Reload the app to use the new bundle?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Reload now', onPress: reloadBundle },
          ]
        );
        break;
      case 'error':
        setStatus(`Sync failed: ${result.error?.message}`);
        break;
    }
  };

  const handleCheckForUpdates = async () => {
    setLoading(true);
    setStatus('Checking for updates...');
    try {
      const update = await checkForUpdates();
      if (!update) {
        setStatus('No updates available');
        Alert.alert('No updates', 'You are running the latest bundle.');
        return;
      }
      setStatus(`Update available: ${update.version}`);
      Alert.alert(
        'Update available',
        `Version ${update.version} is available. Download it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: () =>
              handleDownload(update.url, update.version, update.hash),
          },
        ]
      );
    } catch (error: any) {
      // checkForUpdates now rejects on a network or manifest failure, so a
      // server being down is no longer indistinguishable from "up to date".
      setStatus(`Error: ${error.message}`);
      Alert.alert('Error', `Failed to check for updates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (
    url: string,
    version: string,
    hash?: string
  ) => {
    if (!url.trim()) {
      Alert.alert('Error', 'Please enter a package URL');
      return;
    }

    setLoading(true);
    setProgress(null);
    setStatus('Downloading...');
    try {
      await downloadBundle(url.trim(), version, {
        hash,
        onProgress: setProgress,
      });
      refreshVersions();
      setStatus('Downloaded and verified.');
      Alert.alert(
        'Download complete',
        'Reload the app to use the new bundle?',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Reload now', onPress: reloadBundle },
        ]
      );
    } catch (error: any) {
      // downloadBundle rejects rather than resolving false, so every failure
      // (HTTP, integrity, disk) lands here with a reason.
      setStatus(`Error: ${error.message}`);
      Alert.alert('Error', `Failed to download: ${error.message}`);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleReset = () => {
    Alert.alert(
      'Reset to the packaged bundle?',
      'This deletes every downloaded bundle. The app will reload.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            resetToDefault();
            refreshVersions();
            reloadBundle();
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>OTA Updates</Text>

      <View style={styles.versionSection}>
        <Text style={styles.versionLabel}>Native App Version:</Text>
        <Text style={styles.versionValue}>{appVersion || 'Loading...'}</Text>
        <Text style={styles.versionLabel}>Bundle Version:</Text>
        <Text style={styles.versionValue}>
          {bundleVersion || 'Packaged bundle'}
        </Text>
        {pending ? (
          <Text style={styles.versionLabel}>
            An update is installed but not yet confirmed.
          </Text>
        ) : null}
      </View>

      <View style={[styles.section, styles.row]}>
        <Image
          source={require('./assets/images/example.png')}
          style={styles.image}
        />
        <Image
          source={require('./assets/images/sample.jpeg')}
          style={styles.image}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Set Base URL</Text>
        <Text style={styles.description}>
          The folder that hosts manifest.json, e.g. https://your-server.com/ota
        </Text>
        <TextInput
          style={styles.input}
          placeholder="https://your-server.com/ota"
          value={baseURLInput}
          onChangeText={setBaseURLInput}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleSetBaseURL}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Set Base URL</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Sync</Text>
        <Text style={styles.description}>
          Check the manifest and install whatever it offers.
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleSync}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sync Now</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>3. Check for Updates (Manual)</Text>
        <Text style={styles.description}>
          Check whether an update exists and decide whether to install it.
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={handleCheckForUpdates}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Check for Updates</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>4. Download a package by URL</Text>
        <Text style={styles.description}>
          Bypasses the manifest, so nothing verifies the download.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="https://your-server.com/ota/android-package.zip"
          value={packageURL}
          onChangeText={setPackageURL}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => handleDownload(packageURL, 'manual')}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Download Manually</Text>
          )}
        </TouchableOpacity>
      </View>

      {progress ? (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{formatProgress(progress)}</Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: progress.totalBytes
                    ? `${Math.min(
                      100,
                      (progress.receivedBytes / progress.totalBytes) * 100
                    )}%`
                    : '100%',
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {status ? (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reset</Text>
        <Text style={styles.description}>
          Delete every downloaded bundle and go back to the one in the binary.
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.dangerButton]}
          onPress={handleReset}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Reset to packaged bundle</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>How to use:</Text>
        <Text style={styles.infoText}>
          1. Build packages with `npx ota bundle --manifest --base-url ...
          --app-version ...`{'\n'}
          2. Upload ota-server-files/ to the base URL above{'\n'}
          3. Sync, then reload to run the new bundle
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  content: {
    padding: 20,
    ...Platform.select({
      ios: {
        paddingTop: 60,
      },
    }),
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 30,
    textAlign: 'center',
  },
  versionSection: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  versionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
    marginTop: 8,
  },
  versionValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1B5E20',
    marginBottom: 4,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    marginBottom: 15,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  secondaryButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusContainer: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  statusText: {
    color: '#1976D2',
    fontSize: 14,
    fontWeight: '500',
  },
  infoSection: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E65100',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#E65100',
    lineHeight: 20,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#BBDEFB',
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1976D2',
  },
  dangerButton: {
    backgroundColor: '#D32F2F',
  },
  image: {
    width: 100,
    height: 100,
  },
});
