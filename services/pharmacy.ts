import { db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export interface Pharmacy {
  name: string;
  dist?: string;
  address: string;
  phone: string;
  loc?: string; // "latitude,longitude" şeklinde koordinatlar
}

const API_KEY = process.env.EXPO_PUBLIC_COLLECTAPI_KEY || '';
const NOSYAPI_KEY = process.env.EXPO_PUBLIC_NOSYAPI_KEY || '';
const NOSYAPI_BASE_URL = 'https://www.nosyapi.com/apiv2/service';

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
      phone: "02161234567",
      loc: "40.9924,29.0232"
    },
    {
      name: "HAYAT ECZANESİ",
      address: `Yeni Mahalle, Sağlık Sokak No: 8/A, ${district}/${city}`,
      phone: "02129876543",
      loc: "41.0082,28.9784"
    },
    {
      name: "ŞİFA ECZANESİ",
      address: `Hürriyet Mahallesi, Deva Bulvarı No: 54, ${district}/${city}`,
      phone: "03125556677",
      loc: "39.9334,32.8597"
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

/** NosyAPI yanıt elemanı tipi */
interface NosyAPIPharmacyItem {
  pharmacyID: number;
  pharmacyName: string;
  address: string;
  city: string;
  district: string;
  town: string | null;
  directions: string | null;
  phone: string;
  phone2: string | null;
  latitude: number;
  longitude: number;
}

/** NosyAPI üzerinden tüm eczaneleri çeken doğrudan fallback metodu */
const fetchFromNosyAPI = async (city: string, district: string): Promise<Pharmacy[]> => {
  const citySlug = toSlug(city);
  const districtSlug = toSlug(district);
  const url = `${NOSYAPI_BASE_URL}/pharmaciesv2?city=${encodeURIComponent(citySlug)}&district=${encodeURIComponent(districtSlug)}&limit=50&apiKey=${NOSYAPI_KEY}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error();
  }

  const json = await response.json();
  if (json.status !== 'success' || !json.data) {
    throw new Error();
  }

  const pharmacies: Pharmacy[] = json.data.map((item: NosyAPIPharmacyItem) => ({
    name: item.pharmacyName,
    dist: item.district,
    address: item.address,
    phone: item.phone || '',
    loc: `${item.latitude},${item.longitude}`,
  }));

  return pharmacies;
};

/**
 * Nöbetçi eczaneleri Firestore'dan çeker.
 * Firestore'da veri yoksa veya süresi geçmişse, arka planda ilçeyi active_districts'e ekler.
 * Acil durumda doğrudan API'yi sorgular, aksi halde kullanıcıya dostça hata verir.
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

  // 3. Fallback: İstemci doğrudan API'ye gitmeyi dener (API anahtarı varsa)
  if (!API_KEY || API_KEY.trim() === '' || API_KEY.includes('YOUR_')) {
    const mockData = getMockPharmacies(city, district);
    return { pharmacies: mockData, isDemo: true };
  }

  try {
    const formattedCity = city.toLowerCase();
    const formattedDistrict = district.toLowerCase();
    const url = `https://api.collectapi.com/health/dutyPharmacy?ilce=${encodeURIComponent(formattedDistrict)}&il=${encodeURIComponent(formattedCity)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'authorization': `apikey ${API_KEY}`
      }
    });

    if (!response.ok) throw new Error();

    const json = await response.json();
    if (!json.success || !json.result || json.result.length === 0) throw new Error();

    const pharmacies: Pharmacy[] = json.result.map((item: any) => ({
      name: item.name,
      dist: item.dist,
      address: item.address,
      phone: item.phone,
      loc: item.loc,
    }));

    // Firestore veritabanını güncelle
    if (firestore && pharmacies.length > 0) {
      try {
        const docRef = doc(firestore, DB_COLLECTIONS.DUTY_PHARMACIES, docId);
        await setDoc(docRef, {
          city: city.trim(),
          district: district.trim(),
          pharmacies,
          updatedAt: Date.now()
        }, { merge: true });
      } catch (err) {
        // Sessizce yutulur
      }
    }

    return { pharmacies, isDemo: false };
  } catch (error) {
    // API kotası veya bağlantı hatası durumunda kullanıcıya hata fırlat
    throw new Error('Geçici bir bağlantı veya kota sorunu yaşanıyor. Lütfen daha sonra tekrar deneyiniz.');
  }
};

/**
 * Tüm eczaneleri Firestore'dan çeker (Veritabanı zaten önceden OSM ile yüklenmiş olacaktır).
 * Bulunamazsa bu ilçeyi active_districts'e yazar ve doğrudan API fallback sorgusu dener.
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

  // 3. Fallback: İstemci doğrudan API'ye gitmeyi dener (API anahtarı varsa)
  if (!NOSYAPI_KEY || NOSYAPI_KEY.trim() === '' || NOSYAPI_KEY.includes('YOUR_')) {
    const mockData = getMockCommonPharmacies(city, district);
    return { pharmacies: mockData, isDemo: true };
  }

  try {
    const pharmacies = await fetchFromNosyAPI(city, district);

    // Firestore veritabanını güncelle
    if (firestore && pharmacies.length > 0) {
      try {
        const docRef = doc(firestore, DB_COLLECTIONS.ALL_PHARMACIES, docId);
        await setDoc(docRef, {
          city: city.trim(),
          district: district.trim(),
          pharmacies,
          updatedAt: Date.now()
        }, { merge: true });
      } catch (err) {
        // Sessizce yutulur
      }
    }

    return { pharmacies, isDemo: false };
  } catch (error) {
    throw new Error('Geçici bir bağlantı veya kota sorunu yaşanıyor. Lütfen daha sonra tekrar deneyiniz.');
  }
};
