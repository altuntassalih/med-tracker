const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function check() {
  const list = ['istanbul_adalar', 'istanbul_kadikoy', 'istanbul_besiktas', 'istanbul_uskudar'];
  for (const docId of list) {
    const snap = await db.collection('all_pharmacies').doc(docId).get();
    if (snap.exists) {
      console.log(`Document ID: ${docId}, Pharmacies Count: ${snap.data().pharmacies?.length}`);
    } else {
      console.log(`Document ID: ${docId} does not exist`);
    }
  }
}

check().catch(console.error);
