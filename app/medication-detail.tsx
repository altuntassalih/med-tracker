import { View, Text, StyleSheet,
  TouchableOpacity, ActivityIndicator, Modal,
} from 'react-native';
import { ScrollView, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { getMedicationInfo } from '../services/gemini';
import { useStore } from '../store/useStore';
import { updateMedication, clearMedicationLogs, addMedicationLog, updateMedicationLog, deleteMedicationLog, MedicationLog } from '../services/firestore';
import { cancelMedicationNotifications, checkAndRefreshEndOfDayNotification, rescheduleIntervalNotificationAfterTake, scheduleMedicationNotification, requestNotificationPermission, triggerCriticalStockNotification } from '../services/notifications';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, AI_FEATURES_ENABLED, STOCK_THRESHOLD_CRITICAL, STOCK_THRESHOLD_WARNING } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { formatDate, getLocalDateString } from '../utils/date';

// Kaç günlük geçmiş gösterilecek
const TRACKING_DAYS_COUNT = 30;

export default function MedicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const {
    activeProfileId,
    medications: allMedications,
    medicationLogs,
    updateMedication: updateMedInStore,
    removeMedicationLogsForMed,
    addMedicationLogState,
    updateMedicationLogState,
    deleteMedicationLogState,
    language, theme, showAlert,
  } = useStore();
  const [medication, setMedication] = useState<any | null>(null);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [showTrackingModal, setShowTrackingModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  useEffect(() => {
    const found = allMedications.find((m: any) => m.id === id);
    if (found) {
      setMedication(found);
    }
  }, [id, allMedications]);

  const handleGetInfo = async () => {
    if (!medication) return;

    if (aiInfo) {
      setShowAiModal(true);
      return;
    }

    // Yapay zeka devre dışıysa bilgilendir
    if (!AI_FEATURES_ENABLED) {
      showAlert({ message: t(lang, 'medicines.aiQuotaMsg'), type: 'warning' });
      return;
    }

    setIsLoadingInfo(true);
    try {
      const info = await getMedicationInfo(medication.name, lang);
      setAiInfo(info);
      setShowAiModal(true);
    } catch (err: any) {
      const isQuota = err?.isQuotaError || err?.message === 'QUOTA_EXCEEDED';
      showAlert({ 
        message: isQuota
          ? t(lang, 'medicines.aiQuotaMsg')
          : lang === 'tr' ? 'Bilgi alınamadı.' : 'Could not get info.',
        type: isQuota ? 'warning' : 'danger'
      });
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handleFinishMedication = () => {
    if (!medication) return;
    showAlert({
      message: t(lang, 'medicines.finishMedConfirm'),
      type: 'warning',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        { 
          text: t(lang, 'medicines.finishMed'), 
          style: 'destructive',
          onPress: async () => {
            try {
              const endDate = new Date().toISOString().split('T')[0];
              await updateMedication(medication.id, { isActive: false, endDate });
              updateMedInStore(medication.id, { isActive: false, endDate });
              await cancelMedicationNotifications(medication.id);
              router.back();
            } catch (err) {
              showAlert({ message: lang === 'tr' ? 'İşlem sırasında bir hata oluştu.' : 'An error occurred during the process.', type: 'danger' });
            }
          }
        }
      ]
    });
  };

  const handleClearHistory = () => {
    if (!medication) return;
    showAlert({
      message: t(lang, 'medicationDetail.clearHistoryConfirm'),
      type: 'warning',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        {
          text: t(lang, 'medicationDetail.clearHistory'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearMedicationLogs(medication.id);
              removeMedicationLogsForMed(medication.id);
              showAlert({ message: t(lang, 'medicationDetail.clearHistorySuccess'), type: 'success' });
            } catch (err) {
              showAlert({ message: lang === 'tr' ? 'Geçmiş temizlenirken hata oluştu.' : 'Error clearing history.', type: 'danger' });
            }
          }
        }
      ]
    });
  };

  const getTranslatedUnit = (u: string) => {
    const translationKey = `medicationOptions.units.${u}`;
    const translated = t(lang, translationKey);
    return translated === translationKey ? u : translated;
  };

  const getTranslatedTypeLabel = (value: string) => {
    if (!value) return t(lang, 'medicationDetail.notSpecified');
    return t(lang, `medicationOptions.types.${value}`);
  };

  /** Periyodik ilaç alımında periyot güncelleme sorusu */
  const askPeriodResetFromDetail = (med: any) => {
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
              const newStartDate = new Date().toISOString().split('T')[0];
              const updatePayload: Partial<Medication> = { startDate: newStartDate };
              if (!med.originalStartDate) {
                updatePayload.originalStartDate = med.startDate;
              }
              await updateMedication(med.id, updatePayload);
              updateMedInStore(med.id, updatePayload);
              setMedication((prev: any) => 
                prev ? { ...prev, startDate: newStartDate, originalStartDate: prev.originalStartDate || med.startDate } : prev
              );

              const hasPermission = await requestNotificationPermission();
              if (hasPermission) {
                await cancelMedicationNotifications(med.id);
                for (const time of med.times) {
                  await scheduleMedicationNotification(
                    med.id, med.name, med.dosage, time,
                    lang, med.intervalDays, newStartDate
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

  const handleSlotPress = async (dateStr: string, time: string, currentStatus: string) => {
    if (!medication || !activeProfileId) return;

    const todayStr = getLocalDateString();
    if (dateStr > todayStr) return;

    const existingLog = medicationLogs.find(
      l => l.medicationId === medication.id && 
           l.expectedTime === time && 
           (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr)))
    );

    try {
      if (currentStatus === 'none' || currentStatus === 'missed') {
        if (existingLog) {
          updateMedicationLogState(existingLog.id, { status: 'taken', takenAt: new Date().toISOString() });
          await updateMedicationLog(existingLog.id, { status: 'taken', takenAt: new Date().toISOString() });
        } else {
          const logData: Omit<MedicationLog, 'id' | 'createdAt'> = {
            profileId: activeProfileId,
            medicationId: medication.id,
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

        // Klinik stok uyarısı kontrolü
        if (medication.totalQuantity !== undefined) {
          const updatedState = useStore.getState();
          const updatedLogs = updatedState.medicationLogs || [];
          const takenCount = updatedLogs.filter((l: any) => l.medicationId === medication.id && l.status === 'taken').length;
          const dosageVal = parseFloat(medication.dosage || '1');
          const newRemaining = Math.max(0, medication.totalQuantity - (takenCount * dosageVal));
          const oldRemaining = newRemaining + dosageVal;

          if (newRemaining <= STOCK_THRESHOLD_CRITICAL && oldRemaining > STOCK_THRESHOLD_CRITICAL) {
            triggerCriticalStockNotification(medication.name, STOCK_THRESHOLD_CRITICAL, lang);
          } else if (newRemaining <= STOCK_THRESHOLD_WARNING && oldRemaining > STOCK_THRESHOLD_WARNING) {
            triggerCriticalStockNotification(medication.name, STOCK_THRESHOLD_WARNING, lang);
          }
        }

        // Bildirim: alım sonrası bugünün kalan bildirimini iptal et ve sonrakileri zamanla
        rescheduleIntervalNotificationAfterTake(
          medication.id, medication.name, medication.dosage, time,
          lang, medication.intervalDays || 1, medication.startDate
        );

        // Periyot sorusu: Sadece alım BUGÜN ise ve bugün o ilacın alım periyodunda değilse sor
        const isIntervalDrug = medication.intervalDays && medication.intervalDays > 1 && medication.intervalDays !== 7;
        if (isIntervalDrug && dateStr === todayStr) {
          const start = new Date(medication.startDate + 'T00:00:00');
          const target = new Date(todayStr + 'T00:00:00');
          const daysDiff = Math.floor((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          const isAlignedToday = daysDiff >= 0 && daysDiff % medication.intervalDays === 0;

          if (!isAlignedToday) {
            setTimeout(() => askPeriodResetFromDetail(medication), 600);
          }
        }

      } else if (currentStatus === 'taken') {
        if (existingLog) {
          updateMedicationLogState(existingLog.id, { status: 'postponed' });
          await updateMedicationLog(existingLog.id, { status: 'postponed' });
        }
      } else if (currentStatus === 'postponed') {
        if (existingLog) {
          deleteMedicationLogState(existingLog.id);
          await deleteMedicationLog(existingLog.id);
          
          await cancelMedicationNotifications(medication.id);
          for (const t of (medication.times || [])) {
            await scheduleMedicationNotification(
              medication.id, medication.name, medication.dosage, t, lang, medication.intervalDays || 1, medication.startDate
            );
          }
        }
      }
      checkAndRefreshEndOfDayNotification(lang);
    } catch (_err) {
      showAlert({ message: lang === 'tr' ? 'Güncelleme başarısız oldu.' : 'Update failed.', type: 'danger' });
    }
  };

  // Son TRACKING_DAYS_COUNT günlük geçmişi hesapla
  const buildDailyTracking = () => {
    if (!medication) return [];
    const medLogs = medicationLogs.filter((l) => l.medicationId === medication.id);
    const days: { date: string; label: string; slots: { time: string; status: 'taken' | 'missed' | 'postponed' | 'none' }[] }[] = [];
    const startLimit = medication.originalStartDate || medication.startDate;

    for (let i = 0; i < TRACKING_DAYS_COUNT; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateString(d);

      // Aralıklı ilaç kontrolü
      if (medication.type === 'vaccine') {
        if (!medication.dates || !medication.dates.includes(dateStr)) continue;
      } else if (medication.intervalDays && medication.intervalDays > 1) {
        const hasLogsForDate = medLogs.some(
          (l) => l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr))
        );
        if (!hasLogsForDate) {
          const start = new Date(medication.startDate).setHours(0, 0, 0, 0);
          const origStart = new Date(startLimit).setHours(0, 0, 0, 0);
          const dayTs = d.setHours(0, 0, 0, 0);
          const daysDiffCurrent = Math.floor((dayTs - start) / (1000 * 60 * 60 * 24));
          const daysDiffOrig = Math.floor((dayTs - origStart) / (1000 * 60 * 60 * 24));
          const isScheduledCurrent = daysDiffCurrent >= 0 && daysDiffCurrent % medication.intervalDays === 0;
          const isScheduledOrig = daysDiffOrig >= 0 && daysDiffOrig % medication.intervalDays === 0;
          if (!isScheduledCurrent && !isScheduledOrig) {
            continue;
          }
        }
      }

      // İlaç başlangıcından önce gösterme
      if (dateStr < startLimit) break;

      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const label = `${day}.${month}`;

      const slots = (medication.times || []).map((time: string) => {
        const log = medLogs.find(
          (l) => l.expectedTime === time && (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr)))
        );
        return {
          time,
          status: log ? log.status : 'none' as 'taken' | 'missed' | 'postponed' | 'none',
        };
      });

      days.push({ date: dateStr, label, slots });
    }

    return days;
  };

  // Son alınan tarih ve saat
  const getLastTakenString = () => {
    if (!medication) return '';
    const logsForMed = medicationLogs.filter(
      (l) => l.medicationId === medication.id && l.status === 'taken'
    );
    if (logsForMed.length === 0) {
      return t(lang, 'medicationDetail.notTakenYet');
    }
    const sorted = [...logsForMed].sort(
      (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime()
    );
    const lastLog = sorted[0];
    try {
      const date = new Date(lastLog.takenAt);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${day}.${month}.${year} - ${hours}:${minutes}`;
    } catch (_err) {
      return t(lang, 'medicationDetail.notTakenYet');
    }
  };

  // Bir sonraki ilaç alım tarihi ve saati
  const getNextIntakeString = () => {
    if (!medication) return '';
    const now = new Date();
    const medLogs = medicationLogs.filter((l) => l.medicationId === medication.id);

    if (medication.type === 'vaccine') {
      if (!medication.dates || medication.dates.length === 0) return t(lang, 'medicationDetail.none');
      const sortedDates = [...medication.dates].sort();
      for (const dateStr of sortedDates) {
        const [y, mon, dVal] = dateStr.split('-').map(Number);
        const [h, m] = (medication.times?.[0] || '09:00').split(':').map(Number);
        const slotDate = new Date(y, mon - 1, dVal, h, m, 0, 0);

        if (slotDate.getTime() > now.getTime()) {
          const isLogged = medLogs.some((l) => 
            l.expectedTime === (medication.times?.[0] || '09:00') && 
            (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr))) &&
            (l.status === 'taken' || l.status === 'postponed')
          );
          if (!isLogged) {
            const dayFormatted = slotDate.getDate().toString().padStart(2, '0');
            const monthFormatted = (slotDate.getMonth() + 1).toString().padStart(2, '0');
            const yearFormatted = slotDate.getFullYear();
            return `${dayFormatted}.${monthFormatted}.${yearFormatted} - ${(medication.times?.[0] || '09:00')}`;
          }
        }
      }
      return t(lang, 'medicationDetail.none');
    }

    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = getLocalDateString(d);

      if (dateStr < medication.startDate) continue;
      if (medication.endDate && dateStr > medication.endDate) break;

      if (medication.intervalDays && medication.intervalDays > 1) {
        const start = new Date(medication.startDate + 'T00:00:00');
        const currentDay = new Date(dateStr + 'T00:00:00');
        const diffTime = currentDay.getTime() - start.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 0 || diffDays % medication.intervalDays !== 0) {
          continue;
        }
      }

      const sortedTimes = [...(medication.times || [])].sort();
      for (const time of sortedTimes) {
        const [h, m] = time.split(':').map(Number);
        const slotDate = new Date(d);
        slotDate.setHours(h, m, 0, 0);

        if (slotDate.getTime() > now.getTime()) {
          const isLogged = medLogs.some((l) => 
            l.expectedTime === time && 
            (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr))) &&
            (l.status === 'taken' || l.status === 'postponed')
          );
          if (!isLogged) {
            const dayFormatted = slotDate.getDate().toString().padStart(2, '0');
            const monthFormatted = (slotDate.getMonth() + 1).toString().padStart(2, '0');
            const yearFormatted = slotDate.getFullYear();
            return `${dayFormatted}.${monthFormatted}.${yearFormatted} - ${time}`;
          }
        }
      }
    }
    return t(lang, 'medicationDetail.none');
  };

  if (!medication) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: 20, color: colors.textSecondary }}>{t(lang, 'medicationDetail.loading')}</Text>
      </View>
    );
  }

  const trackingDays = buildDailyTracking();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← {t(lang, 'medicationDetail.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t(lang, 'medicationDetail.title')}</Text>
        <TouchableOpacity 
          onPress={() => router.push({ pathname: '/add-medication', params: { id: medication.id } })} 
          style={styles.editHeaderBtn}
        >
          <Text style={styles.editHeaderBtnText}>
            ✏️ {t(lang, 'medicationDetail.edit')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.medHeroCard}>
          <View style={styles.medHeroHeaderRow}>
            <View style={styles.medHeroIcon}>
              <Text style={styles.medHeroEmoji}>{medication.type === 'vaccine' ? '🛡️' : '💊'}</Text>
            </View>
            <View style={styles.medHeroInfo}>
              <Text style={styles.medHeroName} numberOfLines={1}>{medication.name}</Text>
              <View style={styles.medHeroSubRow}>
                {medication.type !== 'vaccine' && (
                  <Text style={styles.medHeroDose}>{medication.dosage} {getTranslatedUnit(medication.unit)}</Text>
                )}
                {medication.type !== 'vaccine' && medication.startDate && (
                  <Text style={styles.medHeroDate}>📅 {formatDate(medication.originalStartDate || medication.startDate)}</Text>
                )}
              </View>
            </View>
          </View>
 
          {medication.type !== 'vaccine' && medication.times && medication.times.length > 0 && (
            <View style={styles.timesRow}>
              {medication.times.map((time: string, i: number) => (
                <View key={i} style={styles.timeTag}>
                  <Text style={styles.timeTagText}>🕐 {time}</Text>
                </View>
              ))}
            </View>
          )}
 
          {/* AI Info inside Hero Card */}
          <TouchableOpacity
            style={[styles.compactAiBtn, isLoadingInfo && styles.infoButtonLoading]}
            onPress={handleGetInfo}
            disabled={isLoadingInfo}
            activeOpacity={0.85}
          >
            {isLoadingInfo ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.compactAiBtnText}>{t(lang, 'medicationDetail.aiAnalyzing')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.compactAiBtnIcon}>🤖</Text>
                <Text style={styles.compactAiBtnText}>
                  {aiInfo 
                    ? (lang === 'tr' ? 'Yapay Zeka Analizini Gör' : 'Show AI Analysis')
                    : t(lang, 'medicationDetail.aiButton')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
 
        <View style={styles.infoCard}>
          <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoType')} value={getTranslatedTypeLabel(medication.type)} icon="📋" />
          {medication.type !== 'vaccine' && (
            <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoDaily')} value={`${(medication.times || []).length}${t(lang, 'medicationDetail.timesPerDay')}`} icon="🔁" />
          )}
          <InfoRow styles={styles} label={t(lang, 'medicationDetail.lastTaken')} value={getLastTakenString()} icon="⏱️" />
          <InfoRow styles={styles} label={t(lang, 'medicationDetail.nextTake')} value={getNextIntakeString()} icon="⏰" />
          {medication.type === 'vaccine' && medication.dates && (
            <InfoRow 
              styles={styles} 
              label={lang === 'tr' ? 'Aşı Tarihleri' : 'Vaccine Dates'} 
              value={medication.dates.map((d: string) => formatDate(d)).join(', ')} 
              icon="📅" 
            />
          )}
          {medication.type !== 'vaccine' && medication.endDate && <InfoRow styles={styles} label={t(lang, 'medicines.dateRange')} value={`${formatDate(medication.originalStartDate || medication.startDate)} - ${formatDate(medication.endDate)}`} icon="📅" />}
          {medication.type !== 'vaccine' && !medication.endDate && (medication.originalStartDate || medication.startDate) && <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoStart')} value={formatDate(medication.originalStartDate || medication.startDate)} icon="📅" />}
          
          {medication.type !== 'vaccine' && medication.strength ? (
            <InfoRow styles={styles} label={lang === 'tr' ? 'Güç / Seviye' : 'Strength'} value={medication.strength} icon="💡" />
          ) : null}

          {/* Kalan adet ve bitiş tarihi */}
          {medication.type !== 'vaccine' && medication.totalQuantity && (() => {
            const dailyDose = (medication.times || []).length * parseFloat(medication.dosage || '1');
            const daysPerCycle = medication.intervalDays || 1;

            // Kalan adet (Loglar üzerinden)
            const takenCount = medicationLogs.filter((l: any) => l.medicationId === medication.id && l.status === 'taken').length;
            const remaining = Math.max(0, medication.totalQuantity - (takenCount * parseFloat(medication.dosage || '1')));

            // Tahmini Bitiş (Kalan adede göre bugünden itibaren)
            const remainingDays = Math.floor(remaining / dailyDose) * daysPerCycle;
            const estEndDate = new Date();
            estEndDate.setDate(estEndDate.getDate() + remainingDays);
            const endDateStr = estEndDate.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'long', year: 'numeric' });

            return (
              <>
                <InfoRow styles={styles} label={lang === 'tr' ? 'Kalan Adet' : 'Remaining'} value={`${remaining} ${lang === 'tr' ? 'adet' : 'units'}`} icon="📊" />
                <InfoRow styles={styles} label={lang === 'tr' ? 'Tahmini Bitiş' : 'Est. End Date'} value={endDateStr} icon="🏁" />
              </>
            );
          })()}

          {medication.notes ? <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoNotes')} value={medication.notes} icon="📝" /> : null}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.compactTrackingBtn}
            onPress={() => setShowTrackingModal(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.compactBtnText}>📊 {t(lang, 'medicationDetail.dailyTracking')}</Text>
          </TouchableOpacity>

          {medication.isActive && (
            <TouchableOpacity
              style={styles.compactFinishBtn}
              onPress={handleFinishMedication}
              activeOpacity={0.8}
            >
              <Text style={styles.compactFinishBtnText}>🏁 {t(lang, 'medicines.finishMed')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Geçmişi Temizle Butonu */}
        <TouchableOpacity
          style={styles.compactClearHistoryBtn}
          onPress={handleClearHistory}
          activeOpacity={0.8}
        >
          <Text style={styles.compactClearHistoryText}>🗑️ {t(lang, 'medicationDetail.clearHistory')}</Text>
        </TouchableOpacity>

        <View style={{ height: SPACING.huge }} />
      </ScrollView>

      {/* AI Yanıt Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showAiModal}
        onRequestClose={() => setShowAiModal(false)}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.aiModalOverlay}>
            <View style={[styles.aiModalSheet, { paddingBottom: Math.max(insets.bottom, SPACING.xl) }]}>
              <View style={styles.aiModalHeader}>
                <Text style={styles.aiModalTitle}>🤖 {t(lang, 'medicationDetail.aiTitle')}</Text>
                <TouchableOpacity onPress={() => setShowAiModal(false)}>
                  <Text style={styles.closeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.aiModalScroll}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={{ paddingBottom: SPACING.lg }}
              >
                <Text style={styles.aiModalText}>{aiInfo}</Text>
              </ScrollView>
              <View style={styles.aiDisclaimer}>
                <Text style={styles.aiDisclaimerText}>
                  {t(lang, 'medicationDetail.aiDisclaimer')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.aiModalCloseBtn}
                onPress={() => setShowAiModal(false)}
              >
                <Text style={styles.aiModalCloseBtnText}>
                  {lang === 'tr' ? 'Kapat' : 'Close'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>

      {/* Gün Bazlı Takip Modalı */}
      <Modal
        transparent
        animationType="slide"
        visible={showTrackingModal}
        onRequestClose={() => setShowTrackingModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                {t(lang, 'medicationDetail.trackingTitle')} — {medication.name}
              </Text>
              <TouchableOpacity onPress={() => setShowTrackingModal(false)}>
                <Text style={{ fontSize: 22, color: colors.textMuted }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Lejand */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <Text style={styles.legendIcon}>✅</Text>
                <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{t(lang, 'medicationDetail.statusTaken')}</Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={styles.legendIcon}>❌</Text>
                <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{t(lang, 'medicationDetail.statusMissed')}</Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={styles.legendIcon}>⏭️</Text>
                <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{t(lang, 'medicationDetail.statusPostponed')}</Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={styles.legendIcon}>⬜</Text>
                <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{t(lang, 'medicationDetail.statusNoRecord')}</Text>
              </View>
            </View>

            <View style={styles.editInfo}>
              <Text style={styles.editInfoText}>
                💡 {lang === 'tr' 
                  ? 'Durumu değiştirmek için ikonlara dokunabilirsiniz.' 
                  : 'You can tap the icons to change the status.'}
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {trackingDays.length === 0 ? (
                <View style={{ alignItems: 'center', padding: SPACING.xxl }}>
                  <Text style={{ fontSize: 36 }}>📭</Text>
                  <Text style={{ color: colors.textSecondary, marginTop: SPACING.sm }}>{t(lang, 'medicationDetail.noHistory')}</Text>
                </View>
              ) : (
                trackingDays.map((day) => (
                  <View key={day.date} style={[styles.trackingRow, { borderBottomColor: colors.surfaceBorder }]}>
                    <Text style={[styles.trackingDate, { color: colors.textSecondary }]}>{day.label}</Text>
                    <View style={styles.trackingSlots}>
                      {day.slots.map((slot, si) => (
                        <TouchableOpacity 
                          key={si} 
                          style={styles.trackingSlot}
                          onPress={() => handleSlotPress(day.date, slot.time, slot.status)}
                          activeOpacity={0.6}
                        >
                          <Text style={styles.trackingSlotTime}>{slot.time}</Text>
                          <Text style={styles.trackingSlotIcon}>
                            {slot.status === 'taken' ? '✅' : slot.status === 'missed' ? '❌' : slot.status === 'postponed' ? '⏭️' : '⬜'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.primary }]}
              onPress={() => setShowTrackingModal(false)}
            >
              <Text style={styles.modalCloseBtnText}>{t(lang, 'addMedication.confirmBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({ styles, label, value, icon }: { styles: any; label: string; value: string; icon: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoRowIcon}>{icon}</Text>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue}>{value}</Text>
    </View>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingTop: 60, paddingBottom: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
    position: 'relative',
  },
  backBtn: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: RADIUS.full,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  headerTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: SPACING.lg,
    textAlign: 'center',
    zIndex: -1,
    fontSize: TYPOGRAPHY.fontSizeLg,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    color: colors.textPrimary,
    paddingHorizontal: 85,
  },
  editHeaderBtn: {
    backgroundColor: colors.primary + '18',
    borderWidth: 1,
    borderColor: colors.primary + '40',
    borderRadius: RADIUS.full,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  editHeaderBtnText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: 'bold',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl },
  medHeroCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, gap: SPACING.sm,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  medHeroHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
  },
  medHeroIcon: {
    width: 48, height: 48, borderRadius: RADIUS.md,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  medHeroEmoji: { fontSize: 24 },
  medHeroInfo: { flex: 1, justifyContent: 'center' },
  medHeroName: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  medHeroSubRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.sm },
  medHeroDate: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textMuted },
  medHeroDose: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textSecondary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, justifyContent: 'flex-start' },
  timeTag: {
    backgroundColor: colors.primary + '18', borderRadius: RADIUS.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  timeTagText: { fontSize: 11, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  infoCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  infoRowIcon: { fontSize: 16, width: 24 },
  infoRowLabel: { flex: 1, fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  infoRowValue: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textPrimary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  compactAiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: colors.secondary, borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    shadowColor: colors.secondary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  compactAiBtnIcon: { fontSize: 16 },
  compactAiBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  actionRow: {
    flexDirection: 'row', gap: SPACING.md, width: '100%',
  },
  compactTrackingBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary + '18', borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: colors.primary + '44',
  },
  compactFinishBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.danger + '22', borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: colors.danger + '44',
  },
  compactFinishBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.danger },
  compactBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.primary },
  compactClearHistoryBtn: {
    backgroundColor: colors.danger + '11', borderRadius: RADIUS.md,
    padding: SPACING.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.danger + '22',
  },
  compactClearHistoryText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.danger, fontWeight: TYPOGRAPHY.fontWeightMedium },
  infoButtonLoading: { opacity: 0.7 },
  aiResultCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: colors.secondary + '44',
    gap: SPACING.md,
  },
  aiResultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiResultTitle: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  closeBtn: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.textMuted },
  aiPreviewText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, lineHeight: 22 },
  readMoreBtn: {
    backgroundColor: colors.secondary + '22', borderRadius: RADIUS.md,
    padding: SPACING.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.secondary + '44',
  },
  readMoreBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.secondary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  // AI Modal
  aiModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end',
  },
  aiModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    height: '80%', padding: SPACING.xl, gap: SPACING.md,
  },
  aiModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiModalTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  aiModalScroll: { flex: 1 },
  aiModalText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, lineHeight: 24 },
  aiModalCloseBtn: {
    backgroundColor: colors.secondary, borderRadius: RADIUS.lg,
    padding: SPACING.md, alignItems: 'center',
  },
  aiModalCloseBtnText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  aiResultText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, lineHeight: 22 },
  aiDisclaimer: {
    backgroundColor: colors.warning + '22', borderRadius: RADIUS.sm,
    padding: SPACING.sm, borderWidth: 1, borderColor: colors.warning + '44',
  },
  aiDisclaimerText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.warning },
  finishButton: {
    backgroundColor: colors.danger + '22', borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    borderWidth: 1, borderColor: colors.danger + '44',
  },
  finishButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.danger },
  trackingButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.primary + '18', borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: colors.primary + '44',
  },
  trackingButtonIcon: { fontSize: 28 },
  trackingButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.primary },
  trackingButtonSub: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textMuted, marginTop: 2 },
  clearHistoryButton: {
    backgroundColor: colors.danger + '11', borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    borderWidth: 1, borderColor: colors.danger + '22',
  },
  clearHistoryText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.danger, fontWeight: TYPOGRAPHY.fontWeightMedium },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xxl, paddingBottom: 40,
    borderWidth: 1,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md,
  },
  modalTitle: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, flex: 1 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.lg, marginBottom: SPACING.md, paddingVertical: SPACING.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendIcon: { fontSize: 16 },
  legendLabel: { fontSize: TYPOGRAPHY.fontSizeXs },
  trackingRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm,
    borderBottomWidth: 1, gap: SPACING.md,
  },
  trackingDate: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightMedium, width: 40 },
  trackingSlots: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  trackingSlot: { alignItems: 'center', gap: 2, padding: 4 },
  trackingSlotTime: { fontSize: 10, color: '#888' },
  trackingSlotIcon: { fontSize: 18 },
  editInfo: {
    backgroundColor: colors.primary + '11',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: colors.primary + '33',
  },
  editInfoText: {
    fontSize: TYPOGRAPHY.fontSizeXs,
    color: colors.primary,
    textAlign: 'center',
    fontWeight: TYPOGRAPHY.fontWeightMedium,
  },
  modalCloseBtn: { borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center', marginTop: SPACING.lg },
  modalCloseBtnText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
});
