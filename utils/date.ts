/**
 * Formats a date string from YYYY-MM-DD to DD.MM.YYYY
 * @param dateStr Date string in YYYY-MM-DD format
 * @returns Date string in DD.MM.YYYY format or original if invalid
 */
export const formatDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  if (dateStr.includes('.')) return dateStr; // Already formatted
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}.${m}.${y}`;
  }
  return dateStr;
};

/**
 * Parses a date string from DD.MM.YYYY back to YYYY-MM-DD
 */
export const parseDate = (dateStr: string): string => {
  const parts = dateStr.split('.');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y}-${m}-${d}`;
  }
  return dateStr;
};
