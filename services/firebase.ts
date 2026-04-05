import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Firebase Ayarları (Fallback değerleri)
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID
};

// Güvenli başlatma - hata olursa null döner
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

try {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    // @ts-ignore
    auth = initializeAuth(app, {
      // @ts-ignore
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    app = getApp();
    auth = getAuth(app);
  }
  db = getFirestore(app);
} catch (err: any) {
  // Firebase başlatma hatası - uygulama local modda çalışacak
  console.error('[Firebase] Initialization CRITICAL ERROR:', err);
  app = null;
  auth = null;
  db = null;
}

export { app, auth, db };
