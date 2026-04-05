import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, TextInput, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { router } from 'expo-router';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { getProfiles, getMedications, getMedicationLogs, createProfile } from '../services/firestore';
import { useStore } from '../store/useStore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const { user, setUser, setProfiles, setMedications, setMedicationLogs, setActiveProfileId, language, lastEmail, setLastEmail, theme, showAlert } = useStore();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState(lastEmail || '');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  useEffect(() => {
    if (user?.uid) {
      const timer = setTimeout(() => {
        try { router.replace('/(tabs)'); } catch (_) {}
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [user?.uid]);

  const loadUserData = async (fireUser: any) => {
    setUser({
      uid: fireUser.uid,
      email: fireUser.email || '',
      displayName: fireUser.displayName || fireUser.email?.split('@')[0] || t(lang, 'profiles.guestUser'),
      photoURL: fireUser.photoURL || '',
    });

    const userProfiles = await getProfiles(fireUser.uid);
    if (userProfiles.length > 0) {
      setProfiles(userProfiles);
      setActiveProfileId(userProfiles[0].id);
      let allMeds: any[] = [];
      let allLogs: any[] = [];
      for (const p of userProfiles) {
        const meds = await getMedications(p.id);
        allMeds = [...allMeds, ...meds];
        const logs = await getMedicationLogs(p.id);
        allLogs = [...allLogs, ...logs];
      }
      setMedications(allMeds);
      setMedicationLogs(allLogs);
    } else {
      const existingProfile = useStore.getState().profiles.find(p => p.userId === fireUser.uid);
      if (existingProfile) {
        setActiveProfileId(existingProfile.id);
      } else {
        const newProf = await createProfile(fireUser.uid, {
          name: fireUser.displayName || fireUser.email?.split('@')[0] || t(lang, 'profileUpdate.nameLabel'),
          isMain: true,
        });
        setProfiles([...useStore.getState().profiles, newProf]);
        setActiveProfileId(newProf.id);
      }
    }
  };

  const handleAuth = async () => {
    if (!email || !password) { setError(t(lang, 'login.errorEmpty')); return; }
    if (!auth) {
      setError(t(lang, 'login.errorGeneric'));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      let cred;
      if (isLogin) {
        cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      setLastEmail(email.trim());
      await loadUserData(cred.user);
      router.replace('/(tabs)');
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError(t(lang, 'login.errorInvalid'));
      } else if (err.code === 'auth/email-already-in-use') {
        setError(t(lang, 'login.errorInUse'));
      } else if (err.code === 'auth/user-not-found') {
        setError(t(lang, 'login.errorNotFound'));
      } else {
        setError(t(lang, 'login.errorGeneric'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      showAlert({ 
        message: t(lang, 'login.forgotEmailRequired'),
        type: 'warning'
      });
      return;
    }
    showAlert({
      message: `"${email}" ${t(lang, 'login.forgotMsg')}`,
      type: 'info',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        {
          text: t(lang, 'login.send'),
          onPress: async () => {
            try {
              if (!auth) { showAlert({ message: t(lang, 'login.errorGeneric'), type: 'danger' }); return; }
              await sendPasswordResetEmail(auth, email.trim());
              showAlert({ message: t(lang, 'login.sentSuccess'), type: 'success' });
            } catch (err: any) {
              if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
                showAlert({ message: lang === 'tr' ? 'Bu e-posta adresi sisteme kayıtlı değil.' : 'This email is not registered.', type: 'warning' });
              } else if (err.code === 'auth/invalid-email') {
                showAlert({ message: lang === 'tr' ? 'Geçersiz e-posta adresi.' : 'Invalid email address.', type: 'danger' });
              } else {
                showAlert({ message: lang === 'tr' ? 'Bu e-posta adresi sisteme kayıtlı değil veya geçersiz.' : 'Email is not registered or invalid.', type: 'warning' });
              }
            }
          },
        },
      ]
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.bgGlow1} />

        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Image source={require('../assets/images/icon.png')} style={styles.logoImage} />
            </View>
            <Text style={styles.appName}>MedTracker</Text>
            <Text style={styles.tagline}>{lang === 'tr' ? 'İlaçlarınızı takip edin, sağlığınızı koruyun' : 'Track your meds, stay healthy'}</Text>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>{isLogin ? t(lang, 'login.welcome') : t(lang, 'login.createAccount')}</Text>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder={t(lang, 'login.emailLabel')}
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />
              <TextInput
                style={styles.input}
                placeholder={t(lang, 'login.passwordLabel')}
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleAuth}
              />
            </View>

            {isLogin && (
              <TouchableOpacity
                style={styles.forgotBtn}
                onPress={handleForgotPassword}
              >
                <Text style={styles.forgotText}>{t(lang, 'login.forgotBtn')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={handleAuth}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{isLogin ? t(lang, 'login.loginBtn') : t(lang, 'login.registerBtn')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ alignItems: 'center', marginBottom: SPACING.lg }}
              onPress={() => { setIsLogin(!isLogin); setError(null); }}
            >
              <Text style={{ color: colors.primary, fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightMedium }}>
                {isLogin ? t(lang, 'login.noAccount') : t(lang, 'login.hasAccount')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  bgGlow1: {
    position: 'absolute', top: -100, left: -100, width: 300, height: 300,
    borderRadius: 150, backgroundColor: colors.primary, opacity: 0.12,
  },
  content: { flex: 1, paddingHorizontal: SPACING.xxl, justifyContent: 'center', paddingVertical: 60 },
  header: { alignItems: 'center', marginBottom: SPACING.xxl },
  logoContainer: {
    width: 80, height: 80, borderRadius: RADIUS.xl, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg, elevation: 8,
  },
  logoImage: { width: 80, height: 80, borderRadius: RADIUS.xl },
  appName: { fontSize: TYPOGRAPHY.fontSize3xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  tagline: { fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textSecondary, textAlign: 'center', marginTop: SPACING.sm },
  formContainer: {
    backgroundColor: colors.surfaceElevated, padding: SPACING.xl, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: colors.surfaceBorder,
  },
  formTitle: { fontSize: TYPOGRAPHY.fontSizeXl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary, marginBottom: SPACING.xl, textAlign: 'center' },
  inputGroup: { gap: SPACING.md, marginBottom: SPACING.sm },
  input: {
    backgroundColor: colors.surfaceElevated, borderRadius: RADIUS.lg, padding: SPACING.lg,
    color: colors.textPrimary, borderWidth: 1, borderColor: colors.surfaceBorder, fontSize: TYPOGRAPHY.fontSizeMd,
  },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: SPACING.xl, marginTop: SPACING.sm },
  forgotText: { color: colors.primary, fontSize: TYPOGRAPHY.fontSizeSm },
  primaryButton: { backgroundColor: colors.primary, borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center', marginBottom: SPACING.md },
  buttonText: { color: '#fff', fontSize: TYPOGRAPHY.fontSizeLg, fontWeight: TYPOGRAPHY.fontWeightSemiBold },
  buttonDisabled: { opacity: 0.7 },
  errorBox: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: TYPOGRAPHY.fontSizeSm, textAlign: 'center' },
});
