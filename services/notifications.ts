import { Platform } from 'react-native';
import { useStore } from '../store/useStore';

// Sabitler
const NOTIFICATION_LEAD_MINUTES = 5;
const NOTIFICATION_CHANNEL_ID = 'med-tracker-default';

let Notifications: any = null;

try {
  Notifications = require('expo-notifications');
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
  // Bildirim handler yüklenemedi
}

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!Notifications) return false;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
        name: 'İlaç Hatırlatıcı',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6C63FF',
        sound: 'default',
      });
    }
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Verilen saat (HH:MM) için NOTIFICATION_LEAD_MINUTES dk öncesine bildirim zamanlar.
 * Expo'nun `type: 'daily'` tetikleyicisini kullanır — bu en güvenilir yaklaşımdır.
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
    const [originalHour, originalMinute] = time.split(':').map(Number);

    // İlaç saatinden NOTIFICATION_LEAD_MINUTES dk öncesini dakika cinsinden hesapla
    let totalMinutes = originalHour * 60 + originalMinute - NOTIFICATION_LEAD_MINUTES;

    // Gece yarısı geçişi: negatifse bir gün öncesinin sonuna al (23:55 gibi)
    if (totalMinutes < 0) {
      totalMinutes += 24 * 60;
    }

    const triggerHour = Math.floor(totalMinutes / 60);
    const triggerMinute = totalMinutes % 60;

    // Sessiz saat kontrolü — tetikleyici saat üzerinden kontrol et
    const quietStart = state.quietHoursStart;
    const quietEnd = state.quietHoursEnd;
    let isQuiet = false;

    if (quietStart < quietEnd) {
      // Örn: 23:00 - 07:00 gibi gece yarısı geçişi YOK
      if (triggerHour >= quietStart && triggerHour < quietEnd) isQuiet = true;
    } else if (quietStart > quietEnd) {
      // Örn: 23:00 - 07:00: gece yarısı geçişi VAR
      if (triggerHour >= quietStart || triggerHour < quietEnd) isQuiet = true;
    }

    if (isQuiet) return 'quiet_hours';

    // Expo SDK 50+ için doğru trigger formatı: `type: 'daily'`
    let trigger: any = {
      type: 'daily',
      hour: triggerHour,
      minute: triggerMinute,
    };

    // Haftalık tekrar için weekday bazlı tetikleyici
    if (intervalDays === 7) {
      const startD = new Date(startDate + 'T12:00:00'); // Saat dilimi hatalarını önlemek için öğlen
      // expo-notifications weekday: 1 = Pazar, 2 = Pazartesi ... 7 = Cumartesi
      const weekday = startD.getDay() + 1;
      trigger = {
        type: 'weekly',
        weekday,
        hour: triggerHour,
        minute: triggerMinute,
      };
    }

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: '💊 İlaç Vakti Yaklaşıyor!',
        body: `${medicationName} (${dosage}) için ${NOTIFICATION_LEAD_MINUTES} dakika kaldı.`,
        data: { medicationId },
        sound: true,
        ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
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
  } catch (err) {
    // Bildirim silme hatası
  }
};

export const cancelAllNotifications = async (): Promise<void> => {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    // Tüm bildirimleri silme hatası
  }
};
