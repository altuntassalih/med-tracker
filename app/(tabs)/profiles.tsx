import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { deleteProfile } from '../../services/firestore';
import { useStore } from '../../store/useStore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../../constants/AppConstants';
import { t, LanguageCode } from '../../constants/translations';

export default function ProfilesScreen() {
  const { user, profiles, removeProfile, setActiveProfileId, activeProfileId, language, theme, showAlert } = useStore();
  const [isLoading] = useState(false);
  
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  const handleAddProfile = () => {
    if (profiles.length >= 5) {
      showAlert({ 
        message: lang === 'tr' ? 'En fazla 5 profil oluşturabilirsiniz.' : 'You can create up to 5 profiles.', 
        type: 'warning' 
      });
      return;
    }
    router.push('/add-profile');
  };

  const handleDeleteProfile = (profile: any) => {
    if (profiles.length <= 1) {
      showAlert({
        message: lang === 'tr' ? 'Son profili silemezsiniz.' : 'You cannot delete the last profile.',
        type: 'warning'
      });
      return;
    }
    showAlert({
      message: `"${profile.name}" ${t(lang, 'profiles.deleteConfirm')}`,
      type: 'danger',
      buttons: [
        { text: t(lang, 'profiles.cancel'), style: 'cancel' },
        {
          text: t(lang, 'profiles.deleteBtn'),
          style: 'destructive',
          onPress: async () => {
            try {
              removeProfile(profile.id);
              await deleteProfile(profile.id);
            } catch (err) {
              console.log('Profil silinirken hata:', err);
            }
          },
        },
      ]
    });
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
              if (auth) await signOut(auth);
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
        <Text style={styles.headerTitle}>👤 {t(lang, 'profiles.title')}</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t(lang, 'profiles.logout')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.currentUserCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{user?.displayName?.[0] ?? 'K'}</Text>
          </View>
          <View>
            <Text style={styles.currentUserName}>{user?.displayName ?? t(lang, 'profiles.guestUser')}</Text>
            <Text style={styles.currentUserEmail}>{user?.email || t(lang, 'profiles.localSession')}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t(lang, 'profiles.listTitle')}</Text>
        
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: SPACING.xl }} />
        ) : (
          <>
            {profiles.map((profile) => (
              <TouchableOpacity
                key={profile.id}
                style={[styles.profileCard, activeProfileId === profile.id && styles.profileCardActive]}
                onPress={() => setActiveProfileId(profile.id)}
                activeOpacity={0.85}
              >
                <View style={[styles.profileAvatar, activeProfileId === profile.id && styles.profileAvatarActive]}>
                  <Text style={styles.profileAvatarEmoji}>{profile.avatar || (profile.isMain ? '👤' : '👦')}</Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName}>{profile.name}</Text>
                  {profile.age && <Text style={styles.profileAge}>{profile.age} {t(lang, 'profiles.ageSuffix')}</Text>}
                  {profile.isMain && (
                    <View style={styles.mainBadge}>
                      <Text style={styles.mainBadgeText}>{t(lang, 'profiles.mainBadge')}</Text>
                    </View>
                  )}
                </View>
                {activeProfileId === profile.id && (
                  <Text style={styles.activeCheckmark}>✓</Text>
                )}
                
                <TouchableOpacity 
                  onPress={() => router.push({ pathname: '/profile-settings', params: { id: profile.id } })} 
                  style={styles.editProfileBtn}
                >
                  <Text style={styles.editProfileBtnText}>✎</Text>
                </TouchableOpacity>

                {profiles.length > 1 && (
                  <TouchableOpacity onPress={() => handleDeleteProfile(profile)} style={styles.deleteProfileBtn}>
                    <Text style={styles.deleteProfileBtnText}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.addProfileCard} onPress={handleAddProfile}>
              <Text style={styles.addProfileIcon}>+</Text>
              <Text style={styles.addProfileText}>{t(lang, 'profiles.addNew')}</Text>
              <Text style={styles.addProfileSub}>{t(lang, 'profiles.addNewSub')}</Text>
            </TouchableOpacity>
          </>
        )}
        
        <View style={{ height: SPACING.xxl * 2 }} />
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.xl, paddingTop: 60, paddingBottom: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  headerTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  logoutButton: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
    backgroundColor: colors.danger + '22', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: colors.danger + '44',
  },
  logoutText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.danger, fontWeight: TYPOGRAPHY.fontWeightMedium },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.xl, gap: SPACING.md },
  currentUserCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.primary + '15', borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: colors.primary + '33',
    marginBottom: SPACING.md,
  },
  avatarCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  currentUserName: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  currentUserEmail: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: { fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary, marginBottom: SPACING.sm },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  profileCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '11' },
  profileAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarActive: { backgroundColor: colors.primary + '33' },
  profileAvatarEmoji: { fontSize: 24 },
  profileInfo: { flex: 1 },
  profileName: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  profileAge: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary, marginTop: 2 },
  mainBadge: {
    marginTop: 4, backgroundColor: colors.primary + '22',
    borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 2, alignSelf: 'flex-start',
  },
  mainBadgeText: { fontSize: TYPOGRAPHY.fontSizeXs, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightMedium },
  activeCheckmark: { fontSize: TYPOGRAPHY.fontSizeLg, color: colors.success },
  editProfileBtn: { padding: SPACING.xs, marginLeft: SPACING.xs },
  editProfileBtnText: { fontSize: 20, color: colors.primary },
  deleteProfileBtn: { padding: SPACING.xs, marginLeft: SPACING.xs },
  deleteProfileBtnText: { fontSize: 18, color: colors.danger },
  addProfileCard: {
    alignItems: 'center', justifyContent: 'center', gap: SPACING.xs,
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    padding: SPACING.xxl, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.surfaceBorder,
    marginTop: SPACING.md,
  },
  addProfileIcon: { fontSize: 32, color: colors.primary },
  addProfileText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textPrimary },
  addProfileSub: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
});
