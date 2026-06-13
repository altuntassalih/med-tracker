import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Platform,
  Modal,
  Image,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useStore } from '../../store/useStore';
import { getMedications, Medication, addMedicationLog, MedicationLog, updateMedication, deleteMedicationLog, updateMedicationLog, upsertDailyHealthLog } from '../../services/firestore';
import DateTimePicker from '@react-native-community/datetimepicker';
import { checkAndRefreshEndOfDayNotification, rescheduleIntervalNotificationAfterTake, scheduleMedicationNotification, cancelMedicationNotifications, requestNotificationPermission, triggerCriticalStockNotification } from '../../services/notifications';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, STOCK_THRESHOLD_CRITICAL, STOCK_THRESHOLD_WARNING, STATUS_TAKEN, STATUS_POSTPONED, STATUS_MISSED, STATUS_PENDING, STATUS_OVERDUE, STATUS_UPCOMING, STATUS_FINISHED, GENDER_FEMALE } from '../../constants/AppConstants';
import { t, LanguageCode } from '../../constants/translations';
import { getLocalDateString, formatDate } from '../../utils/date';

const { width } = Dimensions.get('window');

// Eşik sabitleri
const OVERDUE_THRESHOLD_MINUTES = 30;  // 30 dk gecikmeyi "süresi geçti" say
const UPCOMING_WINDOW_MINUTES = 240;   // 240 dk içindekiler "yaklaşan"
// Periyot güncelleme: Beklenen günden kaç gün sapma varsa sorulsun
const PERIOD_SHIFT_TOLERANCE_DAYS = 0;

function getTodayGreeting(lang: LanguageCode): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return t(lang, 'greeting.morning');
  if (hour >= 12 && hour < 18) return t(lang, 'greeting.afternoon');
  if (hour >= 18 && hour < 22) return t(lang, 'greeting.evening');
  return t(lang, 'greeting.night');
}

function getTodayDate(lang: LanguageCode): string {
  const d = new Date();
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

/** Periyodik ilaç için startDate'i bugüne endeksleyen yeni startDate hesaplar */
function computeNewStartDateForPeriod(intervalDays: number): string {
  // Bugünden geriye doğru, intervalDays'in tam katı olacak şekilde en yakın geçerli startDate
  // En basit: bugünü yeni startDate yap (mod 0 = bugün geçerli alım günü)
  return getLocalDateString();
}

/** YYYY-MM-DD formatındaki tarihe gün ekler ve yine YYYY-MM-DD döner */
function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
}

export default function HomeScreen() {
  const {
    user, profiles, activeProfileId, setActiveProfileId,
    medications: allMedications, medicationLogs, addMedicationLogState,
    updateMedication: updateMedInStore, deleteMedicationLogState, language, theme, showAlert,
    dismissedStockWarnings, dismissStockWarning, updateMedicationLogState,
    dailyHealthLogs, showPastWater, showPastSleep, showPastWeight, showPastMood
  } = useStore();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedPickerDate, setSelectedPickerDate] = useState<string | null>(null);
  const [androidMonthView, setAndroidMonthView] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tick, setTick] = useState(0); // Her dakika UI'ı tazeler

  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  
  const medications = (allMedications || []).filter(m => m.profileId === activeProfile?.id);
  const logs = (medicationLogs || []).filter(l => l.profileId === activeProfile?.id);

  const getTranslatedUnit = (u: string) => {
    const lang = language as LanguageCode;
    const translationKey = `medicationOptions.units.${u}`;
    const translated = t(lang, translationKey);
    return translated === translationKey ? u : translated;
  };

  const todayStr = getLocalDateString();
  const yesterdayStr = getLocalDateString(new Date(Date.now() - 86400000));

  const openDatePicker = () => {
    setSelectedPickerDate(selectedDate);
    setAndroidMonthView(new Date(selectedDate + 'T00:00:00'));
    setShowDatePicker(true);
  };

  useFocusEffect(
    useCallback(() => {
      onRefresh();
      checkAndRefreshEndOfDayNotification(language as LanguageCode);
    }, [language])
  );

  // Her 60 saniyede bir UI'ı tazele — ilaç durumu zaman bazlıdır
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Kayıtlar değiştiğinde listeyi tazele (Sync fix)
  useEffect(() => {
    onRefresh();
  }, [medicationLogs.length]);


  /**

   * Periyot güncelleme sorusunu sorar. Kullanıcı onaylarsa
   * medication'ın startDate'ini bugüne endeksler ve bildirimleri yeniden zamanlar.
   */
  const askPeriodReset = (med: Medication) => {
    const lang = language as LanguageCode;
    const intervalLabel = med.intervalDays === 2
      ? (lang === 'tr' ? '2 günde bir' : 'every 2 days')
      : med.intervalDays === 3
        ? (lang === 'tr' ? '3 günde bir' : 'every 3 days')
        : `${med.intervalDays}`;

    const msgTr = `"${med.name}" için alım periyotunuz (${intervalLabel}) bugünle uyuşmuyor. Periyodu bugüne endekslemek ister misiniz?`;
    const msgEn = `Your dosing period (${intervalLabel}) for "${med.name}" doesn't align with today. Would you like to reset the period to today?`;

    showAlert({
      message: lang === 'tr' ? msgTr : msgEn,
      type: 'info',
      buttons: [
        { text: lang === 'tr' ? 'Hayır' : 'No', style: 'cancel' },
        {
          text: lang === 'tr' ? 'Evet, Güncelle' : 'Yes, Update',
          onPress: async () => {
            try {
              const newStartDate = computeNewStartDateForPeriod(med.intervalDays!);
              await updateMedication(med.id, { startDate: newStartDate });
              updateMedInStore(med.id, { startDate: newStartDate });

              // Bildirimleri yeniden zamanla
              const hasPermission = await requestNotificationPermission();
              if (hasPermission) {
                await cancelMedicationNotifications(med.id);
                for (const time of med.times) {
                  await scheduleMedicationNotification(
                    med.id, med.name, med.dosage, time,
                    lang, med.intervalDays!, newStartDate
                  );
                }
              }

              showAlert({
                message: lang === 'tr' ? 'Periyot başarıyla güncellendi.' : 'Period updated successfully.',
                type: 'success',
              });
            } catch (_err) {
              showAlert({
                message: lang === 'tr' ? 'Güncelleme başarısız.' : 'Update failed.',
                type: 'danger',
              });
            }
          },
        },
      ],
    });
  };

  const handleTakeMedication = async (medId: string, time: string, dateStr: string) => {
    if (!activeProfile?.id) return;
    const lang = language as LanguageCode;
    const med = medications.find(m => m.id === medId);
    const intervalDays = med?.intervalDays;
    const isIntervalDrug = intervalDays && intervalDays > 1 && intervalDays !== 7;

    const existingLog = logs.find((l) =>
      l.medicationId === medId &&
      l.expectedTime === time &&
      (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr)))
    );

    if (existingLog) {
      updateMedicationLogState(existingLog.id, { status: 'taken', takenAt: new Date().toISOString() });
      await updateMedicationLog(existingLog.id, { status: 'taken', takenAt: new Date().toISOString() });
    } else {
      const logData: Omit<MedicationLog, 'id' | 'createdAt'> = {
        profileId: activeProfile.id,
        medicationId: medId,
        expectedTime: time,
        takenAt: new Date().toISOString(),
        scheduledDate: dateStr,
        status: 'taken',
      };
      const tempId = 'temp_' + Date.now();
      addMedicationLogState({ id: tempId, ...logData });
      try {
        const newLog = await addMedicationLog(logData);
        updateMedicationLogState(tempId, { id: newLog.id });
      } catch (err) {
        // fail silently or keep local tempId
      }
    }

    // Kritik stok uyarısı kontrolü
    if (med && med.totalQuantity !== undefined) {
      const updatedState = useStore.getState();
      const updatedLogs = updatedState.medicationLogs || [];
      const takenCount = updatedLogs.filter((l: any) => l.medicationId === medId && l.status === 'taken').length;
      const dosageVal = parseFloat(med.dosage || '1');
      const newRemaining = Math.max(0, med.totalQuantity - (takenCount * dosageVal));
      const oldRemaining = newRemaining + dosageVal;

      if (newRemaining <= STOCK_THRESHOLD_CRITICAL && oldRemaining > STOCK_THRESHOLD_CRITICAL) {
        triggerCriticalStockNotification(med.name, STOCK_THRESHOLD_CRITICAL, lang);
      } else if (newRemaining <= STOCK_THRESHOLD_WARNING && oldRemaining > STOCK_THRESHOLD_WARNING) {
        triggerCriticalStockNotification(med.name, STOCK_THRESHOLD_WARNING, lang);
      }
    }

    // Bildirimleri güncelle: alım sonrası bugünün kalan bildirimini iptal et ve sonrakileri zamanla
    if (med) {
      rescheduleIntervalNotificationAfterTake(
        med.id, med.name, med.dosage, time, lang, intervalDays || 1, med.startDate
      );
    }

    checkAndRefreshEndOfDayNotification(lang);

    // Periyot güncelleme sorusu: Sadece alım BUGÜN ise ve bugün o ilacın alım periyodunda değilse sor
    if (isIntervalDrug && med && dateStr === todayStr) {
      const start = new Date(med.startDate + 'T00:00:00');
      const target = new Date(todayStr + 'T00:00:00');
      const daysDiff = Math.floor((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const isAlignedToday = daysDiff >= 0 && daysDiff % intervalDays === 0;

      if (!isAlignedToday) {
        setTimeout(() => askPeriodReset(med), 600);
      }
    }
  };

  const executePostpone = async (med: Medication, time: string, targetStr: string, newStartDate: string, successMessage: string) => {
    if (!activeProfile?.id) return;
    const lang = language as LanguageCode;

    const logData: Omit<MedicationLog, 'id' | 'createdAt'> = {
      profileId: activeProfile.id,
      medicationId: med.id,
      expectedTime: time,
      takenAt: new Date().toISOString(),
      scheduledDate: targetStr,
      status: 'postponed',
    };
    const tempId = 'temp_' + Date.now();
    addMedicationLogState({ id: tempId, ...logData });
    try {
      const newLog = await addMedicationLog(logData);
      updateMedicationLogState(tempId, { id: newLog.id });
    } catch (err) {
      // fail silently
    }

    await updateMedication(med.id, { startDate: newStartDate });
    updateMedInStore(med.id, { startDate: newStartDate });

    const hasPermission = await requestNotificationPermission();
    if (hasPermission) {
      await cancelMedicationNotifications(med.id);
      for (const t of med.times) {
        await scheduleMedicationNotification(
          med.id, med.name, med.dosage, t,
          lang, med.intervalDays || 1, newStartDate
        );
      }
    }

    checkAndRefreshEndOfDayNotification(lang);

    showAlert({
      message: successMessage,
      type: 'success',
    });
  };

  const handlePostpone = async (medId: string, time: string, dateStr: string) => {
    if (!activeProfile?.id) return;
    const lang = language as LanguageCode;

    const med = medications.find(m => m.id === medId);
    if (!med) return;

    const nextDayStr = addDaysToDateString(dateStr, 1);

    // Eğer periyot 1 gün veya belirtilmemişse önce onay sor, sonra yarına ertele
    if (!med.intervalDays || med.intervalDays <= 1) {
      const isVaccine = med.type === 'vaccine';
      const message = lang === 'tr'
        ? `"${med.name}" ${isVaccine ? 'aşısını' : 'ilacını'} yarına ertelemek istediğinizden emin misiniz?`
        : `Are you sure you want to postpone "${med.name}" ${isVaccine ? 'vaccine' : 'medication'} to tomorrow?`;

      showAlert({
        message,
        type: 'warning',
        buttons: [
          { text: t(lang, 'settings.cancel'), style: 'cancel' },
          {
            text: t(lang, 'home.postponeBtn'),
            onPress: () => executePostpone(med, time, dateStr, nextDayStr, t(lang, 'home.postponeSuccess')),
          }
        ]
      });
      return;
    }

    // Periyodik ilaç ise kullanıcıya sor: 1 gün mü yoksa 1 periyot mu?
    const nextPeriodStr = addDaysToDateString(dateStr, med.intervalDays);

    showAlert({
      message: t(lang, 'home.postponeChoose'),
      type: 'info',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        {
          text: t(lang, 'home.postponeNextDay'),
          onPress: () => executePostpone(med, time, dateStr, nextDayStr, t(lang, 'home.postponeSuccess')),
        },
        {
          text: t(lang, 'home.postponeNextPeriod'),
          onPress: () => executePostpone(med, time, dateStr, nextPeriodStr, t(lang, 'home.postponeSuccessPeriod')),
        },
      ],
    });
  };


  const onRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getCalendarMinDate = () => {
    const activeMeds = medications.filter(m => m.profileId === activeProfile?.id);
    if (activeMeds.length === 0) return new Date();
    const dates = activeMeds
      .map(m => m.originalStartDate || m.startDate)
      .filter(Boolean)
      .map(dStr => {
        const [y, m, d] = dStr.split('-').map(Number);
        return new Date(y, m - 1, d);
      });
    if (dates.length === 0) return new Date();
    return new Date(Math.min(...dates.map(d => d.getTime())));
  };

  const calculateSlotsForDay = (targetDateStr: string) => {
    const slots: {
      med: Medication;
      time: string;
      timeMinutes: number;
      status: 'taken' | 'postponed' | 'missed' | 'pending' | 'overdue' | 'upcoming' | 'finished';
      logId?: string;
    }[] = [];

    const now = new Date();
    const isToday = targetDateStr === todayStr;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    medications.forEach((med) => {
      const isCurrentlyActive = med.isActive !== false;
      const startLimit = med.originalStartDate || med.startDate;
      const hasStarted = startLimit <= targetDateStr;
      
      let isScheduledForTargetDate = false;
      if (isCurrentlyActive) {
        isScheduledForTargetDate = hasStarted && (!med.endDate || targetDateStr <= med.endDate);
      } else {
        isScheduledForTargetDate = hasStarted && !!med.endDate && targetDateStr <= med.endDate;
      }

      if (!isScheduledForTargetDate) return;

      let isForDay = false;
      if (med.type === 'vaccine') {
        isForDay = !!med.dates && med.dates.includes(targetDateStr);
      } else {
        if (med.intervalDays && med.intervalDays > 1) {
          const hasLogsForDate = logs.some(
            (l) => l.medicationId === med.id && (l.scheduledDate === targetDateStr || (!l.scheduledDate && l.takenAt.startsWith(targetDateStr)))
          );
          if (hasLogsForDate) {
            isForDay = true;
          } else {
            const start = new Date(med.startDate + 'T00:00:00');
            const origStart = new Date(startLimit + 'T00:00:00');
            const target = new Date(targetDateStr + 'T00:00:00');
            const daysDiffCurrent = Math.floor((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            const daysDiffOrig = Math.floor((target.getTime() - origStart.getTime()) / (1000 * 60 * 60 * 24));
            const isScheduledCurrent = daysDiffCurrent >= 0 && daysDiffCurrent % med.intervalDays === 0;
            const isScheduledOrig = daysDiffOrig >= 0 && daysDiffOrig % med.intervalDays === 0;
            isForDay = isScheduledCurrent || isScheduledOrig;
          }
        } else {
          isForDay = true;
        }
      }

      if (!isForDay) return;

      // Stock simulation for future dates
      const isStockAvailableForSlot: Record<string, boolean> = {};
      if (targetDateStr > todayStr && med.totalQuantity !== undefined && med.type !== 'vaccine') {
        const takenCount = logs.filter((l) => l.medicationId === med.id && l.status === STATUS_TAKEN).length;
        const dosageVal = parseFloat(med.dosage || '1') || 1;
        let simulatedStock = Math.max(0, med.totalQuantity - (takenCount * dosageVal));

        const current = new Date(todayStr + 'T00:00:00');
        const target = new Date(targetDateStr + 'T00:00:00');
        const datesList: string[] = [];
        let safeguard = 0;
        while (current <= target && safeguard < 366) {
          datesList.push(getLocalDateString(current));
          current.setDate(current.getDate() + 1);
          safeguard++;
        }

        datesList.forEach((dateStr) => {
          let isScheduled = false;
          if (startLimit <= dateStr && (!med.endDate || med.endDate >= dateStr)) {
            if (med.intervalDays && med.intervalDays > 1) {
              const start = new Date(med.startDate + 'T00:00:00');
              const origStart = new Date(startLimit + 'T00:00:00');
              const curr = new Date(dateStr + 'T00:00:00');
              const daysDiffCurrent = Math.floor((curr.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              const daysDiffOrig = Math.floor((curr.getTime() - origStart.getTime()) / (1000 * 60 * 60 * 24));
              const isScheduledCurrent = daysDiffCurrent >= 0 && daysDiffCurrent % med.intervalDays === 0;
              const isScheduledOrig = daysDiffOrig >= 0 && daysDiffOrig % med.intervalDays === 0;
              if (isScheduledCurrent || isScheduledOrig) {
                isScheduled = true;
              }
            } else {
              isScheduled = true;
            }
          }

          if (!isScheduled) return;

          const sortedTimes = [...(med.times || [])].sort((a, b) => {
            const [ha, ma] = a.split(':').map(Number);
            const [hb, mb] = b.split(':').map(Number);
            return (ha * 60 + ma) - (hb * 60 + mb);
          });

          sortedTimes.forEach((timeStr) => {
            if (dateStr === todayStr) {
              const log = logs.find((l) => 
                l.medicationId === med.id && 
                l.expectedTime === timeStr && 
                (l.scheduledDate === todayStr || (!l.scheduledDate && l.takenAt.startsWith(todayStr)))
              );
              const isAlreadyTaken = log && log.status === STATUS_TAKEN;
              if (!isAlreadyTaken) {
                simulatedStock -= dosageVal;
              }
            } else if (dateStr === targetDateStr) {
              if (simulatedStock >= dosageVal) {
                isStockAvailableForSlot[timeStr] = true;
                simulatedStock -= dosageVal;
              } else {
                isStockAvailableForSlot[timeStr] = false;
              }
            } else {
              simulatedStock -= dosageVal;
            }
          });
        });
      }

      (med.times || []).forEach((time) => {
        if (targetDateStr > todayStr && med.totalQuantity !== undefined && med.type !== 'vaccine' && isStockAvailableForSlot[time] === false) {
          return;
        }

        const [h, m] = time.split(':').map(Number);
        const timeMinutes = h * 60 + m;

        const log = logs.find((l) => 
          l.medicationId === med.id && 
          l.expectedTime === time && 
          (l.scheduledDate === targetDateStr || (!l.scheduledDate && l.takenAt.startsWith(targetDateStr)))
        );

        let status: 'taken' | 'postponed' | 'missed' | 'pending' | 'overdue' | 'upcoming' | 'finished' = STATUS_PENDING;
        if (log) {
          if (log.status === STATUS_TAKEN) status = STATUS_TAKEN;
          else if (log.status === STATUS_POSTPONED) status = STATUS_POSTPONED;
          else if (log.status === STATUS_MISSED) status = STATUS_MISSED;
        } else {
          if (targetDateStr < todayStr) {
            status = STATUS_MISSED;
          } else if (targetDateStr === todayStr) {
            if (timeMinutes < currentMinutes - OVERDUE_THRESHOLD_MINUTES) {
              status = STATUS_OVERDUE;
            } else if (timeMinutes >= currentMinutes && timeMinutes <= currentMinutes + 120) {
              status = STATUS_UPCOMING;
            } else {
              status = STATUS_PENDING;
            }
          } else {
            status = STATUS_PENDING;
          }
        }

        const isFinishDay = med.isActive === false && med.endDate === targetDateStr;
        if (isFinishDay && status !== STATUS_TAKEN && status !== STATUS_POSTPONED) {
          status = STATUS_FINISHED;
        }

        slots.push({
          med,
          time,
          timeMinutes,
          status,
          logId: log?.id
        });
      });
    });

    return slots.sort((a, b) => {
      const aIsDone = a.status === STATUS_TAKEN || a.status === STATUS_POSTPONED || a.status === STATUS_FINISHED;
      const bIsDone = b.status === STATUS_TAKEN || b.status === STATUS_POSTPONED || b.status === STATUS_FINISHED;

      if (aIsDone && !bIsDone) return 1;
      if (!aIsDone && bIsDone) return -1;
      return a.timeMinutes - b.timeMinutes;
    });
  };

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const getDayName = (date: Date) => {
    const dayIndex = date.getDay();
    const daysTr = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return language === 'tr' ? daysTr[dayIndex] : daysEn[dayIndex];
  };

  const getWeeklyDays = () => {
    const days = [];
    const today = new Date();
    for (let i = -3; i <= 3; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      const dStr = getLocalDateString(d);
      days.push({
        dateStr: dStr,
        dateObj: d,
        dayNum: d.getDate(),
        dayName: getDayName(d),
      });
    }
    return days;
  };

  const daySlots = calculateSlotsForDay(selectedDate);
  const totalSlotsCount = daySlots.length;
  const completedSlotsCount = daySlots.filter((s) => s.status === 'taken').length;
  const pendingSlotsCount = daySlots.filter((s) => s.status === 'pending' || s.status === 'overdue' || s.status === 'upcoming').length;

  const handleUndoAction = async (logId: string) => {
    if (!logId) return;
    const lang = language as LanguageCode;
    const log = logs.find((l) => l.id === logId);
    try {
      deleteMedicationLogState(logId);
      await deleteMedicationLog(logId);
      checkAndRefreshEndOfDayNotification(lang);

      if (log) {
        const med = medications.find((m) => m.id === log.medicationId);
        if (med) {
          await cancelMedicationNotifications(med.id);
          for (const t of med.times) {
            await scheduleMedicationNotification(
              med.id, med.name, med.dosage, t, lang, med.intervalDays || 1, med.startDate
            );
          }
        }
      }
    } catch (_err) {
      showAlert({
        message: lang === 'tr' ? 'Geri alma işlemi başarısız oldu.' : 'Undo action failed.',
        type: 'danger'
      });
    }
  };

  const handleAddTodayWater = async (currentWater: number, targetWater: number) => {
    if (!activeProfile?.id) return;
    const newWater = currentWater + 250;
    
    try {
      const result = await upsertDailyHealthLog(activeProfile.id, todayStr, {
        waterIntakeMl: newWater,
        waterTargetMl: targetWater,
      });
      useStore.getState().upsertDailyHealthLogState(activeProfile.id, todayStr, result);
    } catch (_err) {
      // fail silently
    }
  };


  const medWarnings: { med: Medication; threshold: number; remaining: number; key: string }[] = [];
  medications.forEach((med) => {
    if (med.type !== 'vaccine' && med.totalQuantity !== undefined) {
      const takenCount = logs.filter((l) => l.medicationId === med.id && l.status === 'taken').length;
      const dosageVal = parseFloat(med.dosage || '1');
      const remaining = Math.max(0, med.totalQuantity - (takenCount * dosageVal));

      const todaySlotsForMed = calculateSlotsForDay(todayStr).filter(s => s.med.id === med.id && s.status !== 'taken');
      const todayNeededQuantity = todaySlotsForMed.length * dosageVal;
      const willBeDepletedToday = remaining > 0 && remaining <= todayNeededQuantity;

      if (willBeDepletedToday) {
        const key = `${med.id}-depleted-today`;
        if (!(dismissedStockWarnings || []).includes(key)) {
          medWarnings.push({ med, threshold: 0, remaining, key });
        }
      } else if (remaining <= STOCK_THRESHOLD_CRITICAL) {
        const key = `${med.id}-${STOCK_THRESHOLD_CRITICAL}`;
        if (!(dismissedStockWarnings || []).includes(key)) {
          medWarnings.push({ med, threshold: STOCK_THRESHOLD_CRITICAL, remaining, key });
        }
      } else if (remaining <= STOCK_THRESHOLD_WARNING) {
        const key = `${med.id}-${STOCK_THRESHOLD_WARNING}`;
        if (!(dismissedStockWarnings || []).includes(key)) {
          medWarnings.push({ med, threshold: STOCK_THRESHOLD_WARNING, remaining, key });
        }
      }
    }
  });

  const checkIfMedDepletesOnDate = (med: Medication, targetDateStr: string) => {
    if (med.type === 'vaccine' || med.totalQuantity === undefined) return null;

    const takenCount = logs.filter((l) => l.medicationId === med.id && l.status === 'taken').length;
    const dosageVal = parseFloat(med.dosage || '1');
    const remainingToday = Math.max(0, med.totalQuantity - (takenCount * dosageVal));

    if (remainingToday <= 0) return 'depleted_before';

    const dates: string[] = [];
    const current = new Date(todayStr + 'T00:00:00');
    const target = new Date(targetDateStr + 'T00:00:00');
    
    let count = 0;
    while (current <= target && count < 100) {
      dates.push(getLocalDateString(current));
      current.setDate(current.getDate() + 1);
      count++;
    }

    let totalNeededBeforeTarget = 0;
    let totalNeededOnTarget = 0;

    dates.forEach((dateStr) => {
      let isForDay = false;
      if (med.startDate <= dateStr && (!med.endDate || med.endDate >= dateStr)) {
        if (med.intervalDays && med.intervalDays > 1) {
          const start = new Date(med.startDate + 'T00:00:00');
          const curr = new Date(dateStr + 'T00:00:00');
          const daysDiff = Math.floor((curr.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= 0 && daysDiff % med.intervalDays === 0) {
            isForDay = true;
          }
        } else {
          isForDay = true;
        }
      }

      if (isForDay) {
        const timesCount = med.times?.length || 0;
        if (dateStr === todayStr) {
          const slotsToday = calculateSlotsForDay(todayStr).filter(s => s.med.id === med.id && (s.status === 'pending' || s.status === 'upcoming' || s.status === 'overdue'));
          totalNeededBeforeTarget += slotsToday.length * dosageVal;
        } else if (dateStr === targetDateStr) {
          totalNeededOnTarget += timesCount * dosageVal;
        } else {
          totalNeededBeforeTarget += timesCount * dosageVal;
        }
      }
    });

    if (remainingToday <= totalNeededBeforeTarget) {
      return 'depleted_before';
    } else if (remainingToday <= totalNeededBeforeTarget + totalNeededOnTarget) {
      return 'depleted_on';
    }
    return null;
  };

  const futureMedWarnings: { med: Medication; status: 'depleted_on' | 'depleted_before'; remaining: number; key: string }[] = [];
  
  if (selectedDate > todayStr) {
    const todayDate = new Date(todayStr + 'T00:00:00');
    const selectedDateObj = new Date(selectedDate + 'T00:00:00');
    const diffDays = Math.floor((selectedDateObj.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

    medications.forEach((med) => {
      const depletionStatus = checkIfMedDepletesOnDate(med, selectedDate);
      if (depletionStatus === 'depleted_on') {
        const key = `${med.id}-future-depleted-on-${selectedDate}`;
        if (!(dismissedStockWarnings || []).includes(key)) {
          futureMedWarnings.push({
            med,
            status: 'depleted_on',
            remaining: 0,
            key
          });
        }
      } else if (depletionStatus === 'depleted_before') {
        if (diffDays < 7) {
          const key = `${med.id}-future-depleted-before-${selectedDate}`;
          if (!(dismissedStockWarnings || []).includes(key)) {
            futureMedWarnings.push({
              med,
              status: 'depleted_before',
              remaining: 0,
              key
            });
          }
        }
      }
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.bgGlow} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.topBar}>
          <View style={{ flex: 1, justifyContent: 'center', marginRight: SPACING.md }}>
            <Text style={styles.greeting} numberOfLines={1} adjustsFontSizeToFit>
              {getTodayGreeting(language as LanguageCode)}, <Text style={styles.userName}>{activeProfile?.name?.split(' ')[0] ?? user?.displayName?.split(' ')[0] ?? 'Kullanıcı'} 👋</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md }}>
            <TouchableOpacity 
              onPress={() => router.push('/pharmacies')} 
              activeOpacity={0.8} 
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={styles.headerPharmacyBtn}>
                <Text style={{ fontSize: 22 }}>⚕️</Text>
              </View>
              <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 4, fontWeight: '600' }}>
                {language === 'tr' ? 'Eczane' : 'Pharmacy'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => router.push('/profile-settings')} 
              activeOpacity={0.8}
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={[styles.avatarPlaceholder, { overflow: 'hidden' }]}>
                {activeProfile?.avatar?.startsWith('data:image/') ? (
                  <Image source={{ uri: activeProfile.avatar }} style={{ width: 48, height: 48 }} />
                ) : (
                  <Text style={styles.avatarInitial}>{activeProfile?.avatar || '👤'}</Text>
                )}
              </View>
              <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 4, fontWeight: '600' }}>
                {language === 'tr' ? 'Profil' : 'Profile'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>



        {profiles.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profil</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.profileScroll}>
              {profiles.map((profile) => (
                <TouchableOpacity
                  key={profile.id}
                  style={[styles.profileChip, activeProfileId === profile.id && styles.profileChipActive]}
                  onPress={() => setActiveProfileId(profile.id)}
                >
                  {profile.avatar?.startsWith('data:image/') ? (
                    <Image source={{ uri: profile.avatar }} style={{ width: 16, height: 16, borderRadius: 8 }} />
                  ) : (
                    <Text style={styles.profileChipEmoji}>{profile.avatar || (profile.isMain ? '👤' : '👦')}</Text>
                  )}
                  <Text style={[styles.profileChipText, activeProfileId === profile.id && styles.profileChipTextActive]}>
                    {profile.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Haftalık Takip Başlığı ve Takvim Butonu */}
        <View style={styles.weeklyHeader}>
          <Text style={styles.weeklyTitle}>
            {language === 'tr' ? 'Günlük Takip' : 'Daily Tracker'}
          </Text>
          <TouchableOpacity
            style={styles.calendarBtn}
            onPress={openDatePicker}
            activeOpacity={0.7}
          >
            <Text style={styles.calendarBtnText}>📅 {language === 'tr' ? 'Tarih Seç' : 'Select Date'}</Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <Modal 
            transparent 
            animationType="fade" 
            visible={showDatePicker} 
            onRequestClose={() => { setShowDatePicker(false); setSelectedPickerDate(null); }}
          >
            <View style={styles.pickerOverlay}>
              <View style={[styles.pickerContainer, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder, padding: 0, overflow: 'hidden' }]}>
                <View style={[styles.customDatePickerHeader, { backgroundColor: colors.primary }]}>
                  <Text style={styles.customDatePickerYear}>
                    {new Date(selectedPickerDate || selectedDate).getFullYear()}
                  </Text>
                  <Text style={styles.customDatePickerDate}>
                    {new Date(selectedPickerDate || selectedDate).toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <View style={styles.customDatePickerBody}>
                  {Platform.OS === 'ios' ? (
                    <View style={{ paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md }}>
                      <DateTimePicker
                        value={new Date(selectedPickerDate || selectedDate)}
                        mode="date"
                        display="spinner"
                        minimumDate={getCalendarMinDate()}
                        onChange={(_, date) => {
                          if (date) {
                            const formatted = getLocalDateString(date);
                            setSelectedPickerDate(formatted);
                          }
                        }}
                        themeVariant={theme}
                        textColor={colors.textPrimary}
                        style={{ height: 150 }}
                      />
                    </View>
                  ) : (
                    /* Pure JS Custom Grid Date Picker for Android - Fully matches Theme! */
                    <View style={{ padding: SPACING.md }}>
                       <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
                          <TouchableOpacity 
                            onPress={() => setAndroidMonthView(new Date(androidMonthView.getFullYear(), androidMonthView.getMonth() - 1, 1))} 
                            style={{ padding: SPACING.sm, backgroundColor: colors.surfaceBorder, borderRadius: 8 }}
                          >
                             <Text style={{ color: colors.textPrimary }}>◀</Text>
                          </TouchableOpacity>
                          <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.textPrimary }}>
                             {androidMonthView.toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' })}
                          </Text>
                          <TouchableOpacity 
                            onPress={() => setAndroidMonthView(new Date(androidMonthView.getFullYear(), androidMonthView.getMonth() + 1, 1))} 
                            style={{ padding: SPACING.sm, backgroundColor: colors.surfaceBorder, borderRadius: 8 }}
                          >
                             <Text style={{ color: colors.textPrimary }}>▶</Text>
                          </TouchableOpacity>
                       </View>
                       <View style={{ flexDirection: 'row', marginBottom: SPACING.md }}>
                          {['Pt','Sa','Ça','Pe','Cu','Ct','Pz'].map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: colors.textSecondary, fontWeight: 'bold', fontSize: 12 }}>{d}</Text>)}
                       </View>
                       <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                          {Array.from({ length: (new Date(androidMonthView.getFullYear(), androidMonthView.getMonth(), 1).getDay() + 6) % 7 }).map((_, i) => <View key={`b-${i}`} style={{ width: '14.28%', aspectRatio: 1 }} />)}
                          {Array.from({ length: new Date(androidMonthView.getFullYear(), androidMonthView.getMonth() + 1, 0).getDate() }, (_, i) => i + 1).map(d => {
                             const dStr = `${androidMonthView.getFullYear()}-${(androidMonthView.getMonth()+1).toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
                             const isSelected = (selectedPickerDate || selectedDate) === dStr;
                             const minDateStr = getLocalDateString(getCalendarMinDate());
                             const isBeforeMin = dStr < minDateStr;

                             return (
                                <TouchableOpacity 
                                  key={d} 
                                  onPress={() => {
                                    if (!isBeforeMin) {
                                      setSelectedPickerDate(dStr);
                                    }
                                  }} 
                                  disabled={isBeforeMin}
                                  style={{ width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', opacity: isBeforeMin ? 0.25 : 1 }}
                                >
                                   <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: isSelected ? colors.primary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                                      <Text style={{ color: isSelected ? '#fff' : colors.textPrimary, fontWeight: isSelected ? 'bold' : 'normal', fontSize: 15 }}>{d}</Text>
                                    </View>
                                </TouchableOpacity>
                             );
                          })}
                       </View>
                    </View>
                  )}

                  <View style={styles.customDatePickerActions}>
                    <TouchableOpacity style={styles.customDatePickerCancelBtn} onPress={() => { setShowDatePicker(false); setSelectedPickerDate(null); }}>
                      <Text style={[styles.customDatePickerActionText, { color: colors.textSecondary }]}>{t(language as LanguageCode, 'settings.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.customDatePickerOkBtn} 
                      onPress={() => {
                        if (selectedPickerDate) {
                          setSelectedDate(selectedPickerDate);
                        }
                        setShowDatePicker(false);
                        setSelectedPickerDate(null);
                      }}
                    >
                      <Text style={[styles.customDatePickerActionText, { color: colors.primary, fontWeight: 'bold' }]}>{language === 'tr' ? 'Onayla' : 'Confirm'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {/* Haftalık Takip Barı */}
        <View style={styles.weeklyBar}>
          {getWeeklyDays().map((day) => {
            const isActive = day.dateStr === selectedDate;
            const isTodayDay = day.dateStr === todayStr;
            return (
              <TouchableOpacity
                key={day.dateStr}
                style={[styles.dayChip, isActive && styles.dayChipActive]}
                onPress={() => setSelectedDate(day.dateStr)}
                activeOpacity={0.75}
              >
                <Text style={[styles.dayName, isActive && styles.dayNameActive]}>{day.dayName}</Text>
                <Text style={[styles.dayNum, isActive && styles.dayNumActive]}>{day.dayNum}</Text>
                {isTodayDay && (
                  <View style={[styles.todayDot, isActive && styles.todayDotActive]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Gelecek Tarihli Stok Uyarıları */}
        {selectedDate > todayStr && futureMedWarnings.length > 0 && (
          <View style={[styles.section, { marginTop: SPACING.md, marginBottom: 0 }]}>
            {futureMedWarnings.map((warning) => (
              <View key={warning.key} style={[styles.slotCard, { borderColor: colors.danger + '88', backgroundColor: colors.danger + '04' }]}>
                {/* Warning Chip */}
                <View style={[styles.timeChip, { backgroundColor: colors.danger + '18' }]}>
                  <Text style={[styles.timeText, { color: colors.danger }]}>
                    {warning.status === 'depleted_on' ? '⚠️ STOK' : '❌ STOK'}
                  </Text>
                </View>

                {/* Warning Information */}
                <TouchableOpacity
                  style={styles.upcomingInfo}
                  onPress={() => router.push({ pathname: '/medication-detail', params: { id: warning.med.id } })}
                  activeOpacity={0.7}
                >
                  <Text style={styles.upcomingName}>{warning.med.name}</Text>
                  <Text style={styles.upcomingDose}>
                    {warning.status === 'depleted_on'
                      ? (language === 'tr' ? 'Stok bu tarihte tükenecek!' : 'Stock depleting on this date!')
                      : (language === 'tr' ? 'Stok bu tarihten önce bitecek!' : 'Stock depleted before this date!')}
                  </Text>
                </TouchableOpacity>

                {/* Action Buttons */}
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[styles.takeBtn, { backgroundColor: colors.danger + '18', borderColor: colors.danger }]}
                    onPress={() => dismissStockWarning(warning.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.takeBtnEmoji, { color: colors.danger }]}>✓</Text>
                    <Text style={[styles.takeBtnText, { color: colors.danger }]}>
                      {language === 'tr' ? 'Tamam' : 'OK'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.postponeBtn}
                    onPress={() => router.push('/pharmacies')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.postponeBtnEmoji}>⚕️</Text>
                    <Text style={styles.postponeBtnText}>
                      {language === 'tr' ? 'Eczane' : 'Pharmacy'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Kritik Stok Uyarıları */}
        {selectedDate === todayStr && medWarnings.length > 0 && (
          <View style={[styles.section, { marginTop: SPACING.md, marginBottom: 0 }]}>
            {medWarnings.map((warning) => {
              const isDanger = warning.threshold === STOCK_THRESHOLD_CRITICAL || warning.threshold === 0;
              return (
                <View key={warning.key} style={[styles.slotCard, { borderColor: isDanger ? colors.danger + '88' : colors.warning + '88', backgroundColor: isDanger ? colors.danger + '04' : colors.warning + '04' }]}>
                  {/* Warning Chip */}
                  <View style={[styles.timeChip, { backgroundColor: isDanger ? colors.danger + '18' : colors.warning + '18' }]}>
                    <Text style={[styles.timeText, { color: isDanger ? colors.danger : colors.warning }]}>
                      ⚠️ STOK
                    </Text>
                  </View>

                  {/* Warning Information */}
                  <TouchableOpacity
                    style={styles.upcomingInfo}
                    onPress={() => router.push({ pathname: '/medication-detail', params: { id: warning.med.id } })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.upcomingName}>{warning.med.name}</Text>
                    <Text style={styles.upcomingDose}>
                      {warning.threshold === 0
                        ? (language === 'tr' ? 'Bugün tükenecek!' : 'Depletes today!')
                        : (language === 'tr' ? `Kritik stok! Kalan: ${warning.remaining}` : `Critical stock! Left: ${warning.remaining}`)}
                    </Text>
                  </TouchableOpacity>

                  {/* Action Buttons */}
                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      style={[
                        styles.takeBtn,
                        {
                          backgroundColor: isDanger ? colors.danger + '18' : colors.warning + '18',
                          borderColor: isDanger ? colors.danger : colors.warning
                        }
                      ]}
                      onPress={() => dismissStockWarning(warning.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.takeBtnEmoji, { color: isDanger ? colors.danger : colors.warning }]}>✓</Text>
                      <Text style={[styles.takeBtnText, { color: isDanger ? colors.danger : colors.warning }]}>
                        {language === 'tr' ? 'Tamam' : 'OK'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.postponeBtn}
                      onPress={() => router.push('/pharmacies')}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.postponeBtnEmoji}>⚕️</Text>
                      <Text style={styles.postponeBtnText}>
                        {language === 'tr' ? 'Eczane' : 'Pharmacy'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: colors.primary }]}>
            <View style={styles.statCardHeader}>
              <Text style={styles.statValue}>{totalSlotsCount}</Text>
              <Text style={styles.statIcon}>💊</Text>
            </View>
            <Text style={styles.statLabel}>{language === 'tr' ? 'Toplam İlaç' : 'Total Meds'}</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: colors.secondary }]}>
            <View style={styles.statCardHeader}>
              <Text style={styles.statValue}>{completedSlotsCount}</Text>
              <Text style={styles.statIcon}>✅</Text>
            </View>
            <Text style={styles.statLabel}>{t(language as LanguageCode, 'home.completed')}</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: colors.accent }]}>
            <View style={styles.statCardHeader}>
              <Text style={styles.statValue}>{pendingSlotsCount}</Text>
              <Text style={styles.statIcon}>⏳</Text>
            </View>
            <Text style={styles.statLabel}>{language === 'tr' ? 'Kalan İlaç' : 'Remaining'}</Text>
          </View>
        </View>

        {/* Geçmiş Gün Sağlık Özeti */}
        {selectedDate < todayStr && (() => {
          const pastHealthLog = dailyHealthLogs.find(
            (l) => l.profileId === activeProfile?.id && l.date === selectedDate
          );
          
          const hasWater = showPastWater && pastHealthLog && pastHealthLog.waterIntakeMl > 0;
          const hasSleep = showPastSleep && pastHealthLog && pastHealthLog.sleepHours !== undefined;
          const hasWeight = showPastWeight && pastHealthLog && pastHealthLog.weightKg !== undefined;
          const hasMood = showPastMood && pastHealthLog && pastHealthLog.mood !== undefined;

          if (!hasWater && !hasSleep && !hasWeight && !hasMood) {
            return null;
          }

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                📊 {t(language as LanguageCode, 'home.pastHealthTitle')}
              </Text>
              <View style={styles.healthSummaryCard}>
                {hasWater && (
                  <View style={styles.healthSummaryItem}>
                    <Text style={styles.healthSummaryIcon}>💧</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.healthSummaryLabel}>
                        {language === 'tr' ? 'Su Tüketimi' : 'Water Intake'}
                      </Text>
                      <Text style={styles.healthSummaryValue}>
                        {pastHealthLog.waterIntakeMl} ml 
                        {pastHealthLog.waterTargetMl ? ` / ${pastHealthLog.waterTargetMl} ml` : ''}
                      </Text>
                    </View>
                  </View>
                )}
                {hasSleep && (
                  <>
                    {hasWater && <View style={styles.healthSummaryDivider} />}
                    <View style={styles.healthSummaryItem}>
                      <Text style={styles.healthSummaryIcon}>😴</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.healthSummaryLabel}>
                          {language === 'tr' ? 'Uyku Süresi & Kalite' : 'Sleep & Quality'}
                        </Text>
                        <Text style={styles.healthSummaryValue}>
                          {pastHealthLog.sleepHours} {t(language as LanguageCode, 'health.hours')}
                          {pastHealthLog.sleepRating ? ` · ${'⭐'.repeat(pastHealthLog.sleepRating)}` : ''}
                        </Text>
                      </View>
                    </View>
                  </>
                )}
                {hasWeight && (
                  <>
                    {(hasWater || hasSleep) && <View style={styles.healthSummaryDivider} />}
                    <View style={styles.healthSummaryItem}>
                      <Text style={styles.healthSummaryIcon}>⚖️</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.healthSummaryLabel}>
                          {language === 'tr' ? 'Kilo' : 'Weight'}
                        </Text>
                        <Text style={styles.healthSummaryValue}>
                          {pastHealthLog.weightKg} kg
                        </Text>
                      </View>
                    </View>
                  </>
                )}
                {hasMood && (
                  <>
                    {(hasWater || hasSleep || hasWeight) && <View style={styles.healthSummaryDivider} />}
                    <View style={styles.healthSummaryItem}>
                      <Text style={styles.healthSummaryIcon}>🎭</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.healthSummaryLabel}>
                          {language === 'tr' ? 'Ruh Hali' : 'Mood'}
                        </Text>
                        <Text style={styles.healthSummaryValue}>
                          {(() => {
                            const moods: Record<string, { emoji: string; tr: string; en: string }> = {
                              excellent: { emoji: '😍', tr: 'Harika', en: 'Excellent' },
                              good: { emoji: '🙂', tr: 'İyi', en: 'Good' },
                              neutral: { emoji: '😐', tr: 'Orta', en: 'Neutral' },
                              bad: { emoji: '🙁', tr: 'Kötü', en: 'Bad' },
                              terrible: { emoji: '😩', tr: 'Çok Kötü', en: 'Terrible' }
                            };
                            const m = moods[pastHealthLog.mood!];
                            if (!m) return pastHealthLog.mood;
                            return `${m.emoji} ${language === 'tr' ? m.tr : m.en}`;
                          })()}
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </View>
          );
        })()}

        {/* Bugünün Su Tüketimi Özeti */}
        {selectedDate === todayStr && showPastWater && (() => {
          const todayHealthLog = dailyHealthLogs.find(
            (l) => l.profileId === activeProfile?.id && l.date === todayStr
          );
          
          const currentWater = todayHealthLog?.waterIntakeMl || 0;
          const weightVal = activeProfile?.weight || 0;
          const heightVal = activeProfile?.height || 0;
          const ageVal = activeProfile?.age;
          const genderVal = activeProfile?.gender;
          const baseMultiplier = genderVal === GENDER_FEMALE ? 31 : 35;
          let base = weightVal * baseMultiplier;
          if (ageVal) {
            if (ageVal < 30) base = weightVal * (baseMultiplier + 5);
            else if (ageVal > 65) base = weightVal * (baseMultiplier - 5);
          }
          if (heightVal > 185) base += 250;
          const recommendedTarget = Math.round(base / 100) * 100 || 2000;
          const targetWater = todayHealthLog?.waterTargetMl ?? recommendedTarget;
          
          const progressPercent = Math.min(100, (currentWater / targetWater) * 100);
          const isBehind = currentWater < targetWater;
          
          let statusText = '';
          let statusColor: string = colors.warning;
          if (currentWater === 0) {
            statusText = language === 'tr' ? 'Henüz su tüketimi kaydedilmedi.' : 'No water intake recorded yet.';
            statusColor = colors.textSecondary;
          } else if (isBehind) {
            statusText = language === 'tr' ? 'Hedefinin gerisinde (Daha fazla su içmelisin!) 💧' : 'Behind target (Drink more water!) 💧';
            statusColor = colors.warning;
          } else {
            statusText = language === 'tr' ? 'Tebrikler! Hedefine ulaştın 🎉' : 'Congratulations! Target achieved 🎉';
            statusColor = colors.success;
          }

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {t(language as LanguageCode, 'health.waterTitle')}
              </Text>
              <View style={styles.waterTrackerCard}>
                <View style={styles.waterTrackerHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.waterTrackerValue}>
                      {currentWater} ml <Text style={styles.waterTrackerTarget}>/ {targetWater} ml</Text>
                    </Text>
                    <Text style={[styles.waterTrackerStatus, { color: statusColor }]}>
                      {statusText}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.waterQuickAddBtn}
                    onPress={() => handleAddTodayWater(currentWater, targetWater)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.waterQuickAddBtnText}>+250 ml</Text>
                  </TouchableOpacity>
                </View>
                
                {/* Progress Bar */}
                <View style={styles.waterProgressBarBg}>
                  <View style={[styles.waterProgressBarFill, { width: `${progressPercent}%`, backgroundColor: colors.primary }]} />
                </View>
              </View>
            </View>
          );
        })()}

        {/* Seçili Günün İlaçları Listesi */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {selectedDate === todayStr
              ? (language === 'tr' ? 'Bugünün İlaçları' : "Today's Medications")
              : `${formatDate(selectedDate)} ${language === 'tr' ? 'Tarihli İlaçlar' : 'Medications'}`}
          </Text>

          {daySlots.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEmoji}>🍃</Text>
              <Text style={styles.emptyText}>
                {language === 'tr'
                  ? 'Bu tarih için planlanmış herhangi bir ilaç bulunmuyor.'
                  : 'No medications scheduled for this date.'}
              </Text>
            </View>
          ) : (
            daySlots.map((item, idx) => {
              const { med, time, status, logId } = item;
              const isVaccine = med.type === 'vaccine';

              // Durum detayları
              let statusText = '';
              let statusEmoji = '⬜';
              let statusColor: string = colors.textSecondary;
              let cardStyle: any = {};

              if (status === STATUS_TAKEN) {
                statusText = language === 'tr' ? 'Alındı' : 'Taken';
                statusEmoji = '✅';
                statusColor = colors.success;
                cardStyle = styles.slotCardTaken;
              } else if (status === STATUS_POSTPONED) {
                const isFinishDay = med.isActive === false && med.endDate === selectedDate;
                if (isFinishDay) {
                  statusText = language === 'tr' ? 'Bitirildi (Ertelendi)' : 'Finished (Postponed)';
                  statusEmoji = '🏁⏭️';
                } else {
                  statusText = language === 'tr' ? 'Ertelendi' : 'Postponed';
                  statusEmoji = '⏭️';
                }
                statusColor = colors.warning;
                cardStyle = styles.slotCardPostponed;
              } else if (status === STATUS_FINISHED) {
                statusText = language === 'tr' ? 'Bitirildi' : 'Finished';
                statusEmoji = '🏁';
                statusColor = colors.textMuted;
                cardStyle = styles.slotCardFinished;
              } else if (status === STATUS_MISSED) {
                statusText = language === 'tr' ? 'Alınmadı' : 'Missed';
                statusEmoji = '❌';
                statusColor = colors.danger;
                cardStyle = styles.slotCardMissed;
              } else if (status === STATUS_OVERDUE) {
                statusText = language === 'tr' ? 'Süresi Geçti' : 'Overdue';
                statusEmoji = '⏰';
                statusColor = colors.danger;
                cardStyle = styles.slotCardOverdue;
              } else {
                statusText = language === 'tr' ? 'Bekliyor' : 'Pending';
                statusEmoji = '⏳';
                statusColor = colors.primary;
              }

              return (
                <View key={`${med.id}-${time}-${idx}`} style={[styles.slotCard, cardStyle]}>
                  {/* Saat ve Durum */}
                  <View style={[styles.timeChip, { backgroundColor: statusColor + '18' }]}>
                    <Text style={[styles.timeText, { color: statusColor }]}>{time}</Text>
                  </View>

                  {/* İlaç Bilgisi */}
                  <TouchableOpacity
                    style={styles.upcomingInfo}
                    onPress={() => router.push({ pathname: '/medication-detail', params: { id: med.id } })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.upcomingName}>{med.name}</Text>
                    {isVaccine ? (
                      <Text style={styles.upcomingDose}>{language === 'tr' ? 'Aşı' : 'Vaccine'}</Text>
                    ) : (
                      <Text style={styles.upcomingDose}>
                        {med.dosage} {getTranslatedUnit(med.unit)}
                        {med.strength ? ` · ${med.strength}` : ''}
                      </Text>
                    )}
                    <Text style={[styles.statusLabel, { color: statusColor }]}>
                      {statusEmoji} {statusText}
                    </Text>
                    {selectedDate > todayStr && (() => {
                      const depletion = checkIfMedDepletesOnDate(med, selectedDate);
                      if (depletion === 'depleted_on') {
                        return (
                          <Text style={{ fontSize: 11, fontWeight: 'bold', color: colors.danger, marginTop: 4 }}>
                            {t(language as LanguageCode, 'home.stockDepletedOnDateSlot')}
                          </Text>
                        );
                      } else if (depletion === 'depleted_before') {
                        const todayDate = new Date(todayStr + 'T00:00:00');
                        const selectedDateObj = new Date(selectedDate + 'T00:00:00');
                        const diffDays = Math.floor((selectedDateObj.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
                        if (diffDays < 7) {
                          return (
                            <Text style={{ fontSize: 11, fontWeight: 'bold', color: colors.danger, marginTop: 4 }}>
                              {t(language as LanguageCode, 'home.stockDepletedBeforeDateSlot')}
                            </Text>
                          );
                        }
                      }
                      return null;
                    })()}
                  </TouchableOpacity>

                  {/* Butonlar */}
                  <View style={styles.actionButtons}>
                    {/* Log geri alma */}
                    {(status === STATUS_TAKEN || status === STATUS_POSTPONED) && logId ? (
                      <TouchableOpacity
                        style={styles.undoBtn}
                        onPress={() => handleUndoAction(logId)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.undoBtnText}>{language === 'tr' ? 'Geri Al' : 'Undo'}</Text>
                      </TouchableOpacity>
                    ) : null}

                    {/* Aksiyonlar */}
                    {status === STATUS_PENDING || status === STATUS_OVERDUE || status === STATUS_UPCOMING ? (
                      <>
                        {selectedDate <= todayStr && (
                          <TouchableOpacity
                            style={styles.takeBtn}
                            onPress={() => handleTakeMedication(med.id, time, selectedDate)}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.takeBtnEmoji}>✓</Text>
                            <Text style={styles.takeBtnText}>{t(language as LanguageCode, 'home.takeBtn')}</Text>
                          </TouchableOpacity>
                        )}
                        {selectedDate <= todayStr && (
                          <TouchableOpacity
                            style={styles.postponeBtn}
                            onPress={() => handlePostpone(med.id, time, selectedDate)}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.postponeBtnEmoji}>⏭️</Text>
                            <Text style={styles.postponeBtnText}>{t(language as LanguageCode, 'home.postponeBtn')}</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    ) : null}

                    {status === STATUS_MISSED ? (
                      selectedDate <= todayStr && (
                        <TouchableOpacity
                          style={styles.takeBtn}
                          onPress={() => handleTakeMedication(med.id, time, selectedDate)}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.takeBtnEmoji}>✓</Text>
                          <Text style={styles.takeBtnText}>{t(language as LanguageCode, 'home.takeBtn')}</Text>
                        </TouchableOpacity>
                      )
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  bgGlow: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.primary,
    opacity: 0.08,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: 60,
    paddingBottom: SPACING.md,
  },
  greeting: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.textSecondary },
  userName: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  avatarPlaceholder: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  section: { paddingHorizontal: SPACING.xl, marginBottom: SPACING.xxl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary, marginBottom: SPACING.md },
  addLink: {
    backgroundColor: colors.primary + '18',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: RADIUS.full,
    fontSize: 13,
    color: colors.primary,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: colors.primary + '40',
    overflow: 'hidden',
  },
  profileScroll: { flexDirection: 'row' },
  profileChip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full, backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.surfaceBorder, marginRight: SPACING.sm,
  },
  profileChipActive: { backgroundColor: colors.primary + '22', borderColor: colors.primary },
  profileChipEmoji: { fontSize: 16 },
  profileChipText: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightMedium, color: colors.textSecondary },
  profileChipTextActive: { color: colors.primary },
  statsRow: { flexDirection: 'row', gap: SPACING.md, paddingHorizontal: SPACING.xl, marginBottom: SPACING.xxl },
  statCard: {
    flex: 1, backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.lg, padding: SPACING.lg,
    borderLeftWidth: 3, borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  statCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statValue: { fontSize: TYPOGRAPHY.fontSize2xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  statIcon: { fontSize: 18 },
  statLabel: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textSecondary, marginTop: 2 },
  emptyCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.lg,
    padding: SPACING.xxl, alignItems: 'center', gap: SPACING.sm,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  emptyEmoji: { fontSize: 36 },
  emptyText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  // Süresi Geçenler
  overdueHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md,
  },
  overdueTitle: {
    fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.danger,
  },
  overdueBadge: {
    backgroundColor: colors.danger, borderRadius: RADIUS.full,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  overdueBadgeText: { fontSize: TYPOGRAPHY.fontSizeXs, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  overdueCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.danger + '11', borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: colors.danger + '44',
  },
  overdueTimeChip: {
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm, backgroundColor: colors.danger + '22',
  },
  overdueTimeText: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.danger },
  overdueAgo: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.danger, fontWeight: TYPOGRAPHY.fontWeightMedium, marginTop: 2 },
  upcomingCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  upcomingCardUrgent: { borderColor: colors.warning, backgroundColor: colors.warning + '11' },
  timeChip: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: RADIUS.sm },
  timeText: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightBold },
  upcomingInfo: { flex: 1 },
  upcomingName: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  upcomingDose: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textSecondary, marginTop: 2 },
  upcomingDiff: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textMuted, fontWeight: TYPOGRAPHY.fontWeightMedium },
  addFirstCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.lg,
    padding: SPACING.xxxl, alignItems: 'center', gap: SPACING.sm,
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary + '66',
  },
  addFirstEmoji: { fontSize: 44 },
  addFirstText: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  addFirstSub: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  medCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  medIconContainer: {
    width: 44, height: 44, borderRadius: RADIUS.md,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  medIcon: { fontSize: 22 },
  medInfo: { flex: 1 },
  medName: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  medDose: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, marginTop: 2 },
  medTimes: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.primary, marginTop: 4 },
  medArrow: { fontSize: 24, color: colors.textMuted },
  takeBtn: {
    backgroundColor: colors.success + '22',
    borderColor: colors.success,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  takeBtnEmoji: { fontSize: 14, color: colors.success },
  takeBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.success, fontWeight: TYPOGRAPHY.fontWeightBold },
  actionButtons: {
    flexDirection: 'column',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'stretch',
    minWidth: 95,
  },
  postponeBtn: {
    backgroundColor: colors.surfaceBorder + '44',
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  postponeBtnEmoji: { fontSize: 10 },
  postponeBtnText: { fontSize: 10, color: colors.textSecondary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  completedCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surfaceElevated, opacity: 0.7, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  completedIconBox: { width: 32, alignItems: 'center' },
  completedIcon: { fontSize: 20 },
  completedInfo: { flex: 1 },
  completedName: { fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textSecondary, textDecorationLine: 'line-through' },
  completedMeta: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textMuted },
  warningCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1.5,
    borderColor: colors.warning + '88',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  warningCardDanger: {
    borderColor: colors.danger + '88',
  },
  warningCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  warningCardIcon: {
    fontSize: 24,
  },
  warningCardTitle: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  warningCardText: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  warningCardDismissBtn: {
    backgroundColor: colors.warning + '25',
    borderColor: colors.warning,
    borderWidth: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningCardDismissBtnDanger: {
    backgroundColor: colors.danger + '25',
    borderColor: colors.danger,
  },
  warningCardDismissText: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.warning,
    fontWeight: TYPOGRAPHY.fontWeightBold,
  },
  warningCardDismissTextDanger: {
    color: colors.danger,
  },
  weeklyBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  dayChip: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 60,
    borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: SPACING.xs,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayName: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '500',
    marginBottom: 4,
  },
  dayNameActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  dayNum: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dayNumActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  todayDotActive: {
    backgroundColor: '#fff',
  },
  weeklyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  weeklyTitle: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: TYPOGRAPHY.fontWeightSemiBold,
    color: colors.textPrimary,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: RADIUS.full,
  },
  calendarBtnText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: 'bold',
  },
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  slotCardTaken: {
    borderColor: colors.success + '44',
    backgroundColor: colors.success + '08',
  },
  slotCardPostponed: {
    borderColor: colors.warning + '44',
    backgroundColor: colors.warning + '08',
  },
  slotCardOverdue: {
    borderColor: colors.danger + '44',
    backgroundColor: colors.danger + '08',
  },
  slotCardMissed: {
    borderColor: colors.danger + '22',
    backgroundColor: colors.danger + '04',
  },
  slotCardUpcoming: {
    borderColor: colors.primary + '44',
    backgroundColor: colors.primary + '08',
  },
  slotCardFinished: {
    borderColor: colors.textMuted + '33',
    backgroundColor: colors.textMuted + '08',
    opacity: 0.85,
  },
  detailIconBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  detailIconText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: 'bold',
  },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  pickerContainer: {
    width: '100%',
    borderRadius: RADIUS.xl,
    padding: SPACING.xxl,
    borderWidth: 1,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  customDatePickerHeader: { padding: SPACING.xl, alignItems: 'flex-start', justifyContent: 'center' },
  customDatePickerYear: { fontSize: TYPOGRAPHY.fontSizeMd, color: 'rgba(255,255,255,0.7)', fontWeight: 'bold', marginBottom: 4 },
  customDatePickerDate: { fontSize: TYPOGRAPHY.fontSize2xl, color: '#fff', fontWeight: 'bold' },
  customDatePickerBody: { padding: 0 },
  customDatePickerActions: { flexDirection: 'row', justifyContent: 'flex-end', padding: SPACING.md, gap: SPACING.lg },
  customDatePickerCancelBtn: { padding: SPACING.md },
  customDatePickerOkBtn: { padding: SPACING.md },
  customDatePickerActionText: { fontSize: TYPOGRAPHY.fontSizeMd, textTransform: 'uppercase' },
  statusLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
  },
  undoBtn: {
    backgroundColor: colors.surfaceBorder + '44',
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoBtnText: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  healthSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    gap: SPACING.md,
  },
  healthSummaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  healthSummaryIcon: {
    fontSize: 22,
    width: 28,
    textAlign: 'center',
  },
  healthSummaryLabel: {
    fontSize: TYPOGRAPHY.fontSizeXs,
    color: colors.textSecondary,
  },
  healthSummaryValue: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginTop: 2,
  },
  healthSummaryDivider: {
    height: 1,
    backgroundColor: colors.surfaceBorder,
    marginVertical: 2,
  },
  waterTrackerCard: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    gap: SPACING.md,
  },
  waterTrackerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  waterTrackerValue: {
    fontSize: TYPOGRAPHY.fontSizeXl,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    color: colors.textPrimary,
  },
  waterTrackerTarget: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textSecondary,
    fontWeight: 'normal',
  },
  waterTrackerStatus: {
    fontSize: TYPOGRAPHY.fontSizeXs,
    fontWeight: '500',
    marginTop: 4,
  },
  waterQuickAddBtn: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary + '40',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  waterQuickAddBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  waterProgressBarBg: {
    height: 8,
    backgroundColor: colors.surfaceBorder + '44',
    borderRadius: 4,
    overflow: 'hidden',
  },
  waterProgressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  headerPharmacyBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  warningCardPharmacyBtn: {
    flex: 1.2,
    backgroundColor: colors.primary + '18',
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary + '44',
  },
  warningCardPharmacyBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.primaryLight,
  },
});
