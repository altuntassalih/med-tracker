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

  console.log('[Notification] SchedulableTriggerInputTypes:', JSON.stringify(SchedulableTriggerInputTypes));

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (err) {
  console.log('[Notification] expo-notifications yüklenemedi:', err);
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
    console.log('[Notification] Android kanal oluşturuldu/güncellendi.');
  } catch (err) {
    console.log('[Notification] Kanal oluşturma hatası:', err);
  }
};

// ---- İzin isteme ----
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!Notifications) return false;

  try {
    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    console.log('[Notification] Mevcut izin durumu:', existingStatus);

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
      console.log('[Notification] İzin istendi, yeni durum:', finalStatus);
    }

    return finalStatus === 'granted';
  } catch (err) {
    console.log('[Notification] İzin isteme hatası:', err);
    return false;
  }
};

/**
 * Mevcut zamanlanmış bildirimleri konsola listeler — debug amaçlı.
 */
export const listScheduledNotifications = async (): Promise<void> => {
  if (!Notifications) {
    console.log('[Notification] Debug: Notifications modülü yok.');
    return;
  }
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    console.log(`[Notification] Debug: ${scheduled.length} bildirim zamanlanmış.`);
    scheduled.forEach((n: any, i: number) => {
      console.log(
        `[Notification] #${i + 1} id=${n.identifier} trigger=${JSON.stringify(n.trigger)} title="${n.content?.title}"`
      );
    });
  } catch (err) {
    console.log('[Notification] Debug listele hatası:', err);
  }
};

/**
 * İlaç vakti için bildirim zamanlar.
 *
 * SDK 0.32 / Android uyumlu trigger tipleri:
 *  - Günlük: DAILY  (hour + minute)
 *  - Haftalık: WEEKLY (weekday + hour + minute)
 *
 * NOT: 'calendar' tipi Android'de desteklenmez — "Trigger of type: calendar
 * is not supported on Android" hatasına yol açar ve bildirim hiç gelmez.
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

    if (isNaN(originalHour) || isNaN(originalMinute)) {
      console.log(`[Notification] Geçersiz saat formatı: "${time}"`);
      return 'error';
    }

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
      console.log(`[Notification] Atlandı: ${triggerHour}:${triggerMinute} sessiz saatte (${quietStartH}:${quietStartM} - ${quietEndH}:${quietEndM})`);
      return 'quiet_hours';
    }

    // Bu ilacın bu vakti için BENZERSIZ identifier
    const identifierStr = `med-${medicationId}-${time.replace(':', '')}`;

    // Önce aynı kimlikli varsa iptal et
    try { await Notifications.cancelScheduledNotificationAsync(identifierStr); } catch (_e) {}

    let trigger: any;

    if (intervalDays === 7) {
      // Haftalık: startDate'den weekday hesapla
      // JS getDay(): 0=Pazar...6=Cumartesi → Expo WEEKLY weekday: 1=Pazar...7=Cumartesi
      const startD = new Date(startDate + 'T12:00:00');
      const jsWeekday = startD.getDay();
      const expoWeekday = jsWeekday === 0 ? 1 : jsWeekday + 1;

      const weeklyType = SchedulableTriggerInputTypes?.WEEKLY ?? 'weekly';
      trigger = {
        type: weeklyType,
        weekday: expoWeekday,
        hour: triggerHour,
        minute: triggerMinute,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      };
      console.log(`[Notification] Haftalık trigger: weekday=${expoWeekday} ${triggerHour}:${String(triggerMinute).padStart(2, '0')} (type=${weeklyType})`);
    } else {
      // Günlük (her gün veya her N günde bir — N>1 için günlük zamanlayıp runtime'da skip)
      const dailyType = SchedulableTriggerInputTypes?.DAILY ?? 'daily';
      trigger = {
        type: dailyType,
        hour: triggerHour,
        minute: triggerMinute,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      };
      console.log(`[Notification] Günlük trigger: ${triggerHour}:${String(triggerMinute).padStart(2, '0')} (type=${dailyType})`);
    }

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

    console.log(`[Notification] ✅ Zamanlandı: ${medicationName} @ ilaç=${time}, bildirim=${triggerHour}:${String(triggerMinute).padStart(2, '0')}`);

    // İlaç eklendiğinde 5 dk veya daha az vakit kaldıysa ANINDA BİLDİRİM
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
        trigger: {
          type: timeIntervalType,
          seconds: 2,
          repeats: false,
          ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
        },
      });
      console.log(`[Notification] ⚡ Acil bildirim: ${minutesLeft} dakika kaldı.`);
    }

    return identifierStr;
  } catch (err) {
    console.log('[Notification] ❌ Zamanlama hatası:', err);
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
  } catch (err) {
    console.log('[Notification] İptal hatası:', err);
  }
};

export const cancelAllNotifications = async (): Promise<void> => {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    console.log('[Notification] Tüm bildirimler iptal edildi.');
  } catch (err) {
    console.log('[Notification] Tüm iptal hatası:', err);
  }
};

/**
 * 23:59'da günlük "alınmamış ilaç" bildirimi zamanlar.
 * autoMarkMissedAsTaken=true ise bildirim zamanlanmaz.
 *
 * DAILY trigger kullanılır — Android'de calendar trigger çalışmaz.
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

  const title = lang === 'tr' ? '⏰ Unutmayın!' : '⏰ Reminder!';
  const body = lang === 'tr'
    ? 'Bugün içinde henüz işaretlenmemiş ilaçlarınız var. Lütfen kontrol edin.'
    : 'You have medications you have not marked today. Please check.';

  try {
    const dailyType = SchedulableTriggerInputTypes?.DAILY ?? 'daily';

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
        type: dailyType,
        hour: END_OF_DAY_HOUR,
        minute: END_OF_DAY_MINUTE,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      },
    });

    console.log(`[Notification] ✅ Gün sonu bildirimi zamanlandı: ${END_OF_DAY_HOUR}:${END_OF_DAY_MINUTE} (type=${dailyType})`);
  } catch (err) {
    console.log('[Notification] ❌ Gün sonu zamanlama hatası:', err);
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
      console.log('[Notification] Gün sonu bildirimi iptal edildi — tüm ilaçlar alındı.');
    } catch (_err) { /* no-op */ }
  } else {
    console.log(`[Notification] Gün sonu bildirimi korunuyor — ${medications.length} ilaçtan alınmamış var.`);
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

    console.log('[Notification] Test bildirimi zamanlandı (5s).');
  } catch (err) {
    console.log('[Notification] Test zamanlama hatası:', err);
  }
};
