const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function check() {
  console.log('--- Checking Istanbul documents in duty_pharmacies ---');
  const snapshot = await db.collection('duty_pharmacies').where('city', '==', 'İstanbul').get();
  console.log('Total Istanbul documents:', snapshot.size);
  snapshot.forEach(doc => {
    console.log(`Document ID: ${doc.id}, District: ${doc.data().district}, Pharmacies Count: ${doc.data().pharmacies?.length}`);
  });
}

check().catch(console.error);
