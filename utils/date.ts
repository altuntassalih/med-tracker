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

/**
 * Returns a YYYY-MM-DD string based on local time to prevent UTC timezone offset bugs
 */
export const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};
