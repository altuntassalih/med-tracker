import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getMedicationInfo } from '../services/gemini';
import { useStore } from '../store/useStore';
import { updateMedication, clearMedicationLogs, addMedicationLog, updateMedicationLog, deleteMedicationLog, MedicationLog } from '../services/firestore';
import { cancelMedicationNotifications, checkAndRefreshEndOfDayNotification, rescheduleIntervalNotificationAfterTake, scheduleMedicationNotification, requestNotificationPermission } from '../services/notifications';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { formatDate, getLocalDateString } from '../utils/date';

// Kaç günlük geçmiş gösterilecek
const TRACKING_DAYS_COUNT = 30;

export default function MedicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
    setIsLoadingInfo(true);
    setAiInfo(null);
    try {
      const info = await getMedicationInfo(medication.name, lang);
      setAiInfo(info);
    } catch (err) {
      showAlert({ 
        message: lang === 'tr' ? 'Bilgi alınamadı.' : 'Could not get info.',
        type: 'danger'
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
    if (u === 'tablet' || u === 'kapsül' || u === 'damla') {
      return t(lang, `medicationOptions.units.${u}`);
    }
    return u;
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
              await updateMedication(med.id, { startDate: newStartDate });
              updateMedInStore(med.id, { startDate: newStartDate });
              setMedication((prev: any) => prev ? { ...prev, startDate: newStartDate } : prev);

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

    const todayStr = new Date().toISOString().split('T')[0];
    const existingLog = medicationLogs.find(
      l => l.medicationId === medication.id && 
           l.expectedTime === time && 
           (l.scheduledDate === dateStr || (!l.scheduledDate && l.takenAt.startsWith(dateStr)))
    );

    try {
      if (currentStatus === 'none') {
        const logData: Omit<MedicationLog, 'id' | 'createdAt'> = {
          profileId: activeProfileId,
          medicationId: medication.id,
          expectedTime: time,
          takenAt: new Date().toISOString(),
          scheduledDate: dateStr,
          status: 'taken',
        };
        addMedicationLogState({ id: 'temp_' + Date.now(), ...logData });
        await addMedicationLog(logData);

        // Periyodik ilaç kontrolü
        const isIntervalDrug = medication.intervalDays && medication.intervalDays > 1 && medication.intervalDays !== 7;
        if (isIntervalDrug) {
          // Bildirim: alım sonrası sonraki tarihi zamanla
          rescheduleIntervalNotificationAfterTake(
            medication.id, medication.name, medication.dosage, time,
            lang, medication.intervalDays, medication.startDate
          );

          // Periyot sorusu: Kullanıcı DÜN'ü (geçmiş geçerli günü) işaretlediyse sor
          // Bugünü işaretlediyse sormaya gerek yok (zaten doğru gün)
          const yesterdayStr = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            d.setHours(0, 0, 0, 0);
            return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
          })();
          if (dateStr === yesterdayStr) {
            setTimeout(() => askPeriodResetFromDetail(medication), 600);
          }
        }

      } else if (currentStatus === 'taken') {
        if (existingLog) {
          updateMedicationLogState(existingLog.id, { status: 'missed' });
          await updateMedicationLog(existingLog.id, { status: 'missed' });
        }
      } else if (currentStatus === 'missed') {
        if (existingLog) {
          updateMedicationLogState(existingLog.id, { status: 'postponed' });
          await updateMedicationLog(existingLog.id, { status: 'postponed' });
        }
      } else if (currentStatus === 'postponed') {
        if (existingLog) {
          deleteMedicationLogState(existingLog.id);
          await deleteMedicationLog(existingLog.id);
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

    for (let i = 0; i < TRACKING_DAYS_COUNT; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateString(d);

      // Aralıklı ilaç kontrolü
      if (medication.intervalDays && medication.intervalDays > 1) {
        const start = new Date(medication.startDate).setHours(0, 0, 0, 0);
        const dayTs = d.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((dayTs - start) / (1000 * 60 * 60 * 24));
        if (daysDiff >= 0 && daysDiff % medication.intervalDays !== 0) continue;
        if (daysDiff < 0) continue;
      }

      // İlaç başlangıcından önce gösterme
      if (dateStr < medication.startDate) break;

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
          <Text style={styles.backBtnText}>‹ {t(lang, 'medicationDetail.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t(lang, 'medicationDetail.title')}</Text>
        <TouchableOpacity 
          onPress={() => router.push({ pathname: '/add-medication', params: { id: medication.id } })} 
          style={{ width: 60, alignItems: 'flex-end' }}
        >
          <Text style={{ fontSize: TYPOGRAPHY.fontSizeMd, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium }}>
            {t(lang, 'medicationDetail.edit')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.medHeroCard}>
          <Text style={styles.medHeroDate}>📅 {formatDate(medication.startDate)} {t(lang, 'addMedication.startDateLabel')}</Text>
          <View style={styles.medHeroIcon}>
            <Text style={styles.medHeroEmoji}>💊</Text>
          </View>
          <Text style={styles.medHeroName}>{medication.name}</Text>
          <Text style={styles.medHeroDose}>{medication.dosage} {getTranslatedUnit(medication.unit)}</Text>

          <View style={styles.timesRow}>
            {(medication.times || []).map((time: string, i: number) => (
              <View key={i} style={styles.timeTag}>
                <Text style={styles.timeTagText}>🕐 {time}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.infoCard}>
          <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoType')} value={getTranslatedTypeLabel(medication.type)} icon="📋" />
          <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoDaily')} value={`${(medication.times || []).length}${t(lang, 'medicationDetail.timesPerDay')}`} icon="🔁" />
          {medication.endDate && <InfoRow styles={styles} label={t(lang, 'medicines.dateRange')} value={`${formatDate(medication.startDate)} - ${formatDate(medication.endDate)}`} icon="📅" />}
          {!medication.endDate && medication.startDate && <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoStart')} value={formatDate(medication.startDate)} icon="📅" />}
        {/* Opsiyonel güç/seviye */}
          {medication.strength
            ? <InfoRow styles={styles} label={lang === 'tr' ? 'Güç / Seviye' : 'Strength'} value={medication.strength} icon="💡" />
            : null
          }

          {/* Kalan adet ve bitiş tarihi */}
          {medication.totalQuantity && (() => {
            const dailyDose = (medication.times || []).length * parseFloat(medication.dosage || '1');
            const daysPerCycle = medication.intervalDays || 1;
            // Kaç günü karşılar?
            const totalDays = Math.floor(medication.totalQuantity / dailyDose / daysPerCycle) * daysPerCycle;
            const endDate = new Date(medication.startDate + 'T00:00:00');
            endDate.setDate(endDate.getDate() + totalDays);
            const endDateStr = endDate.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'long', year: 'numeric' });

            // Kalan adet
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const start = new Date(medication.startDate + 'T00:00:00');
            const passedDays = Math.max(0, Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
            const usedDoses = Math.floor(passedDays / daysPerCycle) * dailyDose;
            const remaining = Math.max(0, medication.totalQuantity - usedDoses);

            return (
              <>
                <InfoRow styles={styles} label={lang === 'tr' ? 'Kalan Adet' : 'Remaining'} value={`${remaining} ${lang === 'tr' ? 'adet' : 'units'}`} icon="📊" />
                <InfoRow styles={styles} label={lang === 'tr' ? 'Tahmini Bitiş' : 'Est. End Date'} value={endDateStr} icon="🏁" />
              </>
            );
          })()}

          {medication.notes ? <InfoRow styles={styles} label={t(lang, 'medicationDetail.infoNotes')} value={medication.notes} icon="📝" /> : null}
        </View>

        {medication.isActive && (
          <TouchableOpacity
            style={styles.finishButton}
            onPress={handleFinishMedication}
            activeOpacity={0.8}
          >
            <Text style={styles.finishButtonText}>🏁 {t(lang, 'medicines.finishMed')}</Text>
          </TouchableOpacity>
        )}

        {/* Gün Bazlı Alım Takibi Butonu */}
        <TouchableOpacity
          style={styles.trackingButton}
          onPress={() => setShowTrackingModal(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.trackingButtonIcon}>📊</Text>
          <View>
            <Text style={styles.trackingButtonText}>{t(lang, 'medicationDetail.dailyTracking')}</Text>
            <Text style={styles.trackingButtonSub}>{lang === 'tr' ? `Son ${TRACKING_DAYS_COUNT} gün` : `Last ${TRACKING_DAYS_COUNT} days`}</Text>
          </View>
        </TouchableOpacity>

        {/* Geçmişi Temizle Butonu */}
        <TouchableOpacity
          style={styles.clearHistoryButton}
          onPress={handleClearHistory}
          activeOpacity={0.8}
        >
          <Text style={styles.clearHistoryText}>🗑️ {t(lang, 'medicationDetail.clearHistory')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.infoButton, isLoadingInfo && styles.infoButtonLoading]}
          onPress={handleGetInfo}
          disabled={isLoadingInfo}
          activeOpacity={0.85}
        >
          {isLoadingInfo ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.infoButtonText}>{t(lang, 'medicationDetail.aiAnalyzing')}</Text>
            </>
          ) : (
            <>
              <Text style={styles.infoButtonIcon}>🤖</Text>
              <View>
                <Text style={styles.infoButtonText}>{t(lang, 'medicationDetail.aiButton')}</Text>
                <Text style={styles.infoButtonSub}>{t(lang, 'medicationDetail.aiButtonSub')} {medication.name}</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        {aiInfo && (
          <View style={styles.aiResultCard}>
            <View style={styles.aiResultHeader}>
              <Text style={styles.aiResultTitle}>🤖 {t(lang, 'medicationDetail.aiTitle')}</Text>
              <TouchableOpacity onPress={() => setAiInfo(null)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={true}>
              <Text style={styles.aiResultText}>{aiInfo}</Text>
            </ScrollView>
            <View style={styles.aiDisclaimer}>
              <Text style={styles.aiDisclaimerText}>
                {t(lang, 'medicationDetail.aiDisclaimer')}
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: SPACING.huge }} />
      </ScrollView>

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
  },
  backBtn: { width: 60 },
  backBtnText: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.primary },
  headerTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.xl, gap: SPACING.lg },
  medHeroCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.xl,
    padding: SPACING.xxl, alignItems: 'center', gap: SPACING.md,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  medHeroIcon: {
    width: 80, height: 80, borderRadius: RADIUS.xl,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  medHeroEmoji: { fontSize: 40 },
  medHeroDate: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium, marginBottom: -10 },
  medHeroName: { fontSize: TYPOGRAPHY.fontSize2xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  medHeroDose: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.textSecondary },
  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, justifyContent: 'center' },
  timeTag: {
    backgroundColor: colors.primary + '22', borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
  },
  timeTagText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  infoCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  infoRowIcon: { fontSize: 18, width: 28 },
  infoRowLabel: { flex: 1, fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  infoRowValue: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textPrimary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  infoButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.secondary, borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    shadowColor: colors.secondary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  infoButtonLoading: { opacity: 0.7 },
  infoButtonIcon: { fontSize: 28 },
  infoButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  infoButtonSub: { fontSize: TYPOGRAPHY.fontSizeXs, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  aiResultCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: colors.secondary + '44',
    gap: SPACING.md,
  },
  aiResultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiResultTitle: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  closeBtn: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.textMuted },
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
