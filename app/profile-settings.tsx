import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../store/useStore';
import { updateProfile } from 'firebase/auth';
import { updateDoc, setDoc, doc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, AVATAR_OPTIONS } from '../constants/AppConstants';
import { t } from '../constants/translations';
import type { LanguageCode } from '../constants/translations';

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
  const [isSaving, setIsSaving] = useState(false);

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
            userId: user?.uid
          }, { merge: true });
        } catch (dbErr: any) {
          console.log('Firestore update failed, continuing with store update:', dbErr);
        }
      }
      
      if (activeProfile) {
        const updatedProfiles = profiles.map(p =>
          p.id === activeProfile.id ? { ...p, name: trimmedName, avatar: avatar } : p
        );
        setProfiles(updatedProfiles);
      }

      showAlert({
        message: t(language as LanguageCode, 'profileUpdate.success'),
        type: 'success',
        buttons: [{ text: 'OK', onPress: () => router.back() }]
      });
    } catch (err: any) {
      console.log('--- PROFILE UPDATE ERROR ---');
      console.log(err);
      console.log('---------------------------');
      showAlert({ message: lang === 'tr' ? 'Profil güncellenemedi.' : 'Profile update failed.', type: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    showAlert({
      message: t(lang, 'profiles.logoutConfirm'),
      type: 'warning',
      buttons: [
        { text: t(lang, 'profiles.cancel'), style: 'cancel' },
        {
          text: t(lang, 'profiles.logout'),
          style: 'destructive',
          onPress: async () => {
            try {
              if (auth) {
                const { signOut: firebaseSignOut } = await import('firebase/auth');
                await firebaseSignOut(auth);
              }
            } catch (e) {
              console.log('Firebase signOut hatası:', e);
            }
            useStore.getState().logout();
            router.replace('/login');
          },
        },
      ]
    });
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

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarLetter}>{avatar}</Text>
            </View>
            <Text style={styles.avatarHint}>{lang === 'tr' ? 'Avatar Seçin' : 'Select Avatar'}</Text>
            
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
              onSubmitEditing={handleSave}
            />
          </View>

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

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutBtnText}>🚪 {t(lang, 'profiles.logout')}</Text>
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
  avatarContainer: { alignItems: 'center', paddingVertical: SPACING.xxl },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  avatarLetter: { fontSize: 40 },
  avatarHint: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textMuted, marginBottom: SPACING.md },
  avatarPicker: { flexDirection: 'row', paddingVertical: SPACING.sm },
  emojiBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    marginRight: SPACING.sm, borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  emojiBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
  emojiText: { fontSize: 24 },
  fieldGroup: { marginBottom: SPACING.xxl },
  label: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textSecondary, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.surface, borderRadius: RADIUS.md,
    padding: SPACING.lg, color: colors.textPrimary, fontSize: TYPOGRAPHY.fontSizeMd,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  saveButton: {
    backgroundColor: colors.primary, borderRadius: RADIUS.lg,
    padding: SPACING.xl, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
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
});
