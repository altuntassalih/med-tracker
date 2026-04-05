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

// Doz birimleri
export const DOSE_UNITS = ['tablet', 'kapsül', 'mg', 'ml', 'mcg', 'g', 'IU', 'damla'] as const;

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
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

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
