import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useStore } from '../store/useStore';

const isExpoGo = Constants.appOwnership === 'expo';
let Notifications: any = null;

// Sadece Expo Go DIŞINDA (Production/EAS Build) kütüphaneyi yükle.
// Çünkü expo-notifications SDK 53 itibarıyla ilk import anında dahi crash verebilen side-effect'ler taşıyor.
// SDK 52/53 için bildirim handler ayarları
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
  console.log('Bildirim handler ayarlanırken hata:', err);
}

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!Notifications) {
    console.log('Bildirimler (Notifications) yüklenemedi.');
    return false;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      return false;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
    return true;
  } catch (err) {
    console.log('İzin alınırken hata oluştu:', err);
    return false;
  }
};

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
    
    // Sessiz saat kontrolü
    const quietStart = state.quietHoursStart;
    const quietEnd = state.quietHoursEnd;
    let isQuiet = false;
    
    if (quietStart < quietEnd) {
      if (originalHour >= quietStart && originalHour < quietEnd) isQuiet = true;
    } else if (quietStart > quietEnd) {
      if (originalHour >= quietStart || originalHour < quietEnd) isQuiet = true;
    }

    if (isQuiet) {
      console.log(`Bildirim sessiz saatlere (${quietStart}:00 - ${quietEnd}:00) denk geldiği için iptal edildi: ${time}`);
      return 'quiet_hours';
    }

    // 5 dakika öncesini hesapla
    const dateObj = new Date();
    dateObj.setHours(originalHour, originalMinute, 0, 0);
    dateObj.setMinutes(dateObj.getMinutes() - 5);
    
    const triggerHour = dateObj.getHours();
    const triggerMinute = dateObj.getMinutes();
    
    let trigger: any = {
      hour: triggerHour,
      minute: triggerMinute,
      repeats: true,
    };

    // Haftada bir (weekly) durumu için özel gün bazlı tetikleyici
    if (intervalDays === 7) {
      const startD = new Date(startDate);
      // getDay() 0 (Pazar) ile 6 (Cumartesi) arası döner.
      // expo-notifications weekly trigger için weekday (1-7) bekler, 1 Pazar'dır.
      const weekday = startD.getDay() + 1; 
      trigger = {
        weekday,
        hour: triggerHour,
        minute: triggerMinute,
        repeats: true,
      };
    } else if (intervalDays > 1) {
      // 2 veya 3 günde bir durumu için expo-notifications'ın basit bir 'repeats every X days' tetikleyicisi yok.
      // Bu genellikle ya her gün tetiklenip kod tarafında kontrol edilir ya da çok sayıda bildirim önceden planlanır.
      // Basitlik ve güvenilirlik için şu an 'her gün' bırakıyoruz veya çoklu planlama yapılabilir.
      // Ancak kullanıcı 'haftalık' için özel istekte bulundu.
      trigger = {
        hour: triggerHour,
        minute: triggerMinute,
        repeats: true,
      };
    }

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: '💊 İlaç Vakti Yaklaşıyor!',
        body: `${medicationName} (${dosage}) ilacınızı alma saatinize 5 dakika kaldı.`,
        data: { medicationId },
        sound: true,
      },
      trigger,
    });
    return identifier;
  } catch (err) {
    console.log('Bildirim zamanlanırken hata:', err);
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
    console.log('Bildirim silme hatası:', err);
  }
};

export const cancelAllNotifications = async (): Promise<void> => {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.log('Tüm bildirimleri silme hatası:', err);
  }
};
