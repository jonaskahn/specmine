import type { NestedSpecs } from '../types.js';

export interface SpecEnvelopeItem {
  key: string;
  value: string;
  children: SpecEnvelopeItem[];
}

export interface SpecEnvelope {
  specs: SpecEnvelopeItem[];
  tags?: string[];
}

export const SPECS_SCHEMA = {
  type: 'object',
  properties: {
    specs: {
      type: 'array',
      items: { $ref: '#/$defs/spec_item' },
    },
  },
  required: ['specs'],
  additionalProperties: false,
  $defs: {
    spec_item: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
        children: {
          type: 'array',
          items: { $ref: '#/$defs/spec_item' },
        },
      },
      required: ['key', 'value', 'children'],
      additionalProperties: false,
    },
  },
} as const;

export const TAGGED_SPECS_SCHEMA = {
  ...SPECS_SCHEMA,
  properties: {
    ...SPECS_SCHEMA.properties,
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['specs', 'tags'],
} as const;

export const TAGS_ONLY_SCHEMA = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['tags'],
  additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpecItem(value: unknown): value is SpecEnvelopeItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.value === 'string' &&
    Array.isArray(value.children)
  );
}

function parseTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') return undefined;
    result.push(tag);
  }
  return result;
}

export function envelopeToSpecs(envelope: unknown): NestedSpecs | undefined {
  if (!isRecord(envelope) || !Array.isArray(envelope.specs)) return undefined;
  const result: NestedSpecs = {};
  for (const item of envelope.specs) {
    if (!isSpecItem(item)) return undefined;
    const children = envelopeToSpecs({ specs: item.children });
    if (children === undefined) return undefined;
    result[item.key] = Object.keys(children).length > 0 ? children : item.value;
  }
  return result;
}

export function envelopeToResult(
  envelope: unknown,
): { spec: NestedSpecs; tags: string[] } | undefined {
  if (!isRecord(envelope)) return undefined;
  const hasSpecs = Array.isArray(envelope.specs);
  const hasTags = envelope.tags !== undefined;
  if (!hasSpecs && !hasTags) return undefined;
  if (!hasSpecs) {
    const tags = parseTags(envelope.tags);
    if (tags === undefined) return undefined;
    return { spec: {}, tags };
  }
  const spec = envelopeToSpecs(envelope);
  if (spec === undefined) return undefined;
  const tags = hasTags ? parseTags(envelope.tags) : [];
  if (tags === undefined) return undefined;
  return { spec, tags };
}
