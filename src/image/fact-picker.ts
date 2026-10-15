import type { SlotKeyMap, VisualSlot } from '../category/types.js';
import type { SpecsResult } from '../types.js';
import type { VisualFacts } from './facts.js';
import {
  isMeasureOnly,
  sanitizeBrandName,
  sanitizeFactsText,
  stripMarketing,
  stripMeasurements,
} from './hygiene.js';

function flattenLeaves(
  spec: SpecsResult,
  prefix = '',
  out: Array<[string, string]> = [],
): Array<[string, string]> {
  for (const [key, value] of Object.entries(spec)) {
    if (typeof value === 'string') {
      out.push([prefix ? `${prefix} ${key}` : key, value]);
    } else {
      flattenLeaves(value, prefix ? `${prefix} ${key}` : key, out);
    }
  }
  return out;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;/|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 4);
}

function toKeySet(keys: string[]): Set<string> {
  return new Set(keys.map((key) => key.trim().toLowerCase()));
}

function matchesKey(path: string, keys: Set<string>): boolean {
  const lower = path.toLowerCase();
  const leaf = path.split(' ').slice(-2).join(' ').toLowerCase();
  if (keys.has(lower) || keys.has(leaf)) return true;
  for (const candidate of keys) {
    if (lower.includes(candidate)) return true;
  }
  return false;
}

function pickFirst(leaves: Array<[string, string]>, keys: Set<string>): string | undefined {
  for (const [key, value] of leaves) {
    if (matchesKey(key, keys)) return value;
  }
  return undefined;
}

/**
 * Manufacturer/brand keys across major languages. Matched on the full path
 * or the trailing words only, so generic keys like "brand labels" never
 * count as a brand. English covers romanized usage elsewhere.
 */
const BRAND_KEYS = new Set([
  // English
  'brand',
  'brand name',
  'manufacturer',
  'maker',
  'trademark',
  // Mandarin Chinese
  '品牌',
  '制造商',
  '厂家',
  '厂商',
  // Hindi
  'ब्रांड',
  'निर्माता',
  // Spanish
  'marca',
  'fabricante',
  // French
  'marque',
  'fabricant',
  // Arabic
  'العلامة التجارية',
  'الماركة',
  'الشركة المصنعة',
  'الصانع',
  // Bengali
  'ব্র্যান্ড',
  'প্রস্তুতকারক',
  // Portuguese
  'fabricante',
  // Russian
  'бренд',
  'марка',
  'производитель',
  // Urdu
  'برانڈ',
  'تیار کنندہ',
  // Indonesian
  'merek',
  'produsen',
  'pabrikan',
  // German
  'marke',
  'markenname',
  'hersteller',
  // Japanese
  'ブランド',
  'メーカー',
  '製造元',
  // Vietnamese
  'thuong hieu',
  'thương hiệu',
  'nhà sản xuất',
  'hãng',
  // Turkish
  'marka',
  'üretici',
  // Korean
  '브랜드',
  '제조사',
  // Italian
  'produttore',
  'fabbricante',
  // Dutch
  'merk',
  'fabrikant',
]);

function matchesBrandKey(path: string): boolean {
  const lower = path.toLowerCase();
  for (const key of BRAND_KEYS) {
    if (lower === key || lower.endsWith(` ${key}`)) return true;
  }
  return false;
}

/** first subject-slot value that does not name the manufacturer. */
function pickSubject(leaves: Array<[string, string]>, keys: Set<string>): string | undefined {
  for (const [key, value] of leaves) {
    if (!matchesBrandKey(key) && matchesKey(key, keys)) return value;
  }
  return undefined;
}

/** values that can never be drawn: prices, SKUs, urls, or bare measurements */
function isDrawableValue(value: string): boolean {
  const clean = value.trim();
  if (!clean || clean.length > 80) return false;
  if (sanitizeFactsText(clean) !== clean) return false;
  if (isMeasureOnly(clean)) return false;
  return true;
}

function cleanValue(value: string): string {
  return stripMeasurements(stripMarketing(value), false).trim();
}

export function pickVisualFacts(
  spec: SpecsResult,
  tags: string[] = [],
  fallbackSubject = 'product',
  keyMap?: Partial<SlotKeyMap>,
): VisualFacts {
  const sets = {
    subject: toKeySet(keyMap?.subject ?? []),
    color: toKeySet(keyMap?.color ?? []),
    material: toKeySet(keyMap?.material ?? []),
    shape: toKeySet(keyMap?.shape ?? []),
    finish: toKeySet(keyMap?.finish ?? []),
  };
  const leaves = flattenLeaves(spec);
  const brandLeaf = leaves.find(([key]) => matchesBrandKey(key));
  const brand = sanitizeBrandName(brandLeaf?.[1]);
  const subject = pickSubject(leaves, sets.subject) ?? tags[0] ?? fallbackSubject;
  const colorValue = pickFirst(leaves, sets.color);
  const materialValue = pickFirst(leaves, sets.material);
  const shape = pickFirst(leaves, sets.shape);
  const finish = pickFirst(leaves, sets.finish);
  const heroFeatures = leaves
    .filter(([key]) => {
      // Brand-keyed leaves are never depictable features, in any language.
      if (matchesBrandKey(key)) return false;
      const lower = key.toLowerCase();
      for (const slot of Object.keys(sets) as VisualSlot[]) {
        if (matchesKey(lower, sets[slot])) return false;
      }
      return true;
    })
    .map(([, value]) => value)
    .filter((value) => value !== subject && isDrawableValue(value))
    .map((value) => cleanValue(value))
    .filter((value) => value.length > 0)
    .slice(0, 12);
  const facts: VisualFacts = {
    subject,
    colors: splitList(colorValue)
      .map((value) => cleanValue(value))
      .filter((v) => v.length > 0),
    materials: splitList(materialValue)
      .map((value) => cleanValue(value))
      .filter((v) => v.length > 0),
    heroFeatures: heroFeatures.slice(0, 4),
  };
  const cleanShape = shape ? cleanValue(shape) : '';
  if (cleanShape) facts.shape = cleanShape;
  const cleanFinish = finish ? cleanValue(finish) : '';
  if (cleanFinish) facts.finish = cleanFinish;
  if (brand !== undefined) facts.brand = brand;
  return facts;
}
