import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../store/useStore';
import { updateProfile } from 'firebase/auth';
import { updateDoc, setDoc, doc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, AVATAR_OPTIONS, GENDER_MALE, GENDER_FEMALE, GENDER_OTHER } from '../constants/AppConstants';
import { t } from '../constants/translations';
import type { LanguageCode } from '../constants/translations';
import { calculateBmi } from '../utils/bmi';

export default function ProfileSettingsScreen() {
  const { user, setUser, profiles, setProfiles, language, activeProfileId, theme } = useStore();
  
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  const { id } = useLocalSearchParams<{ id: string }>();
  const activeProfile = profiles.find(p => p.id === (id || activeProfileId)) || profiles.find(p => p.isMain);
  const { showAlert } = useStore();
  const [name, setName] = useState(activeProfile?.name || user?.displayName || '');
  const [avatar, setAvatar] = useState<string>(activeProfile?.avatar || '👤');
  const [gender, setGender] = useState<'female' | 'male' | 'other'>(activeProfile?.gender || GENDER_FEMALE);
  const [age, setAge] = useState(activeProfile?.age ? String(activeProfile.age) : '');
  const [height, setHeight] = useState(activeProfile?.height ? String(activeProfile.height) : '');
  const [weight, setWeight] = useState(activeProfile?.weight ? String(activeProfile.weight) : '');
  const [targetWeight, setTargetWeight] = useState(activeProfile?.targetWeight ? String(activeProfile.targetWeight) : '');
  const [isSaving, setIsSaving] = useState(false);

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          lang === 'tr' ? 'İzin Gerekli' : 'Permission Required',
          lang === 'tr' 
            ? 'Profil resmi eklemek için galeri iznine ihtiyacımız var.' 
            : 'We need library permissions to select a profile photo.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const selectedUri = result.assets[0].uri;
        
        const manipulated = await ImageManipulator.manipulateAsync(
          selectedUri,
          [{ resize: { width: 150, height: 150 } }],
          {
            compress: 0.5,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          }
        );

        if (manipulated.base64) {
          const base64Data = `data:image/jpeg;base64,${manipulated.base64}`;
          setAvatar(base64Data);
        }
      }
    } catch (err) {
      Alert.alert(
        lang === 'tr' ? 'Hata' : 'Error',
        lang === 'tr' ? 'Fotoğraf seçilirken bir hata oluştu.' : 'An error occurred while selecting the photo.'
      );
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setIsSaving(true);
    try {
      if (auth && auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmedName });
      }

      if (user) {
        setUser({ ...user, displayName: trimmedName });
      }

      if (activeProfile?.id && !activeProfile.id.startsWith('local_') && db) {
        try {
          await setDoc(doc(db, 'profiles', activeProfile.id), { 
            name: trimmedName,
            avatar: avatar,
            userId: user?.uid,
            age: age ? parseInt(age, 10) : null,
            height: height ? parseFloat(height) : null,
            weight: weight ? parseFloat(weight) : null,
            targetWeight: targetWeight ? parseFloat(targetWeight) : null,
            gender: gender,
          }, { merge: true });
        } catch (dbErr: any) {
          // Hata sessizce yutulur
        }
      }
      
      if (activeProfile) {
        const updatedProfiles = profiles.map(p =>
          p.id === activeProfile.id ? { 
            ...p, 
            name: trimmedName, 
            avatar: avatar,
            age: age ? parseInt(age, 10) : undefined,
            height: height ? parseFloat(height) : undefined,
            weight: weight ? parseFloat(weight) : undefined,
            targetWeight: targetWeight ? parseFloat(targetWeight) : undefined,
            gender: gender,
          } : p
        );
        setProfiles(updatedProfiles);
      }

      showAlert({
        message: t(language as LanguageCode, 'profileUpdate.success'),
        type: 'success',
        buttons: [{ text: 'OK', onPress: () => router.back() }]
      });
    } catch (err: any) {
      showAlert({ message: lang === 'tr' ? 'Profil güncellenemedi.' : 'Profile update failed.', type: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };



  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t(language as LanguageCode, 'profileUpdate.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatarCircle}>
              {avatar.startsWith('data:image/') ? (
                <Image source={{ uri: avatar }} style={{ width: 90, height: 90, borderRadius: 45 }} />
              ) : (
                <Text style={styles.avatarLetter}>{avatar}</Text>
              )}
            </View>
            <TouchableOpacity 
              style={[styles.customPhotoBtn, avatar.startsWith('data:image/') && styles.customPhotoBtnActive]} 
              onPress={handlePickImage}
              activeOpacity={0.7}
            >
              <Text style={[styles.customPhotoBtnText, { color: avatar.startsWith('data:image/') ? '#fff' : colors.primary }]}>
                📸 {lang === 'tr' ? 'Fotoğraf Yükle' : 'Upload Photo'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.avatarHint}>
              {lang === 'tr' ? 'Veya bir emoji avatar seçin:' : 'Or select an emoji avatar:'}
            </Text>
            
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.avatarPicker}>
              {AVATAR_OPTIONS.map(emoji => (
                <TouchableOpacity 
                  key={emoji} 
                  onPress={() => setAvatar(emoji)}
                  style={[styles.emojiBtn, avatar === emoji && styles.emojiBtnActive]}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t(language as LanguageCode, 'profileUpdate.nameLabel')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Adınız Soyadınız"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t(language as LanguageCode, 'profileUpdate.genderLabel')}</Text>
            <View style={styles.genderOptionsRow}>
              <TouchableOpacity 
                style={[styles.genderBtn, gender === GENDER_FEMALE && styles.genderBtnActive]} 
                onPress={() => setGender(GENDER_FEMALE)}
                activeOpacity={0.8}
              >
                <Text style={[styles.genderBtnText, gender === GENDER_FEMALE && styles.genderBtnTextActive]}>
                  👩 {t(language as LanguageCode, 'profileUpdate.genderFemale')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.genderBtn, gender === GENDER_MALE && styles.genderBtnActive]} 
                onPress={() => setGender(GENDER_MALE)}
                activeOpacity={0.8}
              >
                <Text style={[styles.genderBtnText, gender === GENDER_MALE && styles.genderBtnTextActive]}>
                  👨 {t(language as LanguageCode, 'profileUpdate.genderMale')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.genderBtn, gender === GENDER_OTHER && styles.genderBtnActive]} 
                onPress={() => setGender(GENDER_OTHER)}
                activeOpacity={0.8}
              >
                <Text style={[styles.genderBtnText, gender === GENDER_OTHER && styles.genderBtnTextActive]}>
                  👤 {t(language as LanguageCode, 'profileUpdate.genderOther')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{lang === 'tr' ? 'Yaş (Opsiyonel)' : 'Age (Optional)'}</Text>
            <TextInput
              style={styles.input}
              value={age}
              onChangeText={(val) => setAge(val.replace(/[^0-9]/g, ''))}
              placeholder={lang === 'tr' ? 'örn: 30' : 'e.g. 30'}
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
                borderColor: calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.color,
                marginBottom: SPACING.xl
              }
            ]}>
              <Text 
                style={[styles.bmiText, { color: calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                📊 {lang === 'tr' ? 'Beden Kitle İndeksi (BKİ):' : 'Body Mass Index (BMI):'} {calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.bmi} ({calculateBmi(weight ? parseFloat(weight) : 0, height ? parseFloat(height) : 0, lang)!.category})
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>💾 {t(language as LanguageCode, 'profileUpdate.save')}</Text>
            )}
          </TouchableOpacity>


        </View>
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
  backBtnText: { fontSize: 36, color: colors.primary, lineHeight: 40 },
  headerTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  content: { padding: SPACING.xl },
  avatarContainer: { alignItems: 'center', paddingVertical: SPACING.md },
  avatarCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  avatarLetter: { fontSize: 44 },
  avatarHint: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.textMuted, marginTop: SPACING.lg, marginBottom: SPACING.xs },
  avatarPicker: { flexDirection: 'row', paddingVertical: SPACING.sm },
  emojiBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    marginRight: SPACING.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  emojiBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
  emojiText: { fontSize: 24 },
  fieldGroup: { marginBottom: SPACING.lg },
  label: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textSecondary, marginBottom: SPACING.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.surface, borderRadius: RADIUS.md,
    paddingVertical: 10, paddingHorizontal: 14, color: colors.textPrimary, fontSize: TYPOGRAPHY.fontSizeMd,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  saveButton: {
    backgroundColor: colors.primary, borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
    marginTop: SPACING.md,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  logoutBtn: {
    marginTop: SPACING.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    backgroundColor: colors.danger + '15',
    borderWidth: 1,
    borderColor: colors.danger + '33',
  },
  logoutBtnText: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    color: colors.danger,
    fontWeight: TYPOGRAPHY.fontWeightBold,
  },
  bmiBadge: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginTop: SPACING.xs,
    alignItems: 'center',
  },
  bmiText: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
  genderOptionsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: 4,
  },
  genderBtn: {
    flex: 1,
    backgroundColor: colors.surfaceBorder + '22',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  genderBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textSecondary,
  },
  genderBtnTextActive: {
    color: '#ffffff',
  },
  customPhotoBtn: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary + '40',
    borderWidth: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
  },
  customPhotoBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  customPhotoBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});
