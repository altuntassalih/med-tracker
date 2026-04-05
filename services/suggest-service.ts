import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMedicationInfo } from './gemini';
import { LanguageCode } from '../constants/translations';
import { GEMINI_API_URL } from '../constants/AppConstants';
import { addGlobalMedication } from './firestore';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const QUOTA_KEY = 'gemini_daily_quota';
const DAILY_LIMIT = 100;

interface QuotaData {
  date: string;
  count: number;
}

const checkAndUpdateQuota = async (): Promise<boolean> => {
  const today = new Date().toISOString().split('T')[0];
  const stored = await AsyncStorage.getItem(QUOTA_KEY);
  
  let data: QuotaData = { date: today, count: 0 };
  
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed.date === today) {
      data = parsed;
    }
  }

  if (data.count >= DAILY_LIMIT) {
    return false;
  }

  data.count += 1;
  await AsyncStorage.setItem(QUOTA_KEY, JSON.stringify(data));
  return true;
};

export const getMedicationSuggestions = async (name: string, lang: LanguageCode): Promise<string[]> => {
  if (name.length < 3) return [];

  const canRequest = await checkAndUpdateQuota();
  if (!canRequest) {
    throw new Error(lang === 'tr' ? 'Günlük arama limitinize (100) ulaştınız.' : 'Daily search limit (100) reached.');
  }

  const prompt = lang === 'en'
    ? `Find 5 common medication brand names starting with "${name}". Return ONLY a comma-separated list. No numbering, no descriptions.`
    : `"${name}" ile başlayan 5 yaygın ilaç marka ismini bul. SADECE virgülle ayrılmış bir liste olarak döndür. Numara koyma, açıklama yapma.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 100,
        },
      }),
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const results = text.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    
    // Her bir yeni ismi küresel kütüphaneye async olarak ekle
    results.forEach((name: string) => {
      addGlobalMedication(name).catch(e => console.log('Global save error:', e));
    });

    return results;
  } catch (err) {
    console.error('Gemini Suggest Error:', err);
    return [];
  }
};
