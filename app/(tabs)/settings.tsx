import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Modal, Linking } from 'react-native';
import { router } from 'expo-router';
import { auth } from '../../services/firebase';
import { useStore } from '../../store/useStore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../../constants/AppConstants';
import { t, LanguageCode } from '../../constants/translations';

export default function SettingsScreen() {
  const { logout, language, setLanguage, theme, setTheme, showAlert } = useStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState(23);
  const [quietHoursEnd, setQuietHoursEnd] = useState(7);
  const [showQuietPicker, setShowQuietPicker] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [editingWhich, setEditingWhich] = useState<'start' | 'end'>('start');

  const colors = getThemeColors(theme);
  const lang = language as LanguageCode;
  const styles = getStyles(colors);

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const padH = (h: number) => h.toString().padStart(2, '0');

  const openQuietPicker = (which: 'start' | 'end') => {
    setEditingWhich(which);
    setShowQuietPicker(true);
  };

  const handleLogout = () => {
    showAlert({
      message: t(lang, 'settings.logoutAlertMsg'),
      type: 'warning',
      buttons: [
        { text: t(lang, 'settings.cancel'), style: 'cancel' },
        { 
          text: t(lang, 'settings.logout'), 
          style: 'destructive',
          onPress: async () => {
            try {
              if (auth) await auth.signOut();
              logout(); 
              router.replace('/login');
            } catch (err) {
              showAlert({ message: lang === 'tr' ? 'Çıkış yapılırken bir sorun oluştu.' : 'There was a problem logging out.', type: 'danger' });
            }
          }
        }
      ]
    });
  };

  const toggleLanguage = () => {
    setLanguage(language === 'tr' ? 'en' : 'tr');
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleOpenVersion = () => {
    Linking.openURL('https://app.salihaltuntas.com.tr');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>⚙️ {t(lang, 'settings.title')}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Görünüm Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{lang === 'tr' ? 'Görünüm' : 'Appearance'}</Text>
          <View style={styles.card}>
            <SettingRow
              colors={colors}
              icon={theme === 'dark' ? '🌙' : '☀️'}
              label={lang === 'tr' ? 'Koyu Tema' : 'Dark Mode'}
              hasSwitch
              switchValue={theme === 'dark'}
              onSwitchChange={toggleTheme}
            />
            <Divider colors={colors} />
            <SettingRow 
              colors={colors}
              icon="🌍" 
              label={t(lang, 'settings.aiLang')} 
              value={language === 'tr' ? 'Türkçe' : 'English'} 
              isLink 
              onPress={toggleLanguage} 
            />
          </View>
        </View>

        {/* Bildirimler */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(lang, 'settings.notifSection')}</Text>
          <View style={styles.card}>
            <SettingRow
              colors={colors}
              icon="🔔"
              label={t(lang, 'settings.notifReminders')}
              hasSwitch
              switchValue={notificationsEnabled}
              onSwitchChange={setNotificationsEnabled}
            />
            <Divider colors={colors} />
            <TouchableOpacity style={styles.settingRow} onPress={() => openQuietPicker('start')} activeOpacity={0.7}>
              <Text style={styles.settingIcon}>🌙</Text>
              <Text style={styles.settingLabel}>{t(lang, 'settings.quietStart')}</Text>
              <View style={styles.timeTag}>
                <Text style={styles.timeTagText}>{padH(quietHoursStart)}:00</Text>
              </View>
            </TouchableOpacity>
            <Divider colors={colors} />
            <TouchableOpacity style={styles.settingRow} onPress={() => openQuietPicker('end')} activeOpacity={0.7}>
              <Text style={styles.settingIcon}>☀️</Text>
              <Text style={styles.settingLabel}>{t(lang, 'settings.quietEnd')}</Text>
              <View style={styles.timeTag}>
                <Text style={styles.timeTagText}>{padH(quietHoursEnd)}:00</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Yapay Zeka */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(lang, 'settings.aiSection')}</Text>
          <View style={styles.card}>
            <SettingRow 
              colors={colors}
              icon="🤖" 
              label={t(lang, 'settings.aiGemini')} 
              value={t(lang, 'settings.aiConnected')} 
              valueColor={colors.success} 
            />
          </View>
        </View>

        {/* Uygulama Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(lang, 'settings.appSection')}</Text>
          <View style={styles.card}>
            <SettingRow colors={colors} icon="ℹ️" label={t(lang, 'settings.appVersion')} value="1.0.2" />
            <Divider colors={colors} />
            <SettingRow 
              colors={colors} 
              icon="🚀" 
              label={lang === 'tr' ? 'Güncel Versiyonu Kontrol Et' : 'Check for Updates'} 
              isLink 
              onPress={handleOpenVersion} 
            />
            <Divider colors={colors} />
            <SettingRow colors={colors} icon="🔒" label={t(lang, 'settings.privacy')} isLink onPress={() => setShowPrivacyModal(true)} />
          </View>
        </View>

        {/* Hesap İşlemleri */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(lang, 'settings.accountSection')}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.7}>
              <Text style={styles.logoutIcon}>🚪</Text>
              <Text style={styles.logoutLabel}>{t(lang, 'settings.logout')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.versionBox}>
          <Text style={styles.versionText}>MedTracker v1.0.2</Text>
          <Text style={styles.versionSub}>{t(lang, 'settings.wish')}</Text>
        </View>

        <Modal transparent animationType="fade" visible={showQuietPicker} onRequestClose={() => setShowQuietPicker(false)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
              <View style={styles.pickerHeader}>
                <View style={[styles.pickerIconContainer, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={styles.pickerIcon}>{editingWhich === 'start' ? '🌙' : '☀️'}</Text>
                </View>
                <Text style={[styles.pickerTitle, { color: colors.textPrimary }]}>
                  {editingWhich === 'start' 
                    ? t(lang, 'settings.selectStart') 
                    : t(lang, 'settings.selectEnd')}
                </Text>
              </View>
              <ScrollView style={styles.pickerBodyScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.hourGrid}>
                  {HOURS.map((h) => {
                    const isSelected = editingWhich === 'start' ? quietHoursStart === h : quietHoursEnd === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        style={[styles.hourChip, isSelected && styles.hourChipActive, { backgroundColor: isSelected ? colors.primary : colors.surfaceElevated, borderColor: isSelected ? colors.primary : colors.surfaceBorder }]}
                        onPress={() => {
                          if (editingWhich === 'start') setQuietHoursStart(h);
                          else setQuietHoursEnd(h);
                          setShowQuietPicker(false);
                        }}
                      >
                        <Text style={[styles.hourChipText, isSelected && styles.hourChipTextActive]}>
                          {padH(h)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <TouchableOpacity style={styles.pickerCloseBtn} onPress={() => setShowQuietPicker(false)}>
                <Text style={styles.pickerCloseBtnText}>{t(lang, 'addMedication.confirmBtn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Gizlilik Politikası Modalı */}
        <Modal transparent animationType="slide" visible={showPrivacyModal} onRequestClose={() => setShowPrivacyModal(false)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
              <View style={styles.pickerHeader}>
                <View style={[styles.pickerIconContainer, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={styles.pickerIcon}>🔒</Text>
                </View>
                <Text style={[styles.pickerTitle, { color: colors.textPrimary }]}>{t(lang, 'settings.privacy')}</Text>
              </View>
              <ScrollView style={styles.pickerBodyScroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
                  {lang === 'tr' ? (
                    "Med-Tracker gizliliğinize önem verir. Verileriniz (ilaçlar, profiller, hatırlatıcılar) yerel cihazınızda ve güvenli Firebase altyapısında saklanır.\n\n" +
                    "• Verileriniz üçüncü taraflarla reklam amaçlı paylaşılmaz.\n" +
                    "• Yapay zeka analizleri için sadece ilaç isimleri anonim olarak Gemini AI servisine gönderilir.\n" +
                    "• Hatırlatıcı bildirimleri cihazınızın yerel bildirim sistemini kullanır.\n\n" +
                    "Geliştirici: Salih Altuntaş"
                  ) : (
                    "Med-Tracker values your privacy. Your data (medications, profiles, reminders) is stored on your local device and secure Firebase infrastructure.\n\n" +
                    "• Your data is not shared with third parties for advertising purposes.\n" +
                    "• For AI analysis, only medication names are sent anonymously to the Gemini AI service.\n" +
                    "• Reminder notifications use your device's local notification system.\n\n" +
                    "Developer: Salih Altuntaş"
                  )}
                </Text>
              </ScrollView>
              <TouchableOpacity style={styles.pickerCloseBtn} onPress={() => setShowPrivacyModal(false)}>
                <Text style={styles.pickerCloseBtnText}>{t(lang, 'addMedication.confirmBtn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

function Divider({ colors }: { colors: any }) {
  return <View style={{ height: 1, backgroundColor: colors.surfaceBorder, marginLeft: 60 }} />;
}

interface SettingRowProps {
  colors: any;
  icon: string;
  label: string;
  value?: string;
  valueColor?: string;
  isLink?: boolean;
  hasSwitch?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  onPress?: () => void;
}

function SettingRow({ colors, icon, label, value, valueColor, isLink, hasSwitch, switchValue, onSwitchChange, onPress }: SettingRowProps) {
  const rowStyles = StyleSheet.create({
    settingRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md },
    settingIcon: { fontSize: 20, width: 28 },
    settingLabel: { flex: 1, fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textPrimary },
    settingValue: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textSecondary },
  });

  return (
    <TouchableOpacity style={rowStyles.settingRow} onPress={onPress} disabled={!isLink && !hasSwitch} activeOpacity={0.7}>
      <Text style={rowStyles.settingIcon}>{icon}</Text>
      <Text style={rowStyles.settingLabel}>{label}</Text>
      {hasSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
          thumbColor="#fff"
        />
      ) : (
        <Text style={[rowStyles.settingValue, valueColor ? { color: valueColor } : {}]}>
          {value ?? ''}{isLink ? ' →' : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: SPACING.xl, paddingTop: 60, paddingBottom: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
  },
  headerTitle: { fontSize: TYPOGRAPHY.fontSize2xl, fontWeight: TYPOGRAPHY.fontWeightBold, color: colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.xl },
  section: { marginBottom: SPACING.xxl },
  sectionTitle: { fontSize: TYPOGRAPHY.fontSizeSm, fontWeight: TYPOGRAPHY.fontWeightSemiBold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: SPACING.sm },
  card: {
    backgroundColor: colors.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: colors.surfaceBorder,
    overflow: 'hidden',
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md },
  settingIcon: { fontSize: 20, width: 28 },
  settingLabel: { flex: 1, fontSize: TYPOGRAPHY.fontSizeMd, color: colors.textPrimary },
  timeTag: {
    backgroundColor: colors.primary + '22', borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.primary + '55',
  },
  timeTagText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.primary, fontWeight: TYPOGRAPHY.fontWeightBold },
  logoutRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md },
  logoutIcon: { fontSize: 20, width: 28 },
  logoutLabel: { flex: 1, fontSize: TYPOGRAPHY.fontSizeMd, color: colors.danger, fontWeight: TYPOGRAPHY.fontWeightMedium },
  versionBox: { alignItems: 'center', paddingVertical: SPACING.xxl },
  versionText: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textMuted, fontWeight: TYPOGRAPHY.fontWeightMedium },
  versionSub: { fontSize: TYPOGRAPHY.fontSizeSm, color: colors.textMuted, marginTop: 4 },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  pickerSheet: {
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
  pickerTitle: { fontSize: TYPOGRAPHY.fontSizeXl, fontWeight: TYPOGRAPHY.fontWeightBold, textAlign: 'center' },
  pickerBodyScroll: { maxHeight: 300, marginBottom: SPACING.xl },
  pickerCloseBtn: { backgroundColor: colors.primary, borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center' },
  pickerCloseBtnText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightBold, color: '#fff' },
  hourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center' },
  hourChip: {
    width: 60, height: 44, borderRadius: RADIUS.md,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  hourChipActive: { shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  hourChipText: { fontSize: TYPOGRAPHY.fontSizeMd, fontWeight: TYPOGRAPHY.fontWeightMedium, color: colors.textSecondary },
  hourChipTextActive: { color: '#fff', fontWeight: TYPOGRAPHY.fontWeightBold },
  privacyText: { fontSize: TYPOGRAPHY.fontSizeMd, lineHeight: 24, textAlign: 'left' },
});
