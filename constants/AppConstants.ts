// Renk Paleti - Temalar
export const DARK_COLORS = {
  background: '#070B14',
  surface: '#111827',
  surfaceElevated: '#1F2937',
  surfaceBorder: '#374151',
  primary: '#6366F1',
  primaryLight: '#818CF8',
  primaryDark: '#4F46E5',
  secondary: '#10B981',
  secondaryLight: '#34D399',
  accent: '#F43F5E',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  overlay: 'rgba(7, 11, 20, 0.9)',
  glassBg: 'rgba(17, 24, 39, 0.75)',
  glassBorder: 'rgba(99, 102, 241, 0.2)',
} as const;

export const LIGHT_COLORS = {
  background: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceElevated: '#F8FAFC',
  surfaceBorder: '#E2E8F0',
  primary: '#4F46E5',
  primaryLight: '#6366F1',
  primaryDark: '#3730A3',
  secondary: '#059669',
  secondaryLight: '#10B981',
  accent: '#E11D48',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  success: '#10B981',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#2563EB',
  overlay: 'rgba(255, 255, 255, 0.85)',
  glassBg: 'rgba(255, 255, 255, 0.7)',
  glassBorder: 'rgba(79, 70, 229, 0.2)',
} as const;

export const COLORS = DARK_COLORS; // Fallback

export const getThemeColors = (theme: 'dark' | 'light') => {
  return theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
};

// Tipografi ölçekleri
export const TYPOGRAPHY = {
  fontSizeXs: 11,
  fontSizeSm: 13,
  fontSizeMd: 15,
  fontSizeLg: 17,
  fontSizeXl: 20,
  fontSize2xl: 24,
  fontSize3xl: 30,
  fontWeightRegular: '400' as const,
  fontWeightMedium: '500' as const,
  fontWeightSemiBold: '600' as const,
  fontWeightBold: '700' as const,
} as const;

// Boşluk ölçekleri
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

// Köşe yarıçapları
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const RECORD_TYPE_MEDICATION = 'medication';
export const RECORD_TYPE_VACCINE = 'vaccine';
export const DEFAULT_VACCINE_TIME = '09:00';
export const DEFAULT_VACCINE_DOSAGE = '1';
export const DEFAULT_VACCINE_UNIT = 'doz';

// İlaç kategorileri
export const MEDICATION_TYPES = [
  { label: 'Hap / Tablet', value: 'tablet', icon: '💊' },
  { label: 'İğne / Enjeksiyon', value: 'injection', icon: '💉' },
  { label: 'Şurup / Sıvı', value: 'syrup', icon: '🫙' },
  { label: 'Merhem / Krem', value: 'cream', icon: '🧴' },
  { label: 'Damla', value: 'drop', icon: '💧' },
  { label: 'Sprey', value: 'spray', icon: '🌬️' },
  { label: 'Yama', value: 'patch', icon: '🩹' },
  { label: 'Diğer', value: 'other', icon: '🔵' },
] as const;

// Doz Birimleri Sabitleri
export const DOSE_UNIT_TABLET = 'tablet';
export const DOSE_UNIT_KAPSUL = 'kapsül';
export const DOSE_UNIT_DAMLA = 'damla';
export const DOSE_UNIT_PUF = 'puf';
export const DOSE_UNIT_DOZ = 'doz';
export const DOSE_UNIT_OLCEK = 'ölçek';
export const DOSE_UNIT_UYGULAMA = 'uygulama';
export const DOSE_UNIT_ADET = 'adet';

// Doz birimleri listesi
export const DOSE_UNITS = [
  DOSE_UNIT_TABLET,
  DOSE_UNIT_KAPSUL,
  DOSE_UNIT_DAMLA,
  DOSE_UNIT_PUF,
  DOSE_UNIT_DOZ,
  DOSE_UNIT_OLCEK,
  DOSE_UNIT_UYGULAMA,
  DOSE_UNIT_ADET
] as const;

// İlaç Türüne Göre Kullanılabilecek Doz Birimleri Eşleşmesi
export const MEDICATION_TYPE_UNITS: Record<string, readonly string[]> = {
  tablet: [DOSE_UNIT_TABLET, DOSE_UNIT_KAPSUL],
  injection: [DOSE_UNIT_DOZ],
  syrup: [DOSE_UNIT_OLCEK],
  cream: [DOSE_UNIT_UYGULAMA, DOSE_UNIT_DOZ],
  drop: [DOSE_UNIT_DAMLA],
  spray: [DOSE_UNIT_PUF],
  patch: [DOSE_UNIT_ADET],
  other: [DOSE_UNIT_DOZ, DOSE_UNIT_ADET],
} as const;

// Sıklık seçenekleri (Günde X Kez)
export const FREQUENCY_OPTIONS = [
  { label: 'Günde 1 kez', value: 1 },
  { label: 'Günde 2 kez', value: 2 },
  { label: 'Günde 3 kez', value: 3 },
  { label: 'Günde 4 kez', value: 4 },
] as const;

// Aralık seçenekleri (Kaç günde bir)
export const INTERVAL_OPTIONS = [
  { label: 'Her gün', value: 1 },
  { label: '2 günde bir', value: 2 },
  { label: '3 günde bir', value: 3 },
  { label: 'Haftada bir', value: 7 },
] as const;

// Gemini API
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

// AsyncStorage anahtarları
export const STORAGE_KEYS = {
  USER: 'med_tracker_user',
  PROFILES: 'med_tracker_profiles',
  ACTIVE_PROFILE: 'med_tracker_active_profile',
  THEME: 'med_tracker_theme',
} as const;

// Profil Avatar Seçenekleri
export const AVATAR_OPTIONS = [
  '👤', '👦', '👧', '👵', '👴', '👨‍⚕️', '👩‍⚕️', '👶', '🧔', '🧕',
  '💊', '❤️', '🛡️', '🧬', '🩺', '🌡️', '🩹', '🏃', '🥗', '🧘',
  '🐱', '🐶', '🐻', '🐼', '🦁', '🦄', '🍎', '🥦', '💧', '☀️',
  '🏠', '🚲', '🎮', '⭐️', '🍀', '🌈'
] as const;

// Yapay Zeka Özelliği Kontrolü
// false → butonlar pasif görünür, basılınca "limit doldu" mesajı gösterilir
// true  → butonlar aktif, API çağrısı yapılır
export const AI_FEATURES_ENABLED = true;

// Barkod ve Stok Kriterleri
export const MIN_BARCODE_LENGTH = 8;
export const MAX_BARCODE_LENGTH = 15;
export const STOCK_THRESHOLD_CRITICAL = 5;
export const STOCK_THRESHOLD_WARNING = 10;

// İlaç Alım Durum Sabitleri
export const STATUS_TAKEN = 'taken';
export const STATUS_POSTPONED = 'postponed';
export const STATUS_MISSED = 'missed';
export const STATUS_PENDING = 'pending';
export const STATUS_OVERDUE = 'overdue';
export const STATUS_UPCOMING = 'upcoming';
export const STATUS_FINISHED = 'finished';

// Cinsiyet Sabitleri
export const GENDER_MALE = 'male';
export const GENDER_FEMALE = 'female';
export const GENDER_OTHER = 'other';

// Uygulama Versiyonu Sabiti
export const APP_VERSION = '1.0.5';


