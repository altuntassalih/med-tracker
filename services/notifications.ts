import { Platform } from 'react-native';
import { useStore } from '../store/useStore';

// ---- Sabitler ----
const NOTIFICATION_LEAD_MINUTES = 0; // Tam saatinde bildirim gönder
const NOTIFICATION_CHANNEL_ID = 'med-tracker-default';
const END_OF_DAY_NOTIF_DATA_KEY = 'end-of-day-missed-notif';
// Gün sonu bildirimi saati: 23:59 — alınmayan ilaçlar için kritik hatırlatıcı
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
} catch (err) {
  // expo-notifications yüklenemedi
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
  } catch (_err) { /* no-op */ }
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

    return finalStatus === 'granted';
  } catch (_err) {
    return false;
  }
};

/**
 * Belirli bir tarih+saat için tek seferlik bildirim zamanlar (DATE trigger).
 * Periyodik ilaçlar (intervalDays > 1) için kullanılır.
 * İlaç alındığında / uygulama açıldığında sonraki tarih için yeniden çağrılır.
 */
const scheduleOneTimeNotification = async (
  identifier: string,
  title: string,
  body: string,
  targetDate: Date,
  medicationId: string
): Promise<void> => {
  if (!Notifications) return;

  // Geçmişe zamanlanmayı önle
  if (targetDate.getTime() <= Date.now()) return;

  await ensureAndroidChannel();

  // Önce varsa iptal et
  try { await Notifications.cancelScheduledNotificationAsync(identifier); } catch (_e) {}

  const dateType = SchedulableTriggerInputTypes?.DATE ?? 'date';

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title,
      body,
      data: { medicationId, type: 'med-warning' },
      sound: 'default',
      priority: 'max',
    },
    trigger: {
      type: dateType,
      date: targetDate,
      ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
    },
  });
};

/**
 * Periyodik ilaç (intervalDays > 1) için startDate'e göre
 * sonraki geçerli alım tarih+saatini döner.
 * Eğer bugün geçerli alım günü ise bugün olarak döner.
 */
const getNextIntervalDate = (
  startDate: string,
  intervalDays: number,
  timeHour: number,
  timeMinute: number
): Date => {
  const start = new Date(startDate + 'T00:00:00');
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const daysSinceStart = Math.floor(
    (todayMidnight.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Bugün geçerli alım günü mü?
  const remainder = daysSinceStart >= 0 ? daysSinceStart % intervalDays : -1;

  let nextDate: Date;

  if (remainder === 0) {
    // Bugün geçerli gün — ilaç saatini kontrol et
    const todayTrigger = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), timeHour, timeMinute, 0, 0
    );
    if (todayTrigger.getTime() > now.getTime()) {
      nextDate = todayTrigger;
    } else {
      // Bugün geçti, sonraki cycle
      const daysToNext = intervalDays;
      nextDate = new Date(todayMidnight.getTime() + daysToNext * 24 * 60 * 60 * 1000);
      nextDate.setHours(timeHour, timeMinute, 0, 0);
    }
  } else {
    // Bugün geçerli gün değil — sonraki geçerli güne kaç gün var?
    const daysToNext = remainder >= 0 ? intervalDays - remainder : intervalDays - (daysSinceStart % intervalDays);
    nextDate = new Date(todayMidnight.getTime() + daysToNext * 24 * 60 * 60 * 1000);
    nextDate.setHours(timeHour, timeMinute, 0, 0);
  }

  return nextDate;
};

/**
 * İlaç vakti için bildirim zamanlar.
 *
 * - intervalDays === 1 veya 7: DAILY / WEEKLY trigger (tekrarlayan)
 * - intervalDays > 1 (2, 3): DATE trigger (tek seferlik — alım sonrası yeniden zamanlanır)
 *
 * NOT: 'calendar' tipi Android'de desteklenmez — "Trigger of type: calendar
 * is not supported on Android" hatasına yol açar ve bildirim hiç gelmez.
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
        if (triggerTotalMin >= quietStartTotalMin || triggerTotalMin < quietEndTotalMin) isQuiet = true;
      }
    }

    if (isQuietEnabled && isQuiet) {
      return 'quiet_hours';
    }

    // Bu ilacın bu vakti için BENZERSIZ identifier
    const identifierStr = `med-${medicationId}-${time.replace(':', '')}`;

    // Önce aynı kimlikli varsa iptal et
    try { await Notifications.cancelScheduledNotificationAsync(identifierStr); } catch (_e) {}

    const title = lang === 'tr' ? '💊 İlaç Zamanı!' : '💊 Medication Time!';
    const body = lang === 'tr'
      ? `${medicationName} (${dosage}) alma zamanı.`
      : `Time to take ${medicationName} (${dosage}).`;

    // --- intervalDays 2 veya 3: Tek seferlik DATE trigger ---
    if (intervalDays > 1 && intervalDays !== 7) {
      const nextDate = getNextIntervalDate(startDate, intervalDays, triggerHour, triggerMinute);
      await scheduleOneTimeNotification(identifierStr, title, body, nextDate, medicationId);
      return identifierStr;
    }

    let trigger: any;

    if (intervalDays === 7) {
      // Haftalık: startDate'den weekday hesapla
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
    } else {
      // Günlük (intervalDays === 1)
      const dailyType = SchedulableTriggerInputTypes?.DAILY ?? 'daily';
      trigger = {
        type: dailyType,
        hour: triggerHour,
        minute: triggerMinute,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      };
    }

    await Notifications.scheduleNotificationAsync({
      identifier: identifierStr,
      content: {
        title,
        body,
        data: { medicationId, type: 'med-warning' },
        sound: 'default',
        priority: 'max',
      },
      trigger,
    });

    return identifierStr;
  } catch (_err) {
    return 'error';
  }
};

/**
 * Periyodik ilaç alındıktan sonra, bir sonraki alım tarihi için
 * bildirimi yeniden zamanlar. (Seçenek B — alım sonrası tetikleme)
 * Sadece intervalDays > 1 && intervalDays !== 7 için geçerlidir.
 */
export const rescheduleIntervalNotificationAfterTake = async (
  medicationId: string,
  medicationName: string,
  dosage: string,
  time: string,
  lang: 'tr' | 'en',
  intervalDays: number,
  newStartDate: string  // Güncellenmiş startDate (periyot değiştiyse yeni tarih)
): Promise<void> => {
  if (!Notifications) return;
  if (intervalDays <= 1 || intervalDays === 7) return;

  const state = useStore.getState();
  if (!state.notificationsEnabled) return;

  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return;

  const identifierStr = `med-${medicationId}-${time.replace(':', '')}`;
  const title = lang === 'tr' ? '💊 İlaç Zamanı!' : '💊 Medication Time!';
  const body = lang === 'tr'
    ? `${medicationName} (${dosage}) alma zamanı.`
    : `Time to take ${medicationName} (${dosage}).`;

  // Alım yapıldığı gün (yani bugün), bir sonraki cycle'a git
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const nextDateMidnight = new Date(todayMidnight.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const nextDate = new Date(nextDateMidnight);
  nextDate.setHours(h, m, 0, 0);

  await scheduleOneTimeNotification(identifierStr, title, body, nextDate, medicationId);
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
  } catch (_err) { /* no-op */ }
};

export const cancelAllNotifications = async (): Promise<void> => {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (_err) { /* no-op */ }
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
  } catch (_err) { /* no-op */ }
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
 * Mevcut zamanlanmış bildirimleri konsola listeler — debug amaçlı.
 */
export const listScheduledNotifications = async (): Promise<void> => {
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    scheduled.forEach((n: any, i: number) => {
      console.log(
        `[Notification] #${i + 1} id=${n.identifier} trigger=${JSON.stringify(n.trigger)} title="${n.content?.title}"`
      );
    });
  } catch (_err) { /* no-op */ }
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
  } catch (_err) { /* no-op */ }
};
