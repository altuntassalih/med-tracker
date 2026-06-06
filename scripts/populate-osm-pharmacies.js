const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// 1. Firebase Admin SDK Başlatma
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    // Lokal testler için root'taki dosyayı arar
    const localKeyPath = path.join(__dirname, '../service-account.json');
    if (fs.existsSync(localKeyPath)) {
      serviceAccount = require(localKeyPath);
    }
  }
} catch (err) {
  console.error('Firebase Service Account Key loading failed:', err.message);
}

if (!serviceAccount) {
  console.error('Hata: FIREBASE_SERVICE_ACCOUNT_JSON bulunamadı. Lütfen root dizinine service-account.json dosyasını ekleyin veya ortam değişkenini ayarlayın.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const ALL_PHARMACIES_COLLECTION = 'all_pharmacies';

// 2. turkeyCities.ts dosyasından verileri oku
let TURKEY_CITIES, CITY_CENTERS;
try {
  const filePath = path.join(__dirname, '../constants/turkeyCities.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  
  const jsCode = content
    .replace(/export const/g, 'const')
    .replace(/: Record<.*>/g, '');

  const context = {};
  new Function('exports', jsCode + '\nexports.TURKEY_CITIES = TURKEY_CITIES;\nexports.CITY_CENTERS = CITY_CENTERS;')(context);
  TURKEY_CITIES = context.TURKEY_CITIES;
  CITY_CENTERS = context.CITY_CENTERS;
} catch (err) {
  console.error('turkeyCities.ts okunurken hata oluştu:', err.message);
  process.exit(1);
}

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

/** Bir şehre ait tüm eczaneleri OpenStreetMap Overpass API'den çeker */
async function fetchPharmaciesFromOSM(city) {
  const query = `[out:json][timeout:90];area["name"="${city}"]["admin_level"="4"]->.a;(node["amenity"="pharmacy"](area.a);way["amenity"="pharmacy"](area.a););out body center;`;
  const url = 'https://overpass-api.de/api/interpreter';

  const response = await fetch(url, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`OSM HTTP hata: ${response.status}`);
  }

  const json = await response.json();
  return json.elements || [];
}

/** Çekilen OSM elementlerini parse eder ve ilçelerine göre gruplayıp Firestore'a kaydeder */
async function processAndSaveCity(city, elements) {
  const districts = TURKEY_CITIES[city] || [];
  const grouped = {};
  
  // Grupları ilkle
  districts.forEach(d => {
    grouped[d] = [];
  });

  for (const el of elements) {
    const tags = el.tags || {};
    let name = tags.name || tags.operator || 'ECZANE';
    name = name.toUpperCase().replace(/İ/g, 'İ').replace(/I/g, 'I');

    // Telefon no
    const phone = tags.phone || tags['contact:phone'] || tags['phone:mobile'] || '';

    // Koordinat
    const lat = el.lat || (el.center && el.center.lat);
    const lon = el.lon || (el.center && el.center.lon);
    if (!lat || !lon) continue;

    // Adres oluştur
    let address = '';
    if (tags['addr:street']) address += tags['addr:street'] + ' ';
    if (tags['addr:housenumber']) address += 'No: ' + tags['addr:housenumber'] + ' ';
    if (tags['addr:suburb'] || tags['addr:quarter']) address += (tags['addr:suburb'] || tags['addr:quarter']) + ' ';
    if (tags['addr:district']) address += tags['addr:district'] + '/';
    address += city;
    address = address.trim();

    // İlçe eşleme
    let matchedDistrict = null;
    const distTag = (tags['addr:district'] || tags['addr:subregion'] || '').toLowerCase();
    const addrText = address.toLowerCase();

    for (const d of districts) {
      const dLower = d.toLowerCase();
      if (distTag.includes(dLower) || dLower.includes(distTag) || addrText.includes(dLower)) {
        matchedDistrict = d;
        break;
      }
    }

    if (!matchedDistrict) {
      matchedDistrict = districts.includes('Merkez') ? 'Merkez' : districts[0];
    }

    grouped[matchedDistrict].push({
      name,
      dist: matchedDistrict,
      address,
      phone,
      loc: `${lat},${lon}`
    });
  }

  // Firestore'a batch kaydet
  const batch = db.batch();
  let count = 0;

  for (const d of districts) {
    const pharmacies = grouped[d];
    if (pharmacies.length === 0) continue;

    const citySlug = toSlug(city);
    const districtSlug = toSlug(d);
    const docRef = db.collection(ALL_PHARMACIES_COLLECTION).doc(`${citySlug}_${districtSlug}`);

    batch.set(docRef, {
      city,
      district: d,
      pharmacies,
      updatedAt: Date.now()
    }, { merge: true });
    
    count++;
  }

  if (count > 0) {
    await batch.commit();
    console.log(`Firestore Kaydı Tamamlandı: ${city} (${count} ilçe yazıldı)`);
  } else {
    console.log(`Uyarı: ${city} için kaydedilecek eczane bulunamadı.`);
  }
}

async function run() {
  const cities = Object.keys(TURKEY_CITIES);
  console.log(`Tüm eczanelerin ön yükleme işlemi başlatılıyor. Toplam il sayısı: ${cities.length}`);

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    console.log(`[${i + 1}/${cities.length}] ${city} eczaneleri OSM'den çekiliyor...`);
    
    try {
      const elements = await fetchPharmaciesFromOSM(city);
      console.log(`  -> ${city} için ${elements.length} eczane bulundu. Firestore'a yazılıyor...`);
      await processAndSaveCity(city, elements);
    } catch (err) {
      console.error(`❌ Hata: ${city} eczaneleri yüklenirken hata oluştu:`, err.message);
    }

    // Overpass API'ye çok hızlı istek atıp engellenmemek için bekleme süresi koyuyoruz
    await delay(2000);
  }

  console.log('🎉 Tüm Türkiye eczanelerinin ön yükleme işlemi başarıyla tamamlandı!');
}

run();
