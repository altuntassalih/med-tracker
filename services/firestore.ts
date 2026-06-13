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
  getDoc,
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
  height?: number;
  weight?: number;
  targetWeight?: number;
  gender?: 'female' | 'male' | 'other';
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
  originalStartDate?: string;
  endDate?: string;
  isActive: boolean;
  // Opsiyonel: ilaç güç seviyesi (örn. "500mg", "20mcg")
  strength?: string;
  // Opsiyonel: toplam ilaç adedi (kalan hesabı için)
  totalQuantity?: number;
  // Opsiyonel: ilacın barkod numarası
  barcode?: string;
  createdAt?: any;
}

export interface MedicationLog {
  id: string;
  medicationId: string;
  profileId: string;
  expectedTime: string;
  takenAt: string;
  scheduledDate?: string;
  status: 'taken' | 'missed' | 'postponed';
  createdAt?: any;
}

export interface DailyHealthLog {
  id: string; // `${profileId}_${date}`
  profileId: string;
  date: string; // YYYY-MM-DD
  waterIntakeMl: number;
  waterTargetMl?: number;
  mood?: 'excellent' | 'good' | 'neutral' | 'bad' | 'terrible';
  sleepHours?: number;
  sleepRating?: number; // 1-5 rating
  weightKg?: number;
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
  } catch (err) {
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
  } catch (err) {
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
      where('profileId', '==', profileId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() } as MedicationLog))
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
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
    // Hata sessizce yutulur
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
    // Hata sessizce yutulur
  });
};

export interface BarcodeRecord {
  barcode: string;
  name: string;
  type: string;
  dosage: string;
  unit: string;
  strength?: string;
  notes?: string;
  createdAt?: any;
}

// Barkod veritabanından ilacı sorgula (İki Katmanlı Önbellek: 1. Kullanıcıya Özel, 2. Küresel)
export const getMedicationByBarcode = async (barcode: string, userId: string): Promise<BarcodeRecord | null> => {
  const firestore = getDb();
  if (!firestore) return null;
  const trimmed = barcode.trim();
  try {
    // 1. Önce kullanıcının kendi kaydettiği barkodlara bak
    const userDocRef = doc(firestore, 'user_barcodes', `${userId}_${trimmed}`);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      return { barcode: trimmed, ...userDocSnap.data() } as BarcodeRecord;
    }

    // 2. Bulunamazsa küresel doğrulanmış barkod veritabanına bak
    const globalDocRef = doc(firestore, 'barcodes', trimmed);
    const globalDocSnap = await getDoc(globalDocRef);
    if (globalDocSnap.exists()) {
      return { barcode: trimmed, ...globalDocSnap.data() } as BarcodeRecord;
    }
    return null;
  } catch (_err) {
    return null;
  }
};

// Barkod veritabanına yeni ilaç kaydet (Güvenlik için kullanıcının kendi özel önbelleğine yazar)
export const saveMedicationBarcode = async (userId: string, record: BarcodeRecord): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  const trimmed = record.barcode.trim();
  try {
    const docRef = doc(firestore, 'user_barcodes', `${userId}_${trimmed}`);
    await setDoc(docRef, {
      name: record.name,
      type: record.type,
      dosage: record.dosage,
      unit: record.unit,
      strength: record.strength || '',
      notes: record.notes || '',
      createdAt: serverTimestamp(),
    }, { merge: true });
  } catch (_err) {
    // Kaydetme hatası durumunda sessizce yoksay
  }
};

// ---- SAĞLIK (DAILY HEALTH LOG) İŞLEMLERİ ----

export const getDailyHealthLogs = async (profileId: string): Promise<DailyHealthLog[]> => {
  const firestore = getDb();
  if (!firestore) return [];
  try {
    const q = query(
      collection(firestore, 'dailyHealthLogs'),
      where('profileId', '==', profileId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() } as DailyHealthLog))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (_err) {
    return [];
  }
};

export const upsertDailyHealthLog = async (
  profileId: string,
  dateStr: string,
  data: Partial<DailyHealthLog>
): Promise<DailyHealthLog> => {
  const firestore = getDb();
  const docId = `${profileId}_${dateStr}`;
  const logData = {
    profileId,
    date: dateStr,
    ...data,
    updatedAt: new Date().toISOString()
  };

  if (!firestore) {
    return {
      id: docId,
      ...logData,
      waterIntakeMl: data.waterIntakeMl ?? 0,
      createdAt: new Date().toISOString()
    } as DailyHealthLog;
  }

  try {
    const docRef = doc(firestore, 'dailyHealthLogs', docId);
    await setDoc(docRef, {
      ...logData,
      createdAt: serverTimestamp()
    }, { merge: true });

    const docSnap = await getDoc(docRef);
    return { id: docId, ...docSnap.data() } as DailyHealthLog;
  } catch (_err) {
    return {
      id: docId,
      ...logData,
      waterIntakeMl: data.waterIntakeMl ?? 0,
      createdAt: new Date().toISOString()
    } as DailyHealthLog;
  }
};

/** Kullanıcının son aktif olduğu zamanı günceller */
export const updateUserLastActive = async (userId: string, email?: string): Promise<void> => {
  const firestore = getDb();
  if (!firestore) return;
  try {
    const userDocRef = doc(firestore, 'users', userId);
    await setDoc(userDocRef, {
      lastActive: serverTimestamp(),
      ...(email ? { email } : {})
    }, { merge: true });
  } catch (_err) {
    // Hata durumunda sessiz geçilir (RULE[error-mesaji.md] gereği console.log/error yazılmaz)
  }
};

