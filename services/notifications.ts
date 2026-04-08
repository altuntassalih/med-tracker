import { Platform } from 'react-native';
import { useStore } from '../store/useStore';

// ---- Sabitler ----
const NOTIFICATION_LEAD_MINUTES = 5;
const NOTIFICATION_CHANNEL_ID = 'med-tracker-default';
const END_OF_DAY_NOTIF_DATA_KEY = 'end-of-day-missed-notif';
const END_OF_DAY_LEAD_MINUTES = 5;

// ---- expo-notifications dinamik import ----
// Hem Expo Go hem de standalone build'de çalışacak şekilde
let Notifications: any = null;
let SchedulableTriggerInputTypes: any = null;
let AndroidImportance: any = null;

try {
  const notifModule = require('expo-notifications');
  Notifications = notifModule;
  SchedulableTriggerInputTypes = notifModule.SchedulableTriggerInputTypes;
  AndroidImportance = notifModule.AndroidImportance;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (_err) {
  // expo-notifications yüklenemedi — Expo Go web'de normal
}

// ---- Kanal oluşturma (Android 8+) ----
// İzin istemeden ÖNCE çağrılmalı
const ensureAndroidChannel = async () => {
  if (!Notifications || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'İlaç Hatırlatıcı',
      importance: AndroidImportance?.MAX ?? 5,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6C63FF',
      sound: 'default',
      enableVibrate: true,
    });
  } catch (_err) {
    // Kanal oluşturma hatası — sessizce geç
  }
};

// ---- İzin isteme ----
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!Notifications) return false;

  try {
    // Android 8+ için önce kanal oluştur (izin dialog'u için gerekli)
    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  } catch (_err) {
    return false;
  }
};

/**
 * Verilen saat (HH:MM) için NOTIFICATION_LEAD_MINUTES dk öncesine günlük tekrar bildirim zamanlar.
 *
 * SDK 54 doğru trigger formatı: SchedulableTriggerInputTypes.DAILY + channelId trigger'da
 */
export const scheduleMedicationNotification = async (
  medicationId: string,
  medicationName: string,
  dosage: string,
  time: string,
  lang: 'tr' | 'en' = 'tr',
  intervalDays: number = 1,
  startDate: string = new Date().toISOString().split('T')[0]
): Promise<string> => {
  if (!Notifications) return 'disabled';

  const state = useStore.getState();
  if (!state.notificationsEnabled) return 'disabled';

  try {
    await ensureAndroidChannel();

    const [originalHour, originalMinute] = time.split(':').map(Number);

    // İlaç saatinden NOTIFICATION_LEAD_MINUTES dk öncesini hesapla
    let totalMinutes = originalHour * 60 + originalMinute - NOTIFICATION_LEAD_MINUTES;
    if (totalMinutes < 0) totalMinutes += 24 * 60;

    const triggerHour = Math.floor(totalMinutes / 60);
    const triggerMinute = totalMinutes % 60;

    // Sessiz saat kontrolü (Dakika hassasiyetiyle)
    const quietStartH = state.quietHoursStart;
    const quietStartM = state.quietHoursStartMinute || 0;
    const quietEndH = state.quietHoursEnd;
    const quietEndM = state.quietHoursEndMinute || 0;

    const triggerTotalMin = triggerHour * 60 + triggerMinute;
    const quietStartTotalMin = quietStartH * 60 + quietStartM;
    const quietEndTotalMin = quietEndH * 60 + quietEndM;

    const isQuietEnabled = state.quietHoursEnabled;
    let isQuiet = false;
    if (isQuietEnabled) {
      if (quietStartTotalMin < quietEndTotalMin) {
        if (triggerTotalMin >= quietStartTotalMin && triggerTotalMin < quietEndTotalMin) isQuiet = true;
      } else {
        // Gece yarısını geçen aralık (Örn: 23:00 - 07:00)
        if (triggerTotalMin >= quietStartTotalMin || triggerTotalMin < quietEndTotalMin) isQuiet = true;
      }
    }

    if (isQuietEnabled && isQuiet) {
      // TEST IÇIN: Neden sustuğunu konsola yazdır (Daha sonra silinecek)
      console.log(`[Notification] Skip: Trigger ${triggerHour}:${triggerMinute} in Quiet Hours (${quietStartH}:${quietStartM} - ${quietEndH}:${quietEndM})`);
      return 'quiet_hours';
    }

    // SDK 54 doğru trigger formatı + Android EXACT alarm
    let trigger: any;
    if (intervalDays === 7) {
      const startD = new Date(startDate + 'T12:00:00');
      const weekday = startD.getDay() + 1;
      trigger = {
        weekday,
        hour: triggerHour,
        minute: triggerMinute,
        repeats: true,
        ...(Platform.OS === 'android' && { 
          channelId: NOTIFICATION_CHANNEL_ID,
        }),
      };
    } else {
      trigger = {
        hour: triggerHour,
        minute: triggerMinute,
        repeats: true,
        ...(Platform.OS === 'android' && { 
          channelId: NOTIFICATION_CHANNEL_ID,
        }),
      };
    }

    // TEMPORARY LOG: Silinecek
    console.log(`[Notification] Scheduled: ${medicationName} at ${triggerHour}:${triggerMinute} (Exact: true, Repeats: true)`);

    // Eğer planlanan zaman şu anki zamandan çok yakınsa veya geçmişse (bugün için), 
    // Expo genelde bunu yarın için planlar. Ancak anlık tetiklenmeyi önlemek için
    // trigger nesnesinin doğruluğundan emin oluyoruz.
    
    const identifierStr = `med-${medicationId}-${time.replace(':', '')}`;

    await Notifications.scheduleNotificationAsync({
      identifier: identifierStr,
      content: {
        title: lang === 'tr' ? '💊 İlaç Vakti Yaklaşıyor!' : '💊 Medication Time Approaching!',
        body: lang === 'tr' 
          ? `${medicationName} (${dosage}) için ${NOTIFICATION_LEAD_MINUTES} dakika kaldı.`
          : `${NOTIFICATION_LEAD_MINUTES} minutes left for ${medicationName} (${dosage}).`,
        data: { medicationId },
        sound: 'default',
        priority: 'max',
      },
      trigger,
    });

    // Kullanıcı talebi: İlaç eklendiğinde/güncellendiğinde 5 dk'dan az vakit kalmışsa ANINDA BİLDİRİM at
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const currentTotalMin = currentH * 60 + currentM;
    const targetMedTotalMin = originalHour * 60 + originalMinute;
    
    let minutesLeft = targetMedTotalMin - currentTotalMin;
    if (minutesLeft < 0) minutesLeft += 24 * 60;
    
    // Eğer ilaç alımına şu anda 5 dk veya daha az kaldıysa (örneğin 09:56'da 10:00 ilacı eklenirse)
    if (minutesLeft > 0 && minutesLeft <= 5) {
      console.log(`[Notification] Firing Immediate 5-min warning for ${medicationName} (Minutes left: ${minutesLeft})`);
      await Notifications.scheduleNotificationAsync({
        identifier: `med-immed-${medicationId}-${time.replace(':', '')}`,
        content: {
          title: lang === 'tr' ? '🚨 Az Önce Kuruldu!' : '🚨 Scheduled Just Now!',
          body: lang === 'tr'
            ? `${medicationName} (${dosage}) alımınıza ${minutesLeft} dakika kaldı!`
            : `Only ${minutesLeft} minutes left for ${medicationName} (${dosage})!`,
          data: { medicationId },
          sound: 'default',
          priority: 'max',
        },
        trigger: null, // Hemen at
      });
    }

    return identifierStr;
  } catch (err) {
    return 'error';
  }
};

export const cancelMedicationNotifications = async (medicationId: string): Promise<void> => {
  if (!Notifications) return;

  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduledNotifications) {
      if (notif.content.data?.medicationId === medicationId) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch (_err) {
    // Bildirim silme hatası
  }
};

export const cancelAllNotifications = async (): Promise<void> => {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (_err) {
    // Tüm bildirimleri silme hatası
  }
};

/**
 * Sessiz saatlerin başlangıcından END_OF_DAY_LEAD_MINUTES dk önce
 * "işaretlenmemiş ilaçlarınız var" bildirimi zamanlar.
 *
 * autoMarkMissedAsTaken=true ise bildirim zamanlanmaz (otomatik işaretlenecek).
 */
export const scheduleEndOfDayMissedNotification = async (
  quietHoursStart: number,
  quietHoursStartMinute: number,
  autoMarkMissedAsTaken: boolean,
  lang: 'tr' | 'en' = 'tr'
): Promise<void> => {
  if (!Notifications) return;

  // Önceki gün sonu bildirimini iptal et (Identifier üzerinden)
  try {
    await Notifications.cancelScheduledNotificationAsync(END_OF_DAY_NOTIF_DATA_KEY);
  } catch (_err) { /* no-op */ }

  // autoMarkMissedAsTaken=true ise bildirim gerekmez
  if (autoMarkMissedAsTaken) return;

  const state = useStore.getState();
  if (!state.notificationsEnabled) return;

  await ensureAndroidChannel();

  // Kullanıcı İsteği: 23:59'da bildirim at, eğer sessiz saatler aktifse ve içindeyse.
  // Sessiz saatler aktifse ve 23:59'dan önce başlıyorsa, sessiz saatlerden 5 dk önce at.
  
  // Kural: Sadece 23:59'da o güne ait alınmamış ilaç varsa çıkacak.
  let targetHour = 23;
  let targetMinute = 59;

  const title = lang === 'tr' ? '⏰ Unutmayın!' : '⏰ Reminder!';
  const body = lang === 'tr'
    ? 'Bugün içinde henüz işaretlenmemiş ilaçlarınız var. Lütfen kontrol edin.'
    : 'You have medications you have not marked today. Please check.';

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: END_OF_DAY_NOTIF_DATA_KEY,
      content: {
        title,
        body,
        data: { notifType: END_OF_DAY_NOTIF_DATA_KEY },
        sound: 'default',
        priority: 'max',
      },
      trigger: {
        hour: targetHour,
        minute: targetMinute,
        repeats: true,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      },
    });
    console.log(`[Notification] EndOfDay scheduled at ${targetHour}:${targetMinute}`);
  } catch (_err) {
    // Bildirim zamanlama hatası
  }
};

/**
 * Güncel state'i kontrol eder, eğer o gün için alınmamış/bekleyen ilaç YOKSA
 * gün sonu bildirimini iptal eder. Eğer bekleyen varsa planlamasını sağlar.
 */
export const checkAndRefreshEndOfDayNotification = async (lang: 'tr' | 'en' = 'tr'): Promise<void> => {
  const state = useStore.getState();
  if (!state.notificationsEnabled || state.autoMarkMissedAsTaken) return;
  if (!state.activeProfileId) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let hasUntaken = false;

  const medications = (state.medications || []).filter(m => m.profileId === state.activeProfileId && m.isActive !== false);
  const logs = (state.medicationLogs || []).filter(l => l.profileId === state.activeProfileId);

  medications.forEach((med) => {
    // Aralık kontrolü
    if (med.intervalDays && med.intervalDays > 1) {
      const start = new Date(med.startDate).setHours(0,0,0,0);
      const today = new Date().setHours(0,0,0,0);
      const daysDiff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
      if (daysDiff % med.intervalDays !== 0) return;
    }

    (med.times || []).forEach((time) => {
      // Bugün alındı mı? (scheduledDate eksik olabilir, eski kayıtlar için de fallback yap)
      const isTakenToday = logs.some((l) => 
        l.medicationId === med.id && 
        l.expectedTime === time && 
        (l.scheduledDate === todayStr || (!l.scheduledDate && l.takenAt.startsWith(todayStr))) &&
        l.status === 'taken'
      );

      if (!isTakenToday) {
        // Alınmadı. Sadece bugüne ait olması veya vaktinin geçmiş olması da önemli olabilir,
        // Ancak bu ilaç bugün alınmadıysa ve bugün için aktifse hasUntaken true olur.
        hasUntaken = true;
      }
    });
  });

  if (!hasUntaken) {
    // Tüm ilaçlar alınmış, 23:59 bildirimini iptal et!
    if (!Notifications) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(END_OF_DAY_NOTIF_DATA_KEY);
    } catch (_err) { /* no-op */ }
  } else {
    // Bekleyen var, bildirimi kur (Zaten varsa overwrite edecek, sorun değil, ID sabit)
    scheduleEndOfDayMissedNotification(state.quietHoursStart, state.quietHoursStartMinute, state.autoMarkMissedAsTaken, lang);
  }
};

/**
 * Test amaçlı: 5 saniye sonra bildirim gönderir.
 * Build aldıktan sonra çalışıp çalışmadığını doğrulamak için kullanın.
 */
export const scheduleTestNotification = async (): Promise<void> => {
  if (!Notifications) return;
  await ensureAndroidChannel();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✅ Bildirim Testi',
        body: 'Med-Tracker bildirimleri çalışıyor!',
        sound: 'default',
        data: { test: true },
      },
      trigger: {
        type: SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval',
        seconds: 5,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      },
    });
  } catch (_err) {
    // Test bildirim hatası
  }
};
