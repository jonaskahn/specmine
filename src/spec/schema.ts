import type { NestedSpecs } from '../types.js';

export interface SpecEnvelopeItem {
  key: string;
  value: string;
  children: SpecEnvelopeItem[];
}

export interface SpecEnvelope {
  specs: SpecEnvelopeItem[];
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
