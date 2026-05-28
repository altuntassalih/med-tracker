import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../store/useStore';
import { createProfile } from '../services/firestore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, AVATAR_OPTIONS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { calculateBmi } from '../utils/bmi';

export default function AddProfileScreen() {
  const { user, addProfile, profiles, setActiveProfileId, theme, language } = useStore();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<string>(AVATAR_OPTIONS[0]);
  const [isSaving, setIsSaving] = useState(false);

  const colors = getThemeColors(theme);
  const lang = language as LanguageCode;
  const styles = getStyles(colors);


  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Hata', 'Profil adı gereklidir.'); return; }
    if (!user?.uid) { Alert.alert('Hata', 'Kullanıcı oturumu bulunamadı.'); return; }

    setIsSaving(true);
    try {
      const isFirst = profiles.length === 0;
      const newProfile = await createProfile(user.uid, {
        name: name.trim(),
        isMain: isFirst,
        age: age ? parseInt(age, 10) : undefined,
        avatar: selectedAvatar,
        height: height ? parseFloat(height) : undefined,
        weight: weight ? parseFloat(weight) : undefined,
        targetWeight: targetWeight ? parseFloat(targetWeight) : undefined,
      });

      addProfile(newProfile);
      if (isFirst) setActiveProfileId(newProfile.id);

      Alert.alert('✅ Profil Oluşturuldu', `${name} için profil başarıyla oluşturuldu.`, [
        { text: 'Tamam', onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert('Hata', 'Profil kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ {t(lang, 'addMedication.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{lang === 'tr' ? 'Yeni Profil' : 'New Profile'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Avatar Seç</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            style={styles.avatarPicker}
            contentContainerStyle={{ paddingRight: SPACING.xl }}
          >
            {AVATAR_OPTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.emojiBtn, selectedAvatar === emoji && styles.emojiBtnActive]}
                onPress={() => setSelectedAvatar(emoji)}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{lang === 'tr' ? 'Ad *' : 'Name *'}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={lang === 'tr' ? 'örn: Ahmet, Anne...' : 'e.g. John, Mom...'}
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{lang === 'tr' ? 'Yaş (Opsiyonel)' : 'Age (Optional)'}</Text>
          <TextInput
            style={styles.input}
            value={age}
            onChangeText={setAge}
            placeholder={lang === 'tr' ? 'örn: 8' : 'e.g. 8'}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            maxLength={3}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{lang === 'tr' ? 'Boy (cm - Opsiyonel)' : 'Height (cm - Optional)'}</Text>
          <TextInput
            style={styles.input}
            value={height}
            onChangeText={(val) => setHeight(val.replace(/[^0-9]/g, ''))}
            placeholder={lang === 'tr' ? 'örn: 175' : 'e.g. 175'}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            maxLength={3}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{lang === 'tr' ? 'Kilo (kg - Opsiyonel)' : 'Weight (kg - Optional)'}</Text>
          <TextInput
            style={styles.input}
            value={weight}
            onChangeText={(val) => setWeight(val.replace(/[^0-9.]/g, ''))}
            placeholder={lang === 'tr' ? 'örn: 70' : 'e.g. 70'}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            maxLength={5}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{lang === 'tr' ? 'Hedef Kilo (kg - Opsiyonel)' : 'Target Weight (kg - Optional)'}</Text>
          <TextInput
            style={styles.input}
            value={targetWeight}
            onChangeText={(val) => setTargetWeight(val.replace(/[^0-9.]/g, ''))}
            placeholder={lang === 'tr' ? 'örn: 65' : 'e.g. 65'}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            maxLength={5}
          />
        </View>

        {calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang) && (
          <View style={[
            styles.bmiBadge, 
            { 
              backgroundColor: calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.color + '15', 
              borderColor: calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.color 
            }
          ]}>
            <Text style={[styles.bmiText, { color: calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.color }]}>
              📊 BKİ: {calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.bmi} ({calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.category})
            </Text>
          </View>
        )}

        <View style={styles.previewCard}>
          <Text style={styles.previewEmoji}>{selectedAvatar}</Text>
          <Text style={styles.previewName}>{name || 'Profil Adı'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACING.sm, marginTop: 4 }}>
            {age ? <Text style={styles.previewAge}>{age} yaşında</Text> : null}
            {height ? <Text style={styles.previewAge}>• {height} cm</Text> : null}
            {weight ? <Text style={styles.previewAge}>• {weight} kg</Text> : null}
            {targetWeight ? <Text style={styles.previewAge}>• Hedef: {targetWeight} kg</Text> : null}
          </View>
          {calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang) && (
            <Text style={[styles.previewAge, { color: calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.color, fontWeight: 'bold', marginTop: 4 }]}>
              BKİ: {calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.bmi} ({calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.category})
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>✅ {lang === 'tr' ? 'Profil Oluştur' : 'Create Profile'}</Text>
          )}
        </TouchableOpacity>
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
  scrollContent: { padding: SPACING.xl, gap: SPACING.xl },
  fieldGroup: {},
  label: {
    fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightSemiBold,
    color: colors.textSecondary, marginBottom: SPACING.sm,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  avatarPicker: { flexDirection: 'row', paddingVertical: SPACING.sm },
  emojiBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    marginRight: SPACING.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  emojiBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
  emojiText: { fontSize: 24 },
  input: {
    backgroundColor: colors.surface, borderRadius: RADIUS.md,
    padding: SPACING.lg, color: colors.textPrimary, fontSize: TYPOGRAPHY.fontSizeMd,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  previewCard: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.xxl, alignItems: 'center', gap: SPACING.sm,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  previewEmoji: { fontSize: 52 },
  previewName: { fontSize: TYPOGRAPHY.fontSizeXl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  previewAge: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  saveButton: {
    backgroundColor: colors.primary, borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  bmiBadge: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  bmiText: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
});
