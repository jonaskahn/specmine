export type PromptDialectId = 'gpt-image' | 'dalle3' | 'flux' | 'sd' | 'generic';

export interface PromptDialect {
  id: PromptDialectId;
  format: 'labeled' | 'paragraph';
  constraintStyle: 'explicit-exclusions' | 'positive-only';
  maxWords: number;
  supportsNegativePrompt: boolean;
}

export const PROMPT_DIALECTS: Record<PromptDialectId, PromptDialect> = {
  'gpt-image': {
    id: 'gpt-image',
    format: 'labeled',
    constraintStyle: 'explicit-exclusions',
    maxWords: 180,
    supportsNegativePrompt: false,
  },
  dalle3: {
    id: 'dalle3',
    format: 'paragraph',
    constraintStyle: 'positive-only',
    maxWords: 150,
    supportsNegativePrompt: false,
  },
  flux: {
    id: 'flux',
    format: 'paragraph',
    constraintStyle: 'positive-only',
    maxWords: 220,
    supportsNegativePrompt: false,
  },
  sd: {
    id: 'sd',
    format: 'paragraph',
    constraintStyle: 'positive-only',
    maxWords: 150,
    supportsNegativePrompt: true,
  },
  generic: {
    id: 'generic',
    format: 'paragraph',
    constraintStyle: 'positive-only',
    maxWords: 150,
    supportsNegativePrompt: false,
  },
};

export function guessDialect(model: string | undefined): PromptDialect {
  const name = (model ?? '').toLowerCase();
  if (name.includes('gpt-image')) return PROMPT_DIALECTS['gpt-image'];
  if (name.includes('dall-e') || name.includes('dalle')) return PROMPT_DIALECTS.dalle3;
  if (name.includes('flux')) return PROMPT_DIALECTS.flux;
  if (
    name.includes('stable-diffusion') ||
    name.includes('stability') ||
    name.includes('sdxl') ||
    name.includes('sd3')
  ) {
    return PROMPT_DIALECTS.sd;
  }
  return PROMPT_DIALECTS.generic;
}
