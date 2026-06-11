import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { listenToRemoteConfig, RemoteConfig } from '../services/remoteConfig';
import { useStore } from '../store/useStore';
import { getThemeColors } from '../constants/AppConstants';

// Get app version from Expo constants, fallback to package.json version
const CURRENT_VERSION = Constants.expoConfig?.version || '1.0.5';

interface RemoteConfigGuardProps {
  children: React.ReactNode;
}

// Compare semantic versions (e.g. "1.0.5" vs "1.1.0")
function isOutdated(current: string, min: string): boolean {
  if (!current || !min) return false;
  
  const currentParts = current.replace(/[^0-9.]/g, '').split('.').map(Number);
  const minParts = min.replace(/[^0-9.]/g, '').split('.').map(Number);
  
  const maxLength = Math.max(currentParts.length, minParts.length);
  for (let i = 0; i < maxLength; i++) {
    const currentVal = currentParts[i] || 0;
    const minVal = minParts[i] || 0;
    
    if (currentVal < minVal) return true;
    if (currentVal > minVal) return false;
  }
  return false;
}

export default function RemoteConfigGuard({ children }: RemoteConfigGuardProps) {
  const { language, theme } = useStore();
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lastBannerMsg, setLastBannerMsg] = useState<string | null>(null);

  const colors = getThemeColors(theme);
  const isTr = language === 'tr';

  useEffect(() => {
    const unsubscribe = listenToRemoteConfig((newConfig) => {
      setConfig(newConfig);
      setIsLoading(false);

      // If banner message changes, reset dismissed state
      const currentMsg = isTr ? newConfig.bannerMessageTr : newConfig.bannerMessageEn;
      if (currentMsg !== lastBannerMsg) {
        setBannerDismissed(false);
        setLastBannerMsg(currentMsg || null);
      }
    });

    return () => unsubscribe();
  }, [language]);

  const handleUpdatePress = () => {
    if (config?.downloadUrl) {
      Linking.openURL(config.downloadUrl).catch((err) => {
        console.error('Failed to open update link:', err);
      });
    }
  };

  // 1. Initial configuration loading spinner
  if (isLoading || !config) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // 2. MAINTENANCE MODE OVERLAY
  if (config.status === 'maintenance') {
    const maintenanceMsg = isTr
      ? config.maintenanceMessageTr || 'Sistem şu an bakımdadır. Daha iyi bir deneyim sunmak için çalışıyoruz, lütfen daha sonra tekrar deneyin.'
      : config.maintenanceMessageEn || 'The system is currently under maintenance. We are working to provide a better experience, please try again later.';

    return (
      <View style={[styles.overlayContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="construct-outline" size={80} color={colors.primary} style={styles.icon} />
        <Text style={[styles.title, { color: colors.text }]}>
          {isTr ? 'Bakım Çalışması' : 'System Maintenance'}
        </Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {maintenanceMsg}
        </Text>
        <View style={styles.badgeContainer}>
          <Text style={[styles.versionBadge, { backgroundColor: colors.card, color: colors.textSecondary }]}>
            {isTr ? `Uygulama Sürümü: v${CURRENT_VERSION}` : `App Version: v${CURRENT_VERSION}`}
          </Text>
        </View>
      </View>
    );
  }

  // 3. FORCE UPDATE REQUIRED OVERLAY
  const minVersion = config.minVersion || '1.0.0';
  const needsUpdate = config.status === 'force_update' && isOutdated(CURRENT_VERSION, minVersion);

  if (needsUpdate) {
    const updateMsg = isTr
      ? 'Uygulamanızın bu sürümü artık desteklenmiyor. Devam etmek için lütfen en son sürüme güncelleyin.'
      : 'This version of the app is no longer supported. Please update to the latest version to continue.';

    const isPlayStore = config.downloadUrl?.includes('play.google.com');

    return (
      <View style={[styles.overlayContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="cloud-download-outline" size={80} color={colors.primary} style={styles.icon} />
        <Text style={[styles.title, { color: colors.text }]}>
          {isTr ? 'Güncelleme Gerekli' : 'Update Required'}
        </Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {updateMsg}
        </Text>
        
        <View style={styles.versionRow}>
          <Text style={[styles.versionText, { color: colors.textSecondary }]}>
            {isTr ? `Mevcut Sürüm: ${CURRENT_VERSION}` : `Current Version: ${CURRENT_VERSION}`}
          </Text>
          <Text style={[styles.versionText, { color: colors.primary }]}>
            {isTr ? `Gerekli Sürüm: v${minVersion}+` : `Required Version: v${minVersion}+`}
          </Text>
        </View>

        {config.downloadUrl ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.primary }]}
            onPress={handleUpdatePress}
          >
            <Ionicons name={isPlayStore ? "logo-google-playstore" : "download-outline"} size={20} color="#000" />
            <Text style={styles.btnText}>
              {isTr 
                ? (isPlayStore ? "Google Play'den Güncelle" : "Güncellemeyi İndir")
                : (isPlayStore ? "Update from Google Play" : "Download Update")}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            {isTr ? 'Güncelleme linki henüz sağlanmadı.' : 'Update link has not been provided yet.'}
          </Text>
        )}
      </View>
    );
  }

  // 4. ACTIVE STATE (WITH ANNOUNCEMENT BANNER IF APPLICABLE)
  const bannerMsg = isTr ? config.bannerMessageTr : config.bannerMessageEn;
  const showBanner = config.bannerActive && bannerMsg && !bannerDismissed;

  // Map banner styles based on type
  let bannerBg = colors.card;
  let bannerText = colors.text;
  let bannerIcon = 'information-circle-outline';

  if (config.bannerType === 'success') {
    bannerBg = '#00ff8822';
    bannerText = '#00ff88';
    bannerIcon = 'checkmark-circle-outline';
  } else if (config.bannerType === 'warning') {
    bannerBg = '#ffa50022';
    bannerText = '#ffa500';
    bannerIcon = 'warning-outline';
  } else if (config.bannerType === 'danger') {
    bannerBg = '#ff4d4d22';
    bannerText = '#ff4d4d';
    bannerIcon = 'alert-circle-outline';
  } else if (config.bannerType === 'info') {
    bannerBg = '#00bfff22';
    bannerText = '#00bfff';
    bannerIcon = 'information-circle-outline';
  }

  return (
    <View style={styles.root}>
      {showBanner && (
        <SafeAreaView style={{ backgroundColor: bannerBg }}>
          <View style={styles.banner}>
            <Ionicons name={bannerIcon as any} size={20} color={bannerText} style={styles.bannerIcon} />
            <Text style={[styles.bannerText, { color: bannerText }]}>{bannerMsg}</Text>
            <TouchableOpacity onPress={() => setBannerDismissed(true)} style={styles.bannerCloseBtn}>
              <Ionicons name="close" size={20} color={bannerText} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
      <View style={styles.container}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  icon: {
    marginBottom: 30,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Jost' : 'sans-serif-condensed',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 25,
    opacity: 0.9,
  },
  badgeContainer: {
    marginTop: 10,
  },
  versionBadge: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    fontSize: 13,
    fontWeight: '500',
    overflow: 'hidden',
  },
  versionRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 35,
  },
  versionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 15,
    paddingHorizontal: 25,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  btnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  infoText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  bannerIcon: {
    marginRight: 10,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  bannerCloseBtn: {
    padding: 4,
    marginLeft: 10,
  },
});
