import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface UpdateInfo {
  url: string;
  version: string;
  isMandatory?: boolean;
}

export interface Spec extends TurboModule {
  downloadBundle(url: string): Promise<boolean>;
  saveBundleVersion(version: string): void;
  setBaseURL(url: string): void;
  checkForUpdates(): Promise<UpdateInfo | null>;
  getAppVersion(): string;
  getBundleVersion(): string;
  reloadBundle(): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('OverTheAir');
