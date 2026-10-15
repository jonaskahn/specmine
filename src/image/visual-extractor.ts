import type { ResolvedProfile } from '../category/types.js';
import type { LlmProvider } from '../llm/provider.js';
import { logger } from '../log.js';
import type { CallOptions } from '../types.js';
import {
  hasEnoughFacts,
  parseVisualFacts,
  VISUAL_FACTS_SCHEMA,
  type VisualFacts,
} from './facts.js';

const VISUAL_SYSTEM_PROMPT = `You are a visual-facts extraction engine inside an automated product-rendering pipeline. Your output is consumed directly by code that builds an image-generation prompt, never read by a person.
Extract ONLY visually depictable facts explicitly stated in the content — never infer, assume or fabricate. Internal or non-visual attributes (capacity, weight, voltage, price, SKU, warranty) must be excluded. Each fact must be traceable to text actually present in the content; when in doubt, omit it. If the content states a manufacturer or brand name, put it ONLY in "brand" — never inside subject, heroFeatures, or other descriptive text. The pipeline renders it as a "<brand>-style design language" cue with a blank unmarked label, never as drawn text or a logo.
Respond with a single JSON object and nothing else: {"subject": "<concrete product noun>", "shape": "<shape>", "proportions": "<proportions>", "colors": ["<color with finish>"], "materials": ["<material>"], "finish": "<matte/glossy/...>", "heroFeatures": ["<visible part, max 4>"], "viewpoint": "<angle if stated>", "setting": "<setting if stated>", "brand": "<manufacturer/brand name if stated>"}. Use "" or [] for anything unstated rather than guessing.`;

export function buildVisualPrompts(profile: ResolvedProfile): { system: string; slots: string } {
  const slots = profile.visualSlots.length > 0 ? profile.visualSlots : profile.familyVisualSlots;
  const lines = [
    VISUAL_SYSTEM_PROMPT,
    `Subject: a ${profile.subjectNoun} in ${profile.domain} content.`,
    `Depictable fields to fill: ${slots.join(', ')}.`,
  ];
  if (profile.notDepictable.length > 0) {
    lines.push(`Never depict or include: ${profile.notDepictable.join(', ')}.`);
  }
  return { system: lines.join('\n'), slots: slots.join(', ') };
}

export interface VisualExtractOptions extends CallOptions {
  model?: string;
  /** minimum filled slots before facts are accepted. Default: 1 */
  minFacts?: number;
}

export class VisualExtractor {
  constructor(private readonly llm: LlmProvider) {}

  async extract(
    text: string,
    profile: ResolvedProfile,
    options?: VisualExtractOptions,
  ): Promise<VisualFacts | undefined> {
    const slices = text.slice(0, 6000);
    const prompts = buildVisualPrompts(profile);
    const user = `${prompts.slots}\n\nContent:\n${slices}`;
    let raw: string;
    try {
      const response = await this.llm.complete(
        {
          messages: [
            { role: 'system', content: prompts.system },
            { role: 'user', content: user },
          ],
          schema: VISUAL_FACTS_SCHEMA,
          schemaName: 'visual_facts',
          ...(options?.model !== undefined ? { model: options.model } : {}),
        },
        options,
      );
      raw = response.content;
    } catch {
      logger().warn('Visual facts extraction failed');
      return undefined;
    }
    try {
      const facts = parseVisualFacts(JSON.parse(raw));
      if (!facts) {
        logger().warn('Visual facts unparseable');
        return undefined;
      }
      if (!hasEnoughFacts(facts, options?.minFacts ?? 1)) {
        logger().warn('Visual facts too thin, refusing');
        return undefined;
      }
      logger().info('Visual facts extracted', { features: facts.heroFeatures.length });
      return facts;
    } catch {
      logger().warn('Visual facts invalid JSON');
      return undefined;
    }
  }
}
