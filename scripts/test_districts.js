const city = 'Adana';
const query = `[out:json][timeout:60];area["name"="${city}"]["admin_level"="4"]->.city;(relation["admin_level"="6"](area.city););out center;`;
const url = 'https://overpass-api.de/api/interpreter';

async function run() {
  console.log(`Fetching district centers for ${city}...`);
  const response = await fetch(url, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MedTrackerPharmacyApp/1.0 (contact: admin@medtrackerapp.com)'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const elements = json.elements || [];
  console.log(`Found ${elements.length} districts:`);
  elements.forEach(el => {
    const name = el.tags.name;
    const lat = el.center ? el.center.lat : null;
    const lon = el.center ? el.center.lon : null;
    console.log(`- ${name}: ${lat}, ${lon}`);
  });
}

run().catch(console.error);
