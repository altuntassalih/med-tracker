const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Service Account Initialization
let serviceAccount;
const localKeyPath = path.join(__dirname, '../service-account.json');
if (fs.existsSync(localKeyPath)) {
  serviceAccount = require(localKeyPath);
}

if (!serviceAccount) {
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Constants
const ALL_PHARMACIES_COLLECTION = 'all_pharmacies';
const OVERPASS_USER_AGENT = 'MedTrackerPharmacyApp/1.0 (contact: admin@medtrackerapp.com)';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Read turkeyCities
let TURKEY_CITIES;
try {
  const filePath = path.join(__dirname, '../constants/turkeyCities.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  
  const jsCode = content
    .replace(/export const/g, 'const')
    .replace(/: Record<.*>/g, '');

  const context = {};
  new Function('exports', jsCode + '\nexports.TURKEY_CITIES = TURKEY_CITIES;')(context);
  TURKEY_CITIES = context.TURKEY_CITIES;
} catch (err) {
  process.exit(1);
}

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

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
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

async function fetchDistrictCenters(city) {
  const query = `[out:json][timeout:60];area["name"="${city}"]["admin_level"="4"]->.city;(relation["admin_level"="6"](area.city););out center;`;
  let retries = 3;
  
  while (retries > 0) {
    try {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT
        }
      });
      if (response.status === 429) {
        await delay(5000);
        retries--;
        continue;
      }
      if (!response.ok) {
        throw new Error();
      }
      const json = await response.json();
      return json.elements || [];
    } catch (err) {
      if (retries === 1) {
        throw err;
      }
      await delay(3000);
      retries--;
    }
  }
  return [];
}

async function migrate() {
  console.log('--- Database Migration Started ---');
  
  // 1. Fetch all documents in all_pharmacies
  const snapshot = await db.collection(ALL_PHARMACIES_COLLECTION).get();
  console.log(`Fetched ${snapshot.size} documents from Firestore.`);

  // Group current documents by city
  const cityData = {};
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const city = data.city;
    if (city) {
      if (!cityData[city]) {
        cityData[city] = [];
      }
      cityData[city].push({
        id: docSnap.id,
        district: data.district,
        pharmacies: Array.isArray(data.pharmacies) ? data.pharmacies : []
      });
    }
  });

  const cities = Object.keys(cityData);
  console.log(`Found ${cities.length} unique cities to migrate.`);

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    console.log(`\n[${i + 1}/${cities.length}] Migrating city: ${city}...`);

    let osmDistricts = [];
    try {
      osmDistricts = await fetchDistrictCenters(city);
      console.log(`  -> Fetched ${osmDistricts.length} district centers.`);
    } catch (err) {
      console.log(`  -> Failed to fetch district centers for ${city}. Skipping...`);
      continue;
    }

    const districts = TURKEY_CITIES[city] || [];
    const districtCenters = {};
    districts.forEach(d => {
      districtCenters[toSlug(d)] = null;
    });

    const citySlug = toSlug(city);
    osmDistricts.forEach(el => {
      if (el.tags && el.tags.name && el.center) {
        const slug = toSlug(el.tags.name);
        let matched = districts.find(d => toSlug(d) === slug);
        
        // Robust matching for "Merkez" (Center) districts
        if (!matched) {
          if (slug === citySlug || slug === `${citySlug}-merkez` || slug === `merkez-${citySlug}`) {
            matched = districts.find(d => toSlug(d) === 'merkez');
          }
        }
        
        if (matched) {
          districtCenters[toSlug(matched)] = {
            lat: el.center.lat,
            lon: el.center.lon,
            name: matched
          };
        }
      }
    });

    // Flatten all pharmacies currently stored for this city
    const allPharmacies = [];
    const originalDocs = cityData[city];
    originalDocs.forEach(docInfo => {
      allPharmacies.push(...docInfo.pharmacies);
    });

    if (allPharmacies.length === 0) {
      console.log(`  -> No pharmacies found for ${city}.`);
      continue;
    }

    console.log(`  -> Processing ${allPharmacies.length} pharmacies...`);

    // Group them correctly
    const grouped = {};
    districts.forEach(d => {
      grouped[d] = [];
    });

    for (const p of allPharmacies) {
      let matchedDistrict = null;
      let lat = null, lon = null;
      
      if (p.loc) {
        const coords = p.loc.split(',').map(Number);
        if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
          lat = coords[0];
          lon = coords[1];
        }
      }

      // Step 1: Tag matching (preferred to respect administrative boundaries, excluding p.dist)
      const tagsToSearch = [
        p.address,
        p.name
      ].filter(Boolean).map(t => toSlug(t));

      for (const d of districts) {
        const dSlug = toSlug(d);
        const found = tagsToSearch.some(tag => tag.includes(dSlug));
        if (found) {
          matchedDistrict = d;
          break;
        }
      }

      // Step 2: Coordinate matching (fallback if tags don't match)
      if (!matchedDistrict && lat !== null && lon !== null) {
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

      // Step 3: Fallback
      if (!matchedDistrict) {
        matchedDistrict = districts.includes('Merkez') ? 'Merkez' : districts[0];
      }

      grouped[matchedDistrict].push({
        name: p.name,
        dist: matchedDistrict,
        address: p.address,
        phone: p.phone || '',
        loc: p.loc || ''
      });
    }

    // Write to Firestore using batch
    const batch = db.batch();
    
    // Track doc IDs we are touching/creating
    const docIdsToWrite = new Set();

    for (const d of districts) {
      const pharmacies = grouped[d];
      const districtSlug = toSlug(d);
      const docId = `${citySlug}_${districtSlug}`;

      if (pharmacies.length > 0) {
        const docRef = db.collection(ALL_PHARMACIES_COLLECTION).doc(docId);
        batch.set(docRef, {
          city,
          district: d,
          pharmacies,
          updatedAt: Date.now()
        }, { merge: true });
        docIdsToWrite.add(docId);
      }
    }

    // Identify and delete obsolete documents (e.g. documents that were created before but now have 0 pharmacies)
    const originalDocIds = originalDocs.map(d => d.id);
    for (const oldDocId of originalDocIds) {
      if (!docIdsToWrite.has(oldDocId)) {
        const docRef = db.collection(ALL_PHARMACIES_COLLECTION).doc(oldDocId);
        batch.delete(docRef);
        console.log(`  -> Will delete empty document: ${oldDocId}`);
      }
    }

    await batch.commit();
    console.log(`  -> City ${city} migrated successfully.`);

    // Delay to prevent hitting Overpass API rate limits too quickly
    await delay(3000);
  }

  console.log('\n--- Database Migration Completed Successfully ---');
}

migrate().catch(() => {});
