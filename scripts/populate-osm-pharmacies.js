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
  if (!text) return '';
  return text
    .toString()
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

// Haversine Mesafe Hesaplama
const calculateDistance = (lat1, lon1, lat2, lon2) => {
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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Bir şehirdeki tüm ilçe merkezlerinin koordinatlarını Overpass API'den çeker */
async function fetchDistrictCenters(city) {
  const query = `[out:json][timeout:60];area["name"="${city}"]["admin_level"="4"]->.city;(relation["admin_level"="6"](area.city););out center;`;
  const url = 'https://overpass-api.de/api/interpreter';
  let retries = 3;
  
  while (retries > 0) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (response.status === 429) {
        await delay(5000);
        retries--;
        continue;
      }
      if (!response.ok) throw new Error(`District HTTP: ${response.status}`);
      const json = await response.json();
      return json.elements || [];
    } catch (err) {
      if (retries === 1) throw err;
      await delay(3000);
      retries--;
    }
  }
  return [];
}

/** Bir şehre ait tüm eczaneleri OpenStreetMap Overpass API'den çeker */
async function fetchPharmaciesFromOSM(city) {
  const query = `[out:json][timeout:90];area["name"="${city}"]["admin_level"="4"]->.a;(node["amenity"="pharmacy"](area.a);way["amenity"="pharmacy"](area.a););out body center;`;
  const url = 'https://overpass-api.de/api/interpreter';
  let retries = 5;
  let delayTime = 5000;

  while (retries > 0) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (response.status === 429) {
        await delay(delayTime);
        retries--;
        delayTime *= 2;
        continue;
      }

      if (!response.ok) {
        throw new Error(`OSM HTTP: ${response.status}`);
      }

      const json = await response.json();
      return json.elements || [];
    } catch (err) {
      if (retries === 1) throw err;
      await delay(delayTime);
      retries--;
      delayTime *= 2;
    }
  }
  return [];
}

/** Çekilen OSM elementlerini parse eder ve ilçelerine göre gruplayıp Firestore'a kaydeder */
async function processAndSaveCity(city, elements, osmDistricts) {
  const districts = TURKEY_CITIES[city] || [];
  const grouped = {};
  
  // Grupları ilkle
  districts.forEach(d => {
    grouped[d] = [];
  });

  // İlçe merkezlerinin koordinat haritasını oluştur
  const districtCenters = {};
  districts.forEach(d => {
    districtCenters[toSlug(d)] = null;
  });

  osmDistricts.forEach(el => {
    if (el.tags && el.tags.name && el.center) {
      const slug = toSlug(el.tags.name);
      const matched = districts.find(d => toSlug(d) === slug);
      if (matched) {
        districtCenters[toSlug(matched)] = {
          lat: el.center.lat,
          lon: el.center.lon,
          name: matched
        };
      }
    }
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

    // 1. Taglerde ilçe adını ara
    const tagsToSearch = [
      tags['addr:district'],
      tags['addr:subregion'],
      tags['addr:city'],
      tags['addr:suburb'],
      tags['addr:quarter'],
      tags['addr:street'],
      tags['description'],
      address,
      name
    ].filter(Boolean).map(t => toSlug(t));

    for (const d of districts) {
      const dSlug = toSlug(d);
      const found = tagsToSearch.some(tag => tag.includes(dSlug) || dSlug.includes(tag));
      if (found) {
        matchedDistrict = d;
        break;
      }
    }

    // 2. Bulamazsak koordinata göre en yakın ilçe merkezini seç
    if (!matchedDistrict && lat && lon) {
      let minDistance = Infinity;
      let closest = null;
      for (const d of districts) {
        const center = districtCenters[toSlug(d)];
        if (center) {
          const dist = calculateDistance(lat, lon, center.lat, center.lon);
          if (dist < minDistance) {
            minDistance = dist;
            closest = d;
          }
        }
      }
      if (closest) {
        matchedDistrict = closest;
      }
    }

    // 3. Hala bulamadıysa varsayılan fallback
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
  const args = process.argv.slice(2);
  const cities = args.length > 0 ? args : Object.keys(TURKEY_CITIES);
  console.log(`Eczanelerin ön yükleme işlemi başlatılıyor. Toplam il sayısı: ${cities.length}`);

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    console.log(`[${i + 1}/${cities.length}] ${city} verileri çekiliyor...`);
    
    try {
      // 1. Önce ilçe merkezlerini çek
      console.log(`  -> ${city} ilçe koordinatları çekiliyor...`);
      const osmDistricts = await fetchDistrictCenters(city);
      console.log(`  -> ${city} için ${osmDistricts.length} ilçe merkezi koordinatı alındı.`);

      // 2. Eczaneleri çek
      console.log(`  -> ${city} eczaneleri OSM'den çekiliyor...`);
      const elements = await fetchPharmaciesFromOSM(city);
      console.log(`  -> ${city} için ${elements.length} eczane bulundu. Eşleştirilip Firestore'a yazılıyor...`);
      
      await processAndSaveCity(city, elements, osmDistricts);
    } catch (err) {
      console.error(`❌ Hata: ${city} eczaneleri yüklenirken hata oluştu:`, err.message);
    }

    // Overpass API'yi yormamak için bekleme süresi
    await delay(3000);
  }

  console.log('🎉 Eczanelerin ön yükleme işlemi tamamlandı!');
}

run();
