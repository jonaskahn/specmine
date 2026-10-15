import type { ResolvedProfile } from '../category/types.js';
import type { PromptDialect } from './dialects.js';
import type { VisualFacts } from './facts.js';
import { sanitizePrompt } from './hygiene.js';

export interface PromptBuildOptions {
  style?: string;
}

function appearanceLine(facts: VisualFacts): string {
  const parts: string[] = [];
  if (facts.shape) parts.push(facts.shape);
  if (facts.proportions) parts.push(facts.proportions);
  if (facts.colors.length > 0) {
    parts.push(
      facts.finish
        ? `${facts.colors.join(', ')} with ${facts.finish} finish`
        : facts.colors.join(', '),
    );
  }
  if (facts.materials.length > 0) parts.push(`made of ${facts.materials.join(', ')}`);
  return parts.join('; ');
}

function featuresLine(facts: VisualFacts): string {
  if (facts.heroFeatures.length === 0) return '';
  return `Key visible features: ${facts.heroFeatures.join('; ')}.`;
}

/**
 * Design-language cue for a known brand, e.g. "Acme-style ". Kept adjacent
 * to the subject (early token weight) and phrased as a style — never as an
 * instruction to render the name, logo or label text, which models garble
 * and filters may block. The blank-label guardrail in the constraints block
 * always pairs with this cue.
 */
function brandCue(facts: VisualFacts): string {
  return facts.brand !== undefined ? `${facts.brand}-style ` : '';
}

function constraintsBlock(recipe: ResolvedProfile['recipe'], dialect: PromptDialect): string {
  const forbidden = recipe.forbidden;
  if (forbidden.length === 0) return '';
  if (dialect.constraintStyle === 'explicit-exclusions') {
    return `Constraints: no ${forbidden.join(', no ')}.`;
  }
  const positive: Record<string, string> = {
    text: 'with a clean unbranded surface and no writing',
    logos: 'unbranded, no logos',
    watermark: 'no watermark',
    people: 'with no people in frame',
    hands: 'with no hands in frame',
    'extra products': 'single item only',
    faces: 'with no faces visible',
    'brand labels': 'with plain unmarked surfaces',
    'brand text': 'with a blank unmarked label and no readable text',
    clutter: 'kept minimal and uncluttered',
    'competing objects': 'single subject only',
    'fake UI': 'abstract shapes only, not a screen mockup',
    screenshots: 'not a screenshot',
    'real people': 'with no people depicted',
    flags: 'with no flags or emblems',
    'signage text': 'with blank unmarked signage',
  };
  const mapped = forbidden.map((item) => positive[item.toLowerCase()] ?? `without ${item}`);
  return `Clean composition, ${mapped.join(', ')}.`;
}

export function buildImagePrompt(
  facts: VisualFacts,
  profile: ResolvedProfile,
  dialect: PromptDialect,
  options?: PromptBuildOptions,
): string {
  const recipe = profile.recipe;
  const style = options?.style ?? profile.defaultStyle;
  const appearance = appearanceLine(facts);
  const features = featuresLine(facts);
  const cue = brandCue(facts);
  const viewpoint = facts.viewpoint ?? recipe.composition;
  const setting = facts.setting ?? recipe.background;
  const constraints = constraintsBlock(recipe, dialect);
  // Constraints ride ahead of the realism tail: sanitizePrompt truncates
  // overflow from the end, and the no-text/no-logo guardrails must never be
  // the first thing dropped.
  if (dialect.format === 'labeled') {
    const sections = [
      `Intent: ${recipe.intentLine}${style ? ` Style: ${style}.` : ''}`,
      `Subject: ${cue}${facts.subject}.`,
      ...(appearance ? [`Appearance: ${appearance}.`] : []),
      ...(features ? [features] : []),
      ...(constraints ? [constraints] : []),
      `Composition: ${viewpoint}.`,
      `Light: ${recipe.light}`,
      `Background: ${setting}.`,
      recipe.realismLine,
      ...recipe.modifiers,
    ];
    return sanitizePrompt(sections.join('\n'), dialect.maxWords);
  }
  const parts = [
    `${recipe.intentLine}${style ? ` ${style}.` : ''}`,
    `${cue}${facts.subject}${appearance ? `, ${appearance}` : ''}.`,
    ...(features ? [features] : []),
    ...(constraints ? [constraints] : []),
    `${viewpoint} ${recipe.light} ${setting}.`,
    `${recipe.realismLine}${recipe.modifiers.length > 0 ? ` ${recipe.modifiers.join(', ')}.` : ''}`,
  ];
  return sanitizePrompt(parts.join(' '), dialect.maxWords);
}
