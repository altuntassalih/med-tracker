import { db } from './firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
  setDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';

// Firestore kullanılabilir mi kontrol et, kullanılabilirse non-null instance döner
function getDb() {
  if (db !== null && db !== undefined) return db;
  return null;
}

// ---- VERİ TİPLERİ ----

export interface Profile {
  id: string;
  userId: string;
  name: string;
  isMain: boolean;
  age?: number;
  avatar?: string;
  createdAt?: any;
}

export interface Medication {
  id: string;
  profileId: string;
  userId: string;
  name: string;
  type: string;
  dosage: string;
  unit: string;
  times: string[];
  intervalDays?: number;
  notes?: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  // Opsiyonel: ilaç güç seviyesi (örn. "500mg", "20mcg")
  strength?: string;
  // Opsiyonel: toplam ilaç adedi (kalan hesabı için)
  totalQuantity?: number;
  createdAt?: any;
}

export interface MedicationLog {
  id: string;
  medicationId: string;
  profileId: string;
  expectedTime: string;
  takenAt: string;
  scheduledDate?: string;
  status: 'taken' | 'missed';
  createdAt?: any;
}

// ---- PROFİL İŞLEMLERİ ----

export const getProfiles = async (userId: string): Promise<Profile[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  try {
    const q = query(collection(firestore, 'profiles'), where('userId', '==', userId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Profile));
  } catch (_err) {
    return [];
  }
};

export const createProfile = async (userId: string, profileData: Omit<Profile, 'id' | 'userId' | 'createdAt'>): Promise<Profile> => {
  const firestore = getDb();
  if (!firestore) {
    return { 
      id: 'local_prof_' + Date.now(), 
      userId, 
      ...profileData,
      createdAt: new Date()
    };
  }
  try {
    const docRef = await addDoc(collection(firestore, 'profiles'), {
      ...profileData,
      userId,
      createdAt: serverTimestamp(),
    });
    return { id: docRef.id, userId, ...profileData };
  } catch (_err) {
    return { 
      id: 'local_prof_' + Date.now(), 
      userId, 
      ...profileData,
      createdAt: new Date()
    };
  }
};

export const deleteProfile = async (profileId: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    await deleteDoc(doc(firestore, 'profiles', profileId));
  } catch (_err) { /* no-op */ }
};

// ---- İLAÇ İŞLEMLERİ ----

export const getMedications = async (profileId: string, onlyActive: boolean | null = true): Promise<Medication[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  try {
    let q;
    if (onlyActive === true) {
      q = query(
        collection(firestore, 'medications'),
        where('profileId', '==', profileId),
        where('isActive', '==', true)
      );
    } else if (onlyActive === false) {
      q = query(
        collection(firestore, 'medications'),
        where('profileId', '==', profileId),
        where('isActive', '==', false)
      );
    } else {
      // Fetch all for this profile
      q = query(
        collection(firestore, 'medications'),
        where('profileId', '==', profileId)
      );
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Medication));
  } catch (_err) {
    return [];
  }
};

export const addMedication = async (data: Omit<Medication, 'id' | 'createdAt'>): Promise<Medication> => {
  const firestore = getDb();
  if (!firestore) {
    return { 
      id: 'local_med_' + Date.now(), 
      ...data,
      createdAt: new Date()
    };
  }
  try {
    const docRef = await addDoc(collection(firestore, 'medications'), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return { id: docRef.id, ...data };
  } catch (_err) {
    return { 
      id: 'local_med_' + Date.now(), 
      ...data,
      createdAt: new Date()
    };
  }
};

export const updateMedication = async (medicationId: string, data: Partial<Medication>): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    await updateDoc(doc(firestore, 'medications', medicationId), data);
  } catch (_err) { /* no-op */ }
};

export const deleteMedication = async (medicationId: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    await deleteDoc(doc(firestore, 'medications', medicationId));
  } catch (_err) { /* no-op */ }
};

// ---- LOG (GEÇMİŞ) İŞLEMLERİ ----

export const getMedicationLogs = async (profileId: string): Promise<MedicationLog[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  try {
    const q = query(
      collection(firestore, 'medicationLogs'),
      where('profileId', '==', profileId),
      orderBy('takenAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MedicationLog));
  } catch (_err) {
    return [];
  }
};

export const addMedicationLog = async (data: Omit<MedicationLog, 'id' | 'createdAt'>): Promise<MedicationLog> => {
  const firestore = getDb();
  if (!firestore) {
    return { 
      id: 'local_log_' + Date.now(), 
      ...data,
      createdAt: new Date()
    };
  }
  try {
    const docRef = await addDoc(collection(firestore, 'medicationLogs'), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return { id: docRef.id, ...data };
  } catch (_err) {
    return { 
      id: 'local_log_' + Date.now(), 
      ...data,
      createdAt: new Date()
    };
  }
};

export const updateMedicationLog = async (logId: string, data: Partial<MedicationLog>): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    await updateDoc(doc(firestore, 'medicationLogs', logId), data);
  } catch (_err) { /* no-op */ }
};

export const deleteMedicationLog = async (logId: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    await deleteDoc(doc(firestore, 'medicationLogs', logId));
  } catch (_err) { /* no-op */ }
};

export const clearMedicationLogs = async (medicationId: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    const q = query(
      collection(firestore, 'medicationLogs'),
      where('medicationId', '==', medicationId)
    );
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map((d) => deleteDoc(doc(firestore, 'medicationLogs', d.id)));
    await Promise.all(deletePromises);
  } catch (_err) { /* no-op */ }
};

// ---- KÜRESEL İLAÇ KÜTÜPHANESİ (AI CACHE) ----

export const getGlobalMedicationList = async (): Promise<string[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  try {
    const q = query(collection(firestore, 'global_meds'), orderBy('name', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data().name as string);
  } catch (err) {
    console.log('Global meds fetch error:', err);
    return [];
  }
};

export const addGlobalMedication = async (name: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return;

  try {
    // ID olarak normalize edilmiş ismi kullanarak mükerrer kaydı önle
    await setDoc(doc(firestore, 'global_meds', normalized), {
      name: name.trim(),
      createdAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.log('Global meds add error:', err);
  }
};

export const subscribeToGlobalMedications = (callback: (meds: string[]) => void): Unsubscribe | null => {
  const firestore = getDb();
  if (!firestore) return null;

  const q = query(collection(firestore, 'global_meds'), orderBy('name', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const meds = snapshot.docs.map(d => d.data().name as string);
    callback(meds);
  }, (err) => {
    console.log('Global meds selection sync error:', err);
  });
};
