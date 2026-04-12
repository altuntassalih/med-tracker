import { Platform } from 'react-native';
import { useStore } from '../store/useStore';

// ---- Sabitler ----
const NOTIFICATION_LEAD_MINUTES = 5;
const NOTIFICATION_CHANNEL_ID = 'med-tracker-default';
const END_OF_DAY_NOTIF_DATA_KEY = 'end-of-day-missed-notif';
// Gün sonu bildirimi saati: 23:59 — alınmayan ilaçlar için kritik hatırlatıcı
// Not: quiet hours kontrolü bu bildirimde uygulanmaz
const END_OF_DAY_HOUR = 23;
const END_OF_DAY_MINUTE = 59;

// ---- expo-notifications dinamik import ----
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
    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        android: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowAnnouncements: true,
        },
      });
      finalStatus = status;
    }

    // Android 12+ için SCHEDULE_EXACT_ALARM izni
    if (Platform.OS === 'android' && Notifications.requestPermissionsAsync) {
      try {
        // Exact alarm izni ayrıca istenmeli (Android 12+)
        await Notifications.requestPermissionsAsync({
          android: { allowAlert: true, allowBadge: true, allowSound: true },
        });
      } catch (_e) { /* no-op */ }
    }

    return finalStatus === 'granted';
  } catch (_err) {
    return false;
  }
};

/**
 * SDK 54 için doğru trigger tipi:
 *   - Günlük tekrar: SchedulableTriggerInputTypes.CALENDAR (type: 'calendar') + hour + minute + repeats: true
 *   - Anında/aralıklı: SchedulableTriggerInputTypes.TIME_INTERVAL (type: 'timeInterval') + seconds
 *
 * İlaç vaktinden NOTIFICATION_LEAD_MINUTES dk önce günlük bildirim zamanlar.
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

    // Sessiz saat kontrolü
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
      console.log(`[Notification] Skip: Trigger ${triggerHour}:${triggerMinute} in Quiet Hours (${quietStartH}:${quietStartM} - ${quietEndH}:${quietEndM})`);
      return 'quiet_hours';
    }

    // Bu ilacın bu vakti için BENZERSIZ identifier
    const identifierStr = `med-${medicationId}-${time.replace(':', '')}`;

    // SDK 54 doğru trigger — CALENDAR tipi günlük tekrar için
    // Haftalık için sadece 'daily' type ile weekday desteklenmez, ayrı planla
    const calendarTriggerType = SchedulableTriggerInputTypes?.CALENDAR ?? 'calendar';

    let trigger: any;

    if (intervalDays === 7) {
      // Haftalık: startDate'den weekday hesapla
      // Not: JS getDay() — 0=Pazar...6=Cumartesi; Expo weekday: 1=Pazar...7=Cumartesi
      const startD = new Date(startDate + 'T12:00:00');
      const jsWeekday = startD.getDay(); // 0-6
      const expoWeekday = jsWeekday === 0 ? 1 : jsWeekday + 1; // Expo formatı (1=Pazar)

      trigger = {
        type: calendarTriggerType,
        weekday: expoWeekday,
        hour: triggerHour,
        minute: triggerMinute,
        second: 0, // SDK 54: second belirtilmeli
        repeats: true,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      };
    } else {
      // Günlük (intervalDays=1) veya diğer aralıklar için günlük bildirim
      trigger = {
        type: calendarTriggerType,
        hour: triggerHour,
        minute: triggerMinute,
        second: 0, // SDK 54: second belirtilmeli
        repeats: true,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      };
    }

    // Önce aynı kimlikli varsa iptal et
    try { await Notifications.cancelScheduledNotificationAsync(identifierStr); } catch (_e) {}

    await Notifications.scheduleNotificationAsync({
      identifier: identifierStr,
      content: {
        title: lang === 'tr' ? '💊 İlaç Vakti Yaklaşıyor!' : '💊 Medication Time Approaching!',
        body: lang === 'tr'
          ? `${medicationName} (${dosage}) için ${NOTIFICATION_LEAD_MINUTES} dakika kaldı.`
          : `${NOTIFICATION_LEAD_MINUTES} minutes left for ${medicationName} (${dosage}).`,
        data: { medicationId, type: 'med-warning' },
        sound: 'default',
        priority: 'max',
      },
      trigger,
    });

    console.log(`[Notification] Scheduled daily: ${medicationName} @ ${triggerHour}:${String(triggerMinute).padStart(2,'0')} (med time: ${time})`);

    // İlaç eklendiğinde/güncellendiğinde 5 dk veya daha az vakit kaldıysa ANINDA BİLDİRİM
    const now = new Date();
    const currentTotalMin = now.getHours() * 60 + now.getMinutes();
    const targetMedTotalMin = originalHour * 60 + originalMinute;

    let minutesLeft = targetMedTotalMin - currentTotalMin;
    if (minutesLeft < 0) minutesLeft += 24 * 60;

    if (minutesLeft > 0 && minutesLeft <= NOTIFICATION_LEAD_MINUTES) {
      const timeIntervalType = SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval';
      const immediateIdentifier = `med-immed-${medicationId}-${time.replace(':', '')}`;
      try { await Notifications.cancelScheduledNotificationAsync(immediateIdentifier); } catch (_e) {}

      await Notifications.scheduleNotificationAsync({
        identifier: immediateIdentifier,
        content: {
          title: lang === 'tr' ? '🚨 Az Önce Kuruldu!' : '🚨 Scheduled Just Now!',
          body: lang === 'tr'
            ? `${medicationName} (${dosage}) alımınıza ${minutesLeft} dakika kaldı!`
            : `Only ${minutesLeft} minutes left for ${medicationName} (${dosage})!`,
          data: { medicationId },
          sound: 'default',
          priority: 'max',
        },
        // SDK 54: null trigger geçersiz, 2 saniye sonra at
        trigger: {
          type: timeIntervalType,
          seconds: 2,
          repeats: false,
          ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
        },
      });
    }

    return identifierStr;
  } catch (err) {
    console.log('[Notification] Schedule error:', err);
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
 * 23:59'da günlük "alınmamış ilaç" bildirimi zamanlar.
 * autoMarkMissedAsTaken=true ise bildirim zamanlanmaz.
 *
 * SDK 54: CALENDAR trigger type kullanılmalı.
 */
export const scheduleEndOfDayMissedNotification = async (
  quietHoursStart: number,
  quietHoursStartMinute: number,
  autoMarkMissedAsTaken: boolean,
  lang: 'tr' | 'en' = 'tr'
): Promise<void> => {
  if (!Notifications) return;

  // Önceki gün sonu bildirimini iptal et
  try {
    await Notifications.cancelScheduledNotificationAsync(END_OF_DAY_NOTIF_DATA_KEY);
  } catch (_err) { /* no-op */ }

  if (autoMarkMissedAsTaken) return;

  const state = useStore.getState();
  if (!state.notificationsEnabled) return;

  await ensureAndroidChannel();

  // Gün sonu bildirimi SABİT saat olarak tanımlandı (sessiz saati bypass eder)
  // END_OF_DAY_HOUR:END_OF_DAY_MINUTE — genellikle 22:00
  // Not: 23:59 varsayılan sessiz saat aralığına (23:00-07:00) girdiğinden
  // ilaç hatırlatıcısını 22:00'de gönderiyoruz.
  const targetHour = END_OF_DAY_HOUR;
  const targetMinute = END_OF_DAY_MINUTE;

  const title = lang === 'tr' ? '⏰ Unutmayın!' : '⏰ Reminder!';
  const body = lang === 'tr'
    ? 'Bugün içinde henüz işaretlenmemiş ilaçlarınız var. Lütfen kontrol edin.'
    : 'You have medications you have not marked today. Please check.';

  try {
    const calendarTriggerType = SchedulableTriggerInputTypes?.CALENDAR ?? 'calendar';

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
        type: calendarTriggerType,
        hour: targetHour,
        minute: targetMinute,
        second: 0, // SDK 54: second belirtilmeli
        repeats: true,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      },
    });

    console.log(`[Notification] EndOfDay scheduled at ${targetHour}:${targetMinute} (type: ${calendarTriggerType})`);
  } catch (err) {
    console.log('[Notification] EndOfDay schedule error:', err);
  }
};

/**
 * Güncel state'i kontrol eder, alınmamış ilaç YOKSA 23:59 bildirimini iptal eder,
 * varsa yeniden planlar.
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

  let hasUntaken = false;

  const medications = (state.medications || []).filter(m => m.profileId === state.activeProfileId && m.isActive !== false);
  const logs = (state.medicationLogs || []).filter(l => l.profileId === state.activeProfileId);

  medications.forEach((med) => {
    // Aralık kontrolü
    if (med.intervalDays && med.intervalDays > 1) {
      const start = new Date(med.startDate).setHours(0, 0, 0, 0);
      const today = new Date().setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
      if (daysDiff % med.intervalDays !== 0) return;
    }

    (med.times || []).forEach((time) => {
      const isTakenToday = logs.some((l) =>
        l.medicationId === med.id &&
        l.expectedTime === time &&
        (l.scheduledDate === todayStr || (!l.scheduledDate && l.takenAt.startsWith(todayStr))) &&
        l.status === 'taken'
      );

      if (!isTakenToday) {
        hasUntaken = true;
      }
    });
  });

  if (!hasUntaken) {
    if (!Notifications) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(END_OF_DAY_NOTIF_DATA_KEY);
      console.log('[Notification] EndOfDay cancelled — all meds taken.');
    } catch (_err) { /* no-op */ }
  } else {
    scheduleEndOfDayMissedNotification(
      state.quietHoursStart,
      state.quietHoursStartMinute,
      state.autoMarkMissedAsTaken,
      lang
    );
  }
};

/**
 * Test amaçlı: 5 saniye sonra bildirim gönderir.
 */
export const scheduleTestNotification = async (): Promise<void> => {
  if (!Notifications) return;
  await ensureAndroidChannel();
  try {
    const timeIntervalType = SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✅ Bildirim Testi',
        body: 'Med-Tracker bildirimleri çalışıyor!',
        sound: 'default',
        data: { test: true },
      },
      trigger: {
        type: timeIntervalType,
        seconds: 5,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      },
    });

    console.log('[Notification] Test notification scheduled (5s).');
  } catch (err) {
    console.log('[Notification] Test schedule error:', err);
  }
};
