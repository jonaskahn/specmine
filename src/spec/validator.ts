import { logger } from '../log.js';
import type { NestedSpecs, SpecsResult, TagsResult } from '../types.js';
import { envelopeToResult } from './schema.js';

export interface SpecValidationResult {
  spec?: SpecsResult;
  /** tags parsed from a structured-output envelope; empty when the response has none */
  tags: TagsResult;
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
      logger().debug('Invalid LLM output', { errors: ['Response is not valid JSON'] });
      errors.push('Response is not valid JSON');
      return { tags: [], errors };
    }
    if (!isRecord(parsed)) {
      logger().debug('Invalid LLM output', { errors: ['Response is not a JSON object'] });
      errors.push('Response is not a JSON object');
      return { tags: [], errors };
    }
    const result = envelopeToResult(parsed);
    if (result !== undefined) {
      return { spec: result.spec, tags: result.tags, errors: [] };
    }
    if (isValidSpec(parsed, errors, '')) {
      return { spec: parsed as NestedSpecs, tags: [], errors: [] };
    }
    logger().debug('Invalid LLM output', { errors });
    return { tags: [], errors };
  }
}
