import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useStore } from '../store/useStore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';
import { t, LanguageCode } from '../constants/translations';
import { TURKEY_CITIES } from '../constants/turkeyCities';
import { fetchDutyPharmacies, fetchCommonPharmacies, Pharmacy } from '../services/pharmacy';

export default function PharmaciesScreen() {
  const { language, theme, showAlert } = useStore();
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);
  const lang = language as LanguageCode;

  const [city, setCity] = useState('İstanbul');
  const [district, setDistrict] = useState('Kadıköy');
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [searchMode, setSearchMode] = useState<'duty' | 'all'>('duty');
  const [searchInitiated, setSearchInitiated] = useState(false);
  
  // Dropdown Modalları ve Arama Kelimeleri
  const [showCityModal, setShowCityModal] = useState(false);
  const [showDistrictModal, setShowDistrictModal] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [districtSearch, setDistrictSearch] = useState('');

  // Sayfa açıldığında konumu sessizce alıp sadece il-ilçeyi ön tanımlı doldur, otomatik arama yapma
  useEffect(() => {
    const silentGeo = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const { latitude, longitude } = location.coords;
          setUserCoords({ latitude, longitude });
          const reverseGeocode = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (reverseGeocode.length > 0) {
            const addr = reverseGeocode[0];
            const rawCity = addr.region || addr.city || addr.subregion || '';
            const rawDistrict = addr.district || addr.subregion || addr.city || '';
            
            const cleanName = (str: string | null) => {
              if (!str) return '';
              return str
                .replace(/ilçesi/gi, '')
                .replace(/ilçe/gi, '')
                .replace(/ili/gi, '')
                .replace(/il/gi, '')
                .replace(/büyükşehir/gi, '')
                .replace(/belediyesi/gi, '')
                .trim();
            };

            const cleanedCity = cleanName(rawCity);
            const cleanedDistrict = cleanName(rawDistrict);

            const matchedCity = Object.keys(TURKEY_CITIES).find(
              (c) => c.toLowerCase() === cleanedCity.toLowerCase()
            );

            if (matchedCity) {
              setCity(matchedCity);
              const matchedDistrict = TURKEY_CITIES[matchedCity].find(
                (d) => d.toLowerCase() === cleanedDistrict.toLowerCase()
              );
              if (matchedDistrict) {
                setDistrict(matchedDistrict);
              } else {
                setDistrict(TURKEY_CITIES[matchedCity][0]);
              }
            }
          }
        }
      } catch (_err) {
        // silent fail
      }
    };
    silentGeo();
  }, []);

  // Arama modu (Tab) değiştiğinde, eğer daha önce arama yapılmışsa otomatik güncelle
  useEffect(() => {
    if (searchInitiated && city && district) {
      loadPharmacies();
    }
  }, [searchMode]);

  const loadPharmacies = async () => {
    setIsLoading(true);
    try {
      const result = searchMode === 'duty'
        ? await fetchDutyPharmacies(city, district)
        : await fetchCommonPharmacies(city, district, userCoords?.latitude, userCoords?.longitude);
      setPharmacies(result.pharmacies);
      setIsDemo(result.isDemo);
    } catch (err: any) {
      Alert.alert(
        lang === 'tr' ? 'Bağlantı Sorunu' : 'Connection Issue',
        err.message || (lang === 'tr' ? 'Eczane bilgileri yüklenemedi. Lütfen daha sonra tekrar deneyin.' : 'Could not load pharmacy details. Please try again later.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    setSearchInitiated(true);
    loadPharmacies();
  };

  const handleGetLocationAndFetch = async () => {
    setIsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          lang === 'tr' ? 'Konum İzni' : 'Location Permission',
          lang === 'tr' ? 'Konum izni verilmedi. Lütfen ili ve ilçeyi manuel seçerek arayın.' : 'Location permission not granted. Please select city and district manually.'
        );
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;
      setUserCoords({ latitude, longitude });

      const reverseGeocode = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (reverseGeocode.length > 0) {
        const addr = reverseGeocode[0];
        
        const cleanName = (str: string | null) => {
          if (!str) return '';
          return str
            .replace(/ilçesi/gi, '')
            .replace(/ilçe/gi, '')
            .replace(/ili/gi, '')
            .replace(/il/gi, '')
            .replace(/büyükşehir/gi, '')
            .replace(/belediyesi/gi, '')
            .trim();
        };

        const rawCity = addr.region || addr.city || addr.subregion || '';
        const rawDistrict = addr.district || addr.subregion || addr.city || '';

        const cleanedCity = cleanName(rawCity);
        const cleanedDistrict = cleanName(rawDistrict);

        const matchedCity = Object.keys(TURKEY_CITIES).find(
          (c) => c.toLowerCase() === cleanedCity.toLowerCase()
        );

        if (matchedCity) {
          const finalCity = matchedCity;
          const matchedDistrict = TURKEY_CITIES[matchedCity].find(
            (d) => d.toLowerCase() === cleanedDistrict.toLowerCase()
          );
          const finalDistrict = matchedDistrict || TURKEY_CITIES[matchedCity][0];

          setCity(finalCity);
          setDistrict(finalDistrict);
          setSearchInitiated(true);

          const result = searchMode === 'duty'
            ? await fetchDutyPharmacies(finalCity, finalDistrict)
            : await fetchCommonPharmacies(finalCity, finalDistrict, latitude, longitude);
          setPharmacies(result.pharmacies);
          setIsDemo(result.isDemo);
        }
      }
    } catch (err) {
      Alert.alert(
        lang === 'tr' ? 'Hata' : 'Error',
        lang === 'tr' ? 'Konum bilgisi alınamadı. Lütfen manuel seçin.' : 'Could not retrieve location. Please select manually.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Haversine Mesafe Hesaplama
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Dünya yarıçapı (km)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getDistanceText = (pharmacyLoc?: string): string | null => {
    if (!userCoords || !pharmacyLoc) return null;
    const coords = pharmacyLoc.split(',').map(Number);
    if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) return null;

    const dist = calculateDistance(userCoords.latitude, userCoords.longitude, coords[0], coords[1]);
    if (dist < 1) {
      return `${Math.round(dist * 1000)} m`;
    }
    return `${dist.toFixed(1)} km`;
  };

  // Eczaneleri mesafeye göre sıralama
  const getSortedPharmacies = (): Pharmacy[] => {
    let list = [...pharmacies];

    if (userCoords) {
      list.sort((a, b) => {
        if (!a.loc) return 1;
        if (!b.loc) return -1;
        
        const aCoords = a.loc.split(',').map(Number);
        const bCoords = b.loc.split(',').map(Number);

        const aDist = calculateDistance(userCoords.latitude, userCoords.longitude, aCoords[0], aCoords[1]);
        const bDist = calculateDistance(userCoords.latitude, userCoords.longitude, bCoords[0], bCoords[1]);

        return aDist - bDist;
      });
    }

    if (searchMode === 'all') {
      return list.slice(0, 10);
    }

    return list;
  };

  // Haritaya yönlendirme
  const handleGoToMap = (pharmacy: Pharmacy) => {
    const destination = pharmacy.loc || pharmacy.address;
    const cleanDest = encodeURIComponent(destination);

    const mapUrl = Platform.select({
      ios: `maps://app?daddr=${cleanDest}`,
      android: `google.navigation:q=${cleanDest}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${cleanDest}`
    });

    Linking.canOpenURL(mapUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(mapUrl);
        } else {
          const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${cleanDest}`;
          Linking.openURL(webUrl);
        }
      })
      .catch(() => {
        Alert.alert(
          lang === 'tr' ? 'Hata' : 'Error',
          lang === 'tr' ? 'Harita uygulaması açılamadı.' : 'Could not open map application.'
        );
      });
  };

  // Telefon arama
  const handleCall = (phone: string) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    Linking.openURL(`tel:${cleanPhone}`);
  };

  // İl listesini arama filtresine göre süzme
  const filteredCities = Object.keys(TURKEY_CITIES).filter((c) =>
    c.toLowerCase().includes(citySearch.toLowerCase())
  );

  // İlçe listesini arama filtresine göre süzme
  const filteredDistricts = (TURKEY_CITIES[city] || []).filter((d) =>
    d.toLowerCase().includes(districtSearch.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← {t(lang, 'addMedication.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{lang === 'tr' ? '🏥 Nöbetçi Eczaneler' : '🏥 Duty Pharmacies'}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Sekme Seçici */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, searchMode === 'duty' && styles.tabButtonActive]}
          onPress={() => setSearchMode('duty')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabButtonText, searchMode === 'duty' && styles.tabButtonTextActive]}>
            🔴 {lang === 'tr' ? 'Nöbetçiler' : 'On Duty'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, searchMode === 'all' && styles.tabButtonActive]}
          onPress={() => setSearchMode('all')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabButtonText, searchMode === 'all' && styles.tabButtonTextActive]}>
            🔍 {lang === 'tr' ? 'Tüm Eczaneler' : 'All Pharmacies'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Seçim ve Konum Alanı */}
      <View style={styles.selectorsCard}>
        {isDemo && (
          <View style={styles.demoBanner}>
            <Text style={styles.demoBannerText}>
              ⚠️ {lang === 'tr' ? 'Demo Modu: Örnek eczaneler listeleniyor.' : 'Demo Mode: Sample pharmacies listed.'}
            </Text>
          </View>
        )}

        <View style={styles.selectorsRow}>
          <TouchableOpacity
            style={styles.selectorBtn}
            onPress={() => {
              setCitySearch('');
              setShowCityModal(true);
            }}
          >
            <Text style={styles.selectorLabel}>{lang === 'tr' ? 'İL' : 'CITY'}</Text>
            <Text style={styles.selectorValue}>{city} ▾</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.selectorBtn}
            onPress={() => {
              setDistrictSearch('');
              setShowDistrictModal(true);
            }}
          >
            <Text style={styles.selectorLabel}>{lang === 'tr' ? 'İLÇE' : 'DISTRICT'}</Text>
            <Text style={styles.selectorValue}>{district} ▾</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} activeOpacity={0.8}>
          <Text style={styles.searchBtnText}>🔍 {lang === 'tr' ? 'Eczaneleri Ara' : 'Search Pharmacies'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.gpsBtn} onPress={handleGetLocationAndFetch} activeOpacity={0.8}>
          <Text style={styles.gpsBtnText}>📍 {lang === 'tr' ? 'Konumumu Kullan' : 'Use My Location'}</Text>
        </TouchableOpacity>
      </View>

      {/* Liste Alanı */}
      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>{lang === 'tr' ? 'Eczaneler aranıyor...' : 'Searching pharmacies...'}</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {!searchInitiated ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateEmoji}>🔍</Text>
              <Text style={styles.emptyStateText}>
                {lang === 'tr'
                  ? 'Arama yapmak için şehir ve ilçe seçip "Eczaneleri Ara" butonuna basın veya konumunuzu kullanın.'
                  : 'Select city and district and press "Search Pharmacies" or use your location to search.'}
              </Text>
            </View>
          ) : getSortedPharmacies().length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateEmoji}>🏥</Text>
              <Text style={styles.emptyStateText}>
                {searchMode === 'duty'
                  ? (lang === 'tr' ? 'Bu bölgede nöbetçi eczane bulunamadı.' : 'No duty pharmacies found in this region.')
                  : (lang === 'tr' ? 'Bu bölgede eczane bulunamadı.' : 'No pharmacies found in this region.')}
              </Text>
            </View>
          ) : (
            getSortedPharmacies().map((item, idx) => {
              const distance = getDistanceText(item.loc);
              return (
                <View key={idx} style={styles.pharmacyCard}>
                  <View style={styles.pharmacyHeader}>
                    <View style={styles.pharmacyTitleContainer}>
                      <View style={styles.pharmacyIconBadge}>
                        <Text style={{ fontSize: 14 }}>🏥</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pharmacyName}>{item.name}</Text>
                        {distance && (
                          <Text style={styles.pharmacyDistance}>📍 {distance} {lang === 'tr' ? 'yakınında' : 'away'}</Text>
                        )}
                      </View>
                    </View>
                  </View>

                  <Text style={styles.pharmacyAddress}>{item.address}</Text>

                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={styles.callBtn}
                      onPress={() => handleCall(item.phone)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.callBtnText}>📞 {lang === 'tr' ? 'Ara' : 'Call'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.routeBtn}
                      onPress={() => handleGoToMap(item)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.routeBtnText}>🚗 {lang === 'tr' ? 'Yol Tarifi' : 'Directions'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          {/* Uyarı Bandı */}
          {searchInitiated && (
            <Text style={styles.disclaimerText}>
              {lang === 'tr'
                ? '* Nöbetçi eczane listesi resmi odalardan alınmaktadır. Eczane nöbetleri değişiklik gösterebileceği için gitmeden önce arayıp teyit etmeniz önerilir.'
                : '* The duty pharmacy list is retrieved from official associations. Since duties can change, calling to confirm before going is recommended.'}
            </Text>
          )}
          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      )}

      {/* Şehir Seçim Modalı */}
      <Modal visible={showCityModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{lang === 'tr' ? 'İl Seçin' : 'Select City'}</Text>
              <TouchableOpacity onPress={() => setShowCityModal(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalSearch}
              placeholder={lang === 'tr' ? 'İl adı ara...' : 'Search city...'}
              placeholderTextColor={colors.textMuted}
              value={citySearch}
              onChangeText={setCitySearch}
            />

            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {filteredCities.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.modalItem, c === city && styles.modalItemActive]}
                  onPress={() => {
                    setCity(c);
                    setDistrict(TURKEY_CITIES[c][0]); // Şehir değiştiğinde ilk ilçeyi otomatik seç
                    setShowCityModal(false);
                  }}
                >
                  <Text style={[styles.modalItemText, c === city && styles.modalItemTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* İlçe Seçim Modalı */}
      <Modal visible={showDistrictModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{lang === 'tr' ? 'İlçe Seçin' : 'Select District'}</Text>
              <TouchableOpacity onPress={() => setShowDistrictModal(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalSearch}
              placeholder={lang === 'tr' ? 'İlçe adı ara...' : 'Search district...'}
              placeholderTextColor={colors.textMuted}
              value={districtSearch}
              onChangeText={setDistrictSearch}
            />

            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {filteredDistricts.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.modalItem, d === district && styles.modalItemActive]}
                  onPress={() => {
                    setDistrict(d);
                    setShowDistrictModal(false);
                  }}
                >
                  <Text style={[styles.modalItemText, d === district && styles.modalItemTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    tabContainer: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceElevated,
      borderRadius: RADIUS.lg,
      padding: 4,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginHorizontal: SPACING.xl,
      marginTop: SPACING.lg,
    },
    tabButton: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADIUS.md,
    },
    tabButtonActive: {
      backgroundColor: colors.primary,
    },
    tabButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    tabButtonTextActive: {
      color: '#fff',
      fontWeight: 'bold',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACING.xl,
      paddingTop: 60,
      paddingBottom: SPACING.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
      position: 'relative',
    },
    backBtn: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: RADIUS.full,
      paddingVertical: 6,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backBtnText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    headerTitle: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: SPACING.lg,
      textAlign: 'center',
      zIndex: -1,
      fontSize: TYPOGRAPHY.fontSizeLg,
      fontWeight: TYPOGRAPHY.fontWeightBold,
      color: colors.textPrimary,
      paddingHorizontal: 85,
    },
    selectorsCard: {
      margin: SPACING.xl,
      padding: SPACING.lg,
      backgroundColor: colors.surfaceElevated,
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: SPACING.md,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    },
    demoBanner: {
      backgroundColor: colors.warning + '20',
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.warning + '40',
      alignItems: 'center',
    },
    demoBannerText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.warningText || colors.warning,
      textAlign: 'center',
    },
    selectorsRow: {
      flexDirection: 'row',
      gap: SPACING.md,
    },
    selectorBtn: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
    },
    selectorLabel: {
      fontSize: 10,
      color: colors.textMuted,
      fontWeight: 'bold',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    selectorValue: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      fontWeight: TYPOGRAPHY.fontWeightSemiBold,
      color: colors.textPrimary,
    },
    gpsBtn: {
      backgroundColor: colors.primary + '15',
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: colors.primary + '30',
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gpsBtnText: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      color: colors.primary,
      fontWeight: 'bold',
    },
    searchBtn: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.lg,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 4,
    },
    searchBtnText: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      color: '#fff',
      fontWeight: 'bold',
    },
    loadingBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.md,
    },
    loadingText: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      color: colors.textSecondary,
    },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xxl },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 60,
      gap: SPACING.md,
    },
    emptyStateEmoji: {
      fontSize: 48,
    },
    emptyStateText: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    pharmacyCard: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 4,
    },
    pharmacyHeader: {
      marginBottom: SPACING.sm,
    },
    pharmacyTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
    },
    pharmacyIconBadge: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.danger + '15',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.danger + '33',
    },
    pharmacyName: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      fontWeight: TYPOGRAPHY.fontWeightBold,
      color: colors.textPrimary,
    },
    pharmacyDistance: {
      fontSize: TYPOGRAPHY.fontSizeXs,
      fontWeight: '600',
      color: colors.primary,
      marginTop: 2,
    },
    pharmacyAddress: {
      fontSize: TYPOGRAPHY.fontSizeSm,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: SPACING.md,
    },
    cardActions: {
      flexDirection: 'row',
      gap: SPACING.sm,
    },
    callBtn: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: RADIUS.md,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    callBtnText: {
      fontSize: TYPOGRAPHY.fontSizeSm,
      color: colors.textPrimary,
      fontWeight: 'bold',
    },
    routeBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: RADIUS.md,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 4,
    },
    routeBtnText: {
      fontSize: TYPOGRAPHY.fontSizeSm,
      color: '#fff',
      fontWeight: 'bold',
    },
    disclaimerText: {
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 16,
      textAlign: 'center',
      marginTop: SPACING.md,
      paddingHorizontal: SPACING.md,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: SPACING.xl,
      maxHeight: '80%',
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: SPACING.lg,
    },
    modalTitle: {
      fontSize: TYPOGRAPHY.fontSizeLg,
      fontWeight: TYPOGRAPHY.fontWeightBold,
      color: colors.textPrimary,
    },
    modalCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    modalCloseText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    modalSearch: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      fontSize: TYPOGRAPHY.fontSizeMd,
      marginBottom: SPACING.md,
    },
    modalList: {
      maxHeight: 400,
    },
    modalItem: {
      paddingVertical: SPACING.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    modalItemActive: {
      backgroundColor: colors.primary + '10',
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
    },
    modalItemText: {
      fontSize: TYPOGRAPHY.fontSizeMd,
      color: colors.textPrimary,
    },
    modalItemTextActive: {
      color: colors.primary,
      fontWeight: 'bold',
    },
  });
