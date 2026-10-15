export interface VisualFacts {
  subject: string;
  shape?: string;
  proportions?: string;
  colors: string[];
  materials: string[];
  finish?: string;
  heroFeatures: string[];
  viewpoint?: string;
  setting?: string;
  /**
   * Stated manufacturer/brand name. Rendered only as a "<brand>-style design
   * language" cue — never as a request to draw the name, logo or label text.
   */
  brand?: string;
}

export interface VisualFactsInput {
  subject?: unknown;
  shape?: unknown;
  proportions?: unknown;
  colors?: unknown;
  materials?: unknown;
  finish?: unknown;
  heroFeatures?: unknown;
  viewpoint?: unknown;
  setting?: unknown;
  brand?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const clean = asString(entry);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

export const VISUAL_FACTS_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    shape: { type: 'string' },
    proportions: { type: 'string' },
    colors: { type: 'array', items: { type: 'string' } },
    materials: { type: 'array', items: { type: 'string' } },
    finish: { type: 'string' },
    heroFeatures: { type: 'array', items: { type: 'string' } },
    viewpoint: { type: 'string' },
    setting: { type: 'string' },
    brand: { type: 'string' },
  },
  // Strict structured-output backends (e.g. Azure via LiteLLM) require every
  // property to be listed here. Unknown optionals use "" or [] — the parser
  // treats those as absent, so grounding is unchanged.
  required: [
    'subject',
    'shape',
    'proportions',
    'colors',
    'materials',
    'finish',
    'heroFeatures',
    'viewpoint',
    'setting',
    'brand',
  ],
  additionalProperties: false,
} as const;

import { sanitizeBrandName } from './hygiene.js';

export function parseVisualFacts(input: unknown): VisualFacts | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const raw = input as VisualFactsInput;
  const subject = asString(raw.subject);
  if (!subject) return undefined;
  const facts: VisualFacts = {
    subject,
    colors: asStringList(raw.colors),
    materials: asStringList(raw.materials),
    heroFeatures: asStringList(raw.heroFeatures).slice(0, 4),
  };
  const shape = asString(raw.shape);
  if (shape) facts.shape = shape;
  const proportions = asString(raw.proportions);
  if (proportions) facts.proportions = proportions;
  const finish = asString(raw.finish);
  if (finish) facts.finish = finish;
  const viewpoint = asString(raw.viewpoint);
  if (viewpoint) facts.viewpoint = viewpoint;
  const setting = asString(raw.setting);
  if (setting) facts.setting = setting;
  const brand = sanitizeBrandName(raw.brand);
  if (brand !== undefined) facts.brand = brand;
  return facts;
}

export function countFilledSlots(facts: VisualFacts): number {
  let count = 1;
  if (facts.shape ?? facts.proportions) count += 1;
  if (facts.colors.length > 0) count += 1;
  if (facts.materials.length > 0) count += 1;
  if (facts.heroFeatures.length > 0) count += 1;
  return count;
}

export function hasEnoughFacts(facts: VisualFacts, minimum = 3): boolean {
  return countFilledSlots(facts) >= minimum;
}
