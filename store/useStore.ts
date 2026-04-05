import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MedicationLog } from '../services/firestore';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

export interface Profile {
  id: string;
  userId: string;
  name: string;
  isMain: boolean;
  avatar?: string;
  age?: number;
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
}

export interface AlertConfig {
  title?: string;
  message: string;
  buttons?: {
    text: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
  }[];
  type?: 'info' | 'success' | 'warning' | 'danger';
}

interface AppState {
  user: User | null;
  profiles: Profile[];
  medications: Medication[];
  medicationLogs: MedicationLog[];
  activeProfileId: string | null;
  language: 'tr' | 'en';
  theme: 'dark' | 'light';
  lastEmail: string | null;
  alert: AlertConfig | null;
  globalMedications: string[];
  setUser: (user: User | null) => void;
  setProfiles: (profiles: Profile[]) => void;
  addProfile: (profile: Profile) => void;
  setMedications: (medications: Medication[]) => void;
  addMedication: (medication: Medication) => void;
  removeMedication: (id: string) => void;
  removeProfile: (id: string) => void;
  updateMedication: (id: string, data: Partial<Medication>) => void;
  setMedicationLogs: (logs: MedicationLog[]) => void;
  addMedicationLogState: (log: MedicationLog) => void;
  setActiveProfileId: (id: string | null) => void;
  setLanguage: (lang: 'tr' | 'en') => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setLastEmail: (email: string) => void;
  setGlobalMedications: (meds: string[]) => void;
  logout: () => void;
  showAlert: (config: AlertConfig) => void;
  hideAlert: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      profiles: [],
      medications: [],
      medicationLogs: [],
      activeProfileId: null,
      language: 'tr',
      theme: 'dark',
      lastEmail: null,
      alert: null,
      globalMedications: [],
      setUser: (user) => set({ user }),
      setProfiles: (profiles) => set({ profiles }),
      addProfile: (profile) => set((state) => ({ profiles: [...state.profiles, profile] })),
      setMedications: (medications) => set({ medications }),
      addMedication: (medication) => set((state) => ({ medications: [...state.medications, medication] })),
      updateMedication: (id, data) => set((state) => ({
        medications: (state.medications || []).map((m) => m.id === id ? { ...m, ...data } : m)
      })),
      removeMedication: (id) => set((state) => ({ 
        medications: (state.medications || []).filter((m) => m.id !== id) 
      })),
      removeProfile: (id) => set((state) => ({
        profiles: (state.profiles || []).filter((p) => p.id !== id)
      })),
      setMedicationLogs: (logs) => set({ medicationLogs: logs }),
      addMedicationLogState: (log) => set((state) => ({ medicationLogs: [...(state.medicationLogs || []), log] })),
      setActiveProfileId: (id) => set({ activeProfileId: id }),
      setLanguage: (lang) => set({ language: lang }),
      setTheme: (theme) => set({ theme }),
      setLastEmail: (email) => set({ lastEmail: email }),
      setGlobalMedications: (meds) => set({ globalMedications: meds }),
      logout: () => set({ user: null }),
      showAlert: (alert) => set({ alert }),
      hideAlert: () => set({ alert: null }),
    }),
    {
      name: 'med-tracker-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
