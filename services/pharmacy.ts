import { db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { TURKEY_CITIES } from '../constants/turkeyCities';

export interface Pharmacy {
  name: string;
  dist?: string;
  address: string;
  phone: string;
  loc?: string; // "latitude,longitude" şeklinde koordinatlar
}

const DB_COLLECTIONS = {
  ACTIVE_DISTRICTS: 'active_districts',
  DUTY_PHARMACIES: 'duty_pharmacies',
  ALL_PHARMACIES: 'all_pharmacies',
} as const;

// Firebase Firestore veritabanı bağlantısı denetimi
const getDb = () => {
  if (db !== null && db !== undefined) return db;
  return null;
};

/** Türkçe karakterleri İngilizce karşılıklarıyla değiştirip URL uyumlu hale getirir */
const toSlug = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
};

/** Türkiye'de nöbetçi eczane önbelleğinin o güne ait geçerliliğini denetler (Nöbetler 09:00'da değişir) */
const isDutyCacheValid = (updatedAt: number): boolean => {
  const now = new Date();
  const todayNineAM = new Date();
  todayNineAM.setHours(9, 0, 0, 0);

  const cacheDate = new Date(updatedAt);

  if (now >= todayNineAM) {
    return cacheDate >= todayNineAM;
  } else {
    const yesterdayNineAM = new Date(todayNineAM.getTime() - 24 * 60 * 60 * 1000);
    return cacheDate >= yesterdayNineAM;
  }
};

/** Bir ilçeyi otomatik senkronizasyon kuyruğuna (active_districts) ekler */
const registerActiveDistrict = async (city: string, district: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;

  const citySlug = toSlug(city);
  const districtSlug = toSlug(district);
  const docId = `${citySlug}_${districtSlug}`;

  try {
    const docRef = doc(firestore, DB_COLLECTIONS.ACTIVE_DISTRICTS, docId);
    await setDoc(docRef, {
      city: city.trim(),
      district: district.trim(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    // Hata sessizce yutulur
  }
};

export const getMockPharmacies = (city: string, district: string): Pharmacy[] => {
  return [
    {
      name: `${district.toUpperCase()} MERKEZ NÖBETÇİ ECZANESİ`,
      address: `Cumhuriyet Mahallesi, Atatürk Caddesi No: 12, ${district}/${city}`,
      phone: "02161234567"
    },
    {
      name: "HAYAT ECZANESİ",
      address: `Yeni Mahalle, Sağlık Sokak No: 8/A, ${district}/${city}`,
      phone: "02129876543"
    },
    {
      name: "ŞİFA ECZANESİ",
      address: `Hürriyet Mahallesi, Deva Bulvarı No: 54, ${district}/${city}`,
      phone: "03125556677"
    }
  ];
};

export const getMockCommonPharmacies = (city: string, district: string): Pharmacy[] => {
  return [
    { name: "ATATÜRK ECZANESİ", address: `Cumhuriyet Mah. Atatürk Cad. No: 1, ${district}/${city}`, phone: "02161111111", loc: "40.9910,29.0220" },
    { name: "YENİ ECZANE", address: `Yeni Mah. Lise Cad. No: 15, ${district}/${city}`, phone: "02162222222", loc: "40.9930,29.0240" },
    { name: "PARK ECZANESİ", address: `Göztepe Parkı Karşısı No: 4, ${district}/${city}`, phone: "02163333333", loc: "40.9780,29.0560" },
    { name: "MERKEZ ECZANESİ", address: `Çarşı Sokak No: 10, ${district}/${city}`, phone: "02164444444", loc: "40.9900,29.0200" },
    { name: "DEVA ECZANESİ", address: `Şifa Sokak No: 3, ${district}/${city}`, phone: "02165555555", loc: "40.9850,29.0300" },
  ];
};

/**
 * Nöbetçi eczaneleri Firestore'dan çeker.
 * Firestore'da veri yoksa veya süresi geçmişse, arka planda ilçeyi active_districts'e ekler.
 * API çağrıları kaldırılmıştır. Firestore'da veri yoksa mock veri döner.
 */
export const fetchDutyPharmacies = async (city: string, district: string): Promise<{ pharmacies: Pharmacy[]; isDemo: boolean }> => {
  const firestore = getDb();
  const citySlug = toSlug(city);
  const districtSlug = toSlug(district);
  const docId = `${citySlug}_${districtSlug}`;

  // 1. Önce Firestore'daki küresel önbelleğe bak
  if (firestore) {
    try {
      const docRef = doc(firestore, DB_COLLECTIONS.DUTY_PHARMACIES, docId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.updatedAt && isDutyCacheValid(data.updatedAt) && Array.isArray(data.pharmacies) && data.pharmacies.length > 0) {
          return { pharmacies: data.pharmacies, isDemo: false };
        }
      }
    } catch (err) {
      // Sessizce yutulur
    }
  }

  // 2. Veritabanı boş veya güncel değilse bu ilçeyi aktif ilçeler kuyruğuna yaz
  await registerActiveDistrict(city, district);

  // API bağlantısı kaldırıldığı için mock veri döner
  const mockData = getMockPharmacies(city, district);
  return { pharmacies: mockData, isDemo: true };
};

/**
 * Tüm eczaneleri Firestore'dan çeker (Veritabanı zaten önceden OSM ile yüklenmiş olacaktır).
 * Bulunamazsa bu ilçeyi active_districts'e yazar.
 * API çağrıları kaldırılmıştır. Firestore'da veri yoksa mock veri döner.
 */
export const fetchCommonPharmacies = async (
  city: string,
  district: string,
  _userLat?: number,
  _userLon?: number,
): Promise<{ pharmacies: Pharmacy[]; isDemo: boolean }> => {
  const firestore = getDb();
  const citySlug = toSlug(city);
  const districtSlug = toSlug(district);
  const docId = `${citySlug}_${districtSlug}`;

  // 1. Önce Firestore'daki önceden yüklenmiş kayıtlara bak
  if (firestore) {
    try {
      const docRef = doc(firestore, DB_COLLECTIONS.ALL_PHARMACIES, docId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.pharmacies) && data.pharmacies.length > 0) {
          return { pharmacies: data.pharmacies, isDemo: false };
        }
      }
    } catch (err) {
      // Sessizce yutulur
    }
  }

  // 2. İlçe yoksa kuyruğa ekle
  await registerActiveDistrict(city, district);

  // API bağlantısı kaldırıldığı için mock veri döner
  const mockData = getMockCommonPharmacies(city, district);
  return { pharmacies: mockData, isDemo: true };
};

/** Bir şehirdeki tüm eczaneleri (tüm ilçelerden) Firestore'dan çeker */
export const fetchCommonPharmaciesForCity = async (city: string): Promise<Pharmacy[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  const citySlug = toSlug(city);
  const districts = TURKEY_CITIES[city] || [];

  try {
    const promises = districts.map(async (d: string) => {
      const districtSlug = toSlug(d);
      const docRef = doc(firestore, DB_COLLECTIONS.ALL_PHARMACIES, `${citySlug}_${districtSlug}`);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        return Array.isArray(data.pharmacies) ? data.pharmacies : [];
      }
      return [];
    });
    const results = await Promise.all(promises);
    return results.flat();
  } catch (err) {
    return [];
  }
};

/** Bir şehirdeki tüm nöbetçi eczaneleri (tüm ilçelerden) Firestore'dan çeker */
export const fetchDutyPharmaciesForCity = async (city: string): Promise<Pharmacy[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  const citySlug = toSlug(city);
  const districts = TURKEY_CITIES[city] || [];

  try {
    const promises = districts.map(async (d: string) => {
      const districtSlug = toSlug(d);
      const docRef = doc(firestore, DB_COLLECTIONS.DUTY_PHARMACIES, `${citySlug}_${districtSlug}`);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.pharmacies)) {
          return data.pharmacies;
        }
      }
      return [];
    });
    const results = await Promise.all(promises);
    return results.flat();
  } catch (err) {
    return [];
  }
};
