import { ARCHETYPE_RECIPES } from '../category/archetypes.js';
import type { ResolvedProfile } from '../category/types.js';
import type { LlmProvider } from '../llm/provider.js';
import { logger } from '../log.js';
import type { CallOptions, ImageGrounding } from '../types.js';
import { parseVisualFacts, VISUAL_FACTS_SCHEMA, type VisualFacts } from './facts.js';
import { sanitizeFactsText, stripMarketing } from './hygiene.js';

const SHAPE_LINE =
  'Respond with a single JSON object and nothing else: {"subject": "...", "shape": "...", "proportions": "...", "colors": ["..."], "materials": ["..."], "finish": "...", "heroFeatures": ["..."], "viewpoint": "...", "setting": "...", "brand": "<manufacturer/brand name if stated, else "">"}. Use "" or [] for anything unknown. A stated brand goes ONLY in "brand" — never inside subject, heroFeatures, or other descriptive text.';

const COMMON_RULES =
  'Never include people, faces, logos, readable text, prices, phone numbers, URLs or numbers in descriptive fields. Your output feeds an image-generation prompt and is never read by a person.';

const CONTEXTUAL_SYSTEM = `You are a visual-brief engine. From the content, describe the real place, scene or object it is about as a photographer would shoot it.
Use only what the content states, or the obvious generic type of the subject (for example "townhouse exterior with a rooftop terrace"). Fill "subject" with a concrete noun phrase and "setting" with the surroundings. ${COMMON_RULES}
${SHAPE_LINE}`;

const CONCEPTUAL_SYSTEM = `You are a visual-brief engine for abstract topics (software, courses, events, news, science, plans, policies).
Pick ONE tasteful visual metaphor for the topic, such as an object, landscape or simple composition, that represents the idea without claiming any specific fact. "subject" is the metaphor object or scene, "colors" is a palette of one to three colors, "setting" is a calm backdrop. ${COMMON_RULES}
${SHAPE_LINE}`;

export interface LadderResult {
  facts: VisualFacts;
  grounding: ImageGrounding;
  profile: ResolvedProfile;
}

export interface LadderInput {
  text: string;
  profile: ResolvedProfile;
  llm: LlmProvider;
  /** product-literal facts; undefined when too thin */
  literal: () => Promise<VisualFacts | undefined>;
  model?: string;
  call: CallOptions;
}

function withRecipe(profile: ResolvedProfile, id: keyof typeof ARCHETYPE_RECIPES): ResolvedProfile {
  return { ...profile, recipe: ARCHETYPE_RECIPES[id] };
}

async function briefFacts(
  system: string,
  input: LadderInput,
  label: string,
): Promise<VisualFacts | undefined> {
  try {
    const response = await input.llm.complete(
      {
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Domain: ${input.profile.domain}.\n\nContent:\n${input.text.slice(0, 4000)}`,
          },
        ],
        schema: VISUAL_FACTS_SCHEMA,
        schemaName: 'visual_brief',
        ...(input.model !== undefined ? { model: input.model } : {}),
      },
      input.call,
    );
    return parseVisualFacts(JSON.parse(response.content)) ?? undefined;
  } catch {
    logger().warn(`${label} brief failed`);
    return undefined;
  }
}

export function neutralFacts(text: string, fallbackNoun: string): VisualFacts {
  const first = text.split('\n').find((line) => line.trim().length > 0) ?? '';
  const title = stripMarketing(sanitizeFactsText(first.replace(/[#*_>`]/g, ' ')))
    .replace(/\d+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
  return {
    subject: title.length >= 3 ? title : fallbackNoun,
    colors: [],
    materials: [],
    heroFeatures: [],
  };
}

const ABSTRACT = new Set(['abstract_hero', 'editorial_concept']);

export async function resolveGroundedFacts(input: LadderInput): Promise<LadderResult> {
  const literal = await input.literal();
  if (literal) return { facts: literal, grounding: 'literal', profile: input.profile };
  const abstract = ABSTRACT.has(input.profile.recipe.id);
  if (!abstract) {
    const contextual = await briefFacts(CONTEXTUAL_SYSTEM, input, 'Contextual');
    if (contextual) {
      return { facts: contextual, grounding: 'contextual', profile: input.profile };
    }
  }
  const conceptual = await briefFacts(CONCEPTUAL_SYSTEM, input, 'Conceptual');
  if (conceptual) {
    // Abstract metaphors stay unbranded: no design-language cue applies.
    delete conceptual.brand;
    return {
      facts: conceptual,
      grounding: 'conceptual',
      profile: withRecipe(input.profile, abstract ? input.profile.recipe.id : 'editorial_concept'),
    };
  }
  return {
    facts: neutralFacts(input.text, input.profile.subjectNoun),
    grounding: 'neutral',
    profile: withRecipe(input.profile, 'generic_subject'),
  };
}
