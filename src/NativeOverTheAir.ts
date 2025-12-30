import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  downloadBundle(url: string): Promise<boolean>;
  setBaseURL(url: string): void;
  checkForUpdates(): Promise<boolean>;
  reloadBundle(): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('OverTheAir');
