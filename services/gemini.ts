import { GEMINI_API_URL } from '../constants/AppConstants';
import { LanguageCode } from '../constants/translations';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const callGemini = async (prompt: string, attempt = 1): Promise<string> => {
  if (!API_KEY || API_KEY === '') {
    throw new Error('API Anahtarı Eksik (Lütfen terminali restart edin)');
  }

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1000,
        },
      }),
    });

    const data: GeminiResponse = await response.json();

    // Yüksek talep / rate limit → retry
    if ((response.status === 429 || response.status === 503) && attempt <= 3) {
      const waitMs = attempt * 2000; // 2s, 4s, 6s
      await sleep(waitMs);
      return callGemini(prompt, attempt + 1);
    }

    if (!response.ok) {
      const errorMsg = data.error?.message || `HTTP ${response.status}`;
      throw new Error(`API Hatası: ${errorMsg}`);
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Yanıt alınamadı.';
  } catch (err: any) {
    // Ağ hatalarında da retry uygula
    if (attempt <= 3 && (err.message?.includes('network') || err.message?.includes('fetch'))) {
      await sleep(attempt * 1500);
      return callGemini(prompt, attempt + 1);
    }
    throw err;
  }
};

// İlaç Hakkında Genel Bilgi Al
export const getMedicationInfo = async (medicationName: string, lang: LanguageCode = 'tr'): Promise<string> => {
  const prompt = lang === 'en'
    ? `You are an experienced pharmacologist. What is "${medicationName}" used for, and what are its side effects? Answer in English, short and clear.`
    : `Sen deneyimli bir farmakologsun. "${medicationName}" ilacı ne için kullanılır, yan etkileri nelerdir? Türkçe, kısa ve net yanıtla.`;
  
  return callGemini(prompt);
};

// İlaç Etkileşim Analizi
export const analyzeMedicationInteractions = async (medications: string[], lang: LanguageCode = 'tr'): Promise<string> => {
  if (medications.length < 2) {
    return lang === 'en' ? 'At least 2 medications are required for interaction analysis.' : 'Etkileşim analizi için en az 2 ilaç gereklidir.';
  }

  const medicationList = medications.map((m, i) => `${i + 1}. ${m}`).join('\n');
  
  const prompt = lang === 'en'
    ? `Analyze potential interactions when the following medications are used together:\n${medicationList}\nProvide a short and clear safety report in English. Add "Consult your doctor" at the end.`
    : `Aşağıdaki ilaç listesi birlikte kullanıldığında olası etkileşimleri analiz et:\n${medicationList}\nTürkçe, kısa ve anlaşılır bir güvenlik raporu ver. En sona "Doktorunuza danışın" notu ekle.`;

  return callGemini(prompt);
};
