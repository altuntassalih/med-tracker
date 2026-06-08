import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import { useStore } from '../../store/useStore';
import { upsertDailyHealthLog, DailyHealthLog } from '../../services/firestore';
import { getGeminiHealthInsights } from '../../services/gemini';
import { db } from '../../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, GENDER_FEMALE } from '../../constants/AppConstants';
import { t, LanguageCode } from '../../constants/translations';
import { getLocalDateString } from '../../utils/date';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width } = Dimensions.get('window');
const STANDARD_CUP_ML = 250;
const DEFAULT_WATER_TARGET_ML = 2000;

export default function HealthScreen() {
  const {
    profiles,
    activeProfileId,
    setProfiles,
    dailyHealthLogs,
    upsertDailyHealthLogState,
    language,
    theme,
    showAlert,
    medicationLogs,
    medications,
  } = useStore();

  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const [activeTab, setActiveTab] = useState<'log' | 'reports'>('log');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Form State
  const [waterMl, setWaterMl] = useState<number>(0);
  const [waterTargetMl, setWaterTargetMl] = useState<number>(DEFAULT_WATER_TARGET_ML);
  const [mood, setMood] = useState<'excellent' | 'good' | 'neutral' | 'bad' | 'terrible' | undefined>(undefined);
  const [sleepHours, setSleepHours] = useState<number>(8);
  const [sleepRating, setSleepRating] = useState<number>(3); // 1-5 rating
  const [weight, setWeight] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // AI Modal State
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiReport, setAiReport] = useState<string>('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Yaş, kilo ve boya göre önerilen günlük su miktarı hesaplama
  const getRecommendedWater = () => {
    const weightVal = activeProfile?.weight || 0;
    const heightVal = activeProfile?.height || 0;
    const ageVal = activeProfile?.age;
    const genderVal = activeProfile?.gender;
    if (!weightVal) return DEFAULT_WATER_TARGET_ML; // Varsayılan ml

    const baseMultiplier = genderVal === GENDER_FEMALE ? 31 : 35;
    let base = weightVal * baseMultiplier;
    if (ageVal) {
      if (ageVal < 30) base = weightVal * (baseMultiplier + 5);
      else if (ageVal > 65) base = weightVal * (baseMultiplier - 5);
    }
    if (heightVal > 185) base += 250; // Boy düzeltmesi
    return Math.round(base / 100) * 100; // En yakın 100 ml'e yuvarla
  };

  const recommendedTarget = getRecommendedWater();

  const logsForProfile = (dailyHealthLogs || []).filter(l => l.profileId === activeProfile?.id);
  const activeLog = logsForProfile.find(l => l.date === selectedDate);

  // Load active log data when selected date or profile changes
  useEffect(() => {
    if (activeLog) {
      setWaterMl(activeLog.waterIntakeMl || 0);
      setWaterTargetMl(activeLog.waterTargetMl ?? recommendedTarget);
      setMood(activeLog.mood);
      setSleepHours(activeLog.sleepHours ?? 8);
      setSleepRating(activeLog.sleepRating ?? 3);
      setWeight(activeLog.weightKg ? activeLog.weightKg.toString() : '');
    } else {
      // Default / reset
      setWaterMl(0);
      setWaterTargetMl(recommendedTarget);
      setMood(undefined);
      setSleepHours(8);
      setSleepRating(3);
      setWeight(activeProfile?.weight ? activeProfile.weight.toString() : '');
    }
  }, [selectedDate, activeProfileId, activeLog, recommendedTarget]);

  const handleDateChange = (days: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const dateStr = getLocalDateString(d);
    if (dateStr <= getLocalDateString()) {
      setSelectedDate(dateStr);
    }
  };

  const handleSave = async () => {
    if (!activeProfile?.id) return;
    setIsSaving(true);

    const weightVal = weight ? parseFloat(weight) : undefined;
    const updateData: Partial<DailyHealthLog> = {
      waterIntakeMl: waterMl,
      waterTargetMl,
      mood,
      sleepHours,
      sleepRating,
      weightKg: weightVal,
    };

    try {
      // 1. Save to state & DB
      const result = await upsertDailyHealthLog(activeProfile.id, selectedDate, updateData);
      upsertDailyHealthLogState(activeProfile.id, selectedDate, result);

      // 2. If date is today, update active profile current weight
      const todayStr = getLocalDateString();
      if (selectedDate === todayStr && weightVal) {
        // Update local store
        const updatedProfiles = profiles.map(p =>
          p.id === activeProfile.id ? { ...p, weight: weightVal } : p
        );
        setProfiles(updatedProfiles);

        // Update Firestore
        if (db) {
          try {
            const profileRef = doc(db, 'profiles', activeProfile.id);
            await setDoc(profileRef, { weight: weightVal }, { merge: true });
          } catch (dbErr) {
            // fail silently on offline
          }
        }
      }

      showAlert({
        message: t(lang, 'health.successSave'),
        type: 'success',
      });
    } catch (err) {
      showAlert({
        message: lang === 'tr' ? 'Kaydedilirken hata oluştu.' : 'Failed to save health data.',
        type: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Water intake helper logic
  const handleWaterIncrement = (amountMl: number) => {
    setWaterMl(prev => Math.max(0, prev + amountMl));
  };

  // Actual AI Health insights generation
  const executeAiReportGeneration = async () => {
    setIsLoadingAi(true);
    setAiReport('');
    setShowAiModal(true);

    try {
      // Gather last 7 days of logs
      const last7Days: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7Days.push(getLocalDateString(d));
      }

      let summaryText = `Profil Adı: ${activeProfile?.name}\n`;
      const genderStr = activeProfile?.gender === 'female' || activeProfile?.gender?.toLowerCase() === 'kadın' || activeProfile?.gender?.toLowerCase() === 'kadin'
        ? (lang === 'tr' ? 'Kadın' : 'Female')
        : activeProfile?.gender === 'male' || activeProfile?.gender?.toLowerCase() === 'erkek'
          ? (lang === 'tr' ? 'Erkek' : 'Male')
          : activeProfile?.gender === 'other'
            ? (lang === 'tr' ? 'Diğer' : 'Other')
            : (lang === 'tr' ? 'Belirtilmedi' : 'Not specified');
      summaryText += `Cinsiyet: ${genderStr}\n`;
      summaryText += `Mevcut Boy: ${activeProfile?.height || 'Bilinmiyor'} cm, Mevcut Kilo: ${activeProfile?.weight || 'Bilinmiyor'} kg\n\n`;
      summaryText += `Son 7 Günlük Kayıtlar:\n`;

      last7Days.forEach(dateStr => {
        const log = logsForProfile.find(l => l.date === dateStr);
        const dayMeds = (medications || []).filter(m => m.profileId === activeProfile?.id && m.isActive);
        const dayLogs = (medicationLogs || []).filter(l => l.profileId === activeProfile?.id && l.takenAt.startsWith(dateStr));
        const medAdherence = dayMeds.length > 0 
          ? `${dayLogs.filter(l => l.status === 'taken').length} / ${dayMeds.reduce((acc, m) => acc + (m.times?.length || 1), 0)} doz alındı`
          : 'İlaç tanımlanmamış';

        if (log) {
          summaryText += `- Tarih: ${dateStr}, Su: ${log.waterIntakeMl} ml (${Math.round(log.waterIntakeMl / STANDARD_CUP_ML)} Bardak), Ruh Hali: ${log.mood || 'Girmedi'}, Uyku: ${log.sleepHours ?? 'Girmedi'} saat (Kalite: ${log.sleepRating ?? 'Girmedi'}/5), Kilo: ${log.weightKg || 'Girmedi'} kg, İlaç Durumu: ${medAdherence}\n`;
        } else {
          summaryText += `- Tarih: ${dateStr}, Veri girilmedi, İlaç Durumu: ${medAdherence}\n`;
        }
      });

      const response = await getGeminiHealthInsights(summaryText, lang);
      setAiReport(response);
    } catch (err) {
      setAiReport(
        lang === 'tr'
          ? 'AI Raporu oluşturulamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.'
          : 'Could not generate AI report. Please check your internet connection and try again.'
      );
    } finally {
      setIsLoadingAi(false);
    }
  };

  // AI Health insights handler with missing data checks
  const handleGenerateAiReport = () => {
    // Count days with no health logs in the last 7 days
    const last7Days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7Days.push(getLocalDateString(d));
    }

    const missingDaysCount = last7Days.filter(dateStr => {
      const log = logsForProfile.find(l => l.date === dateStr);
      const hasWater = log && log.waterIntakeMl > 0;
      const hasSleep = log && log.sleepHours !== undefined;
      const hasWeight = log && log.weightKg !== undefined;
      const hasMood = log && log.mood !== undefined;
      return !(hasWater || hasSleep || hasWeight || hasMood);
    }).length;

    if (missingDaysCount > 0) {
      showAlert({
        message: lang === 'tr'
          ? `Son 7 güne ait ${missingDaysCount} günlük sağlık veriniz eksik. Daha doğru bir analiz için eksik günlerinizi tamamlayabilirsiniz. Yine de devam etmek ister misiniz?`
          : `You have missing health data for ${missingDaysCount} day(s) in the last 7 days. You can complete them for a more accurate analysis. Do you want to proceed anyway?`,
        type: 'warning',
        buttons: [
          { 
            text: lang === 'tr' ? 'Eksikleri Tamamla' : 'Complete Missing', 
            style: 'cancel' 
          },
          {
            text: lang === 'tr' ? 'Yine de Devam Et' : 'Proceed Anyway',
            style: 'default',
            onPress: () => {
              executeAiReportGeneration();
            }
          }
        ]
      });
    } else {
      executeAiReportGeneration();
    }
  };

  // Rendering Helper: Mood card selection
  const moodOptions: { key: typeof mood; emoji: string; labelTr: string; labelEn: string; color: string }[] = [
    { key: 'excellent', emoji: '😍', labelTr: 'Harika', labelEn: 'Excellent', color: '#10B981' },
    { key: 'good', emoji: '🙂', labelTr: 'İyi', labelEn: 'Good', color: '#3B82F6' },
    { key: 'neutral', emoji: '😐', labelTr: 'Orta', labelEn: 'Neutral', color: '#F59E0B' },
    { key: 'bad', emoji: '🙁', labelTr: 'Kötü', labelEn: 'Bad', color: '#EF4444' },
    { key: 'terrible', emoji: '😩', labelTr: 'Çok Kötü', labelEn: 'Terrible', color: '#7C3AED' },
  ];

  // Render Charts Data
  const last7DaysData = () => {
    const data = [];
    const today = new Date();
    const daysTr = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = getLocalDateString(d);
      const log = logsForProfile.find(l => l.date === dateStr);
      const label = lang === 'tr' ? daysTr[d.getDay()] : daysEn[d.getDay()];

      data.push({
        dateStr,
        label,
        dayNum: d.getDate(),
        waterMl: log?.waterIntakeMl || 0,
        waterTargetMl: log?.waterTargetMl ?? recommendedTarget,
        sleepHours: log?.sleepHours || 0,
        sleepRating: log?.sleepRating || 0,
        weightKg: log?.weightKg || 0,
        hasData: !!log,
      });
    }
    return data;
  };

  const chartData = last7DaysData();
  const hasLogHistory = chartData.some(d => d.hasData);

  return (
    <View style={styles.container}>
      <View style={styles.bgGlow} />

      {/* Başlık ve Segmentli Sekme Butonları */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t(lang, 'health.title')}</Text>
        
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'log' && styles.tabButtonActive]}
            onPress={() => setActiveTab('log')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabButtonText, activeTab === 'log' && styles.tabButtonTextActive]}>
              📝 {t(lang, 'health.dailyLog')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'reports' && styles.tabButtonActive]}
            onPress={() => setActiveTab('reports')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabButtonText, activeTab === 'reports' && styles.tabButtonTextActive]}>
              📊 {t(lang, 'health.reports')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'log' ? (
          /* ================= GÜNLÜK KAYIT EKRANI ================= */
          <View style={styles.sectionContainer}>
            {/* Tarih Seçim Barı */}
            <View style={styles.dateSelectorRow}>
              <TouchableOpacity onPress={() => handleDateChange(-1)} style={styles.dateNavBtn}>
                <Text style={styles.dateNavBtnText}>◀</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateDisplay}>
                <Text style={styles.dateDisplayText}>
                  📅 {selectedDate === getLocalDateString() 
                    ? (lang === 'tr' ? 'Bugün' : 'Today')
                    : selectedDate === getLocalDateString(new Date(Date.now() - 86400000))
                      ? (lang === 'tr' ? 'Dün' : 'Yesterday')
                      : selectedDate.split('-').reverse().join('.')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDateChange(1)}
                disabled={selectedDate >= getLocalDateString()}
                style={[styles.dateNavBtn, selectedDate >= getLocalDateString() && styles.disabledBtn]}
              >
                <Text style={[styles.dateNavBtnText, selectedDate >= getLocalDateString() && styles.disabledText]}>▶</Text>
              </TouchableOpacity>
            </View>

            {showDatePicker && (
              <DateTimePicker
                value={new Date(selectedDate + 'T00:00:00')}
                mode="date"
                maximumDate={new Date()}
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(event, date) => {
                  setShowDatePicker(false);
                  if (date && event.type !== 'dismissed') {
                    setSelectedDate(getLocalDateString(date));
                  }
                }}
              />
            )}

            {/* SU TAKİBİ KARTI */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t(lang, 'health.waterTitle')}</Text>
              <View style={styles.targetRow}>
                <Text style={styles.targetLabel}>{lang === 'tr' ? 'Günlük Hedef (ml):' : 'Daily Goal (ml):'}</Text>
                <TextInput
                  style={styles.targetInput}
                  keyboardType="numeric"
                  value={waterTargetMl.toString()}
                  onChangeText={(val) => setWaterTargetMl(Number(val.replace(/[^0-9]/g, '')) || 0)}
                  maxLength={4}
                />
              </View>
              <Text style={styles.recommendationText}>
                💡 {lang === 'tr'
                  ? `Önerilen Hedef: ${recommendedTarget} ml (Profilinize göre)`
                  : `Recommended: ${recommendedTarget} ml (Based on profile)`}
              </Text>

              <View style={styles.waterPanel}>
                {/* Bardak Göstergesi */}
                <View style={styles.glassContainer}>
                  <View style={styles.glassOuter}>
                    <View 
                      style={[
                        styles.glassInner, 
                        { height: `${Math.min(100, (waterMl / waterTargetMl) * 100)}%`, backgroundColor: colors.primary }
                      ]} 
                    />
                  </View>
                  <Text style={styles.glassLabel}>
                    {waterMl} {t(lang, 'health.ml')} {'\n'}
                    <Text style={{ fontSize: 11, fontWeight: 'bold' }}>
                      ({(waterMl / STANDARD_CUP_ML).toFixed(1)} / {(waterTargetMl / STANDARD_CUP_ML).toFixed(1)} {t(lang, 'health.cups')})
                    </Text>
                  </Text>
                </View>

                {/* Hızlı Butonlar */}
                <View style={styles.waterControls}>
                  <View style={styles.waterRow}>
                    <TouchableOpacity onPress={() => handleWaterIncrement(STANDARD_CUP_ML)} style={styles.waterAddBtn}>
                      <Text style={styles.waterAddBtnText}>+1 {t(lang, 'health.cups')} (250 ml)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleWaterIncrement(500)} style={styles.waterAddBtn}>
                      <Text style={styles.waterAddBtnText}>+2 {t(lang, 'health.cups')} (500 ml)</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.waterRow}>
                    <TouchableOpacity onPress={() => handleWaterIncrement(750)} style={styles.waterAddBtn}>
                      <Text style={styles.waterAddBtnText}>+3 {t(lang, 'health.cups')} (750 ml)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleWaterIncrement(-STANDARD_CUP_ML)} style={[styles.waterAddBtn, styles.waterSubBtn]}>
                      <Text style={[styles.waterAddBtnText, { color: colors.textSecondary }]}>-250 {t(lang, 'health.ml')}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setWaterMl(0)} style={styles.waterResetBtn}>
                    <Text style={styles.waterResetBtnText}>{lang === 'tr' ? 'Sıfırla' : 'Reset'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* UYKU KARTI */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t(lang, 'health.sleepTitle')}</Text>
              
              <View style={styles.sleepInputRow}>
                <Text style={styles.sleepInputLabel}>{t(lang, 'health.sleepDuration')}:</Text>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity 
                    style={styles.stepperBtn} 
                    onPress={() => setSleepHours(prev => Math.max(0, prev - 0.5))}
                  >
                    <Text style={styles.stepperBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{sleepHours} {t(lang, 'health.hours')}</Text>
                  <TouchableOpacity 
                    style={styles.stepperBtn} 
                    onPress={() => setSleepHours(prev => Math.min(24, prev + 0.5))}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.sleepInputRow, { marginTop: SPACING.md }]}>
                <Text style={styles.sleepInputLabel}>{t(lang, 'health.sleepQuality')}:</Text>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity 
                      key={star} 
                      onPress={() => setSleepRating(star)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.starText, sleepRating >= star && styles.starTextActive]}>
                        ⭐
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Text style={styles.sleepRatingDesc}>
                {lang === 'tr' 
                  ? moodOptions.find(o => o.key === moodOptions[sleepRating - 1]?.key)?.labelTr
                  : moodOptions.find(o => o.key === moodOptions[sleepRating - 1]?.key)?.labelEn}
              </Text>
            </View>

            {/* KİLO KARTI */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t(lang, 'health.weightTitle')}</Text>
              <View style={styles.weightInputContainer}>
                <TextInput
                  style={styles.weightInput}
                  keyboardType="numeric"
                  placeholder={t(lang, 'health.weightPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={weight}
                  onChangeText={(val) => setWeight(val.replace(/[^0-9.]/g, ''))}
                  maxLength={5}
                />
                <Text style={styles.weightUnit}>kg</Text>
              </View>
              {selectedDate === getLocalDateString() && (
                <Text style={styles.weightInfo}>
                  💡 {lang === 'tr' 
                    ? 'Bugünün kilo girişi otomatik olarak profil kilonuzu günceller.' 
                    : 'Entering weight for today automatically updates your profile weight.'}
                </Text>
              )}
            </View>

            {/* RUH HALİ KARTI */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t(lang, 'health.moodTitle')}</Text>
              <View style={styles.moodGrid}>
                {moodOptions.map(opt => {
                  const isSelected = mood === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.moodChip,
                        isSelected && { borderColor: opt.color, backgroundColor: opt.color + '15' }
                      ]}
                      onPress={() => setMood(opt.key as any)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.moodEmoji}>{opt.emoji}</Text>
                      <Text style={[styles.moodLabel, isSelected && { color: opt.color, fontWeight: 'bold' }]}>
                        {lang === 'tr' ? opt.labelTr : opt.labelEn}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* KAYDET BUTONU */}
            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>💾 {t(lang, 'health.saveBtn')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          /* ================= RAPORLAR VE GRAFİKLER EKRANI ================= */
          <View style={styles.sectionContainer}>
            {/* AI SAĞLIK RAPORU BUTONU - Artık en üstte! */}
            <TouchableOpacity
              style={[styles.aiButton, { marginBottom: SPACING.md }]}
              onPress={handleGenerateAiReport}
              activeOpacity={0.85}
            >
              <Text style={styles.aiButtonText}>{t(lang, 'health.aiAnalysisBtn')}</Text>
            </TouchableOpacity>

            {!hasLogHistory ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyEmoji}>📈</Text>
                <Text style={styles.emptyText}>{t(lang, 'health.noDataForPeriod')}</Text>
              </View>
            ) : (
              <>
                {/* 1. SU TÜKETİMİ GRAFİĞİ (Custom Bar Chart) */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>💧 {lang === 'tr' ? 'Haftalık Su Tüketimi (ml)' : 'Weekly Water Intake (ml)'}</Text>
                  <View style={styles.chartContainer}>
                    <View style={styles.chartYAxis}>
                      <Text style={styles.chartAxisLabel}>{lang === 'tr' ? 'Hedef' : 'Goal'}</Text>
                      <Text style={styles.chartAxisLabel}>50%</Text>
                      <Text style={styles.chartAxisLabel}>0</Text>
                    </View>
                    <View style={styles.chartBarsArea}>
                      {chartData.map((item, idx) => {
                        const target = item.waterTargetMl || recommendedTarget;
                        const percent = Math.min(100, (item.waterMl / target) * 100);
                        return (
                          <View key={idx} style={styles.chartBarCol}>
                            <View style={styles.chartBarTrack}>
                              <View 
                                style={[
                                  styles.chartBarFill, 
                                  { height: `${percent}%`, backgroundColor: colors.primary }
                                ]} 
                              />
                            </View>
                            <Text style={styles.chartBarLabel}>{item.label}</Text>
                            <Text style={styles.chartBarSubLabel}>{item.dayNum}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* 2. UYKU GRAFİĞİ (Custom Colored Bar Chart) */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>😴 {lang === 'tr' ? 'Uyku Süresi & Kalitesi' : 'Sleep Duration & Quality'}</Text>
                  <View style={styles.chartContainer}>
                    <View style={styles.chartYAxis}>
                      <Text style={styles.chartAxisLabel}>12h</Text>
                      <Text style={styles.chartAxisLabel}>6h</Text>
                      <Text style={styles.chartAxisLabel}>0</Text>
                    </View>
                    <View style={styles.chartBarsArea}>
                      {chartData.map((item, idx) => {
                        const percent = Math.min(100, (item.sleepHours / 12) * 100);
                        // Rating'e göre renk ata
                        const ratingColor = item.sleepRating >= 4 
                          ? colors.success 
                          : item.sleepRating === 3 
                            ? colors.warning 
                            : item.sleepRating > 0 ? colors.danger : colors.textMuted;

                        return (
                          <View key={idx} style={styles.chartBarCol}>
                            <View style={styles.chartBarTrack}>
                              <View 
                                style={[
                                  styles.chartBarFill, 
                                  { height: `${percent}%`, backgroundColor: ratingColor }
                                ]} 
                              />
                            </View>
                            <Text style={styles.chartBarLabel}>{item.label}</Text>
                            <Text style={styles.chartBarSubLabel}>
                              {item.sleepRating > 0 ? `${item.sleepRating}⭐` : '-'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* 3. KİLO DEĞİŞİMİ GRAFİĞİ */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>⚖️ {lang === 'tr' ? 'Haftalık Kilo Değişimi (kg)' : 'Weekly Weight Tracking (kg)'}</Text>
                  <View style={styles.chartContainer}>
                    <View style={styles.chartYAxis}>
                      <Text style={styles.chartAxisLabel}>Max</Text>
                      <Text style={styles.chartAxisLabel}>Min</Text>
                    </View>
                    <View style={styles.chartBarsArea}>
                      {chartData.map((item, idx) => {
                        const weights = chartData.map(d => d.weightKg).filter(w => w > 0);
                        const maxW = weights.length > 0 ? Math.max(...weights) : 100;
                        const minW = weights.length > 0 ? Math.min(...weights) : 0;
                        const range = maxW - minW || 10;
                        const percent = item.weightKg > 0 ? Math.max(10, ((item.weightKg - minW) / range) * 90) : 0;

                        return (
                          <View key={idx} style={styles.chartBarCol}>
                            <View style={styles.chartBarTrack}>
                              {item.weightKg > 0 ? (
                                <View 
                                  style={[
                                    styles.chartBarFill, 
                                    { height: `${percent}%`, backgroundColor: colors.accent, borderRadius: RADIUS.sm }
                                  ]} 
                                />
                              ) : null}
                            </View>
                            <Text style={styles.chartBarLabel}>{item.label}</Text>
                            <Text style={styles.chartBarSubLabel}>
                              {item.weightKg > 0 ? `${item.weightKg}` : '-'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* AI INSIGHTS DIALOG MODAL */}
      <Modal
        transparent
        animationType="slide"
        visible={showAiModal}
        onRequestClose={() => setShowAiModal(false)}
      >
        <View style={styles.aiModalOverlay}>
          <View style={styles.aiModalSheet}>
            <View style={styles.aiModalHeader}>
              <Text style={styles.aiModalTitle}>{t(lang, 'health.aiReportTitle')}</Text>
              <TouchableOpacity onPress={() => setShowAiModal(false)} disabled={isLoadingAi}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.aiModalScroll} 
              showsVerticalScrollIndicator={true}
              contentContainerStyle={{ paddingBottom: SPACING.xl }}
            >
              {isLoadingAi ? (
                <View style={styles.aiLoadingContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.aiLoadingText}>{t(lang, 'health.aiAnalyzing')}</Text>
                </View>
              ) : (
                <Text style={styles.aiModalText}>{aiReport}</Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.aiModalCloseBtn, { backgroundColor: colors.primary }]}
              onPress={() => setShowAiModal(false)}
              disabled={isLoadingAi}
            >
              <Text style={styles.aiModalCloseBtnText}>
                {lang === 'tr' ? 'Kapat' : 'Close'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  header: {
    paddingHorizontal: SPACING.xl,
    paddingTop: 60,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.fontSizeXl,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceBorder + '44',
    borderRadius: RADIUS.lg,
    padding: 2,
  },
  tabButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: RADIUS.md,
  },
  tabButtonActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabButtonTextActive: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  sectionContainer: {
    padding: SPACING.md,
    gap: SPACING.md,
  },
  dateSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  dateNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceBorder + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNavBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  disabledBtn: {
    opacity: 0.3,
  },
  disabledText: {
    color: colors.textMuted,
  },
  dateDisplay: {
    flex: 1,
    alignItems: 'center',
  },
  dateDisplayText: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: 4,
  },
  targetLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  targetInput: {
    backgroundColor: colors.surfaceBorder + '22',
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: 'bold',
    width: 70,
    textAlign: 'center',
  },
  recommendationText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  waterPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
  glassContainer: {
    alignItems: 'center',
    gap: SPACING.xs,
    width: 100,
  },
  glassOuter: {
    width: 60,
    height: 100,
    borderWidth: 3,
    borderColor: '#E2E8F0',
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surfaceBorder + '22',
    justifyContent: 'flex-end',
  },
  glassInner: {
    width: '100%',
  },
  glassLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    textAlign: 'center',
    fontWeight: '600',
  },
  waterControls: {
    flex: 1,
    gap: SPACING.xs,
  },
  waterRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  waterAddBtn: {
    flex: 1,
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary + '33',
    borderWidth: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waterSubBtn: {
    backgroundColor: colors.surfaceBorder + '15',
    borderColor: colors.surfaceBorder + '33',
  },
  waterAddBtnText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
  },
  waterResetBtn: {
    backgroundColor: colors.danger + '10',
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  waterResetBtnText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.danger,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
  },
  moodChip: {
    width: '31%',
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.surfaceBorder,
  },
  moodEmoji: {
    fontSize: 26,
    marginBottom: 4,
  },
  moodLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  sleepInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sleepInputLabel: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    overflow: 'hidden',
  },
  stepperBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceBorder + '33',
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  stepperValue: {
    paddingHorizontal: SPACING.md,
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  starText: {
    fontSize: 24,
    opacity: 0.3,
  },
  starTextActive: {
    opacity: 1,
  },
  sleepRatingDesc: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: SPACING.xs,
  },
  weightInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.xs,
  },
  weightInput: {
    flex: 1,
    height: 48,
    color: colors.textPrimary,
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
  weightUnit: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textSecondary,
    fontWeight: 'bold',
  },
  weightInfo: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: SPACING.xs,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
    marginTop: SPACING.sm,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
  emptyCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.xxl,
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    marginTop: SPACING.xl,
  },
  emptyEmoji: { fontSize: 36 },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  chartContainer: {
    flexDirection: 'row',
    height: 160,
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  chartYAxis: {
    justifyContent: 'space-between',
    height: '80%',
    paddingBottom: 20,
  },
  chartAxisLabel: {
    fontSize: 9,
    color: colors.textMuted,
    textAlign: 'right',
    width: 25,
  },
  chartBarsArea: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: '100%',
  },
  chartBarCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
  },
  chartBarTrack: {
    flex: 1,
    width: 14,
    backgroundColor: colors.surfaceBorder + '33',
    borderRadius: RADIUS.sm,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chartBarFill: {
    width: '100%',
  },
  chartBarLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 4,
  },
  chartBarSubLabel: {
    fontSize: 8,
    color: colors.textMuted,
    marginTop: 2,
  },
  aiButton: {
    backgroundColor: colors.success,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
    marginTop: SPACING.md,
  },
  aiButtonText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
  aiModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  aiModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '85%',
  },
  aiModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
    paddingBottom: SPACING.sm,
  },
  aiModalTitle: {
    fontSize: TYPOGRAPHY.fontSizeLg,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  closeBtn: {
    fontSize: 22,
    color: colors.textMuted,
  },
  aiModalScroll: {
    maxHeight: 450,
  },
  aiLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.md,
  },
  aiLoadingText: {
    color: colors.textSecondary,
    fontSize: TYPOGRAPHY.fontSizeSm,
  },
  aiModalText: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  aiModalCloseBtn: {
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
  },
  aiModalCloseBtnText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
});
