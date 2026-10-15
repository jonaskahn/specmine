import type { CallOptions } from '../types.js';
import type { ContentKind, DomainId, ScopeKind } from '../category/types.js';

export interface Classification {
  kind: ContentKind;
  domain: DomainId;
  scope: ScopeKind;
  visual: boolean;
  confidence: number;
  probabilities?: Record<string, number>;
  source: 'jev' | 'llm' | 'user' | 'fallback';
}

export interface ClassifierOptions extends CallOptions {
  apiKey?: string;
  model?: string;
  minConfidence?: number;
}

export interface ContentClassifier {
  classify(text: string, options?: ClassifierOptions): Promise<Classification>;
}

export const GENERIC_CLASSIFICATION: Classification = {
  kind: 'item_detail',
  domain: 'general',
  scope: 'single',
  visual: true,
  confidence: 0,
  source: 'fallback',
};

export function isKnownKind(value: unknown): value is ContentKind {
  return (
    value === 'item_detail' ||
    value === 'item_collection' ||
    value === 'editorial' ||
    value === 'instructional' ||
    value === 'policy_legal' ||
    value === 'non_content'
  );
}

export function isKnownScope(value: unknown): value is ScopeKind {
  return value === 'single' || value === 'multiple' || value === 'none';
}
