import { familyOf, listDomains } from '../category/registry.js';
import type { DomainId } from '../category/types.js';
import type { LlmProvider } from '../llm/provider.js';
import { logger } from '../log.js';
import {
  GENERIC_CLASSIFICATION,
  isKnownKind,
  isKnownScope,
  type Classification,
  type ClassifierOptions,
  type ContentClassifier,
} from './classifier.js';

export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    domain: { type: 'string' },
    scope: { type: 'string' },
    visual: { type: 'boolean' },
  },
  required: ['kind', 'domain', 'scope', 'visual'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT =
  'You are a fast content router. Reply with a single JSON object and nothing else: {"kind","domain","scope","visual"}. kind is one of item_detail,item_collection,editorial,instructional,policy_legal,non_content. scope is one of single,multiple,none. visual is true when the content describes something depictable in a picture.';

function userPrompt(text: string, domains: DomainId[]): string {
  return `Domains: ${domains.join(', ')}. Classify this content (first 6000 chars):\n\n${text.slice(0, 6000)}`;
}

export class LlmClassifier implements ContentClassifier {
  constructor(private readonly llm: LlmProvider) {}

  async classify(text: string, options?: ClassifierOptions): Promise<Classification> {
    let raw: string;
    try {
      const response = await this.llm.complete(
        {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(text, listDomains()) },
          ],
          schema: CLASSIFY_SCHEMA,
          schemaName: 'classify_content',
          ...(options?.model !== undefined ? { model: options.model } : {}),
        },
        options,
      );
      raw = response.content;
    } catch {
      logger().warn('LLM classification failed, using generic classification');
      return { ...GENERIC_CLASSIFICATION };
    }
    try {
      const parsed = JSON.parse(raw) as {
        kind?: unknown;
        domain?: unknown;
        scope?: unknown;
        visual?: unknown;
      };
      if (!isKnownKind(parsed.kind) || !isKnownScope(parsed.scope)) {
        return { ...GENERIC_CLASSIFICATION };
      }
      const domain: DomainId = listDomains().includes(parsed.domain as DomainId)
        ? (parsed.domain as DomainId)
        : 'general';
      void familyOf(domain);
      return {
        kind: parsed.kind,
        domain,
        scope: parsed.scope,
        visual: parsed.visual !== false,
        confidence: 0.5,
        source: 'llm',
      };
    } catch {
      return { ...GENERIC_CLASSIFICATION };
    }
  }
}
