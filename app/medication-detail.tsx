import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getMedicationInfo } from '../services/gemini';
import { useStore } from '../store/useStore';
import { updateMedication } from '../services/firestore';
import { cancelMedicationNotifications } from '../services/notifications';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { formatDate } from '../utils/date';

export default function MedicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { medications: allMedications, updateMedication: updateMedInStore, language, theme, showAlert } = useStore();
  const [medication, setMedication] = useState<any | null>(null);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);

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

  if (!medication) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: 20, color: colors.textSecondary }}>{t(lang, 'medicationDetail.loading')}</Text>
      </View>
    );
  }

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
            <Text style={styles.aiResultText}>{aiInfo}</Text>
            <View style={styles.aiDisclaimer}>
              <Text style={styles.aiDisclaimerText}>
                {t(lang, 'medicationDetail.aiDisclaimer')}
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: SPACING.huge }} />
      </ScrollView>
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
    padding: SPACING.lg, alignItems: 'center', marginBottom: SPACING.xl,
    borderWidth: 1, borderColor: colors.danger + '44',
  },
  finishButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.danger },
});
