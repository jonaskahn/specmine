import type { NestedSpecs, SpecsResult } from '../types.js';
import { envelopeToSpecs } from './schema.js';

export interface SpecValidationResult {
  spec?: SpecsResult;
  errors: string[];
}

export interface SpecValidator {
  validate(raw: string): SpecValidationResult;
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSpec(value: unknown, errors: string[], path: string): boolean {
  if (typeof value === 'string') return true;
  if (isRecord(value)) {
    let valid = true;
    for (const key of Object.keys(value)) {
      if (!isValidSpec(value[key], errors, path === '' ? key : `${path}.${key}`)) {
        valid = false;
      }
    }
    return valid;
  }
  errors.push(`Value at '${path === '' ? '<root>' : path}' must be a string or nested object`);
  return false;
}

export class JsonSpecValidator implements SpecValidator {
  validate(raw: string): SpecValidationResult {
    const errors: string[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      errors.push('Response is not valid JSON');
      return { errors };
    }
    if (!isRecord(parsed)) {
      errors.push('Response is not a JSON object');
      return { errors };
    }
    const envelope = envelopeToSpecs(parsed);
    if (envelope !== undefined) {
      return { spec: envelope, errors: [] };
    }
    if (isValidSpec(parsed, errors, '')) {
      return { spec: parsed as NestedSpecs, errors: [] };
    }
    return { errors };
  }
}
