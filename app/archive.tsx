import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../store/useStore';
import { deleteMedication } from '../services/firestore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { formatDate } from '../utils/date';

export default function ArchiveScreen() {
  const { 
    activeProfileId, 
    profiles, 
    medications: allMedications, 
    removeMedication,
    language,
    theme,
    showAlert
  } = useStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMeds, setSelectedMeds] = useState<string[]>([]);

  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const archivedMeds = (allMedications || []).filter(m => 
    m.profileId === activeProfileId && m.isActive === false
  );

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
            } catch (err) {
              console.log('Med deletion error:', err);
            }
          },
        },
      ]
    });
  };

  const handleBulkDelete = () => {
    if (selectedMeds.length === 0) return;
    showAlert({
      message: `${selectedMeds.length} ${t(lang, 'medicines.deleteConfirm')}`,
      type: 'danger',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        {
          text: t(lang, 'profiles.deleteBtn'),
          style: 'destructive',
          onPress: async () => {
            try {
              for (const id of selectedMeds) {
                removeMedication(id);
                await deleteMedication(id);
              }
              setSelectedMeds([]);
            } catch (err) {
              console.log('Bulk deletion error:', err);
            }
          },
        },
      ]
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedMeds(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const getTranslatedUnit = (u: string) => {
    if (u === 'tablet' || u === 'kapsül' || u === 'damla') {
      return t(lang, `medicationOptions.units.${u}`);
    }
    return u;
  };

  const filteredMeds = archivedMeds.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ {t(lang, 'medicationDetail.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📦 {t(lang, 'medicines.archivedTitle')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.searchBarContainer}>
        <TextInput
          style={styles.searchBar}
          placeholder={t(lang, 'addMedication.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {selectedMeds.length > 0 && (
          <TouchableOpacity style={styles.bulkDeleteBtn} onPress={handleBulkDelete}>
            <Text style={styles.bulkDeleteBtnText}>🗑️ ({selectedMeds.length})</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {filteredMeds.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📦</Text>
            <Text style={styles.emptyTitle}>{t(lang, 'medicines.noArchived')}</Text>
          </View>
        ) : (
          filteredMeds.map((med) => (
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
                    <Text style={styles.medicineIcon}>📦</Text>
                  )}
                </View>
                <View style={styles.medicineInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.medicineName}>{med.name}</Text>
                    {allMedications.some(am => am.name === med.name && am.profileId === activeProfileId && am.isActive !== false) && (
                      <View style={styles.activeBadgeSmall}>
                        <Text style={styles.activeBadgeSmallText}>✨ {lang === 'tr' ? 'Aktif' : 'Active'}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.medicineDateRange}>
                    {formatDate(med.startDate)} - {formatDate(med.endDate) || '?'}
                  </Text>
                  <Text style={styles.medicineDose}>{med.dosage} {getTranslatedUnit(med.unit)}</Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(med)}
                >
                  <Text style={styles.deleteBtnText}>🗑️</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cardActions}>
                { !allMedications.some(am => am.name.trim().toLowerCase() === med.name.trim().toLowerCase() && am.profileId === activeProfileId && am.isActive !== false) && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.reuseBtn]}
                    onPress={() => router.push({ pathname: '/add-medication', params: { templateId: med.id } })}
                  >
                    <Text style={styles.reuseBtnText}>♻️ {lang === 'tr' ? 'Tekrar Kullan' : 'Use Again'}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.actionBtn, styles.detailBtn]}
                  onPress={() => router.push({ pathname: '/medication-detail', params: { id: med.id } })}
                >
                  <Text style={styles.detailBtnText}>{t(lang, 'medicines.detailsBtn')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingTop: 60, paddingBottom: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  backBtn: { width: 60 },
  backBtnText: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.primary },
  headerTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  searchBarContainer: {
    flexDirection: 'row', padding: SPACING.lg, gap: SPACING.md, alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  searchBar: {
    flex: 1, backgroundColor: colors.surface, borderRadius: RADIUS.md,
    padding: SPACING.md, color: colors.textPrimary, fontSize: TYPOGRAPHY.fontSizeSm,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  bulkDeleteBtn: {
    backgroundColor: colors.danger, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  bulkDeleteBtnText: { color: '#fff', fontWeight: TYPOGRAPHY.fontWeightBold, fontSize: TYPOGRAPHY.fontSizeXs },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.xl },
  emptyState: { alignItems: 'center', paddingVertical: 100, gap: SPACING.md },
  emptyEmoji: { fontSize: 56, opacity: 0.5 },
  emptyTitle: { fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textMuted },
  medicineCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.md,
    borderWidth: 2, borderColor: colors.surfaceBorder,
    gap: SPACING.md,
  },
  medicineCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '11',
  },
  medicineCardTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  medicineIconBox: {
    width: 48, height: 48, borderRadius: RADIUS.md,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  medicineIcon: { fontSize: 24 },
  medicineInfo: { flex: 1 },
  medicineName: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  medicineDateRange: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.primary, marginTop: 2 },
  medicineDose: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, marginTop: 2 },
  deleteBtn: { padding: SPACING.xs },
  deleteBtnText: { fontSize: 18 },
  cardActions: { flexDirection: 'row', gap: SPACING.sm },
  actionBtn: { flex: 1, borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center' },
  reuseBtn: { backgroundColor: colors.primary + '22', borderWidth: 1, borderColor: colors.primary + '44' },
  reuseBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  detailBtn: { backgroundColor: colors.surfaceBorder },
  detailBtnText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  activeBadgeSmall: {
    backgroundColor: colors.success + '22',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: colors.success + '44',
  },
  activeBadgeSmallText: { fontSize: 10, color: colors.success, fontWeight: TYPOGRAPHY.fontWeightBold },
});
