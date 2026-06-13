const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function check() {
  console.log('--- Checking details of istanbul_pendik in duty_pharmacies ---');
  const docRef = db.collection('duty_pharmacies').doc('istanbul_pendik');
  const docSnap = await docRef.get();
  
  if (docSnap.exists) {
    const data = docSnap.data();
    console.log('City:', data.city);
    console.log('District:', data.district);
    console.log('updatedAt:', data.updatedAt, 'type:', typeof data.updatedAt);
    if (typeof data.updatedAt === 'number') {
      console.log('updatedAt formatted:', new Date(data.updatedAt).toLocaleString('tr-TR'));
    }
    console.log('dutyDateRangeText:', data.dutyDateRangeText);
    console.log('Pharmacies:', JSON.stringify(data.pharmacies, null, 2));
  } else {
    console.log('Document istanbul_pendik does not exist!');
  }
}

check().catch(console.error);
