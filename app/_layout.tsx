import { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, AppState, AppStateStatus, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { getProfiles, getMedications, getMedicationLogs, addMedicationLog, getDailyHealthLogs, createProfile, addMedication, upsertDailyHealthLog, updateUserLastActive } from '../services/firestore';
import {
  requestNotificationPermission,
  scheduleMedicationNotification,
  cancelMedicationNotifications,
  cancelAllNotifications,
  scheduleEndOfDayMissedNotification,
  checkAndRefreshEndOfDayNotification,
} from '../services/notifications';
import { useStore } from '../store/useStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getThemeColors } from '../constants/AppConstants';
import GlobalAlert from '../components/GlobalAlert';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import RemoteConfigGuard from '../components/RemoteConfigGuard';

const AUTH_TIMEOUT_MS = 3000;
const ONLINE_UPDATE_THROTTLE_MS = 5 * 60 * 1000; // 5 dakika (RULE[static-sting-rules.md] gereği sabit olarak tanımlandı)


// Dünün tarihini YYYY-MM-DD formatında döner
function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    ),
  ]);
}

export default function RootLayout() {
  const {
    user, setUser, setProfiles, setMedications, setMedicationLogs, setActiveProfileId,
    medications, medicationLogs, addMedicationLogState, updateMedicationLogState,
    theme, language, profiles,
    quietHoursStart, notificationsEnabled, autoMarkMissedAsTaken,
    hasHydrated, setDailyHealthLogs,
  } = useStore();
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastProcessedDateRef = useRef<string>('');
  const lastOnlineUpdateRef = useRef<number>(0);

  const colors = getThemeColors(theme);

  const updateOnlineStatus = async (userId: string, userEmail?: string) => {
    const now = Date.now();
    if (now - lastOnlineUpdateRef.current > ONLINE_UPDATE_THROTTLE_MS) {
      lastOnlineUpdateRef.current = now;
      await updateUserLastActive(userId, userEmail);
    }
  };

  // ---- Tüm Bildirimleri Yeniden Zamanla ----
  // Telefon yeniden başlatıldığında veya uygulama açıldığında çağrılır.
  // Android, restart sonrası zamanlanmış bildirimleri siler - bu fonksiyon onları geri yükler.
  const rescheduleAllNotifications = async () => {
    const state = useStore.getState();
    if (!state.notificationsEnabled) return;

    const activeMeds = (state.medications || []).filter((m) => m.isActive !== false);
    if (activeMeds.length === 0) return;

    try {
      const hasPermission = await requestNotificationPermission();
      if (!hasPermission) return;

      await cancelAllNotifications();

      for (const med of activeMeds) {
        for (const t of (med.times || [])) {
          await scheduleMedicationNotification(
            med.id,
            med.name,
            med.dosage,
            t,
            state.language as 'tr' | 'en',
            med.intervalDays,
            med.startDate
          );
        }
      }

      // 23:59 - Alınmayan ilaçlar için gün sonu bildirimi
      await scheduleEndOfDayMissedNotification(
        state.quietHoursStart,
        state.quietHoursStartMinute,
        state.autoMarkMissedAsTaken,
        state.language as 'tr' | 'en'
      );

      // Tüm ilaçlar alındıysa 23:59 bildirimini iptal et
      await checkAndRefreshEndOfDayNotification(state.language as 'tr' | 'en');

      console.log('[Notifications] Tüm bildirimler yeniden zamanlandı.');
    } catch (_err) {
      // Sessizce geç
    }
  };

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
          const startLimit = med.originalStartDate || med.startDate;
          const start = new Date(startLimit).setHours(0, 0, 0, 0);
          const yesterday = new Date(yesterdayStr + 'T12:00:00').getTime();
          const daysDiff = Math.floor((yesterday - start) / (1000 * 60 * 60 * 24));
          if (daysDiff < 0 || daysDiff % med.intervalDays !== 0) continue;
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
            const tempId = 'local_eod_' + Date.now() + '_' + med.id + '_' + time.replace(':', '');
            const newLog = { id: tempId, ...logData };
            addMedicationLogState(newLog);
            // Firestore'a da kaydet (arka planda, hata olursa sessiz geç)
            addMedicationLog(logData).then((dbLog) => {
              updateMedicationLogState(tempId, { id: dbLog.id });
            }).catch(() => {});
          }
        }
      }
    }

    // Yeni gün başladığında gün sonu bildirimini yenile
    if (state.notificationsEnabled) {
      scheduleEndOfDayMissedNotification(
        state.quietHoursStart,
        state.quietHoursStartMinute,
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
        // Arka plandan öne geçince sadece gün sonu kontrolü yap
        // Not: rescheduleAllNotifications BURAYA EKLEME — her ekran açılışında
        // immediate bildirim tetikleniyordu
        processMissedMedications();

        // Kullanıcı ön plana geçtiğinde aktiflik zamanını güncelle
        const state = useStore.getState();
        if (state.user?.uid) {
          updateOnlineStatus(state.user.uid, state.user.email);
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  const syncLocalDataToFirestore = async (userId: string) => {
    const state = useStore.getState();
    const profilesToSync = state.profiles.filter(p => p.id.startsWith('local_prof_'));
    const medsToSync = state.medications.filter(m => m.id.startsWith('local_med_'));
    const logsToSync = state.medicationLogs.filter(l => l.id.startsWith('local_log_') || l.id.startsWith('temp_') || l.id.startsWith('local_eod_'));

    const profileIdMap: Record<string, string> = {};
    const medIdMap: Record<string, string> = {};

    // 1. Sync Profiles
    for (const localProf of profilesToSync) {
      try {
        const { id, createdAt, ...profileData } = localProf as any;
        const newProf = await createProfile(userId, profileData);
        profileIdMap[id] = newProf.id;
      } catch (err) {
        // fail silently
      }
    }

    // 2. Sync Medications
    for (const localMed of medsToSync) {
      try {
        const { id, createdAt, ...medData } = localMed as any;
        if (medData.profileId.startsWith('local_prof_')) {
          medData.profileId = profileIdMap[medData.profileId] || medData.profileId;
        }
        medData.userId = userId;
        const newMed = await addMedication(medData);
        medIdMap[id] = newMed.id;
      } catch (err) {
        // fail silently
      }
    }

    // 3. Sync Medication Logs
    for (const localLog of logsToSync) {
      try {
        const { id, createdAt, ...logData } = localLog;
        if (logData.profileId.startsWith('local_prof_')) {
          logData.profileId = profileIdMap[logData.profileId] || logData.profileId;
        }
        if (logData.medicationId.startsWith('local_med_')) {
          logData.medicationId = medIdMap[logData.medicationId] || logData.medicationId;
        }
        await addMedicationLog(logData);
      } catch (err) {
        // fail silently
      }
    }

    // 4. Fetch everything to refresh Zustand store
    const userProfiles = await getProfiles(userId);
    if (userProfiles.length > 0) {
      setProfiles(userProfiles);
      const activeProfExists = userProfiles.some(p => p.id === state.activeProfileId);
      if (!activeProfExists || !state.activeProfileId) {
        setActiveProfileId(userProfiles[0].id);
      }

      let allMeds: any[] = [];
      let allLogs: any[] = [];
      let allHealthLogs: any[] = [];
      for (const p of userProfiles) {
        const meds = await getMedications(p.id, null);
        allMeds = [...allMeds, ...meds];
        const logs = await getMedicationLogs(p.id);
        allLogs = [...allLogs, ...logs];
        const hLogs = await getDailyHealthLogs(p.id);
        allHealthLogs = [...allHealthLogs, ...hLogs];
      }
      setMedications(allMeds);
      setMedicationLogs(allLogs);
      setDailyHealthLogs(allHealthLogs);
    }
  };

  // ---- 1. Firestore Senkronizasyon (Hydration sonrası ve Giriş Yapılmışsa) ----
  useEffect(() => {
    const syncData = async () => {
      const state = useStore.getState();
      if (!state.user?.uid || !hasHydrated) return;
      const userId = state.user.uid;

      setIsSyncing(true);
      try {
        await promiseWithTimeout(
          syncLocalDataToFirestore(userId),
          8000
        );
        const currentState = useStore.getState();
        if (currentState.profiles.length > 0) {
          router.replace('/(tabs)');
        } else {
          router.replace('/onboarding');
        }
      } catch (_syncErr) {
        const currentState = useStore.getState();
        if (currentState.profiles.length > 0) {
          router.replace('/(tabs)');
        } else {
          router.replace('/onboarding');
        }
      } finally {
        setIsSyncing(false);
      }
    };
    syncData();
  }, [hasHydrated, user?.uid]);

  // ---- 2. Bildirimleri ve Gün Sonu Kontrolünü Tetikleme ----
  // İlaçlar veya ayarlar değiştiğinde bildirimleri güncelle
  useEffect(() => {
    if (isAuthReady && hasHydrated) {
      rescheduleAllNotifications();
      processMissedMedications();
    }
  }, [medications, notificationsEnabled, isAuthReady, hasHydrated]);

  // ---- 3. Kullanıcı Oturum Takibi ----
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
            updateOnlineStatus(firebaseUser.uid, firebaseUser.email ?? '');
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <RemoteConfigGuard>
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ 
              headerShown: false, 
              animation: 'fade',
              contentStyle: { backgroundColor: colors.background }
            }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="add-medication" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="add-profile" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="medication-detail" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="profile-settings" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="archive" options={{ animation: 'slide_from_right' }} />
            </Stack>

            {(!isAuthReady || isSyncing) && (
              <View style={[
                StyleSheet.absoluteFillObject,
                {
                  backgroundColor: colors.background,
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                }
              ]}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          </View>
        </RemoteConfigGuard>
        <GlobalAlert />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
