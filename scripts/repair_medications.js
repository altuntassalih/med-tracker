const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function repair() {
  console.log('--- Starting Medication Repair Script ---');
  const medsSnapshot = await db.collection('medications').get();
  console.log(`Total medications found in DB: ${medsSnapshot.size}`);

  let repairedCount = 0;

  for (const doc of medsSnapshot.docs) {
    const med = doc.data();
    const medId = doc.id;

    console.log(`\nChecking medication: "${med.name}" (ID: ${medId})`);
    console.log(`  - Current startDate: ${med.startDate}`);
    console.log(`  - Current originalStartDate: ${med.originalStartDate}`);

    // Query logs to find the earliest log date
    const logsSnapshot = await db.collection('medicationLogs')
      .where('medicationId', '==', medId)
      .get();
    
    console.log(`  - Total logs found: ${logsSnapshot.size}`);

    let earliestDate = null;
    logsSnapshot.forEach(logDoc => {
      const log = logDoc.data();
      let logDate = log.scheduledDate;
      if (!logDate && log.takenAt) {
        logDate = log.takenAt.split('T')[0];
      }
      if (logDate) {
        if (!earliestDate || logDate < earliestDate) {
          earliestDate = logDate;
        }
      }
    });

    console.log(`  - Earliest log date found: ${earliestDate}`);

    // Determine the correct originalStartDate
    let targetOriginalStart = med.originalStartDate;

    if (!targetOriginalStart) {
      // If originalStartDate is not set, we must set it
      if (earliestDate && earliestDate < med.startDate) {
        targetOriginalStart = earliestDate;
      } else {
        targetOriginalStart = med.startDate;
      }
    } else {
      // If originalStartDate IS set, but maybe it is later than the earliest log, we can heal it
      if (earliestDate && earliestDate < targetOriginalStart) {
        targetOriginalStart = earliestDate;
      }
    }

    if (targetOriginalStart !== med.originalStartDate || !med.originalStartDate) {
      console.log(`  -> REPAIRING: Setting originalStartDate to "${targetOriginalStart}"`);
      await db.collection('medications').doc(medId).update({
        originalStartDate: targetOriginalStart
      });
      repairedCount++;
    } else {
      console.log(`  - No repair needed.`);
    }
  }

  console.log(`\n--- Repair completed. Repaired ${repairedCount} medications. ---`);
}

repair().catch(console.error);
