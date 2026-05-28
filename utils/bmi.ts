import { LanguageCode } from '../constants/translations';

export interface BmiResult {
  bmi: number;
  category: string;
  color: string; // UI badge/text color
}

export const calculateBmi = (weightKg: number, heightCm: number, lang: LanguageCode = 'tr'): BmiResult | null => {
  if (!weightKg || !heightCm || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  
  let category = '';
  let color = '#10B981'; // default success (green)
  
  if (bmi < 18.5) {
    category = lang === 'tr' ? 'Zayıf' : 'Underweight';
    color = '#3B82F6'; // blue
  } else if (bmi < 25) {
    category = lang === 'tr' ? 'Normal Kilolu' : 'Normal Weight';
    color = '#10B981'; // green
  } else if (bmi < 30) {
    category = lang === 'tr' ? 'Fazla Kilolu' : 'Overweight';
    color = '#F59E0B'; // orange
  } else if (bmi < 35) {
    category = lang === 'tr' ? 'Obez (Sınıf 1)' : 'Obese (Class 1)';
    color = '#EF4444'; // red
  } else {
    category = lang === 'tr' ? 'Aşırı Obez (Sınıf 2+)' : 'Severely Obese (Class 2+)';
    color = '#7C3AED'; // purple
  }
  
  return {
    bmi: Math.round(bmi * 10) / 10,
    category,
    color
  };
};
