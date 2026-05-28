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

const callGemini = async (prompt: string, attempt = 1, signal?: AbortSignal): Promise<string> => {
  if (!API_KEY || API_KEY === '') {
    throw new Error('API Anahtarı Eksik (Lütfen terminali restart edin)');
  }

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4000,
        },
      }),
    });

    const data: GeminiResponse = await response.json();

    // Kota aşımı → özel hata (Retry'dan önce kontrol edilir ki boşuna istek harcamayalım)
    const isQuotaExceeded =
      data.error?.status === 'RESOURCE_EXHAUSTED' ||
      data.error?.message?.toLowerCase().includes('quota') ||
      data.error?.message?.toLowerCase().includes('exceeded');

    if (isQuotaExceeded) {
      const quotaErr = new Error('QUOTA_EXCEEDED');
      (quotaErr as any).isQuotaError = true;
      throw quotaErr;
    }

    // Yüksek talep / rate limit (Kota aşımı hariç) → retry
    if ((response.status === 429 || response.status === 503) && attempt <= 3) {
      const waitMs = attempt * 2000; // 2s, 4s, 6s
      await sleep(waitMs);
      return callGemini(prompt, attempt + 1, signal);
    }

    if (!response.ok) {
      const errorMsg = data.error?.message || `HTTP ${response.status}`;
      throw new Error(`API Hatası: ${errorMsg}`);
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text).join('');
    return text || 'Yanıt alınamadı.';
  } catch (err: any) {
    // AbortError ise tekrar deneme yapma
    if (err.name === 'AbortError') {
      throw err;
    }
    // Ağ hatalarında da retry uygula
    if (attempt <= 3 && (err.message?.includes('network') || err.message?.includes('fetch'))) {
      await sleep(attempt * 1500);
      return callGemini(prompt, attempt + 1, signal);
    }
    throw err;
  }
};

// İlaç Hakkında Genel Bilgi Al
export const getMedicationInfo = async (medicationName: string, lang: LanguageCode = 'tr'): Promise<string> => {
  const prompt = lang === 'en'
    ? `You are an experienced pharmacologist. Provide a structured guide for the medication "${medicationName}". Include two clear sections: 1. What it is used for, 2. Common side effects. Answer in English, keep it concise but complete.`
    : `Sen deneyimli bir farmakologsun. "${medicationName}" ilacı hakkında yapılandırılmış bir kılavuz sağla. İki net bölüm içersin: 1. Ne için kullanılır?, 2. Yaygın yan etkileri nelerdir?. Türkçe yanıtla, öz ama eksiksiz olsun.`;
  
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

const fetchFromBarkodOku = async (barcode: string, signal?: AbortSignal): Promise<string | null> => {
  try {
    const url = `https://www.barkodoku.com/${barcode}`;
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.status !== 200) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      if (title.includes(':')) {
        const parts = title.split(':');
        const name = parts.slice(1).join(':').trim();
        if (name && name.toLowerCase() !== 'null') {
          return name;
        }
      }
    }
    return null;
  } catch (err) {
    return null;
  }
};

const fetchFromYahoo = async (barcode: string, signal?: AbortSignal): Promise<string | null> => {
  try {
    const url = `https://search.yahoo.com/search?p=${barcode}`;
    const response = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (response.status !== 200) return null;
    const html = await response.text();
    
    const linkRegex = /(?:ilacabak|ilactr|ilacrehberi|ilacprospektusu|vademecumonline)[^\s"'`<>]+/gi;
    const matches = html.match(linkRegex);
    if (!matches) return null;

    const foundNames = new Set<string>();
    for (const m of matches) {
      try {
        let decoded = m;
        try {
          decoded = decodeURIComponent(m);
        } catch (_) {
          continue;
        }

        let match;
        if (decoded.includes('ilacabak.com/')) {
          match = decoded.match(/ilacabak\.com\/([a-zA-Z0-9-_\.]+)/);
        } else if (decoded.includes('ilactr.com/ilac/')) {
          match = decoded.match(/ilactr\.com\/ilac\/([a-zA-Z0-9-_\.]+)/);
        } else if (decoded.includes('ilacrehberi.com/v/')) {
          match = decoded.match(/ilacrehberi\.com\/v\/([a-zA-Z0-9-_\.]+)/);
        } else if (decoded.includes('ilacprospektusu.com/ilac/')) {
          match = decoded.match(/ilacprospektusu\.com\/ilac\/([a-zA-Z0-9-_\.]+)/);
        }
        
        if (match && match[1]) {
          let namePart = match[1].replace(/\.html?$/i, '').replace(/-\d+$/g, '');
          namePart = namePart.replace(/[-_]/g, ' ').trim();
          const capitalized = namePart.split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
          
          if (capitalized.length > 3 && !capitalized.toLowerCase().includes('search') && !capitalized.toLowerCase().includes('arama')) {
            foundNames.add(capitalized);
          }
        }
      } catch (e) {
        // Ignore single item parsing errors
      }
    }
    
    const list = Array.from(foundNames);
    if (list.length > 0) {
      return list.sort((a, b) => b.length - a.length)[0];
    }
    return null;
  } catch (err) {
    return null;
  }
};

export interface BarcodeMedicationResult {
  isMedication: boolean;
  name?: string;
  type?: string;     // 'tablet' | 'injection' | 'syrup' | 'cream' | 'drop' | 'spray' | 'patch' | 'other'
  dosage?: string;
  unit?: string;     // 'tablet' | 'kapsül' | 'mg' | 'ml' | 'mcg' | 'g' | 'IU' | 'damla'
  strength?: string;
  notes?: string;
}

// Barkod numarasından ilacı sorgula (Gemini API)
export const identifyMedicationByBarcode = async (
  barcode: string,
  lang: LanguageCode = 'tr',
  signal?: AbortSignal
): Promise<BarcodeMedicationResult> => {
  // 1. Önce internetten ismi kazımayı dene
  let scrapedName = await fetchFromBarkodOku(barcode, signal);
  if (!scrapedName) {
    scrapedName = await fetchFromYahoo(barcode, signal);
  }

  let prompt = '';
  if (scrapedName) {
    prompt = `You are a professional pharmacology assistant. The barcode number "${barcode}" corresponds to the product named "${scrapedName}" according to the database.
Determine if this corresponds to a known human medication (drug/medicine), vaccine, or supplement.
Respond ONLY with a valid JSON object matching the following structure:
{
  "isMedication": boolean (true if it is a real medicine/vaccine or supplement, false otherwise),
  "name": string (the official trade name of the medicine, e.g. "Arveles" or "Parol", capitalized nicely, excluding package count or strength if possible, or null if not a medicine),
  "type": string (must be one of: 'tablet', 'injection', 'syrup', 'cream', 'drop', 'spray', 'patch', 'other', or null if not a medicine),
  "dosage": string (typical single dose quantity, e.g. "1" or "500", or null if not a medicine),
  "unit": string (must be one of: 'tablet', 'kapsül', 'mg', 'ml', 'mcg', 'g', 'IU', 'damla', or null if not a medicine),
  "strength": string (strength/concentration description e.g. "500 mg" or "25 mg" or "20 mg/ml", or null if not a medicine),
  "notes": string (short description or active ingredients of the drug, or null if not a medicine)
}
CRITICAL INSTRUCTIONS:
1. Use the provided product name "${scrapedName}" to extract the medication name, strength, unit, and type.
2. The "name" field should be the clean brand name (e.g., if product name is "ARVELES 25 MG 20 FİLM TABLET", name should be "Arveles").
3. Do not write any explanations before or after the JSON. Only return the JSON.`;
  } else {
    prompt = `You are a professional pharmacology assistant. Analyze the barcode number "${barcode}".
Determine if this barcode corresponds to a known human medication (drug/medicine), vaccine, or supplement.
Respond ONLY with a valid JSON object matching the following structure:
{
  "isMedication": boolean (true if it is a real medicine/vaccine or supplement, false otherwise),
  "name": string (the official trade name of the medicine, capitalized nicely, or null if not a medicine),
  "type": string (must be one of: 'tablet', 'injection', 'syrup', 'cream', 'drop', 'spray', 'patch', 'other', or null if not a medicine),
  "dosage": string (typical single dose quantity, e.g. "1" or "500", or null if not a medicine),
  "unit": string (must be one of: 'tablet', 'kapsül', 'mg', 'ml', 'mcg', 'g', 'IU', 'damla', or null if not a medicine),
  "strength": string (strength/concentration description e.g. "500 mg" or "20 mg/ml", or null if not a medicine),
  "notes": string (short description or active ingredients of the drug, or null if not a medicine)
}
CRITICAL INSTRUCTIONS:
1. Do not hallucinate or guess a drug name if you are not certain. If you don't know the exact medication for this barcode, return {"isMedication": false}.
2. For Turkish barcodes (usually starting with 869 or 868), search for Turkish drugs registered by the Turkish Ministry of Health (TITCK) or popular Turkish supplements.
3. Do not match non-medication products like food supplements, cosmetics, or food to a prescription/OTC drug. If it is a food supplement or vitamin, and you have its exact name, you can return {"isMedication": true, "name": "Exact Supplement Name", ...} but NEVER guess a different drug name. If it is not a medicine or supplement, return {"isMedication": false}.
4. Do not write any explanations before or after the JSON. Only return the JSON.`;
  }

  try {
    const responseText = await callGemini(prompt, 1, signal);
    const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);
    return {
      isMedication: !!result.isMedication,
      name: result.name || undefined,
      type: result.type || undefined,
      dosage: result.dosage?.toString() || undefined,
      unit: result.unit || undefined,
      strength: result.strength || undefined,
      notes: result.notes || undefined,
    };
  } catch (err: any) {
    if (err.isQuotaError || err.name === 'AbortError' || err.message?.includes('API Hatası') || err.message?.includes('quota') || err.message?.includes('exceeded')) {
      throw err;
    }
    return { isMedication: false };
  }
};
