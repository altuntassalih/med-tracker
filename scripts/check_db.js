const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking active_districts ---');
  const activeSnap = await db.collection('active_districts').get();
  activeSnap.forEach(doc => {
    const data = doc.data();
    console.log(`Active District ID: ${doc.id}, City: ${data.city}, District: ${data.district}, updatedAt:`, data.updatedAt);
  });

  console.log('\n--- Checking duty_pharmacies for a sample ---');
  const dutySnapshot = await db.collection('duty_pharmacies').limit(3).get();
  dutySnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`Document ID: ${doc.id}, City: ${data.city}, District: ${data.district}`);
    console.log(`  - updatedAt type: ${typeof data.updatedAt}, value:`, data.updatedAt);
    if (data.updatedAt && data.updatedAt.toDate) {
      console.log(`  - parsed via toDate():`, data.updatedAt.toDate());
    }
    console.log(`  - Pharmacies Count: ${data.pharmacies?.length}`);
    if (data.pharmacies && data.pharmacies.length > 0) {
      console.log(`  - Sample Pharmacy:`, JSON.stringify(data.pharmacies[0], null, 2));
    }
  });
}

check().catch(console.error);
