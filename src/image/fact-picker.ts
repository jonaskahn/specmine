import type { SpecsResult } from '../types.js';
import type { VisualFacts } from './facts.js';

const COLOR_KEYS = new Set(
  [
    'color',
    'colour',
    'farbe',
    'couleur',
    'colore',
    'colorway',
    'finish color',
    'mau sac',
    'màu sắc',
    '色',
  ].map((key) => key.toLowerCase()),
);

const MATERIAL_KEYS = new Set(
  [
    'material',
    'materials',
    'materialien',
    'materiale',
    'matiere',
    'matière',
    'fabric',
    'stoff',
    'tissu',
    'composition',
    'fabric composition',
    'chat lieu',
    'chất liệu',
    '材质',
  ].map((key) => key.toLowerCase()),
);

const SHAPE_KEYS = new Set(
  ['shape', 'form', 'silhouette', 'design', 'style', 'cut', 'fit', ' dáng', 'hình dáng'].map(
    (key) => key.trim().toLowerCase(),
  ),
);

const FINISH_KEYS = new Set(
  ['finish', 'oberfläche', 'surface', 'texture', 'finition', 'bề mặt'].map((key) =>
    key.toLowerCase(),
  ),
);

const SUBJECT_KEYS = new Set(
  [
    'product',
    'name',
    'title',
    'model',
    'model number',
    'brand',
    'marke',
    'marque',
    'marca',
    'thuong hieu',
    'thương hiệu',
    'produkt',
    'produit',
    'sản phẩm',
    'product name',
    'item',
  ].map((key) => key.toLowerCase()),
);

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

function pickFirst(leaves: Array<[string, string]>, keys: Set<string>): string | undefined {
  for (const [key, value] of leaves) {
    const leaf = key.split(' ').slice(-2).join(' ');
    if (keys.has(key.toLowerCase()) || keys.has(leaf.toLowerCase())) return value;
    for (const candidate of keys) {
      if (key.toLowerCase().includes(candidate)) return value;
    }
  }
  return undefined;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;/|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 4);
}

export function pickVisualFacts(
  spec: SpecsResult,
  tags: string[] = [],
  fallbackSubject = 'product',
): VisualFacts {
  const leaves = flattenLeaves(spec);
  const subject = pickFirst(leaves, SUBJECT_KEYS) ?? tags[0] ?? fallbackSubject;
  const colorValue = pickFirst(leaves, COLOR_KEYS);
  const materialValue = pickFirst(leaves, MATERIAL_KEYS);
  const shape = pickFirst(leaves, SHAPE_KEYS);
  const finish = pickFirst(leaves, FINISH_KEYS);
  const heroFeatures = leaves
    .filter(([, value]) => value.length > 0 && value.length <= 80)
    .slice(0, 12)
    .map(([, value]) => value)
    .filter((value) => value !== subject);
  const facts: VisualFacts = {
    subject,
    colors: splitList(colorValue),
    materials: splitList(materialValue),
    heroFeatures: heroFeatures.slice(0, 4),
  };
  if (shape) facts.shape = shape;
  if (finish) facts.finish = finish;
  return facts;
}
