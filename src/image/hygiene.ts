const PRICE_PATTERN = /[$€£¥]\s?[\d.,]+|[\d.,]+\s?(USD|EUR|VND|JPY|GBP)\b/gi;
const SKU_PATTERN = /\b(sku|asin|ean|upc|isbn|part\s?no|model\s?no)\s*[:#]?\s*[\w-]+/gi;
const URL_PATTERN = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|\+?[\d][\d\s().-]{7,}/g;
const MEASURE_PATTERN =
  /\b\d[\d.,]*\s?(kg|g|mg|lb|oz|mm|cm|m|km|inch|in|ft|ml|l|cl|w|kw|v|mah|gb|tb|mp|hz|dpi)\b/gi;
const MARKETING_WORDS = [
  'best',
  'best-selling',
  'bestseller',
  'premium',
  'innovative',
  'revolutionary',
  'cutting-edge',
  'amazing',
  'incredible',
  'ultimate',
  'unbeatable',
];

export function sanitizeFactsText(value: string): string {
  return value
    .replace(PRICE_PATTERN, '')
    .replace(SKU_PATTERN, '')
    .replace(URL_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function stripMeasurements(value: string, keepGeometry: boolean): string {
  if (keepGeometry) return value;
  return value
    .replace(MEASURE_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s([,;.])/g, '$1')
    .trim();
}

export function stripMarketing(value: string): string {
  let out = value;
  for (const word of MARKETING_WORDS) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s([,;.])/g, '$1')
    .trim();
}

export function sanitizePrompt(prompt: string, maxWords: number): string {
  let out = sanitizeFactsText(stripMarketing(prompt));
  const words = out.split(/\s+/).filter((word) => word.length > 0);
  if (words.length > maxWords) {
    out = words.slice(0, maxWords).join(' ');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function containsForbiddenNumbers(prompt: string): boolean {
  PRICE_PATTERN.lastIndex = 0;
  SKU_PATTERN.lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  return PRICE_PATTERN.test(prompt) || SKU_PATTERN.test(prompt) || URL_PATTERN.test(prompt);
}
