const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const cheerio = require('cheerio');

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

// 2. Çevre Değişkenleri / API Anahtarları
const COLLECTAPI_KEY = process.env.EXPO_PUBLIC_COLLECTAPI_KEY || '';
const NOSYAPI_KEY = process.env.EXPO_PUBLIC_NOSYAPI_KEY || '';
const NOSYAPI_BASE_URL = 'https://www.nosyapi.com/apiv2/service';

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

/** HTML Scraper: eczaneler.gen.tr sitesinden ildeki nöbetçi eczaneleri çeker */
async function scrapeDutyPharmaciesFromWeb(city) {
  const citySlug = toSlug(city);
  const url = `https://www.eczaneler.gen.tr/nobetci-${citySlug}`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Scraper HTTP hatası: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const pharmacies = [];

  $('td.border-bottom').each((i, el) => {
    const name = $(el).find('span.isim').text().trim().toUpperCase().replace(/İ/g, 'İ').replace(/I/g, 'I');
    if (!name) return;

    const addressDiv = $(el).find('.col-lg-6');
    const addressClone = addressDiv.clone();
    addressClone.find('div').remove();
    let address = addressClone.text().trim();
    
    const directions = addressDiv.find('.font-italic').text().trim();
    if (directions) {
      address += ` (${directions})`;
    }

    const district = addressDiv.find('.bg-info').text().trim();
    
    let phone = '';
    $(el).find('.col-lg-3').each((j, subEl) => {
      const text = $(subEl).text().trim();
      if (/^[0-9\s()-]+$/.test(text)) {
        phone = text.replace(/\s+/g, '');
      }
    });

    pharmacies.push({
      name,
      dist: district,
      address,
      phone,
      loc: '' // Scraper'dan koordinat gelmediği için boş bırakıyoruz
    });
  });

  return pharmacies;
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
    let scraperFailed = false;

    // A. Web Scraper'ı dene
    try {
      pharmacies = await scrapeDutyPharmaciesFromWeb(city);
      console.log(`  -> Scraper başarılı! ${pharmacies.length} eczane bulundu.`);
    } catch (err) {
      scraperFailed = true;
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
          
          const citySlug = toSlug(city);
          const districtSlug = toSlug(district);
          const docRef = db.collection(DB_COLLECTIONS.DUTY_PHARMACIES).doc(`${citySlug}_${districtSlug}`);
          
          batch.set(docRef, {
            city,
            district,
            pharmacies: districtMeds,
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
      
      process.exitCode = 1;
    } else {
      // C. Scraper Başarılıysa: Çekilen tüm eczaneleri Firestore'a yaz (Tüm ilçeler için tek istekte)
      const districtsInCity = TURKEY_CITIES[city] || [];
      const groupedByDistrict = {};
      districtsInCity.forEach(d => { groupedByDistrict[d] = []; });

      // Eczaneleri ilçelerine dağıt
      pharmacies.forEach(p => {
        const matched = districtsInCity.find(d => toSlug(d) === toSlug(p.dist) || p.address.toLowerCase().includes(d.toLowerCase()));
        if (matched) {
          groupedByDistrict[matched].push(p);
        }
      });

      const batch = db.batch();
      let count = 0;

      districtsInCity.forEach(d => {
        const districtMeds = groupedByDistrict[d] || [];
        if (districtMeds.length > 0) {
          const citySlug = toSlug(city);
          const districtSlug = toSlug(d);
          const docRef = db.collection(DB_COLLECTIONS.DUTY_PHARMACIES).doc(`${citySlug}_${districtSlug}`);
          
          batch.set(docRef, {
            city,
            district: d,
            pharmacies: districtMeds,
            updatedAt: Date.now()
          }, { merge: true });

          count++;
        }
      });

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

      if (docSnap.exists()) {
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
