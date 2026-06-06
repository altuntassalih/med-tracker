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
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { FontAwesome } from '@expo/vector-icons';
import { auth } from '../services/firebase';
import { getProfiles, getMedications, getMedicationLogs, createProfile, getDailyHealthLogs } from '../services/firestore';
import { useStore } from '../store/useStore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const { user, setUser, setProfiles, setMedications, setMedicationLogs, setDailyHealthLogs, setActiveProfileId, language, lastEmail, setLastEmail, theme, showAlert } = useStore();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState(lastEmail || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  useEffect(() => {
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [isLogin]);

  useEffect(() => {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (webClientId) {
      GoogleSignin.configure({
        webClientId: webClientId,
        offlineAccess: false,
      });
    }
  }, []);

  useEffect(() => {
    if (user?.uid) {
      const timer = setTimeout(() => {
        try {
          const hasProfiles = useStore.getState().profiles.length > 0;
          if (hasProfiles) {
            router.replace('/(tabs)');
          } else {
            router.replace('/onboarding');
          }
        } catch (_) {}
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [user?.uid]);

  const handleGoogleAuth = async () => {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!webClientId) {
      setError(
        lang === 'tr'
          ? 'Google Web Client ID (.env dosyasında) bulunamadı. Lütfen kurulum adımlarını takip edin.'
          : 'Google Web Client ID not found in .env. Please follow setup instructions.'
      );
      return;
    }
    if (!auth) {
      setError(t(lang, 'login.errorGeneric'));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken || (response as any).idToken;
      if (!idToken) {
        throw new Error('No idToken returned from Google Sign-In');
      }
      const credential = GoogleAuthProvider.credential(idToken);
      const cred = await signInWithCredential(auth, credential);
      setLastEmail(cred.user.email || '');
      await loadUserData(cred.user);
      const hasProfiles = useStore.getState().profiles.length > 0;
      if (hasProfiles) {
        router.replace('/(tabs)');
      } else {
        router.replace('/onboarding');
      }
    } catch (err: any) {
      if (err.code === 'DEVELOPER_ERROR') {
        setError(
          lang === 'tr'
            ? 'Geliştirici Hatası (DEVELOPER_ERROR). Lütfen Firebase ve Google Cloud Console\'da SHA-1 parmak izlerinin doğru girildiğini ve Web Client ID\'nin doğru olduğunu kontrol edin.'
            : 'Developer Error (DEVELOPER_ERROR). Please check that SHA-1 fingerprints are registered in Firebase and Web Client ID is correct.'
        );
      } else if (err.code === 'SIGN_IN_CANCELLED') {
        setError(lang === 'tr' ? 'Giriş iptal edildi.' : 'Sign in cancelled.');
      } else if (err.code === 'IN_PROGRESS') {
        setError(lang === 'tr' ? 'Giriş işlemi devam ediyor...' : 'Sign in already in progress.');
      } else {
        setError(`${lang === 'tr' ? 'Google ile giriş başarısız' : 'Google sign-in failed'} (${err.message || err.code || 'Bilinmeyen Hata'})`);
      }
    } finally {
      setIsLoading(false);
    }
  };

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
      let allHealthLogs: any[] = [];
      for (const p of userProfiles) {
        const meds = await getMedications(p.id, null); // Fetch all (active + archived)
        allMeds = [...allMeds, ...meds];
        const logs = await getMedicationLogs(p.id);
        allLogs = [...allLogs, ...logs];
        const hLogs = await getDailyHealthLogs(p.id);
        allHealthLogs = [...allHealthLogs, ...hLogs];
      }
      setMedications(allMeds);
      setMedicationLogs(allLogs);
      setDailyHealthLogs(allHealthLogs);
    } else {
      const existingProfile = useStore.getState().profiles.find(p => p.userId === fireUser.uid);
      if (existingProfile) {
        setActiveProfileId(existingProfile.id);
      }
    }
  };

  const handleAuth = async () => {
    if (!email || !password || (!isLogin && !confirmPassword)) {
      setError(t(lang, 'login.errorEmpty'));
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      setError(t(lang, 'login.errorPasswordMismatch'));
      return;
    }
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
      const hasProfiles = useStore.getState().profiles.length > 0;
      if (hasProfiles) {
        router.replace('/(tabs)');
      } else {
        router.replace('/onboarding');
      }
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError(t(lang, 'login.errorInvalid'));
      } else if (err.code === 'auth/email-already-in-use') {
        setError(t(lang, 'login.errorInUse'));
      } else if (err.code === 'auth/user-not-found') {
        setError(t(lang, 'login.errorNotFound'));
      } else if (err.code === 'auth/weak-password') {
        setError(lang === 'tr' ? 'Şifre en az 6 karakter olmalıdır.' : 'Password should be at least 6 characters.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError(lang === 'tr' ? 'Email/Şifre girişi Firebase panelinden kapalı!' : 'Email/Password sign-in is disabled in Firebase!');
      } else {
        setError(`${t(lang, 'login.errorGeneric')} (${err.code || 'Bilinmeyen Hata'})`);
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
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder={t(lang, 'login.passwordLabel')}
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType={isLogin ? "done" : "next"}
                  onSubmitEditing={isLogin ? handleAuth : undefined}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                  activeOpacity={0.7}
                >
                  <FontAwesome
                    name={showPassword ? "eye" : "eye-slash"}
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {!isLogin && (
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder={t(lang, 'login.passwordConfirmLabel')}
                    placeholderTextColor={colors.textMuted}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleAuth}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    activeOpacity={0.7}
                  >
                    <FontAwesome
                      name={showConfirmPassword ? "eye" : "eye-slash"}
                      size={20}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              )}
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

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t(lang, 'login.or')}</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={[styles.googleButton, isLoading && styles.buttonDisabled]}
              onPress={handleGoogleAuth}
              disabled={isLoading}
            >
              <Image source={require('../assets/images/google-logo.png')} style={styles.googleIconImage} />
              <Text style={styles.googleButtonText}>{t(lang, 'login.googleBtn')}</Text>
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  googleIcon: {
    marginRight: SPACING.xs,
  },
  googleButtonText: {
    color: colors.textPrimary,
    fontSize: TYPOGRAPHY.fontSizeLg,
    fontWeight: TYPOGRAPHY.fontWeightSemiBold,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.md,
    gap: SPACING.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.surfaceBorder,
  },
  dividerText: {
    color: colors.textMuted,
    fontSize: TYPOGRAPHY.fontSizeSm,
    paddingHorizontal: SPACING.sm,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingHorizontal: SPACING.lg,
  },
  passwordInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: TYPOGRAPHY.fontSizeMd,
    paddingVertical: Platform.OS === 'ios' ? SPACING.lg : SPACING.md,
  },
  eyeButton: {
    padding: SPACING.sm,
  },
  googleIconImage: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
    marginRight: SPACING.xs,
  },
  errorBox: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: TYPOGRAPHY.fontSizeSm, textAlign: 'center' },
});
