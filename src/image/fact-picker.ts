import type { SlotKeyMap, VisualSlot } from '../category/types.js';
import type { SpecsResult } from '../types.js';
import type { VisualFacts } from './facts.js';
import { sanitizeFactsText, stripMarketing, stripMeasurements } from './hygiene.js';

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

/** values that can never be drawn: prices, SKUs, urls, or bare measurements */
const MEASURE_ONLY = /^\d[\d\s.,/-]*[a-zA-Z%°]*$/;

function isDrawableValue(value: string): boolean {
  const clean = value.trim();
  if (!clean || clean.length > 80) return false;
  if (sanitizeFactsText(clean) !== clean) return false;
  if (MEASURE_ONLY.test(clean)) return false;
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
  const subject = pickFirst(leaves, sets.subject) ?? tags[0] ?? fallbackSubject;
  const colorValue = pickFirst(leaves, sets.color);
  const materialValue = pickFirst(leaves, sets.material);
  const shape = pickFirst(leaves, sets.shape);
  const finish = pickFirst(leaves, sets.finish);
  const heroFeatures = leaves
    .filter(([key]) => {
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
  return facts;
}
