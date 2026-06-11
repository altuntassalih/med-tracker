const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function check() {
  console.log('--- Checking all_pharmacies ---');
  const allSnapshot = await db.collection('all_pharmacies').limit(10).get();
  console.log('Total documents found in all_pharmacies limit 10:', allSnapshot.size);
  allSnapshot.forEach(doc => {
    console.log(`Document ID: ${doc.id}, City: ${doc.data().city}, District: ${doc.data().district}, Pharmacies Count: ${doc.data().pharmacies?.length}`);
  });

  console.log('\n--- Checking duty_pharmacies ---');
  const dutySnapshot = await db.collection('duty_pharmacies').limit(10).get();
  console.log('Total documents found in duty_pharmacies limit 10:', dutySnapshot.size);
  dutySnapshot.forEach(doc => {
    console.log(`Document ID: ${doc.id}, City: ${doc.data().city}, District: ${doc.data().district}, Pharmacies Count: ${doc.data().pharmacies?.length}`);
  });
}

check().catch(console.error);
