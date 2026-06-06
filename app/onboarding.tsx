import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../store/useStore';
import { createProfile } from '../services/firestore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS, GENDER_MALE, GENDER_FEMALE, GENDER_OTHER } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';

const { width } = Dimensions.get('window');

export default function OnboardingScreen() {
  const { user, setProfiles, setActiveProfileId, language, theme, showAlert } = useStore();
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  // Onboarding Form States
  const [step, setStep] = useState(1);
  const [name, setName] = useState(user?.displayName || '');
  const [gender, setGender] = useState<'female' | 'male' | 'other'>(GENDER_FEMALE);
  const [age, setAge] = useState(30);
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [targetWeight, setTargetWeight] = useState(70);
  const [isSaving, setIsSaving] = useState(false);

  // Animation Refs
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Trigger step animation
  const transitionToStep = (nextStep: number) => {
    // Fade out and slide left
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -50,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStep(nextStep);
      // Reset position to right and fade in
      slideAnim.setValue(50);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const handleNext = () => {
    if (step === 2 && !name.trim()) {
      showAlert({
        message: lang === 'tr' ? 'Lütfen isminizi girin.' : 'Please enter your name.',
        type: 'warning',
      });
      return;
    }
    if (step < 5) {
      transitionToStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      transitionToStep(step - 1);
    }
  };

  // BMI (BKİ) ve Önerilen Su Hesaplama
  const bmi = weight / ((height / 100) * (height / 100));
  
  const getBmiClass = () => {
    if (bmi < 18.5) return lang === 'tr' ? 'Zayıf' : 'Underweight';
    if (bmi < 25) return lang === 'tr' ? 'Normal' : 'Normal';
    if (bmi < 30) return lang === 'tr' ? 'Fazla Kilolu' : 'Overweight';
    if (bmi < 35) return lang === 'tr' ? 'Obez (Sınıf 1)' : 'Obese (Class 1)';
    return lang === 'tr' ? 'Aşırı Obez (Sınıf 2+)' : 'Severely Obese (Class 2+)';
  };

  const getBmiColor = () => {
    if (bmi < 18.5) return '#3B82F6'; // Mavi
    if (bmi < 25) return '#10B981'; // Yeşil
    if (bmi < 30) return '#F59E0B'; // Turuncu
    return '#EF4444'; // Kırmızı
  };

  const getRecommendedWater = () => {
    let base = weight * (gender === GENDER_FEMALE ? 31 : 35);
    if (age < 30) base = weight * (gender === GENDER_FEMALE ? 36 : 40);
    else if (age > 65) base = weight * (gender === GENDER_FEMALE ? 27 : 30);
    if (height > 185) base += 250;
    return Math.round(base / 100) * 100;
  };

  const recommendedWater = getRecommendedWater();

  const handleFinish = async () => {
    if (!user?.uid) return;
    setIsSaving(true);

    try {
      // 1. Create main profile in DB
      const newProfile = await createProfile(user.uid, {
        name: name.trim(),
        age,
        height,
        weight,
        targetWeight,
        isMain: true,
        avatar: '👤',
        gender,
      });

      // 2. Set in Zustand Store
      setProfiles([newProfile]);
      setActiveProfileId(newProfile.id);

      showAlert({
        message: lang === 'tr' ? 'Profiliniz başarıyla oluşturuldu!' : 'Your profile has been created!',
        type: 'success',
      });

      // 3. Route to main tab panel
      router.replace('/(tabs)');
    } catch (err) {
      showAlert({
        message: lang === 'tr' ? 'Profil oluşturulurken hata oluştu.' : 'Failed to create profile.',
        type: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <View style={styles.stepWrapper}>
            <View style={styles.logoBadgeContainer}>
              <Text style={styles.logoBadge}>✨</Text>
            </View>
            <Text style={styles.title}>
              {lang === 'tr' ? 'MedTracker\'a Hoş Geldiniz!' : 'Welcome to MedTracker!'}
            </Text>
            <Text style={styles.description}>
              {lang === 'tr'
                ? 'İlaçlarınızı zamanında almak, su tüketimini, uykuyu ve kilonuzu takip etmek artık çok kolay. Başlamadan önce profilinizi oluşturalım.'
                : 'Taking meds on time, tracking water intake, sleep, and weight is now easier than ever. Let\'s set up your profile first.'}
            </Text>
            
            <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>{lang === 'tr' ? 'Hemen Başlayalım' : 'Let\'s Start'}</Text>
            </TouchableOpacity>
          </View>
        );

      case 2:
        return (
          <View style={styles.stepWrapper}>
            <Text style={styles.stepIndicator}>2 / 5</Text>
            <Text style={styles.title}>
              {lang === 'tr' ? 'Adınız nedir?' : 'What is your name?'}
            </Text>
            <Text style={styles.description}>
              {lang === 'tr'
                ? 'Profilinizde görünecek ve size hitap edeceğimiz ismi belirtin.'
                : 'Enter the display name that will appear on your profile.'}
            </Text>
            
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder={lang === 'tr' ? 'Adınız Soyadınız' : 'Your Name'}
              placeholderTextColor={colors.textMuted}
              maxLength={25}
              autoFocus
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack}>
                <Text style={styles.secondaryBtnText}>{lang === 'tr' ? 'Geri' : 'Back'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleNext}>
                <Text style={styles.primaryBtnText}>{lang === 'tr' ? 'İleri' : 'Next'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 3:
        return (
          <View style={styles.stepWrapper}>
            <Text style={styles.stepIndicator}>3 / 5</Text>
            <Text style={styles.title}>
              {lang === 'tr' ? 'Cinsiyet, Yaş ve Boy?' : 'Gender, Age & Height?'}
            </Text>
            <Text style={styles.description}>
              {lang === 'tr'
                ? 'İndeks hesaplamaları ve kişiselleştirilmiş su hedefleri için bu bilgilere ihtiyacımız var.'
                : 'We need this information to calculate body indexes and custom water targets.'}
            </Text>

            {/* GENDER SELECTOR */}
            <View style={styles.stepperSection}>
              <Text style={styles.stepperLabel}>{t(lang, 'profileUpdate.genderLabel').toUpperCase()}</Text>
              <View style={styles.genderOptionsRow}>
                <TouchableOpacity 
                  style={[styles.genderOnboardBtn, gender === GENDER_FEMALE && styles.genderOnboardBtnActive]} 
                  onPress={() => setGender(GENDER_FEMALE)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.genderOnboardBtnText, gender === GENDER_FEMALE && styles.genderOnboardBtnTextActive]}>
                    👩 {t(lang, 'profileUpdate.genderFemale')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.genderOnboardBtn, gender === GENDER_MALE && styles.genderOnboardBtnActive]} 
                  onPress={() => setGender(GENDER_MALE)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.genderOnboardBtnText, gender === GENDER_MALE && styles.genderOnboardBtnTextActive]}>
                    👨 {t(lang, 'profileUpdate.genderMale')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.genderOnboardBtn, gender === GENDER_OTHER && styles.genderOnboardBtnActive]} 
                  onPress={() => setGender(GENDER_OTHER)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.genderOnboardBtnText, gender === GENDER_OTHER && styles.genderOnboardBtnTextActive]}>
                    👤 {t(lang, 'profileUpdate.genderOther')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* AGE STEPPER */}
            <View style={styles.stepperSection}>
              <Text style={styles.stepperLabel}>{lang === 'tr' ? 'YAŞ' : 'AGE'}</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setAge(prev => Math.max(1, prev - 1))}>
                  <Text style={styles.stepperBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{age} <Text style={styles.stepperUnit}>{lang === 'tr' ? 'yaş' : 'yrs'}</Text></Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setAge(prev => Math.min(120, prev + 1))}>
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* HEIGHT STEPPER */}
            <View style={styles.stepperSection}>
              <Text style={styles.stepperLabel}>{lang === 'tr' ? 'BOY' : 'HEIGHT'}</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setHeight(prev => Math.max(50, prev - 1))}>
                  <Text style={styles.stepperBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{height} <Text style={styles.stepperUnit}>cm</Text></Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setHeight(prev => Math.min(250, prev + 1))}>
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack}>
                <Text style={styles.secondaryBtnText}>{lang === 'tr' ? 'Geri' : 'Back'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleNext}>
                <Text style={styles.primaryBtnText}>{lang === 'tr' ? 'İleri' : 'Next'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 4:
        return (
          <View style={styles.stepWrapper}>
            <Text style={styles.stepIndicator}>4 / 5</Text>
            <Text style={styles.title}>
              {lang === 'tr' ? 'Kilonuz?' : 'Your Weight?'}
            </Text>
            <Text style={styles.description}>
              {lang === 'tr'
                ? 'Mevcut ağırlığınızı ve ulaşmak istediğiniz hedef kiloyu girin.'
                : 'Enter your current weight and your desired target weight.'}
            </Text>

            {/* WEIGHT STEPPER */}
            <View style={styles.stepperSection}>
              <Text style={styles.stepperLabel}>{lang === 'tr' ? 'MEVCUT KİLO' : 'CURRENT WEIGHT'}</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => { setWeight(prev => Math.max(10, prev - 1)); setTargetWeight(prev => Math.max(10, prev - 1)); }}>
                  <Text style={styles.stepperBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{weight} <Text style={styles.stepperUnit}>kg</Text></Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => { setWeight(prev => Math.min(300, prev + 1)); setTargetWeight(prev => Math.min(300, prev + 1)); }}>
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* TARGET WEIGHT STEPPER */}
            <View style={styles.stepperSection}>
              <Text style={styles.stepperLabel}>{lang === 'tr' ? 'HEDEF KİLO (İSTEĞE BAĞLI)' : 'TARGET WEIGHT (OPTIONAL)'}</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setTargetWeight(prev => Math.max(10, prev - 1))}>
                  <Text style={styles.stepperBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{targetWeight} <Text style={styles.stepperUnit}>kg</Text></Text>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => setTargetWeight(prev => Math.min(300, prev + 1))}>
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack}>
                <Text style={styles.secondaryBtnText}>{lang === 'tr' ? 'Geri' : 'Back'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleNext}>
                <Text style={styles.primaryBtnText}>{lang === 'tr' ? 'İleri' : 'Next'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 5:
        return (
          <View style={styles.stepWrapper}>
            <Text style={styles.stepIndicator}>5 / 5</Text>
            <Text style={styles.title}>
              {lang === 'tr' ? 'Sağlık Özetiniz 📊' : 'Your Health Summary 📊'}
            </Text>
            <Text style={styles.description}>
              {lang === 'tr'
                ? `Harika, ${name}! Girdiğiniz değerlere göre vücut analiziniz yapıldı.`
                : `Great, ${name}! Your body analysis is ready based on your inputs.`}
            </Text>

            {/* SUMMARY CARDS */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View>
                  <Text style={styles.summaryLabel}>{lang === 'tr' ? 'Vücut Kitle İndeksi (VKİ)' : 'Body Mass Index (BMI)'}</Text>
                  <Text style={[styles.summaryBmiValue, { color: getBmiColor() }]}>
                    {bmi.toFixed(1)} <Text style={styles.summaryBmiClass}>({getBmiClass()})</Text>
                  </Text>
                </View>
                <Text style={styles.summaryEmoji}>⚖️</Text>
              </View>
            </View>

            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View>
                  <Text style={styles.summaryLabel}>{lang === 'tr' ? 'Önerilen Günlük Su Hedefi' : 'Recommended Daily Water Goal'}</Text>
                  <Text style={styles.summaryWaterValue}>
                    {recommendedWater} <Text style={styles.summaryWaterUnit}>ml</Text>
                  </Text>
                </View>
                <Text style={styles.summaryEmoji}>💧</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack} disabled={isSaving}>
                <Text style={styles.secondaryBtnText}>{lang === 'tr' ? 'Geri' : 'Back'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtnSmall, isSaving && styles.disabledBtn]} onPress={handleFinish} disabled={isSaving}>
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>{lang === 'tr' ? 'Profili Oluştur' : 'Create Profile'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.bgGlow} />
        
        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${(step / 5) * 100}%`, backgroundColor: colors.primary }]} />
        </View>

        <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>
          {renderStepContent()}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  bgGlow: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.primary,
    opacity: 0.08,
  },
  progressContainer: {
    height: 6,
    backgroundColor: colors.surfaceBorder + '44',
    borderRadius: 3,
    marginBottom: SPACING.xxl,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  stepWrapper: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  logoBadgeContainer: {
    alignSelf: 'center',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  logoBadge: {
    fontSize: 48,
  },
  stepIndicator: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    fontWeight: 'bold',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize3xl,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    color: colors.textPrimary,
    lineHeight: 36,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: SPACING.md,
  },
  nameInput: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    fontSize: TYPOGRAPHY.fontSizeLg,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: SPACING.lg,
  },
  stepperSection: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  stepperLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.textSecondary,
    letterSpacing: 0.8,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceBorder + '22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  stepperBtnText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  stepperValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  stepperUnit: {
    fontSize: TYPOGRAPHY.fontSizeSm,
    color: colors.textSecondary,
    fontWeight: 'normal',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
    marginTop: SPACING.md,
  },
  primaryBtnSmall: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: colors.textSecondary,
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: 'bold',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryBmiValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  summaryBmiClass: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: '500',
  },
  summaryWaterValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
  },
  summaryWaterUnit: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  summaryEmoji: {
    fontSize: 32,
  },
  genderOptionsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: 4,
  },
  genderOnboardBtn: {
    flex: 1,
    backgroundColor: colors.surfaceBorder + '22',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderOnboardBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '18',
  },
  genderOnboardBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textSecondary,
  },
  genderOnboardBtnTextActive: {
    color: colors.primary,
  },
});
