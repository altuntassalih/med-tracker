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
/**
 * Bir ilacın startDate ve intervalDays değerine göre bugünden itibaren
 * gelecek olan ilk N alım tarihini hesaplar.
 * Eğer bir alım saati bugün henüz geçmediyse bugünü de dahil eder.
 */
const getNextNOccurrences = (
  startDate: string,
  intervalDays: number,
  timeHour: number,
  timeMinute: number,
  count: number
): Date[] => {
  const occurrences: Date[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const now = new Date();

  // Bugünden başla ve gelecek tarihlere bak
  let currentMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (currentMidnight < start) {
    currentMidnight = new Date(start);
  }

  // Güvenlik sınırı: sonsuz döngüyü engellemek için maks 1000 gün ilerle
  let daysLimit = 1000;
  while (occurrences.length < count && daysLimit > 0) {
    const daysSinceStart = Math.floor(
      (currentMidnight.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceStart >= 0 && daysSinceStart % intervalDays === 0) {
      const occurrenceTime = new Date(currentMidnight);
      occurrenceTime.setHours(timeHour, timeMinute, 0, 0);

      // Gelecekte bir zaman mı?
      if (occurrenceTime.getTime() > now.getTime()) {
        occurrences.push(occurrenceTime);
      }
    }

    // Sonraki güne geç
    currentMidnight.setDate(currentMidnight.getDate() + 1);
    daysLimit--;
  }

  return occurrences;
};

/**
 * İlaç vakti için bildirim zamanlar.
 *
 * Sınırlı sayıda (5 adet) bir sonraki alım vaktini one-time trigger olarak zamanlar.
 * Bu sayede "önceden alındı" olarak işaretlenen günlerin bildirimleri otomatik atlanabilir.
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

    const med = state.medications.find(m => m.id === medicationId);

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

    const title = med?.type === 'vaccine'
      ? (lang === 'tr' ? '🛡️ Aşı Zamanı!' : '🛡️ Vaccine Time!')
      : (lang === 'tr' ? '💊 İlaç Zamanı!' : '💊 Medication Time!');
      
    const profile = med ? state.profiles.find(p => p.id === med.profileId) : null;
    const profileName = profile ? profile.name : '';

    // Aşı ise çoklu tarihleri tek seferlik DATE trigger'ları olarak planla
    if (med?.type === 'vaccine') {
      await cancelMedicationNotifications(medicationId);
      const vaccineBody = lang === 'tr'
        ? (profileName ? `${profileName} için ` : '') + `${medicationName} zamanı.`
        : `Time for ${medicationName}` + (profileName ? ` for ${profileName}.` : '.');

      if (med.dates && med.dates.length > 0) {
        for (const dateStr of med.dates) {
          const [y, mon, dVal] = dateStr.split('-').map(Number);
          const targetDate = new Date(y, mon - 1, dVal, triggerHour, triggerMinute, 0, 0);
          if (targetDate.getTime() > Date.now()) {
            const dateIdentifier = `med-${medicationId}-${dateStr}-${time.replace(':', '')}`;
            await scheduleOneTimeNotification(dateIdentifier, title, vaccineBody, targetDate, medicationId);
          }
        }
      }
      return 'vaccines_scheduled';
    }

    const body = lang === 'tr'
      ? (profileName ? `${profileName} için ` : '') + `${medicationName} (${dosage}) alma zamanı.`
      : `Time to take ${medicationName} (${dosage})` + (profileName ? ` for ${profileName}.` : '.');

    // Gelecekteki ilk 5 alım vakti için one-time bildirim zamanla
    const occurrences = getNextNOccurrences(startDate, intervalDays, triggerHour, triggerMinute, 5);

    for (const occurrenceDate of occurrences) {
      const year = occurrenceDate.getFullYear();
      const month = (occurrenceDate.getMonth() + 1).toString().padStart(2, '0');
      const day = occurrenceDate.getDate().toString().padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      // Bu tarih için ilaç zaten alınmış mı kontrol et
      const isTaken = state.medicationLogs?.some((l) =>
        l.medicationId === medicationId &&
        l.expectedTime === time &&
        (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr))) &&
        l.status === 'taken'
      );

      if (isTaken) {
        continue;
      }

      const dateIdentifier = `med-${medicationId}-${time.replace(':', '')}-${dateStr}`;
      await scheduleOneTimeNotification(dateIdentifier, title, body, occurrenceDate, medicationId);
    }

    return `med-${medicationId}-${time.replace(':', '')}`;
  } catch (_err) {
    return 'error';
  }
};

/**
 * İlaç alındıktan sonra bildirimleri yeniden zamanlar.
 * İlaç "alındı" durumuna geçtiği için bugünün kalan bildirimi iptal edilir ve sonraki günler zamanlanır.
 */
export const rescheduleIntervalNotificationAfterTake = async (
  medicationId: string,
  medicationName: string,
  dosage: string,
  time: string,
  lang: 'tr' | 'en',
  intervalDays: number,
  newStartDate: string
): Promise<void> => {
  if (!Notifications) return;

  const state = useStore.getState();
  if (!state.notificationsEnabled) return;

  const med = state.medications.find(m => m.id === medicationId);
  if (!med) return;

  // İlacın tüm bildirimlerini iptal edip yeniden zamanlayarak
  // "alınmış" olan günleri otomatik olarak atlamasını sağlıyoruz.
  await cancelMedicationNotifications(medicationId);
  for (const t of (med.times || [])) {
    await scheduleMedicationNotification(
      med.id,
      med.name,
      med.dosage,
      t,
      lang,
      med.intervalDays || 1,
      med.startDate
    );
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
    if (med.type === 'vaccine') {
      if (!med.dates || !med.dates.includes(todayStr)) return;
    } else if (med.intervalDays && med.intervalDays > 1) {
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

export const triggerCriticalStockNotification = async (
  medicationName: string,
  remainingStock: number,
  lang: 'tr' | 'en' = 'tr'
): Promise<void> => {
  if (!Notifications) return;

  const state = useStore.getState();
  if (!state.notificationsEnabled) return;

  await ensureAndroidChannel();

  const title = lang === 'tr' ? '⚠️ Kritik Stok Uyarısı!' : '⚠️ Critical Stock Warning!';
  const body = lang === 'tr'
    ? `"${medicationName}" ilacı için kalan stok ${remainingStock} adettir! Lütfen tedarik edin.`
    : `Remaining stock for "${medicationName}" is ${remainingStock} units! Please refill.`;

  try {
    const timeIntervalType = SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval';
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        priority: 'max',
        data: { type: 'stock-warning', remainingStock },
      },
      trigger: {
        type: timeIntervalType,
        seconds: 1,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
      },
    });
  } catch (_err) { /* no-op */ }
};

