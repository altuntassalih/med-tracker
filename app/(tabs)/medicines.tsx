import { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { ScrollView, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useStore } from '../../store/useStore';
import { deleteMedication } from '../../services/firestore';
import { analyzeMedicationInteractions } from '../../services/gemini';
import { cancelMedicationNotifications } from '../../services/notifications';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, AI_FEATURES_ENABLED } from '../../constants/AppConstants';
import { t, LanguageCode } from '../../constants/translations';

export default function MedicinesScreen() {
  const { 
    activeProfileId, 
    profiles, 
    medications: allMedications, 
    removeMedication,
    language,
    theme,
    showAlert
  } = useStore();
  
  const insets = useSafeAreaInsets();
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [selectedMeds, setSelectedMeds] = useState<string[]>([]);
  const [showAiModal, setShowAiModal] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const medications = (allMedications || []).filter(m => m.profileId === activeProfile?.id && m.isActive !== false);

  const handleDelete = (med: any) => {
    showAlert({
      message: `"${med.name}" ${t(lang, 'medicines.deleteConfirm')}`,
      type: 'danger',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        {
          text: t(lang, 'profiles.deleteBtn'),
          style: 'destructive',
          onPress: async () => {
            try {
              removeMedication(med.id);
              await deleteMedication(med.id);
              await cancelMedicationNotifications(med.id);
            } catch (err) {
              console.log('Med deletion error:', err);
            }
          },
        },
      ]
    });
  };

  const handleAnalyze = async () => {
    // If no medications are selected but we have a previous result, just open the modal!
    if (selectedMeds.length === 0 && analysisResult) {
      setShowAiModal(true);
      return;
    }

    if (!AI_FEATURES_ENABLED) {
      showAlert({ message: t(lang, 'medicines.aiQuotaMsg'), type: 'warning' });
      return;
    }

    const medsToAnalyze = selectedMeds.length > 0 
      ? medications.filter(m => selectedMeds.includes(m.id)) 
      : medications;

    if (medsToAnalyze.length < 2) {
      showAlert({
        message: selectedMeds.length > 0 
          ? t(lang, 'medicines.insufficientMsg') 
          : t(lang, 'medicines.insufficientGeneric'),
        type: 'warning'
      });
      return;
    }
    setIsAnalyzing(true);
    try {
      const medicationNames = medsToAnalyze.map((m) => `${m.name} ${m.dosage} ${getTranslatedUnit(m.unit)}`);
      const result = await analyzeMedicationInteractions(medicationNames, lang);
      setAnalysisResult(result);
      setSelectedMeds([]);
      setShowAiModal(true);
    } catch (err: any) {
      const isQuota = err?.isQuotaError || err?.message === 'QUOTA_EXCEEDED';
      const errMsg = isQuota
        ? t(lang, 'medicines.aiQuotaMsg')
        : lang === 'tr'
          ? `Analiz sırasında bir hata oluştu. Lütfen tekrar deneyin.`
          : `An error occurred during analysis. Please try again.`;
      showAlert({ message: errMsg, type: 'danger' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getTranslatedUnit = (u: string) => {
    if (u === 'tablet' || u === 'kapsül' || u === 'damla') {
      return t(lang, `medicationOptions.units.${u}`);
    }
    return u;
  };

  const toggleSelection = (id: string) => {
    setSelectedMeds(prev => {
      if (!prev.includes(id) && prev.length >= 3) {
        showAlert({
          message: lang === 'tr' ? 'En fazla 3 ilaç seçebilirsiniz.' : 'You can select up to 3 medications.',
          type: 'warning'
        });
        return prev;
      }
      return prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id];
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>💊 {t(lang, 'medicines.title')}</Text>
          <TouchableOpacity 
            onPress={() => router.push('/archive')}
            style={styles.archiveHeaderBtn}
          >
            <Text style={styles.archiveHeaderBtnText}>📦 {t(lang, 'medicines.archivedTitle')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.profileName}>{activeProfile?.name ?? t(lang, 'medicines.noProfile')}</Text>
      </View>

      <ScrollView 
        ref={scrollRef}
        style={styles.scroll} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={[
            styles.analyzeButton, 
            (isAnalyzing || (selectedMeds.length === 0 && !analysisResult)) && styles.analyzeButtonDisabled
          ]}
          onPress={handleAnalyze}
          disabled={isAnalyzing || (selectedMeds.length === 0 && !analysisResult)}
          activeOpacity={0.8}
        >
          {isAnalyzing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.analyzeButtonIcon}>🤖</Text>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.analyzeButtonText}>
              {selectedMeds.length > 0 
                ? t(lang, 'medicines.analyzeBtn') 
                : analysisResult 
                  ? (lang === 'tr' ? 'Son Analiz Sonucunu Göster' : 'Show Last Analysis Result')
                  : t(lang, 'medicines.analyzeAll')}
            </Text>
            <Text style={styles.analyzeButtonSub}>
              {selectedMeds.length > 0 
                ? t(lang, 'medicines.analyzeSubSelected') 
                : analysisResult
                  ? (lang === 'tr' ? 'Son yapılan yapay zeka analizini modalda açar' : 'Opens the last AI analysis in a modal')
                  : t(lang, 'medicines.analyzeSubAll')}
            </Text>
          </View>
        </TouchableOpacity>

        {medications.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>💊</Text>
            <Text style={styles.emptyTitle}>{t(lang, 'medicines.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t(lang, 'medicines.emptySub')}</Text>
          </View>
        ) : (
          medications.map((med) => (
            <TouchableOpacity 
              key={med.id} 
              style={[
                styles.medicineCard, 
                selectedMeds.includes(med.id) && styles.medicineCardSelected
              ]}
              onPress={() => toggleSelection(med.id)}
              activeOpacity={0.8}
            >
              <View style={styles.medicineCardTop}>
                <View style={styles.medicineIconBox}>
                  {selectedMeds.includes(med.id) ? (
                    <Text style={{fontSize: 20}}>☑️</Text>
                  ) : (
                    <Text style={styles.medicineIcon}>💊</Text>
                  )}
                </View>
                <View style={styles.medicineInfo}>
                  <Text style={styles.medicineName}>{med.name}</Text>
                  <Text style={styles.medicineDose}>{med.dosage} {getTranslatedUnit(med.unit)}</Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(med)}
                >
                  <Text style={styles.deleteBtnText}>🗑️</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.medicineTimesRow}>
                {(med.times || []).map((time: string, i: number) => (
                  <View key={i} style={styles.timeTag}>
                    <Text style={styles.timeTagText}>🕐 {time}</Text>
                  </View>
                ))}
              </View>

              {med.notes ? (
                <Text style={styles.medicineNotes}>{med.notes}</Text>
              ) : null}

              <TouchableOpacity
                style={styles.detailBtn}
                onPress={() => router.push({ pathname: '/medication-detail', params: { id: med.id } })}
              >
                <Text style={styles.detailBtnText}>{t(lang, 'medicines.detailsBtn')}</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
 
        <View style={{ height: SPACING.xxl * 3 }} />
      </ScrollView>

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/add-medication')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

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
                <Text style={styles.aiModalTitle}>🤖 {t(lang, 'medicines.analysisResult')}</Text>
                <TouchableOpacity onPress={() => setShowAiModal(false)}>
                  <Text style={styles.closeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.aiModalScroll}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={{ paddingBottom: SPACING.lg }}
              >
                <Text style={styles.aiModalText}>{analysisResult}</Text>
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
    </View>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: SPACING.xl, paddingTop: 50, paddingBottom: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: TYPOGRAPHY.fontSize2xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  archiveHeaderBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  archiveHeaderBtnText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  profileName: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, marginTop: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.xl, paddingBottom: 150 },
  analyzeButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.primary + '11', borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.xl,
    borderWidth: 1, borderColor: colors.primary + '44',
  },
  analyzeButtonDisabled: { opacity: 0.6 },
  analyzeButtonIcon: { fontSize: 28 },
  analyzeButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.primaryLight },
  analyzeButtonSub: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textSecondary, marginTop: 2 },
  analysisResultCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.xl,
    borderWidth: 1, borderColor: colors.primary + '44',
    gap: SPACING.md,
  },
  analysisResultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  analysisResultTitle: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  closeBtn: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.textMuted },
  analysisPreviewText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, lineHeight: 22 },
  readMoreBtn: {
    backgroundColor: colors.primary + '22', borderRadius: RADIUS.md,
    padding: SPACING.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary + '44',
  },
  readMoreBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  aiDisclaimer: {
    backgroundColor: colors.warning + '22', borderRadius: RADIUS.sm,
    padding: SPACING.sm, borderWidth: 1, borderColor: colors.warning + '44',
  },
  aiDisclaimerText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.warning },
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
    backgroundColor: colors.primary, borderRadius: RADIUS.lg,
    padding: SPACING.md, alignItems: 'center',
  },
  aiModalCloseBtnText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.huge, gap: SPACING.md },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  emptyText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, textAlign: 'center' },
  medicineCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.md,
    borderWidth: 1, borderColor: colors.surfaceBorder,
    gap: SPACING.md,
  },
  medicineCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '11',
  },
  medicineCardTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  medicineIconBox: {
    width: 48, height: 48, borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center',
  },
  medicineIcon: { fontSize: 24 },
  medicineInfo: { flex: 1 },
  medicineName: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  medicineDose: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, marginTop: 2 },
  deleteBtn: { padding: SPACING.xs },
  deleteBtnText: { fontSize: 18 },
  medicineTimesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  timeTag: {
    backgroundColor: colors.primary + '22', borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm, paddingVertical: 4,
  },
  timeTagText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  medicineNotes: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, fontStyle: 'italic' },
  detailBtn: {
    backgroundColor: colors.surfaceBorder + '88', borderRadius: RADIUS.md,
    padding: SPACING.sm, alignItems: 'center',
  },
  detailBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  fab: {
    position: 'absolute', bottom: 30, right: SPACING.xl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 12, elevation: 10,
  },
  fabIcon: { fontSize: 28, color: '#fff', lineHeight: 32 },
});
