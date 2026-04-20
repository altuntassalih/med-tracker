import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useStore } from '../../store/useStore';
import { getMedications, Medication, addMedicationLog, MedicationLog, updateMedication } from '../../services/firestore';
import { checkAndRefreshEndOfDayNotification, rescheduleIntervalNotificationAfterTake, scheduleMedicationNotification, cancelMedicationNotifications, requestNotificationPermission } from '../../services/notifications';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../../constants/AppConstants';
import { t, LanguageCode } from '../../constants/translations';
import { getLocalDateString } from '../../utils/date';

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

export default function HomeScreen() {
  const { user, profiles, activeProfileId, setActiveProfileId, medications: allMedications, medicationLogs, addMedicationLogState, updateMedication: updateMedInStore, language, theme, showAlert } = useStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tick, setTick] = useState(0); // Her dakika UI'ı tazeler

  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  
  const medications = (allMedications || []).filter(m => m.profileId === activeProfile?.id && m.isActive !== false);
  const logs = (medicationLogs || []).filter(l => l.profileId === activeProfile?.id);

  const todayStr = getLocalDateString();
  const yesterdayStr = getLocalDateString(new Date(Date.now() - 86400000));

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

  const handleTakeMedication = async (medId: string, time: string, diff?: number) => {
    if (!activeProfile?.id) return;
    
    const lang = language as LanguageCode;

    // --- Hangi günün ilacı? ---
    // diff === -2000: Özel marker "dünün ilacı" (overdue listesinden, label='Dün')
    // diff < 0 ve timeMinutes > currentMinutes: saat ilerisi demek ama gece yarısını geçmiş → DÜN
    // Diğer durumlar: BUGÜN
    let targetStr = todayStr;

    if (diff === -2000) {
      targetStr = yesterdayStr;
    } else if (diff !== undefined && diff < 0) {
      const [h, m] = time.split(':').map(Number);
      const timeMinutes = h * 60 + m;
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      // Saat gece yarısından sonra ve ilaç saati günün ilerisi (örn. 22:00)
      // → Bu dünkü ilaçtır
      if (timeMinutes > currentMinutes) {
        targetStr = yesterdayStr;
      }
    }

    const med = medications.find(m => m.id === medId);
    const intervalDays = med?.intervalDays;
    const isIntervalDrug = intervalDays && intervalDays > 1 && intervalDays !== 7;

    // --- Periyodik ilaç alım kaydı ---
    const logData: Omit<MedicationLog, 'id' | 'createdAt'> = {
      profileId: activeProfile.id,
      medicationId: medId,
      expectedTime: time,
      takenAt: new Date().toISOString(),
      scheduledDate: targetStr,
      status: 'taken',
    };
    addMedicationLogState({ id: 'temp_' + Date.now(), ...logData });
    await addMedicationLog(logData);

    // Periyodik bildirim: alım sonrası sonraki tarihi zamanla
    if (isIntervalDrug && med) {
      rescheduleIntervalNotificationAfterTake(
        med.id, med.name, med.dosage, time, lang, intervalDays, med.startDate
      );
    }

    checkAndRefreshEndOfDayNotification(lang);

    // --- Periyot güncelleme sorusu ---
    // Senaryo: Dünkü (overdue "Dün") periyodik ilaç bugün alındı
    // → "Periyodu bugüne endekslemek ister misiniz?" sor
    if (isIntervalDrug && med && diff === -2000) {
      setTimeout(() => askPeriodReset(med), 600);
    }
  };

  const handlePostpone = async (medId: string, time: string, diff?: number) => {
    if (!activeProfile?.id) return;
    const lang = language as LanguageCode;

    let targetStr = todayStr;
    if (diff === -2000) {
      targetStr = yesterdayStr;
    } else if (diff !== undefined && diff < 0) {
      const [h, m] = time.split(':').map(Number);
      const timeMinutes = h * 60 + m;
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      if (timeMinutes > currentMinutes) targetStr = yesterdayStr;
    }

    const med = medications.find(m => m.id === medId);
    if (!med) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrow);

    const logData: Omit<MedicationLog, 'id' | 'createdAt'> = {
      profileId: activeProfile.id,
      medicationId: medId,
      expectedTime: time,
      takenAt: new Date().toISOString(),
      scheduledDate: targetStr,
      status: 'postponed',
    };
    addMedicationLogState({ id: 'temp_' + Date.now(), ...logData });
    await addMedicationLog(logData);

    await updateMedication(med.id, { startDate: tomorrowStr });
    updateMedInStore(med.id, { startDate: tomorrowStr });

    const hasPermission = await requestNotificationPermission();
    if (hasPermission) {
      await cancelMedicationNotifications(med.id);
      for (const t of med.times) {
        await scheduleMedicationNotification(
          med.id, med.name, med.dosage, t,
          lang, med.intervalDays || 1, tomorrowStr
        );
      }
    }

    checkAndRefreshEndOfDayNotification(lang);

    showAlert({
      message: t(lang, 'home.postponeSuccess'),
      type: 'success',
    });
  };


  const onRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getMedicationLists = () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let upcoming: any[] = [];
    let overdue: any[] = [];
    let completed: any[] = [];
    // Dün overdue'ya eklenen ilaç+saat çiftlerini takip et (çifter önlemek için)
    const addedToOverdue = new Set<string>();

    medications.forEach((med) => {
      // 1. DÜNÜ KONTROL ET (Dünden kalan içilmemiş ilaç var mı?)
      // Önemli: ilaç dün veya daha önce başlamış olmalı (startDate <= yesterdayStr)
      const medStartedBeforeToday = med.startDate <= yesterdayStr;
      let isForYesterday = false;
      if (medStartedBeforeToday) {
        if (med.intervalDays && med.intervalDays > 1) {
          const start = new Date(med.startDate + 'T00:00:00');
          const yesterdayDate = new Date();
          yesterdayDate.setDate(yesterdayDate.getDate() - 1);
          yesterdayDate.setHours(0, 0, 0, 0);
          const daysDiff = Math.floor((yesterdayDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= 0 && daysDiff % med.intervalDays === 0) isForYesterday = true;
        } else {
          isForYesterday = true;
        }
      }

      if (isForYesterday) {
        (med.times || []).forEach((time) => {
          const isTakenYesterday = logs.some((l) => 
            l.medicationId === med.id && 
            l.expectedTime === time && 
            (l.scheduledDate === yesterdayStr || (!l.scheduledDate && l.takenAt.startsWith(yesterdayStr))) &&
            (l.status === 'taken' || l.status === 'postponed')
          );

          if (!isTakenYesterday) {
            // Dünden kalan ilaç -> Süresi geçti
            const key = `${med.id}-${time}`;
            addedToOverdue.add(key);
            overdue.push({ med, time, timeMinutes: 0, diff: -2000, label: t(language as LanguageCode, 'home.yesterday') || 'Dün' });
          }
        });
      }

      // 2. BUGÜNÜ KONTROL ET
      let isForToday = false;
      if (med.intervalDays && med.intervalDays > 1) {
        const start = new Date(med.startDate + 'T00:00:00');
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((todayDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff >= 0 && daysDiff % med.intervalDays === 0) isForToday = true;
      } else {
        isForToday = true;
      }

      if (isForToday) {
        (med.times || []).forEach((time) => {
          // Dün overdue'ya eklenmiş aynı ilaç+saat çifti ise bugün atla (çifter olmasın)
          if (addedToOverdue.has(`${med.id}-${time}`)) return;

          const isTakenToday = logs.some((l) => 
            l.medicationId === med.id && 
            l.expectedTime === time && 
            (l.scheduledDate === todayStr || (!l.scheduledDate && l.takenAt.startsWith(todayStr))) &&
            (l.status === 'taken' || l.status === 'postponed')
          );

          if (isTakenToday) return;

          const [h, m] = time.split(':').map(Number);
          const timeMinutes = h * 60 + m;
          let diff = timeMinutes - currentMinutes;

          if (diff < -OVERDUE_THRESHOLD_MINUTES) {
            // OVERDUE_THRESHOLD_MINUTES dk geçtikten sonra -> Süresi Geçti
            overdue.push({ med, time, timeMinutes, diff });
          } else if (diff <= UPCOMING_WINDOW_MINUTES) {
            // Henüz saati gelmeyenler veya grace period içindekiler -> Yaklaşan
            upcoming.push({ med, time, timeMinutes, diff });
          }
        });
      }
    });

    // Tamamlananlar: filtrelenmiş medications listesinden al (çifter olmasın)
    medications.forEach((med) => {
      (med.times || []).forEach((time) => {
        const isTakenToday = logs.some((l) => 
          l.medicationId === med.id && 
          l.expectedTime === time && 
          (l.scheduledDate === todayStr || (!l.scheduledDate && l.takenAt.startsWith(todayStr))) &&
          l.status === 'taken'
        );
        if (isTakenToday) {
          completed.push({ med, time });
        }
      });
    });

    return {
      upcoming: upcoming.sort((a, b) => a.diff - b.diff),
      overdue: overdue.sort((a, b) => a.diff - b.diff),
      completed,
    };
  };

  const { upcoming: upcomingMeds, overdue: overdueMeds, completed: completedMeds } = getMedicationLists();

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
          <View>
            <Text style={styles.greeting}>{getTodayGreeting(language as LanguageCode)},</Text>
            <Text style={styles.userName}>{user?.displayName?.split(' ')[0] ?? 'Kullanıcı'} 👋</Text>
            <Text style={styles.dateText}>{getTodayDate(language as LanguageCode)}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/profile-settings')} activeOpacity={0.8}>
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{activeProfile?.avatar || '👤'}</Text>
            </View>
          </TouchableOpacity>
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
                  <Text style={styles.profileChipEmoji}>{profile.avatar || (profile.isMain ? '👤' : '👦')}</Text>
                  <Text style={[styles.profileChipText, activeProfileId === profile.id && styles.profileChipTextActive]}>
                    {profile.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: colors.primary }]}>
            <Text style={styles.statValue}>{medications.length}</Text>
            <Text style={styles.statLabel}>{t(language as LanguageCode, 'home.activeMed')}</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: colors.secondary }]}>
            <Text style={styles.statValue}>{completedMeds.length}</Text>
            <Text style={styles.statLabel}>{t(language as LanguageCode, 'home.completed')}</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: colors.accent }]}>
            <Text style={styles.statValue}>{upcomingMeds.length}</Text>
            <Text style={styles.statLabel}>{t(language as LanguageCode, 'home.upcoming')}</Text>
          </View>
        </View>

        {/* Süresi Geçmiş İlaçlar */}
        {overdueMeds.length > 0 && (
          <View style={styles.section}>
            <View style={styles.overdueHeader}>
              <Text style={styles.overdueTitle}>⏰ {t(language as LanguageCode, 'home.overdueTitle')}</Text>
              <View style={styles.overdueBadge}>
                <Text style={styles.overdueBadgeText}>{overdueMeds.length}</Text>
              </View>
            </View>
            {overdueMeds.map((item, i) => {
              const minsAgo = Math.abs(item.diff);
              const hoursAgo = Math.floor(minsAgo / 60);
              const minsLeft = minsAgo % 60;
              const timeAgoStr = hoursAgo > 0
                ? `${hoursAgo}s ${minsLeft}dk önce`
                : `${minsAgo}dk önce`;
              return (
                <View key={i} style={styles.overdueCard}>
                  <View style={styles.overdueTimeChip}>
                    <Text style={styles.overdueTimeText}>{item.time}</Text>
                  </View>
                  <View style={styles.upcomingInfo}>
                    <Text style={styles.upcomingName}>{item.med.name}</Text>
                    <Text style={styles.upcomingDose}>{item.med.dosage} {item.med.unit}</Text>
                    {item.label ? (
                      <Text style={styles.overdueAgo}>{item.label}</Text>
                    ) : (
                      <Text style={styles.overdueAgo}>{timeAgoStr}</Text>
                    )}
                  </View>
                  <View style={styles.actionButtons}>
                    <TouchableOpacity style={styles.postponeBtn} onPress={() => handlePostpone(item.med.id, item.time, item.diff)}>
                      <Text style={styles.postponeBtnEmoji}>⏭️</Text>
                      <Text style={styles.postponeBtnText}>{t(language as LanguageCode, 'home.postponeBtn')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.takeBtn} onPress={() => handleTakeMedication(item.med.id, item.time, item.diff)}>
                      <Text style={styles.takeBtnEmoji}>✓</Text>
                      <Text style={styles.takeBtnText}>{t(language as LanguageCode, 'home.takeBtn')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(language as LanguageCode, 'home.upcomingTitle')}</Text>
          {upcomingMeds.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEmoji}>✅</Text>
              <Text style={styles.emptyText}>{t(language as LanguageCode, 'home.noUpcoming')}</Text>
            </View>
          ) : (
            upcomingMeds.map((item, i) => {
              const isPast = item.diff < 0;
              const isSoon = item.diff >= 0 && item.diff <= 30;
              return (
                <View key={i} style={[styles.upcomingCard, isSoon && styles.upcomingCardUrgent]}>
                  <View style={[styles.timeChip, { backgroundColor: isPast ? colors.danger + '33' : isSoon ? colors.warning + '33' : colors.primary + '33' }]}>
                    <Text style={[styles.timeText, { color: isPast ? colors.danger : isSoon ? colors.warning : colors.primary }]}>
                      {item.time}
                    </Text>
                  </View>
                  <View style={styles.upcomingInfo}>
                    <Text style={styles.upcomingName}>{item.med.name}</Text>
                    <Text style={styles.upcomingDose}>{item.med.dosage} {item.med.unit}</Text>
                    <Text style={styles.upcomingDiff}>
                      {isPast ? t(language as LanguageCode, 'home.passed') : item.diff === 0 ? t(language as LanguageCode, 'home.now') : `${item.diff} ${t(language as LanguageCode, 'home.minsLater')}`}
                    </Text>
                  </View>
                  <View style={styles.actionButtons}>
                    <TouchableOpacity style={styles.postponeBtn} onPress={() => handlePostpone(item.med.id, item.time, item.diff)}>
                      <Text style={styles.postponeBtnEmoji}>⏭️</Text>
                      <Text style={styles.postponeBtnText}>{t(language as LanguageCode, 'home.postponeBtn')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.takeBtn} onPress={() => handleTakeMedication(item.med.id, item.time, item.diff)}>
                      <Text style={styles.takeBtnEmoji}>✓</Text>
                      <Text style={styles.takeBtnText}>{t(language as LanguageCode, 'home.takeBtn')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {completedMeds.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t(language as LanguageCode, 'home.completedTitle')}</Text>
            {completedMeds.map((item, i) => (
              <View key={i} style={styles.completedCard}>
                <View style={styles.completedIconBox}>
                  <Text style={styles.completedIcon}>✅</Text>
                </View>
                <View style={styles.completedInfo}>
                  <Text style={styles.completedName}>{item.med.name}</Text>
                  <Text style={styles.completedMeta}>{item.time} {t(language as LanguageCode, 'home.completedTarget')}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t(language as LanguageCode, 'home.allMedsTitle')}</Text>
            <TouchableOpacity onPress={() => router.push('/add-medication')}>
              <Text style={styles.addLink}>{t(language as LanguageCode, 'home.addBtn')}</Text>
            </TouchableOpacity>
          </View>
          {medications.length === 0 ? (
            <TouchableOpacity style={styles.addFirstCard} onPress={() => router.push('/add-medication')}>
              <Text style={styles.addFirstEmoji}>💊</Text>
              <Text style={styles.addFirstText}>{t(language as LanguageCode, 'home.addFirstTitle')}</Text>
              <Text style={styles.addFirstSub}>{t(language as LanguageCode, 'home.addFirstSub')}</Text>
            </TouchableOpacity>
          ) : (
            medications.map((med) => (
              <TouchableOpacity
                key={med.id}
                style={styles.medCard}
                onPress={() => router.push({ pathname: '/medication-detail', params: { id: med.id } })}
                activeOpacity={0.8}
              >
                <View style={styles.medIconContainer}>
                  <Text style={styles.medIcon}>💊</Text>
                </View>
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medDose}>{med.dosage} {med.unit}{med.strength ? ` · ${med.strength}` : ''}</Text>
                  <Text style={styles.medTimes}>{(med.times || []).join(' · ')}</Text>
                </View>
                <Text style={styles.medArrow}>›</Text>
              </TouchableOpacity>
            ))
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
  scrollContent: { paddingBottom: 100 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: SPACING.xl,
    paddingTop: 60,
    paddingBottom: SPACING.xl,
  },
  greeting: { fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textSecondary },
  userName: { fontSize: TYPOGRAPHY.fontSize2xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary, marginTop: 2 },
  dateText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, marginTop: 4 },
  avatarPlaceholder: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  section: { paddingHorizontal: SPACING.xl, marginBottom: SPACING.xxl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary, marginBottom: SPACING.md },
  addLink: { fontSize: TYPOGRAPHY.fontSizeMd, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
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
  statValue: { fontSize: TYPOGRAPHY.fontSize2xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
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
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  postponeBtn: {
    backgroundColor: colors.surfaceBorder + '44',
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  postponeBtnEmoji: { fontSize: 12 },
  postponeBtnText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textSecondary, fontWeight: TYPOGRAPHY.fontWeightMedium },
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
});
