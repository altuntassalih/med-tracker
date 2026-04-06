import { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, AppState, AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { getProfiles, getMedications, getMedicationLogs, addMedicationLog } from '../services/firestore';
import {
  requestNotificationPermission,
  scheduleMedicationNotification,
  cancelAllNotifications,
  scheduleEndOfDayMissedNotification,
} from '../services/notifications';
import { useStore } from '../store/useStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getThemeColors } from '../constants/AppConstants';
import GlobalAlert from '../components/GlobalAlert';

const AUTH_TIMEOUT_MS = 3000;

// Dünün tarihini YYYY-MM-DD formatında döner
function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export default function RootLayout() {
  const {
    setUser, setProfiles, setMedications, setMedicationLogs, setActiveProfileId,
    medications, medicationLogs, addMedicationLogState,
    theme, language, profiles,
    quietHoursStart, notificationsEnabled, autoMarkMissedAsTaken,
  } = useStore();
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastProcessedDateRef = useRef<string>('');

  const colors = getThemeColors(theme);

  // ---- Gün Sonu Kontrolü ----
  const processMissedMedications = async () => {
    const yesterdayStr = getYesterdayStr();
    const todayStr = getTodayStr();

    // Aynı günü birden fazla işleme
    if (lastProcessedDateRef.current === todayStr) return;
    lastProcessedDateRef.current = todayStr;

    const state = useStore.getState();
    const allMeds = state.medications;
    const allLogs = state.medicationLogs;
    const autoMark = state.autoMarkMissedAsTaken;

    if (!allMeds || allMeds.length === 0) return;

    for (const profile of (state.profiles || [])) {
      const profileMeds = allMeds.filter(
        (m) => m.profileId === profile.id && m.isActive !== false
      );

      for (const med of profileMeds) {
        // Aralıklı ilaç kontrolü: dün bu ilaç alınması gereken gündeydi mi?
        if (med.intervalDays && med.intervalDays > 1) {
          const start = new Date(med.startDate).setHours(0, 0, 0, 0);
          const yesterday = new Date(yesterdayStr + 'T12:00:00').getTime();
          const daysDiff = Math.floor((yesterday - start) / (1000 * 60 * 60 * 24));
          if (daysDiff % med.intervalDays !== 0) continue;
        }

        for (const time of (med.times || [])) {
          // Dün için bu doz zaten loglandı mı?
          const alreadyLogged = allLogs.some(
            (l) =>
              l.medicationId === med.id &&
              l.expectedTime === time &&
              l.takenAt.startsWith(yesterdayStr)
          );

          if (!alreadyLogged) {
            const status = autoMark ? 'taken' : 'missed';
            const takenAt = `${yesterdayStr}T23:59:00.000Z`;
            const logData = {
              profileId: profile.id,
              medicationId: med.id,
              expectedTime: time,
              takenAt,
              status: status as 'taken' | 'missed',
            };
            const newLog = { id: 'local_eod_' + Date.now() + '_' + med.id + '_' + time.replace(':', ''), ...logData };
            addMedicationLogState(newLog);
            // Firestore'a da kaydet (arka planda, hata olursa sessiz geç)
            addMedicationLog(logData).catch(() => {});
          }
        }
      }
    }

    // Sessiz saat öncesi bildirimi güncelle
    if (notificationsEnabled) {
      scheduleEndOfDayMissedNotification(
        state.quietHoursStart,
        state.autoMarkMissedAsTaken,
        state.language as 'tr' | 'en'
      ).catch(() => {});
    }
  };

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // Arka plandan öne geçince gün sonu kontrolü yap
        processMissedMedications();
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

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

                  // Bildirimleri yenile
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
                      // Gün sonu bildirimi zamanlama
                      const state = useStore.getState();
                      await scheduleEndOfDayMissedNotification(
                        state.quietHoursStart,
                        state.autoMarkMissedAsTaken,
                        state.language as 'tr' | 'en'
                      );
                    }
                  } catch (_notifErr) {
                    // Bildirim yenileme hatası — sessizce geç
                  }

                  // Uygulama açıldığında gün sonu kontrolü
                  setTimeout(() => processMissedMedications(), 1500);
                }
              } catch (_syncErr) {
              } finally {
                setIsSyncing(false);
              }
            } else {
              // Medications zaten yüklü: gün sonu kontrolü yap
              setTimeout(() => processMissedMedications(), 1000);
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
