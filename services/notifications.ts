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

    let isQuiet = false;
    if (quietStartTotalMin < quietEndTotalMin) {
      if (triggerTotalMin >= quietStartTotalMin && triggerTotalMin < quietEndTotalMin) isQuiet = true;
    } else {
      // Gece yarısını geçen aralık (Örn: 23:00 - 07:00)
      if (triggerTotalMin >= quietStartTotalMin || triggerTotalMin < quietEndTotalMin) isQuiet = true;
    }

    if (isQuiet) {
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
          exact: true 
        }),
      };
    } else {
      trigger = {
        hour: triggerHour,
        minute: triggerMinute,
        repeats: true,
        ...(Platform.OS === 'android' && { 
          channelId: NOTIFICATION_CHANNEL_ID,
          exact: true 
        }),
      };
    }

    // TEMPORARY LOG: Silinecek
    console.log(`[Notification] Scheduled: ${medicationName} at ${triggerHour}:${triggerMinute} (Exact: true, Repeats: true)`);

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: '💊 İlaç Vakti Yaklaşıyor!',
        body: `${medicationName} (${dosage}) için ${NOTIFICATION_LEAD_MINUTES} dakika kaldı.`,
        data: { medicationId },
        // sound: 'default' string olarak — true geçersiz
        sound: 'default',
        sticky: false,
        priority: 'max',
      },
      trigger,
    });

    return identifier;
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
  autoMarkMissedAsTaken: boolean,
  lang: 'tr' | 'en' = 'tr'
): Promise<void> => {
  if (!Notifications) return;

  // Önceki gün sonu bildirimlerini iptal et
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.content.data?.notifType === END_OF_DAY_NOTIF_DATA_KEY) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch (_err) { /* no-op */ }

  // autoMarkMissedAsTaken=true ise bildirim gerekmez
  if (autoMarkMissedAsTaken) return;

  const state = useStore.getState();
  if (!state.notificationsEnabled) return;

  await ensureAndroidChannel();

  // Sessiz saat başlangıcından 5 dk öncesi
  let totalMinutes = quietHoursStart * 60 - END_OF_DAY_LEAD_MINUTES;
  if (totalMinutes < 0) totalMinutes += 24 * 60;

  const triggerHour = Math.floor(totalMinutes / 60);
  const triggerMinute = totalMinutes % 60;

  const title = lang === 'tr' ? '⏰ Unutmayın!' : '⏰ Reminder!';
  const body = lang === 'tr'
    ? 'Bugün içinde alınmamış ilaçlarınız var. Sessiz saatler başlamadan önce kontrol edin.'
    : 'You have medications you have not marked today. Check before quiet hours begin.';

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { notifType: END_OF_DAY_NOTIF_DATA_KEY },
        sound: 'default',
        priority: 'max',
      },
      trigger: {
        hour: triggerHour,
        minute: triggerMinute,
        repeats: true,
        ...(Platform.OS === 'android' && { 
          channelId: NOTIFICATION_CHANNEL_ID,
          exact: true 
        }),
      },
    });
  } catch (_err) {
    // Bildirim zamanlama hatası
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
