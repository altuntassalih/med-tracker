import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { getProfiles, getMedications, getMedicationLogs } from '../services/firestore';
import { requestNotificationPermission, scheduleMedicationNotification, cancelAllNotifications } from '../services/notifications';
import { useStore } from '../store/useStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getThemeColors } from '../constants/AppConstants';
import GlobalAlert from '../components/GlobalAlert';

const AUTH_TIMEOUT_MS = 3000;

export default function RootLayout() {
  const { setUser, setProfiles, setMedications, setMedicationLogs, setActiveProfileId, medications, theme } = useStore();
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const colors = getThemeColors(theme);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initAuth = async () => {
      if (!auth) {
        setIsAuthReady(true);
        return;
      }

      try {
        unsubscribe = onAuthStateChanged(auth, async (firebaseUser: any) => {
          if (firebaseUser) {
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              displayName: firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? 'Kullanıcı',
              photoURL: firebaseUser.photoURL ?? '',
            });

            if (medications.length === 0) {
              setIsSyncing(true);
              try {
                const userProfiles = await getProfiles(firebaseUser.uid);
                if (userProfiles.length > 0) {
                  setProfiles(userProfiles);
                  setActiveProfileId(userProfiles[0].id);
                  
                  let allMeds: any[] = [];
                  let allLogs: any[] = [];
                  for (const p of userProfiles) {
                    const meds = await getMedications(p.id, null);
                    allMeds = [...allMeds, ...meds];
                    const logs = await getMedicationLogs(p.id);
                    allLogs = [...allLogs, ...logs];
                  }
                  setMedications(allMeds);
                  setMedicationLogs(allLogs);

                  // Eski bildirimleri iptal et ve yeniden zamanla (trigger formatı düzeltildi)
                  try {
                    const hasPermission = await requestNotificationPermission();
                    if (hasPermission) {
                      await cancelAllNotifications();
                      for (const med of allMeds) {
                        if (med.isActive !== false) {
                          for (const t of (med.times || [])) {
                            await scheduleMedicationNotification(
                              med.id,
                              med.name,
                              med.dosage,
                              t,
                              med.intervalDays,
                              med.startDate
                            );
                          }
                        }
                      }
                    }
                  } catch (_notifErr) {
                    // Bildirim yenileme hatası — sessizce geç
                  }
                }
              } catch (_syncErr) {
              } finally {
                setIsSyncing(false);
              }
            }
          }
          setIsAuthReady(true);
        });
      } catch (_err) {
        setIsAuthReady(true);
      }
    };

    initAuth();
    const timeout = setTimeout(() => setIsAuthReady(true), AUTH_TIMEOUT_MS);

    return () => {
      if (unsubscribe) unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (!isAuthReady || isSyncing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ 
        headerShown: false, 
        animation: 'fade',
        contentStyle: { backgroundColor: colors.background }
      }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add-medication" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="add-profile" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="medication-detail" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="profile-settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="archive" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <GlobalAlert />
    </SafeAreaProvider>
  );
}
