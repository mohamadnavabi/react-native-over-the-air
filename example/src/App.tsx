import { useEffect, useState } from 'react';
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
} from 'react-native';
import {
  setBaseURL,
  downloadBundle,
  checkForUpdates,
  reloadBundle,
} from 'react-native-over-the-air';

const ROOT_URL = 'http://localhost:8080/bundles';
const BUNDLE_FILE_NAME = `index.${
  Platform.OS === 'ios' ? 'ios' : 'android'
}.bundle`;

export default function App() {
  const [baseURL, setBaseURLInput] = useState(ROOT_URL);
  const [bundleURL, setBundleURL] = useState(`${ROOT_URL}/${BUNDLE_FILE_NAME}`);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setBaseURL(baseURL);
  }, [baseURL]);

  const handleSetBaseURL = () => {
    if (!baseURL.trim()) {
      Alert.alert('Error', 'Please enter a base URL');
      return;
    }
    try {
      setStatus(`Base URL set to: ${baseURL}`);
      Alert.alert('Success', 'Base URL has been set');
    } catch (error) {
      Alert.alert('Error', `Failed to set base URL: ${error}`);
    }
  };

  const handleCheckForUpdates = async () => {
    setLoading(true);
    setStatus('Checking for updates...');
    try {
      const hasUpdate = await checkForUpdates();
      if (hasUpdate) {
        setStatus('Update available!');
        Alert.alert(
          'Update Available',
          'A new bundle is available. Download it?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Download', onPress: handleDownloadFromBaseURL },
          ]
        );
      } else {
        setStatus('No updates available');
        Alert.alert('No Updates', 'You are using the latest version');
      }
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      Alert.alert('Error', `Failed to check for updates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadFromBaseURL = async () => {
    if (!baseURL.trim()) {
      Alert.alert('Error', 'Please set a base URL first');
      return;
    }

    const url = baseURL.endsWith('/')
      ? `${baseURL}/${BUNDLE_FILE_NAME}`
      : `${baseURL}/${BUNDLE_FILE_NAME}`;

    await handleDownload(url);
  };

  const handleDownload = async (url?: string) => {
    const downloadURL = url || bundleURL;
    if (!downloadURL.trim()) {
      Alert.alert('Error', 'Please enter a bundle URL');
      return;
    }

    setLoading(true);
    setStatus('Downloading bundle...');
    try {
      const success = await downloadBundle(downloadURL.trim());
      if (success) {
        setStatus('Bundle downloaded successfully!');
        Alert.alert(
          'Download Complete',
          'Bundle downloaded successfully. Reload the app to use the new bundle?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Reload Now', onPress: () => reloadBundle() },
          ]
        );
      } else {
        setStatus('Download failed');
        Alert.alert('Error', 'Failed to download bundle');
      }
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      Alert.alert('Error', `Failed to download bundle: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>OTA Updates</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Set Base URL</Text>
        <Text style={styles.description}>
          Set the base URL where your bundles are hosted (e.g.,
          http://your-server.com)
        </Text>
        <TextInput
          style={styles.input}
          placeholder="http://your-server.com"
          value={baseURL}
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
        <Text style={styles.sectionTitle}>2. Check for Updates</Text>
        <Text style={styles.description}>
          Check if a new bundle is available from the base URL
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
        <Text style={styles.sectionTitle}>3. Download Bundle (Direct URL)</Text>
        <Text style={styles.description}>
          Download a bundle directly from a URL
        </Text>
        <TextInput
          style={styles.input}
          placeholder="https://your-server.com/index.android.bundle"
          value={bundleURL}
          onChangeText={setBundleURL}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => handleDownload()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Download Bundle</Text>
          )}
        </TouchableOpacity>
      </View>

      {status ? (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>How to use:</Text>
        <Text style={styles.infoText}>
          1. Set your base URL (e.g., http://your-server.com){'\n'}
          2. Host your bundle files as: index.android.bundle and
          index.ios.bundle{'\n'}
          3. Use "Check for Updates" to check for new versions{'\n'}
          4. Or use "Download Bundle" with a direct URL{'\n'}
          5. After download, reload the app to use the new bundle
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
});
