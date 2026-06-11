import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export interface RemoteConfig {
  status: 'active' | 'maintenance' | 'force_update';
  version?: string;
  minVersion?: string;
  downloadUrl?: string;
  maintenanceMessageTr?: string;
  maintenanceMessageEn?: string;
  bannerActive?: boolean;
  bannerType?: 'info' | 'success' | 'warning' | 'danger';
  bannerMessageTr?: string;
  bannerMessageEn?: string;
  customConfigs?: Record<string, any>;
}

// Fallback config when database is unreachable or offline
const defaultFallbackConfig: RemoteConfig = {
  status: 'active',
  bannerActive: false,
  customConfigs: {}
};

/**
 * Subscribes to real-time changes of the remote control settings in Firestore.
 * If Firestore is not initialized or offline, it falls back to default values.
 * 
 * @param callback Function to call when configuration updates
 * @returns Unsubscribe function
 */
export function listenToRemoteConfig(callback: (config: RemoteConfig) => void): () => void {
  if (!db) {
    console.warn('[RemoteConfig] Firestore is null, using offline fallback configs.');
    callback(defaultFallbackConfig);
    return () => {};
  }

  try {
    const docRef = doc(db, 'app_configs', 'control');
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as RemoteConfig;
          callback(data);
        } else {
          console.warn('[RemoteConfig] Remote config document does not exist in target database.');
          callback(defaultFallbackConfig);
        }
      },
      (error) => {
        console.error('[RemoteConfig] Error listening to remote configs:', error);
        callback(defaultFallbackConfig);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.error('[RemoteConfig] Setup error:', err);
    callback(defaultFallbackConfig);
    return () => {};
  }
}
