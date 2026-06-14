const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const cheerio = require('cheerio');

// Load environment variables from .env file if it exists
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const firstEquals = trimmed.indexOf('=');
    if (firstEquals === -1) return;
    const key = trimmed.substring(0, firstEquals).trim();
    let val = trimmed.substring(firstEquals + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    process.env[key] = val;
  });
}

// 1. Firebase Admin SDK Başlatma
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    const localKeyPath = path.join(__dirname, '../service-account.json');
    if (fs.existsSync(localKeyPath)) {
      serviceAccount = require(localKeyPath);
    }
  }
} catch (err) {
  console.error('Firebase Service Account Key loading failed:', err.message);
}

if (!serviceAccount) {
  console.error('Hata: FIREBASE_SERVICE_ACCOUNT_JSON bulunamadı. Lütfen root dizinine service-account.json dosyasını ekleyin.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const DB_COLLECTIONS = {
  ACTIVE_DISTRICTS: 'active_districts',
  DUTY_PHARMACIES: 'duty_pharmacies',
  ALL_PHARMACIES: 'all_pharmacies',
  PHARMACY_META: 'pharmacy_meta',
};

// turkeyCities.ts dosyasından verileri oku
let TURKEY_CITIES = {};
try {
  const filePath = path.join(__dirname, '../constants/turkeyCities.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  
  const jsCode = content
    .replace(/export const/g, 'const')
    .replace(/: Record<.*>/g, '');

  const context = {};
  new Function('exports', jsCode + '\nexports.TURKEY_CITIES = TURKEY_CITIES;')(context);
  TURKEY_CITIES = context.TURKEY_CITIES || {};
} catch (err) {
  // Hata durumunda sessiz kal
}

const COLLECTAPI_KEY = process.env.EXPO_PUBLIC_COLLECTAPI_KEY || '';
const NOSYAPI_KEY = process.env.EXPO_PUBLIC_NOSYAPI_KEY || '';
const NOSYAPI_BASE_URL = 'https://www.nosyapi.com/apiv2/service';
const CLOUDFLARE_PROXY_URL = process.env.CLOUDFLARE_PROXY_URL || '';
const SCRAPER_BASE_URL = 'https://www.milliyet.com.tr/nobetci-eczaneler';
const SCRAPER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Türkçe karakterleri İngilizce karşılıklarıyla değiştirip URL uyumlu hale getirir */
const toSlug = (text) => {
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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** HTML Scraper: milliyet.com.tr sitesinden ildeki nöbetçi eczaneleri çeker */
async function scrapeDutyPharmaciesFromWeb(city) {
  const citySlug = toSlug(city);
  const targetUrl = `${SCRAPER_BASE_URL}/${citySlug}/`;
  
  let response;
  let usedProxy = false;
  
  try {
    response = await fetch(targetUrl, {
      headers: {
        'User-Agent': SCRAPER_USER_AGENT
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (directErr) {
    if (CLOUDFLARE_PROXY_URL) {
      const url = `${CLOUDFLARE_PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
      response = await fetch(url, {
        headers: {
          'User-Agent': SCRAPER_USER_AGENT
        }
      });
      usedProxy = true;
    } else {
      throw directErr;
    }
  }

  if (!response.ok) {
    throw new Error(`Scraper HTTP hatası (Proxy: ${usedProxy}): ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const pharmacies = [];
  const dutyDateRangeText = $('.ecz-module-info-text').text().trim();

  $('.ecz-module-pharmacy-info').each((i, el) => {
    const name = $(el).find('.ecz-module-pharmacy-name').text().trim().toUpperCase().replace(/İ/g, 'İ').replace(/I/g, 'I');
    if (!name) return;

    const subtitle = $(el).find('.ecz-module-pharmacy-subtitle').text().trim();
    let district = '';
    if (subtitle.includes('/')) {
      district = subtitle.split('/').pop().trim();
    }

    let address = $(el).find('.ecz-module-pharmacy-location').text().trim();
    if (address.startsWith('Adres:')) {
      address = address.substring(6).trim();
    }

    let phone = $(el).find('.ecz-module-pharmacy-contact').text().trim();
    if (phone.startsWith('Telefon:')) {
      phone = phone.substring(8).trim().replace(/\s+/g, '');
    }

    // Harita butonundan koordinatları parse et
    let loc = '';
    const mapBtn = $(el).find('a[href*="maps/search"]');
    if (mapBtn.length > 0) {
      const href = mapBtn.attr('href');
      const match = href.match(/query=([0-9.-]+),([0-9.-]+)/);
      if (match) {
        loc = `${match[1]},${match[2]}`;
      }
    }

    pharmacies.push({
      name,
      dist: district,
      address,
      phone,
      loc
    });
  });

  return { pharmacies, dutyDateRangeText };
}

/** CollectAPI Fallback: Nöbetçileri resmi API'den çeker (Scraper hata verdiğinde) */
async function fetchDutyFromCollectAPI(city, district) {
  if (!COLLECTAPI_KEY || COLLECTAPI_KEY.includes('YOUR_')) {
    throw new Error('Yedek CollectAPI anahtarı yapılandırılmamış.');
  }

  const formattedCity = city.toLowerCase();
  const formattedDistrict = district.toLowerCase();
  const url = `https://api.collectapi.com/health/dutyPharmacy?ilce=${encodeURIComponent(formattedDistrict)}&il=${encodeURIComponent(formattedCity)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'authorization': `apikey ${COLLECTAPI_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error(`CollectAPI HTTP hatası: ${response.status}`);
  }

  const json = await response.json();
  if (!json.success || !json.result) {
    throw new Error(json.msg || 'CollectAPI başarısız döndü.');
  }

  return json.result.map(item => ({
    name: item.name.toUpperCase().replace(/İ/g, 'İ').replace(/I/g, 'I'),
    dist: item.dist,
    address: item.address,
    phone: item.phone,
    loc: item.loc || ''
  }));
}

const normalizeText = (text) => {
  if (!text) return '';
  return text
    .toString()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .trim();
};

const cleanNameForMatching = (name) => {
  let cleaned = normalizeText(name);
  cleaned = cleaned.replace(/[^a-z0-9]/g, '');
  cleaned = cleaned
    .replace(/eczanesi$/, '')
    .replace(/eczane$/, '')
    .replace(/ecz$/, '')
    .replace(/^eczanesi/, '')
    .replace(/^eczane/, '')
    .replace(/^ecz/, '');
  return cleaned;
};

/**
 * Nöbetçi eczanelerin koordinatlarını (loc) ortak eczaneler listesinden bularak doldurur
 */
async function enrichDutyPharmaciesWithCoords(city, district, dutyPharmaciesList) {
  const citySlug = toSlug(city);
  const districtSlug = toSlug(district);
  
  try {
    const docRef = db.collection(DB_COLLECTIONS.ALL_PHARMACIES).doc(`${citySlug}_${districtSlug}`);
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      const data = docSnap.data();
      const commonList = Array.isArray(data.pharmacies) ? data.pharmacies : [];
      
      const commonMap = new Map();
      commonList.forEach(cp => {
        if (cp.loc) {
          commonMap.set(cleanNameForMatching(cp.name), cp.loc);
        }
      });
      
      return dutyPharmaciesList.map(dp => {
        if (dp.loc) return dp; // Zaten koordinatı varsa ellemeyelim
        
        const cleanedName = cleanNameForMatching(dp.name);
        let matchedLoc = commonMap.get(cleanedName);
        
        if (!matchedLoc) {
          for (const [key, value] of commonMap.entries()) {
            if (cleanedName.includes(key) || key.includes(cleanedName)) {
              matchedLoc = value;
              break;
            }
          }
        }
        
        if (matchedLoc) {
          return { ...dp, loc: matchedLoc };
        }
        
        return dp;
      });
    }
  } catch (err) {
    console.error(`Eczane koordinatları eşleştirilirken hata oluştu (${city}/${district}):`, err.message);
  }
  
  return dutyPharmaciesList;
}

const TURKEY_TIMEZONE_OFFSET_MS = 3 * 60 * 60 * 1000;
const SHIFT_CHANGE_HOUR = 8;
const SHIFT_CHANGE_MINUTE = 30;
const SHIFT_CHANGE_TOTAL_MINUTES = SHIFT_CHANGE_HOUR * 60 + SHIFT_CHANGE_MINUTE;
const DUTY_DATE_DELIMITER = 'akşamından';

const TURKISH_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

/**
 * Scraped dutyDateRangeText'in bugün/güncel olup olmadığını denetler
 */
function isDutyDateToday(dutyDateRangeText) {
  if (!dutyDateRangeText) return false;
  
  const now = new Date();
  const trTime = new Date(now.getTime() + TURKEY_TIMEZONE_OFFSET_MS);
  const trHour = trTime.getUTCHours();
  const trMinute = trTime.getUTCMinutes();
  const trTotalMinutes = trHour * 60 + trMinute;
  
  let expectedStartDate = new Date(now.getTime() + TURKEY_TIMEZONE_OFFSET_MS);
  if (trTotalMinutes < SHIFT_CHANGE_TOTAL_MINUTES) {
    expectedStartDate.setUTCDate(expectedStartDate.getUTCDate() - 1);
  }
  
  const expectedDay = expectedStartDate.getUTCDate().toString();
  const expectedMonthName = TURKISH_MONTHS[expectedStartDate.getUTCMonth()];
  
  const parts = dutyDateRangeText.split(DUTY_DATE_DELIMITER);
  if (parts.length > 0) {
    const startPart = parts[0];
    const hasDay = startPart.includes(expectedDay);
    const hasMonth = startPart.toLowerCase().includes(expectedMonthName.toLowerCase());
    return hasDay && hasMonth;
  }
  
  return false;
}

/** NÖBETÇİ ECZANE GÜNCELLEME İŞİ */
async function syncDutyPharmacies() {
  console.log('--- Nöbetçi Eczaneler Senkronizasyonu Başlatıldı ---');
  
  // 1. Firestore 'active_districts' koleksiyonundan aktif ilçeleri oku (Yedek hat için)
  const activeSnapshot = await db.collection(DB_COLLECTIONS.ACTIVE_DISTRICTS).get();
  const activeDistrictsMap = {};
  activeSnapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (data.city && data.district) {
      if (!activeDistrictsMap[data.city]) {
        activeDistrictsMap[data.city] = [];
      }
      activeDistrictsMap[data.city].push(data.district);
    }
  });

  // 2. Tüm 81 ili tara
  const cities = Object.keys(TURKEY_CITIES);
  console.log(`Toplam şehir sayısı: ${cities.length}. Tüm Türkiye taranıyor...`);

  for (const city of cities) {
    console.log(`\n[${city}] nöbetçi eczaneleri taranıyor...`);
    let pharmacies = [];
    let dutyDateRangeText = '';
    let scraperFailed = false;

    // A. Web Scraper'ı dene
    try {
      const result = await scrapeDutyPharmaciesFromWeb(city);
      pharmacies = result.pharmacies;
      dutyDateRangeText = result.dutyDateRangeText;
      console.log(`  -> Scraper başarılı! ${pharmacies.length} eczane bulundu.`);
    } catch (err) {
      scraperFailed = true;
      console.log(`  -> Scraper hatası: ${err.message}`);
    }

    if (scraperFailed || pharmacies.length === 0) {
      // B. Scraper başarısızsa sadece AKTİF ilçeler için CollectAPI'ye (Yedek) geç
      const activeDistricts = activeDistrictsMap[city] || [];
      if (activeDistricts.length === 0) {
        console.log(`  -> Scraper başarısız ancak bu ilde aktif aranan ilçe yok. Yedek hat tetiklenmedi.`);
        continue;
      }

      console.log(`  -> Yedek hat (CollectAPI) devreye sokuluyor... Aktif ilçeler: ${activeDistricts.join(', ')}`);
      const batch = db.batch();
      let savedCount = 0;

      for (const district of activeDistricts) {
        try {
          console.log(`    -> CollectAPI sorgusu yapılıyor: ${city} / ${district}...`);
          const districtMeds = await fetchDutyFromCollectAPI(city, district);
          
          // Eczaneleri koordinatlarıyla zenginleştir
          const enrichedMeds = await enrichDutyPharmaciesWithCoords(city, district, districtMeds);
          
          const citySlug = toSlug(city);
          const districtSlug = toSlug(district);
          const docRef = db.collection(DB_COLLECTIONS.DUTY_PHARMACIES).doc(`${citySlug}_${districtSlug}`);
          
          batch.set(docRef, {
            city,
            district,
            pharmacies: enrichedMeds,
            updatedAt: Date.now()
          }, { merge: true });

          savedCount++;
          await delay(1000); // Rate limit aşımı koruması
        } catch (apiErr) {
          // Hata sessizce yutulur
        }
      }

      if (savedCount > 0) {
        await batch.commit();
        console.log(`  -> CollectAPI ile ${savedCount} aktif ilçe başarıyla güncellendi.`);
      }
    } else {
      // C. Scraper Başarılıysa: Çekilen tüm eczaneleri Firestore'a yaz (Tüm ilçeler için tek istekte)
      const districtsInCity = TURKEY_CITIES[city] || [];
      const groupedByDistrict = {};
      districtsInCity.forEach(d => { groupedByDistrict[d] = []; });

      // Eczaneleri ilçelerine dağıt
      pharmacies.forEach(p => {
        // Öncelikle p.dist ile tam eşleşme arayalım
        let matched = districtsInCity.find(d => toSlug(d) === toSlug(p.dist));
        
        // Eğer p.dist eşleşmediyse ve p.dist boşsa, son çare olarak adres üzerinden eşleşme deneyelim
        if (!matched && (!p.dist || p.dist.trim() === '')) {
          matched = districtsInCity.find(d => p.address.toLowerCase().includes(d.toLowerCase()));
        }
        
        if (matched) {
          groupedByDistrict[matched].push(p);
        }
      });

      const batch = db.batch();
      let count = 0;

      // Scraped tarihin güncelliğini kontrol et
      const isToday = isDutyDateToday(dutyDateRangeText);
      const updateTime = isToday ? Date.now() : (Date.now() - 24 * 60 * 60 * 1000);

      // Asenkron koordinat zenginleştirmesi için for...of kullanıyoruz
      const districtsWithMeds = districtsInCity.filter(d => (groupedByDistrict[d] || []).length > 0);
      for (const d of districtsWithMeds) {
        const districtMeds = groupedByDistrict[d] || [];
        const enrichedMeds = await enrichDutyPharmaciesWithCoords(city, d, districtMeds);
        
        const citySlug = toSlug(city);
        const districtSlug = toSlug(d);
        const docRef = db.collection(DB_COLLECTIONS.DUTY_PHARMACIES).doc(`${citySlug}_${districtSlug}`);
        
         batch.set(docRef, {
          city,
          district: d,
          pharmacies: enrichedMeds,
          dutyDateRangeText: dutyDateRangeText || '',
          updatedAt: updateTime
        }, { merge: true });

        count++;
      }

      if (count > 0) {
        await batch.commit();
        console.log(`  -> Firestore güncellendi: ${city} (${count} ilçe yazıldı).`);
      }
    }
    
    await delay(2000); // İl sorguları arasında bekleme süresi
  }
  
  console.log('\n--- Nöbetçi Eczaneler Senkronizasyonu Tamamlandı ---');
}

/** YENİ ECZANELERİN SENKRONİZASYONU (NosyAPI recent) */
async function syncRecentPharmacies() {
  console.log('--- Yeni Eklenen Eczaneler Senkronizasyonu Başlatıldı ---');

  if (!NOSYAPI_KEY || NOSYAPI_KEY.includes('YOUR_')) {
    console.error('Hata: EXPO_PUBLIC_NOSYAPI_KEY bulunamadı.');
    return;
  }

  try {
    const url = `${NOSYAPI_BASE_URL}/pharmaciesv2/recent?apiKey=${NOSYAPI_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`NosyAPI HTTP hatası: ${response.status}`);
    }

    const json = await response.json();
    if (json.status !== 'success' || !Array.isArray(json.data)) {
      throw new Error(json.messageTR || json.message || 'NosyAPI başarısız yanıt döndü.');
    }

    console.log(`Son 1 hafta içinde eklenen ${json.data.length} yeni eczane bulundu. Firestore karşılaştırılıyor...`);

    // Gelen eczaneleri ilçe bazında gruplayarak işle
    const updates = {}; // Key: citySlug_districtSlug, Value: { city, district, items: [] }

    json.data.forEach(item => {
      const city = item.city;
      const district = item.district;
      if (!city || !district) return;

      const key = `${toSlug(city)}_${toSlug(district)}`;
      if (!updates[key]) {
        updates[key] = { city, district, items: [] };
      }
      updates[key].items.push({
        name: item.pharmacyName.toUpperCase().replace(/İ/g, 'İ').replace(/I/g, 'I'),
        dist: item.district,
        address: item.address,
        phone: item.phone || '',
        loc: `${item.latitude},${item.longitude}`
      });
    });

    let updatedCount = 0;

    for (const key of Object.keys(updates)) {
      const { city, district, items } = updates[key];
      const docRef = db.collection(DB_COLLECTIONS.ALL_PHARMACIES).doc(key);
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        const data = docSnap.data();
        const existingList = Array.isArray(data.pharmacies) ? data.pharmacies : [];
        let modified = false;

        items.forEach(newItem => {
          const exists = existingList.some(p => p.name.toLowerCase().trim() === newItem.name.toLowerCase().trim());
          if (!exists) {
            existingList.push(newItem);
            modified = true;
          }
        });

        if (modified) {
          await docRef.update({
            pharmacies: existingList
          });
          console.log(`  -> ${city}/${district} listesine yeni eczane(ler) eklendi.`);
          updatedCount++;
        }
      }
    }

    // Son senkronizasyon zamanını kaydet
    await db.collection(DB_COLLECTIONS.PHARMACY_META).doc('recent_sync').set({
      lastSyncTime: Date.now()
    }, { merge: true });

    console.log(`\nSenkronizasyon tamamlandı. Toplam ${updatedCount} ilçe güncellendi.`);
  } catch (err) {
    console.error('❌ Hata: syncRecentPharmacies başarısız:', err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--duty')) {
    await syncDutyPharmacies();
  } else if (args.includes('--recent')) {
    await syncRecentPharmacies();
  } else {
    console.log('Kullanım: node scripts/sync-pharmacies.js [--duty | --recent]');
  }
}

main();
