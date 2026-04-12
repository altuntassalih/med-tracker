import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Alert, ActivityIndicator, Modal, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../store/useStore';
import { addMedication, updateMedication, getGlobalMedicationList, subscribeToGlobalMedications } from '../services/firestore';
import { requestNotificationPermission, scheduleMedicationNotification, cancelMedicationNotifications } from '../services/notifications';
import {
  getThemeColors, TYPOGRAPHY, SPACING, RADIUS,
  MEDICATION_TYPES, DOSE_UNITS, FREQUENCY_OPTIONS, INTERVAL_OPTIONS
} from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { formatDate, getLocalDateString } from '../utils/date';
import { getMedicationSuggestions } from '../services/suggest-service';

const COMMON_MEDICATIONS = [
  // Ağrı Kesiciler ve Ateş Düşürücüler
  'Parol', 'Aspirin', 'Arveles', 'Apranax', 'Majezik', 'Nurofen', 'Dolorex', 'Vermidon',
  'Minoset', 'Advil', 'Tylenol', 'Panadol', 'Motrin', 'Doliprane', 'Buscopan', 'Dex-Forte',
  // Antibiyotikler
  'Augmentin', 'Amoklavin', 'Cefaks', 'Zinnat', 'Klamer', 'Macrol', 'Tetradox', 'Azitro',
  // Mide ve Sindirim
  'Lansor', 'Nexium', 'Panto', 'Pulcet', 'Gaviscon', 'Rennie', 'Talcid', 'Emedur', 'Metpamid',
  // Kalp ve Kan Basıncı
  'Coraspin', 'Ecopirin', 'Beloc', 'Concor', 'Vasoxen', 'Co-Diovan', 'Delix', 'Karvezea',
  'Lipitor', 'Ator', 'Crestor', 'Zestril', 'Amlodipine', 'Diltizem',
  // Diyabet
  'Metformin', 'Glifor', 'Matofin', 'Diamicron', 'Januvia', 'Humalog', 'Lantus',
  // Alerji ve Solunum
  'Zyrtec', 'Claritin', 'Benadryl', 'Aerius', 'Allerset', 'Ventolin', 'Flixotide', 'Foster',
  'Singulair', 'Levmont',
  // Vitamin ve Takviyeler
  'B12 Vitamini', 'D3 Vitamini', 'C Vitamini', 'Omega 3', 'Biotin', 'Magnezyum', 'Çinko',
  'Supradyn', 'Pharmaton', 'Solgar', 'Ocean', 'Benexol', 'Devit-3',
  // Psikiyatri ve Sinir Sistemi
  'Lustral', 'Selectra', 'Cipralex', 'Paxera', 'Xanax', 'Lyrica', 'Neurontin',
  // Hormon ve Diğer
  'Levothyroxine', 'Levotiron', 'Euthyrox', 'Tiroks', 'Prednol', 'Dexamethasone'
];

export default function AddMedicationScreen() {
  const { id, templateId } = useLocalSearchParams<{ id?: string, templateId?: string }>();
  const { 
    user, activeProfileId, profiles, medications, 
    addMedication: addMedToStore, updateMedication: updateMedInStore, 
    language, theme, showAlert, globalMedications, setGlobalMedications 
  } = useStore();
  
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const lang = language as LanguageCode;

  const existingMed = id ? medications.find(m => m.id === id) : 
                     templateId ? medications.find(m => m.id === templateId) : null;
  const isEditMode = !!existingMed && !templateId;

  const [name, setName] = useState(existingMed?.name || '');
  const [type, setType] = useState<string>(existingMed?.type || MEDICATION_TYPES[0].value);
  const [dosage, setDosage] = useState(existingMed?.dosage || '1');
  const [unit, setUnit] = useState<string>(existingMed?.unit || DOSE_UNITS[0]);
  const [intervalDays, setIntervalDays] = useState<number>(existingMed?.intervalDays || 1);
  const [frequency, setFrequency] = useState(existingMed ? existingMed.times.length : 1);
  const [times, setTimes] = useState(existingMed?.times || ['08:00']);
  const [notes, setNotes] = useState(existingMed?.notes || '');
  const [startDate, setStartDate] = useState(templateId ? getLocalDateString() : (existingMed?.startDate || getLocalDateString()));
  const [isSaving, setIsSaving] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [activeTimeIndex, setActiveTimeIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [reuseTemplate, setReuseTemplate] = useState<any | null>(null);
  const [activeDuplicateError, setActiveDuplicateError] = useState<string | null>(null);
  const [isSearchingAI, setIsSearchingAI] = useState(false);

  // Modern Pure JS Picker State Variables for Android
  const [androidHour, setAndroidHour] = useState(8);
  const [androidMinute, setAndroidMinute] = useState(0);
  const [androidMonthView, setAndroidMonthView] = useState(new Date());

  const incrementHour = (dir: number) => setAndroidHour(h => (h + dir + 24) % 24);
  const incrementMinute = (dir: number) => setAndroidMinute(m => (m + dir + 60) % 60);

  const openTimePicker = (index: number) => {
    setActiveTimeIndex(index);
    const [h, m] = times[index].split(':').map(Number);
    setAndroidHour(h);
    setAndroidMinute(m);
    setShowTimePicker(true);
  };

  const openStartDatePicker = () => {
     setAndroidMonthView(new Date(startDate || new Date()));
     setShowStartDatePicker(true);
  };

  useEffect(() => {
    // Gerçek zamanlı dinleyici kur (Başka kullanıcılar eklediğinde anında gelsin)
    const unsubscribe = subscribeToGlobalMedications((meds) => {
      if (meds.length > 0) setGlobalMedications(meds);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleTimePickerConfirm = (_: any, selectedDate?: Date) => {
    // Legacy support (now handled inline)
  };

  const handleStartDateConfirm = (_: any, selectedDate?: Date) => {
    // Legacy support (now handled inline)
  };

  const handleNameChange = (text: string) => {
    setName(text);
    setReuseTemplate(null);

    if (text.length > 1) {
      // Check for active duplicate name (for the same profile)
      const activeDuplicate = medications.find(m => 
        m.name.trim().toLowerCase() === text.trim().toLowerCase() && 
        m.profileId === activeProfileId && 
        m.isActive !== false &&
        m.id !== id
      );

      if (activeDuplicate) {
        setActiveDuplicateError(text.trim());
        setSuggestions([]);
        return;
      } else {
        setActiveDuplicateError(null);
      }

      // Önerileri filtrele (Yerel + Küresel)
      const allKnownMeds = Array.from(new Set([...COMMON_MEDICATIONS, ...(globalMedications || [])]));
      const filtered = allKnownMeds.filter(m => 
        m.toLowerCase().includes(text.toLowerCase()) && 
        m.toLowerCase() !== text.toLowerCase()
      ).slice(0, 6);
      setSuggestions(filtered);

      // Arşivde var mı kontrol et
      const archivedMatch = medications.find(m => 
        m.name.toLowerCase() === text.toLowerCase() && 
        m.profileId === activeProfileId && 
        m.isActive === false
      );
      if (archivedMatch) {
        setReuseTemplate(archivedMatch);
      }
    } else {
      setSuggestions([]);
    }
  };

  const handleAISearch = async () => {
    if (name.length < 3) {
      showAlert({ 
        message: lang === 'tr' ? 'Arama yapmak için en az 3 harf girin.' : 'Enter at least 3 letters to search.', 
        type: 'warning' 
      });
      return;
    }

    // Zaten sistemde varsa (Yerel veya Küresel) yapay zekayı kullanma
    const isKnown = [...COMMON_MEDICATIONS, ...(globalMedications || [])].some(
      m => m.toLowerCase() === name.trim().toLowerCase()
    );

    if (isKnown) {
        showAlert({ 
          message: lang === 'tr' ? 'Bu ilaç zaten sistemimizde kayıtlı.' : 'This medication is already in our system.', 
          type: 'info' 
        });
        return;
    }

    setIsSearchingAI(true);
    try {
      const results = await getMedicationSuggestions(name, lang);
      if (results.length > 0) {
        setSuggestions(results);
        // Yerel store'u anında güncelle ki arama sonuçları hemen öneri olarak gelsin
        const updatedGlobalMeds = Array.from(new Set([...(globalMedications || []), ...results]));
        setGlobalMedications(updatedGlobalMeds);
      } else {
        showAlert({ 
          message: lang === 'tr' ? 'Sonuç bulunamadı.' : 'No results found.', 
          type: 'info' 
        });
      }
    } catch (err: any) {
      showAlert({ message: err.message || 'AI Hatası', type: 'danger' });
    } finally {
      setIsSearchingAI(false);
    }
  };

  const applyTemplate = (template: any) => {
    // Check if this template's name is already active
    const activeDuplicate = medications.find(m => 
      m.name.trim().toLowerCase() === template.name.trim().toLowerCase() && 
      m.profileId === activeProfileId && 
      m.isActive !== false
    );

    if (activeDuplicate) {
        setActiveDuplicateError(template.name);
        return;
    }
    setActiveDuplicateError(null);

    setName(template.name);
    setType(template.type);
    setDosage(template.dosage);
    setUnit(template.unit);
    setIntervalDays(template.intervalDays || 1);
    setFrequency(template.times.length);
    setTimes(template.times);
    setNotes(template.notes || '');
    setReuseTemplate(null);
    setSuggestions([]);
  };

  const getDateFromTimeStr = (timeStr: string): Date => {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h || 8, m || 0, 0, 0);
    return d;
  };

  const handleFrequencyChange = (freq: number) => {
    setFrequency(freq);
    const defaultTimes: Record<number, string[]> = {
      1: ['08:00'],
      2: ['08:00', '20:00'],
      3: ['08:00', '14:00', '20:00'],
      4: ['08:00', '12:00', '16:00', '20:00'],
    };
    setTimes(defaultTimes[freq] ?? ['08:00']);
  };

  const handleSave = async () => {
    if (!name.trim()) { showAlert({ message: t(lang, 'addMedication.errorName'), type: 'danger' }); return; }
    if (!dosage.trim()) { showAlert({ message: t(lang, 'addMedication.errorDose'), type: 'danger' }); return; }
    if (!isEditMode && !activeProfile?.id) { showAlert({ message: t(lang, 'addMedication.errorProfile'), type: 'danger' }); return; }

    setIsSaving(true);
    try {
      // Check for active duplicate name (for the same profile)
      const activeDuplicate = medications.find(m => 
        m.name.trim().toLowerCase() === name.trim().toLowerCase() && 
        m.profileId === activeProfileId && 
        m.isActive !== false &&
        m.id !== id // Don't block self if we're actually editing this exact medication
      );

      if (activeDuplicate) {
        showAlert({ 
          message: lang === 'tr' ? `"${name.trim()}" isminde aktif bir ilacınız zaten var. Lütfen farklı bir isim seçin.` : `You already have an active medication named "${name.trim()}". Please choose a different name.`,
          type: 'danger'
        });
        setIsSaving(false);
        return;
      }

      const medData = {
        name: name.trim(),
        type,
        dosage: dosage.trim(),
        unit,
        intervalDays,
        times,
        notes: notes.trim(),
        startDate: startDate,
        profileId: existingMed ? existingMed.profileId : activeProfile.id,
        userId: user?.uid ?? 'guest',
        isActive: true,
      };

      if (isEditMode && existingMed) {
        await updateMedication(existingMed.id, medData);
        updateMedInStore(existingMed.id, medData);
        
        await cancelMedicationNotifications(existingMed.id);
        const hasPermission = await requestNotificationPermission();
        if (hasPermission) {
          for (const time of times) {
            await scheduleMedicationNotification(existingMed.id, medData.name, medData.dosage, time, lang, medData.intervalDays, medData.startDate);
          }
        }
      } else {
        const newMed = await addMedication(medData);
        addMedToStore(newMed);
        
        const hasPermission = await requestNotificationPermission();
        if (hasPermission) {
          for (const time of times) {
            await scheduleMedicationNotification(newMed.id, medData.name, medData.dosage, time, lang, medData.intervalDays, medData.startDate);
          }
        }
      }

      showAlert({
        message: `${name} ${isEditMode ? t(lang, 'addMedication.successUpdate') : t(lang, 'addMedication.successAdd')}`,
        type: 'success',
        buttons: [{ text: t(lang, 'addMedication.confirmBtn'), onPress: () => router.back() }]
      });
    } catch (err) {
      showAlert({ message: lang === 'tr' ? 'İşlem başarısız oldu' : 'Action failed', type: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };

  const getTranslatedTypeLabel = (value: string) => t(lang, `medicationOptions.types.${value}`);
  const getTranslatedFreqLabel = (value: number) => {
    const keys: Record<number, string> = { 1: 'once', 2: 'twice', 3: 'thrice', 4: 'four' };
    return t(lang, `medicationOptions.frequencies.${keys[value]}`);
  };
  const getTranslatedIntervalLabel = (value: number) => {
    const keys: Record<number, string> = { 1: 'everyday', 2: 'twoDays', 3: 'threeDays', 7: 'weekly' };
    return t(lang, `medicationOptions.intervals.${keys[value]}`);
  };
  const getTranslatedUnit = (u: string) => {
    if (u === 'tablet' || u === 'kapsül' || u === 'damla') return t(lang, `medicationOptions.units.${u}`);
    return u;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ {t(lang, 'addMedication.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditMode ? t(lang, 'addMedication.editTitle') : t(lang, 'addMedication.addTitle')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeProfile && (
          <View style={styles.profileIndicator}>
            <Text style={styles.profileIndicatorText}>{activeProfile.avatar || '👤'} {activeProfile.name} {t(lang, 'addMedication.profileIndicator')}</Text>
          </View>
        )}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.nameLabel')}</Text>
          <View style={styles.inputSearchRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={name}
              onChangeText={handleNameChange}
              placeholder={t(lang, 'addMedication.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity 
              style={[styles.aiSearchBtn, isSearchingAI && styles.aiSearchBtnDisabled]} 
              onPress={handleAISearch}
              disabled={isSearchingAI}
              activeOpacity={0.7}
            >
              {isSearchingAI ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.aiSearchBtnIcon}>🤖</Text>
              )}
            </TouchableOpacity>
          </View>
          {activeDuplicateError && (
            <View style={styles.activeErrorAlert}>
              <Text style={styles.activeErrorText}>
                ⚠️ {lang === 'tr' ? `"${activeDuplicateError}" isminde aktif bir ilacınız var. Lütfen farklı bir isim seçin.` : `You have an active medication named "${activeDuplicateError}". Please choose a different name.`}
              </Text>
            </View>
          )}
          {!activeDuplicateError && reuseTemplate && (
            <TouchableOpacity style={styles.reuseAlert} onPress={() => applyTemplate(reuseTemplate)} activeOpacity={0.8}>
              <Text style={styles.reuseAlertText}>
                💡 {lang === 'tr' ? `${reuseTemplate.name} arşivde bulundu. Kayıtlı ayarlarla doldurmak için dokun.` : `${reuseTemplate.name} found in archive. Tap to reuse settings.`}
              </Text>
            </TouchableOpacity>
          )}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((s, idx) => (
                <TouchableOpacity key={idx} style={styles.suggestionItem} onPress={() => { setName(s); setSuggestions([]); }}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.startDateLabel')}</Text>
          <TouchableOpacity style={styles.datePickerBtn} onPress={openStartDatePicker} activeOpacity={0.7}>
            <Text style={styles.datePickerBtnText}>📅 {formatDate(startDate)}</Text>
          </TouchableOpacity>
        </View>

      {/* ----------------- MODERN DATE PICKER MODAL ----------------- */}
      <Modal transparent animationType="fade" visible={showStartDatePicker} onRequestClose={() => setShowStartDatePicker(false)}>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerContainer, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder, padding: 0, overflow: 'hidden' }]}>
            <View style={[styles.customDatePickerHeader, { backgroundColor: colors.primary }]}>
              <Text style={styles.customDatePickerYear}>{new Date(startDate).getFullYear()}</Text>
              <Text style={styles.customDatePickerDate}>
                {new Date(startDate).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
            </View>
            <View style={styles.customDatePickerBody}>
              {Platform.OS === 'ios' ? (
                <View style={{ paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md }}>
                  <DateTimePicker
                    value={new Date(startDate)}
                    mode="date"
                    display="spinner"
                    onChange={(_, selectedDate) => {
                      if (selectedDate) setStartDate(selectedDate.toISOString().split('T')[0]);
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
                      <TouchableOpacity onPress={() => setAndroidMonthView(new Date(androidMonthView.getFullYear(), androidMonthView.getMonth() - 1, 1))} style={{ padding: SPACING.sm, backgroundColor: colors.surfaceBorder, borderRadius: 8 }}>
                         <Text style={{ color: colors.textPrimary }}>◀</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.textPrimary }}>
                         {androidMonthView.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' })}
                      </Text>
                      <TouchableOpacity onPress={() => setAndroidMonthView(new Date(androidMonthView.getFullYear(), androidMonthView.getMonth() + 1, 1))} style={{ padding: SPACING.sm, backgroundColor: colors.surfaceBorder, borderRadius: 8 }}>
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
                         const isSelected = startDate === dStr;
                         return (
                            <TouchableOpacity key={d} onPress={() => setStartDate(dStr)} style={{ width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center' }}>
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
                <TouchableOpacity style={styles.customDatePickerCancelBtn} onPress={() => setShowStartDatePicker(false)}>
                  <Text style={[styles.customDatePickerActionText, { color: colors.textSecondary }]}>{t(lang, 'settings.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.customDatePickerOkBtn} onPress={() => setShowStartDatePicker(false)}>
                  <Text style={[styles.customDatePickerActionText, { color: colors.primary, fontWeight: 'bold' }]}>{t(lang, 'addMedication.confirmBtn')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.typeLabel')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.typeRow}>
              {MEDICATION_TYPES.map((typeOption) => (
                <TouchableOpacity
                  key={typeOption.value}
                  style={[styles.typeChip, type === typeOption.value && styles.typeChipActive]}
                  onPress={() => setType(typeOption.value)}
                >
                  <Text style={styles.typeChipEmoji}>{typeOption.icon}</Text>
                  <Text style={[styles.typeChipLabel, type === typeOption.value && styles.typeChipLabelActive]}>
                    {getTranslatedTypeLabel(typeOption.value)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.doseLabel')}</Text>
          <View style={styles.dosageRow}>
            <TextInput
              style={[styles.input, styles.dosageInput]}
              value={dosage}
              onChangeText={setDosage}
              placeholder={t(lang, 'addMedication.dosePlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.unitScroll}>
              {DOSE_UNITS.map((u) => (
                <TouchableOpacity key={u} style={[styles.unitChip, unit === u && styles.unitChipActive]} onPress={() => setUnit(u)}>
                  <Text style={[styles.unitChipText, unit === u && styles.unitChipTextActive]}>{getTranslatedUnit(u)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.frequencyLabel')}</Text>
          <View style={styles.intervalGrid}>
            {INTERVAL_OPTIONS.map((opt) => {
              const isActive = intervalDays === opt.value;
              const icons: Record<number,string> = { 1: '📅', 2: '🔁', 3: '⏳', 7: '📆' };
              return (
                <TouchableOpacity key={opt.value} style={[styles.intervalCard, isActive && styles.intervalCardActive]} onPress={() => setIntervalDays(opt.value)} activeOpacity={0.75}>
                  <Text style={styles.intervalIcon}>{icons[opt.value] ?? '📅'}</Text>
                  <Text style={[styles.intervalLabel, isActive && styles.intervalLabelActive]}>{getTranslatedIntervalLabel(opt.value)}</Text>
                  {isActive && <View style={styles.intervalCheck}><Text style={styles.intervalCheckText}>✓</Text></View>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.dailyDoseLabel')}</Text>
          <View style={styles.freqRow}>
            {FREQUENCY_OPTIONS.map((f) => (
              <TouchableOpacity key={f.value} style={[styles.freqChip, frequency === f.value && styles.freqChipActive]} onPress={() => handleFrequencyChange(f.value)}>
                <Text style={[styles.freqChipText, frequency === f.value && styles.freqChipTextActive]}>{getTranslatedFreqLabel(f.value)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.timesLabel')}</Text>
          <View style={styles.timeGrid}>
            {times.map((time, i) => (
              <TouchableOpacity key={i} style={styles.timePickerBox} onPress={() => openTimePicker(i)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timeLabel}>{i + 1}. {t(lang, 'addMedication.doseIndex')}</Text>
                  <Text style={styles.timeValueDisplay}>{time}</Text>
                </View>
                <Text style={styles.timeEditIcon}>🕰️</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

      {/* ----------------- MODERN TIME PICKER MODAL ----------------- */}
      <Modal transparent animationType="fade" visible={showTimePicker} onRequestClose={() => setShowTimePicker(false)}>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerContainer, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
            <View style={styles.pickerHeader}>
              <View style={[styles.pickerIconContainer, { backgroundColor: colors.primary + '15' }]}>
                <Text style={styles.pickerIcon}>🕰️</Text>
              </View>
              <Text style={[styles.pickerTitle, { color: colors.textPrimary }]}>{t(lang, 'addMedication.timePickerTitle')}</Text>
            </View>
            <View style={styles.pickerBody}>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={getDateFromTimeStr(times[activeTimeIndex])}
                  mode="time"
                  display="spinner"
                  is24Hour
                  onChange={(_, selectedDate) => {
                    if (selectedDate) {
                      const h = selectedDate.getHours().toString().padStart(2, '0');
                      const m = selectedDate.getMinutes().toString().padStart(2, '0');
                      const newTimes = [...times];
                      newTimes[activeTimeIndex] = `${h}:${m}`;
                      setTimes(newTimes);
                    }
                  }}
                  themeVariant={theme}
                  textColor={colors.textPrimary}
                />
              ) : (
                 /* Pure JS Custom Time Stepper for Android - No Popups, Premium UI! */
                 <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.xl }}>
                   <View style={{ alignItems: 'center', width: 80 }}>
                      <TouchableOpacity onPress={() => incrementHour(1)} style={{ padding: SPACING.md, backgroundColor: colors.surfaceBorder, borderRadius: 12, marginBottom: SPACING.md }}>
                        <Text style={{ color: colors.primary, fontSize: 24, fontWeight: 'bold' }}>▲</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: 44, fontWeight: 'bold', color: colors.textPrimary }}>{androidHour.toString().padStart(2, '0')}</Text>
                      <TouchableOpacity onPress={() => incrementHour(-1)} style={{ padding: SPACING.md, backgroundColor: colors.surfaceBorder, borderRadius: 12, marginTop: SPACING.md }}>
                        <Text style={{ color: colors.primary, fontSize: 24, fontWeight: 'bold' }}>▼</Text>
                      </TouchableOpacity>
                   </View>
                   <Text style={{ fontSize: 40, fontWeight: 'bold', color: colors.textPrimary, marginHorizontal: SPACING.md }}>:</Text>
                   <View style={{ alignItems: 'center', width: 80 }}>
                      <TouchableOpacity onPress={() => incrementMinute(5)} style={{ padding: SPACING.md, backgroundColor: colors.surfaceBorder, borderRadius: 12, marginBottom: SPACING.md }}>
                        <Text style={{ color: colors.primary, fontSize: 24, fontWeight: 'bold' }}>▲</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: 44, fontWeight: 'bold', color: colors.textPrimary }}>{androidMinute.toString().padStart(2, '0')}</Text>
                      <TouchableOpacity onPress={() => incrementMinute(-5)} style={{ padding: SPACING.md, backgroundColor: colors.surfaceBorder, borderRadius: 12, marginTop: SPACING.md }}>
                        <Text style={{ color: colors.primary, fontSize: 24, fontWeight: 'bold' }}>▼</Text>
                      </TouchableOpacity>
                   </View>
                 </View>
              )}
            </View>
            <TouchableOpacity style={styles.pickerCloseBtn} onPress={() => {
              if (Platform.OS !== 'ios') {
                 const h = androidHour.toString().padStart(2, '0');
                 const m = androidMinute.toString().padStart(2, '0');
                 const newTimes = [...times];
                 newTimes[activeTimeIndex] = `${h}:${m}`;
                 setTimes(newTimes);
              }
              setShowTimePicker(false);
            }}>
              <Text style={styles.pickerCloseBtnText}>{t(lang, 'addMedication.confirmBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t(lang, 'addMedication.notesLabel')}</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t(lang, 'addMedication.notesPlaceholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        <TouchableOpacity 
          style={[
            styles.saveButton, 
            (isSaving || !!activeDuplicateError) && styles.saveButtonDisabled
          ]} 
          onPress={handleSave} 
          disabled={isSaving || !!activeDuplicateError}
        >
          {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{isEditMode ? `🔄 ${t(lang, 'addMedication.update')}` : `💾 ${t(lang, 'addMedication.save')}`}</Text>}
        </TouchableOpacity>

        <View style={{ height: SPACING.xxxl }} />
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
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.xl },
  profileIndicator: {
    backgroundColor: colors.primary + '15', borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xl, alignSelf: 'flex-start',
  },
  profileIndicatorText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  fieldGroup: { marginBottom: SPACING.xl },
  label: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textSecondary, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.md,
    padding: SPACING.lg, color: colors.textPrimary, fontSize: TYPOGRAPHY.fontSizeMd,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  inputSearchRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  aiSearchBtn: {
    width: 48, height: 48, borderRadius: RADIUS.md,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  aiSearchBtnDisabled: { backgroundColor: colors.textMuted, shadowOpacity: 0 },
  aiSearchBtnIcon: { fontSize: 24 },
  suggestionsContainer: { backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.md, marginTop: 4, borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden' },
  suggestionItem: { padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  suggestionText: { color: colors.textPrimary, fontSize: TYPOGRAPHY.fontSizeSm },
  reuseAlert: { backgroundColor: colors.primary + '22', borderRadius: RADIUS.md, padding: SPACING.md, marginTop: 8, borderWidth: 1, borderColor: colors.primary + '44' },
  reuseAlertText: { color: colors.primaryLight, fontSize: 13, fontWeight: TYPOGRAPHY.fontWeightMedium },
  activeErrorAlert: { backgroundColor: colors.danger + '22', borderRadius: RADIUS.md, padding: SPACING.md, marginTop: 8, borderWidth: 1, borderColor: colors.danger + '44' },
  activeErrorText: { color: colors.danger, fontSize: 13, fontWeight: TYPOGRAPHY.fontWeightMedium },
  dosageRow: { flexDirection: 'row', gap: SPACING.md, alignItems: 'flex-start' },
  dosageInput: { width: 80 },
  unitScroll: { flex: 1 },
  unitChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.surfaceBorder, marginRight: SPACING.xs,
  },
  unitChipActive: { backgroundColor: colors.primary + '20', borderColor: colors.primary },
  unitChipText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  unitChipTextActive: { color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  typeRow: { flexDirection: 'row', gap: SPACING.sm },
  typeChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.surfaceBorder,
    alignItems: 'center', gap: 4, minWidth: 80,
  },
  typeChipActive: { backgroundColor: colors.primary + '20', borderColor: colors.primary },
  typeChipEmoji: { fontSize: 20 },
  typeChipLabel: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textSecondary },
  typeChipLabelActive: { color: colors.primary },
  freqRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  freqChip: { flex: 1, minWidth: '45%', padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.surfaceBorder },
  freqChipActive: { backgroundColor: colors.primary + '20', borderColor: colors.primary },
  freqChipText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, textAlign: 'center' },
  freqChipTextActive: { color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  intervalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  intervalCard: {
    width: '47%', padding: SPACING.lg,
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.lg,
    borderWidth: 1.5, borderColor: colors.surfaceBorder,
    alignItems: 'center', gap: SPACING.xs, position: 'relative',
  },
  intervalCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  intervalIcon: { fontSize: 26 },
  intervalLabel: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, fontWeight: TYPOGRAPHY.fontWeightMedium, textAlign: 'center' },
  intervalLabelActive: { color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightBold },
  intervalCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  intervalCheckText: { fontSize: 10, color: '#fff', fontWeight: TYPOGRAPHY.fontWeightBold },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  timePickerBox: {
    flex: 1, minWidth: '45%',
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: colors.primary + '55',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  timeLabel: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textMuted },
  timeValueDisplay: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.primary, marginTop: 2 },
  timeEditIcon: { fontSize: 20 },
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
  pickerHeader: { alignItems: 'center', marginBottom: SPACING.xl },
  pickerIconContainer: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  pickerIcon: { fontSize: 32 },
  pickerBody: { marginBottom: SPACING.xl },
  pickerTitle: { fontSize: TYPOGRAPHY.fontSizeXl, fontWeight: TYPOGRAPHY.fontWeightBold, textAlign: 'center' },
  pickerCloseBtn: { backgroundColor: colors.primary, borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center' },
  pickerCloseBtnText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  saveButton: {
    backgroundColor: colors.primary, borderRadius: RADIUS.lg,
    padding: SPACING.xl, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  datePickerBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.md,
    padding: SPACING.lg, borderWidth: 1, borderColor: colors.surfaceBorder,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
  },
  datePickerBtnText: { fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textPrimary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  customDatePickerHeader: { padding: SPACING.xl, alignItems: 'flex-start', justifyContent: 'center' },
  customDatePickerYear: { fontSize: TYPOGRAPHY.fontSizeMd, color: 'rgba(255,255,255,0.7)', fontWeight: 'bold', marginBottom: 4 },
  customDatePickerDate: { fontSize: TYPOGRAPHY.fontSize2xl, color: '#fff', fontWeight: 'bold' },
  customDatePickerBody: { padding: 0 },
  customDatePickerActions: { flexDirection: 'row', justifyContent: 'flex-end', padding: SPACING.md, gap: SPACING.lg },
  customDatePickerCancelBtn: { padding: SPACING.md },
  customDatePickerOkBtn: { padding: SPACING.md },
  customDatePickerActionText: { fontSize: TYPOGRAPHY.fontSizeMd, textTransform: 'uppercase' },
});
