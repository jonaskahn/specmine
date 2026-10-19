import { ExtractionError } from './errors.js';
import { detectLanguage } from './input/language.js';
import { DefaultReader, type InputKind, type InputReader } from './input/reader.js';
import { NapiPdfInspector } from './input/napi-pdf-inspector.js';
import { createAnthropicProvider } from './llm/anthropic.js';
import { createOpenAiProvider } from './llm/openai.js';
import type { LlmMessage, LlmProvider, LlmRequest } from './llm/provider.js';
import { logger } from './log.js';
import { buildSystemPrompt, type PromptMode } from './prompts/spec.js';
import { JsonSpecValidator, type SpecValidator } from './spec/validator.js';
import type { ResolvedProfile } from './category/types.js';
import type {
  ExtractInput,
  ExtractOptions,
  NestedSpecs,
  ProductSpec,
  SpecsResult,
  TaggedResult,
  TagsResult,
  CallOptions,
} from './types.js';

export interface Extractor {
  extract<I extends ExtractInput, O extends ExtractOptions | undefined>(
    input: I,
    options?: O,
  ): Promise<O extends { tags: true } ? TaggedResult : SpecsResult>;
  extractTags(input: ExtractInput, options?: ExtractOptions): Promise<TagsResult>;
}

export interface ExtractorDependencies {
  reader: InputReader;
  llm: LlmProvider;
  validator: SpecValidator;
}

/**
 * Prompt design notes (from the prompt-consistency research these replace):
 * - `flattenSpecs`/`flattenInnermostPairs` below operate on a plain nested object
 *   (`Record<string, string | NestedSpecs>`) — a leaf is a string, a group is a
 *   nested object one level down. The prompts are written to that exact contract:
 *   no wrapper key, no array-of-nodes/"children" shape. If `JsonSpecValidator`
 *   itself expects or coerces a different raw shape, the "Output shape" block in
 *   each prompt below is the one place to change.
 * - CORE_TAXONOMY is an illustrative starting set, not the real catalog schema —
 *   extend it with the attributes that actually recur across the catalog. There's
 *   no per-tenant injection point yet since `ExtractOptions` doesn't expose one;
 *   adding `taxonomy` there is the natural next step if per-org key sets turn out
 *   to be needed, but that's a `types.ts` change and out of scope here.
 * - Determinism, tag ordering, tag specificity and hallucination-avoidance are each
 *   their own instruction — bundling them into one sentence is the under-specification
 *   that produced the original drift. Pair this with temperature: 0 at the call site
 *   and with downstream JSON-shape validation, since prompt-only determinism has a
 *   ceiling.
 * - Tag casing, count, and atomicity live in TAG_FORMAT_BLOCK, referenced by both
 *   the tags-only and specs-and-tags prompts. They used to be worded only in the
 *   tags-only task line, which is exactly how the two prompts drifted apart on a
 *   real input (one produced "Acme Kettle"/"Kettle", the other "acme"/"kettle") —
 *   a shared block that both prompts point to can't drift the way two independently
 *   worded sentences can. `normalizeTags` below is a second, code-level backstop for
 *   the casing/duplication part specifically, since that's cheap and deterministic
 *   to enforce outside the model.
 * - CORE_ATTRIBUTES_LINE is deliberately small and category-agnostic (brand, color,
 *   weight, dimensions, ...) rather than skewed toward one vertical — a catalog like
 *   this one spans electronics, apparel, grocery, home goods and more, and nothing
 *   in it should assume any one of them. Category-specific attributes (wattage for
 *   an appliance, fabric composition for a shirt, ISBN for a book) are intentionally
 *   left to the normalize-the-source's-own-label fallback in KEY_DISCIPLINE_BLOCK
 *   rather than hand-listed per category, since that list would never stay complete.
 * - Spec keys are copied verbatim from the source's own attribute label — wording,
 *   spelling, and case included — rather than canonicalized. That trades away some
 *   cross-listing key consistency (a "Color" table and a "Colour" table won't share
 *   a key), which is a deliberate choice, not an oversight: if the fidelity trade-off
 *   ever needs revisiting, KEY_DISCIPLINE_BLOCK is the one place to change it back.
 *   Tags are unaffected — they still go through TAG_FORMAT_BLOCK's lowercase/atomic
 *   rules, since that instruction was scoped to specs only.
 * - The prose rule alone wasn't enough to hold against the model's own strong prior
 *   toward "clean" lowercase/snake_case/English JSON keys — verified on a real,
 *   German-labeled listing where values stayed verbatim but keys got silently
 *   re-anglicized ("Lieferumfang" -> "included_items"). KEY_VERBATIM_EXAMPLE is a
 *   concrete worked counter-example for exactly that failure, since examples beat
 *   abstract instruction for locking a format, per the original consistency research.
 */

function flattenSpecs(specs: NestedSpecs): ProductSpec {
  const flattened: ProductSpec = {};
  for (const [key, value] of Object.entries(specs)) {
    if (typeof value === 'string') {
      flattened[key] = value;
      continue;
    }
    for (const [childKey, childValue] of Object.entries(flattenSpecs(value))) {
      flattened[`${key} · ${childKey}`] = childValue;
    }
  }
  return flattened;
}

function flattenInnermostPairs(specs: NestedSpecs, out: ProductSpec = {}): ProductSpec {
  for (const [key, value] of Object.entries(specs)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else {
      flattenInnermostPairs(value, out);
    }
  }
  return out;
}

function normalizeTags(tags: TagsResult): TagsResult {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
    if (normalized.length === 8) break;
  }
  return normalized;
}

export class DefaultExtractor implements Extractor {
  constructor(private readonly dependencies: ExtractorDependencies) {}

  async extract<I extends ExtractInput, O extends ExtractOptions | undefined>(
    input: I,
    options?: O,
  ): Promise<O extends { tags: true } ? TaggedResult : SpecsResult> {
    const mode = options?.tags === true ? 'specs-and-tags' : 'specs';
    const result = await this.run(input, options, mode);
    return (
      options?.tags === true ? { spec: result.spec, tags: result.tags } : result.spec
    ) as O extends { tags: true } ? TaggedResult : SpecsResult;
  }

  async extractTags(input: ExtractInput, options?: ExtractOptions): Promise<TagsResult> {
    const result = await this.run(input, options, 'tags-only');
    return result.tags;
  }

  async extractFromText(
    text: string,
    options?: ExtractOptions,
    mode: PromptMode = 'specs',
    profile?: ResolvedProfile,
    kind?: InputKind,
  ): Promise<{ spec: SpecsResult; tags: TagsResult }> {
    return this.runOnText(text, options, mode, profile, kind);
  }

  private async run(
    input: ExtractInput,
    options?: ExtractOptions,
    mode: PromptMode = 'specs',
    profile?: ResolvedProfile,
  ): Promise<{ spec: SpecsResult; tags: TagsResult }> {
    const log = logger();
    const readResult = await this.dependencies.reader.read(input);
    const text = readResult.text.trim();
    if (readResult.imageOnly) {
      log.warn('Input is image only, returning empty result');
      return { spec: {}, tags: [] };
    }
    if (!text) {
      throw new ExtractionError('EMPTY_INPUT', 'Input is empty');
    }
    return this.runOnText(text, options, mode, profile, readResult.kind);
  }

  private async runOnText(
    rawText: string,
    options?: ExtractOptions,
    mode: PromptMode = 'specs',
    profile?: ResolvedProfile,
    kind?: InputKind,
  ): Promise<{ spec: SpecsResult; tags: TagsResult }> {
    const log = logger();
    const text = rawText.trim();
    if (!text) {
      throw new ExtractionError('EMPTY_INPUT', 'Input is empty');
    }
    const lang = options?.lang ?? detectLanguage(text) ?? 'en';
    log.info('Extraction started', { mode, lang, chars: text.length });
    const messages: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(lang, mode, profile, kind === 'video') },
      { role: 'user', content: text },
    ];
    const request: LlmRequest = {
      messages,
      ...(mode === 'specs-and-tags' ? { includeTags: true } : {}),
      ...(mode === 'tags-only' ? { tagsOnly: true } : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
    };
    const callOptions: CallOptions = {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    };
    const startedAt = Date.now();
    const response = await this.dependencies.llm.complete(request, callOptions);
    const result = this.dependencies.validator.validate(response.content);
    if (result.spec === undefined) {
      log.error('Invalid LLM output', { errors: result.errors });
      throw new ExtractionError('INVALID_OUTPUT', result.errors.join('; '));
    }
    const spec =
      options?.flattened !== true
        ? result.spec
        : options?.inheritance === true
          ? flattenSpecs(result.spec)
          : flattenInnermostPairs(result.spec);
    log.info('Extraction complete', {
      mode,
      specCount: Object.keys(spec).length,
      tagCount: result.tags.length,
      durationMs: Date.now() - startedAt,
    });
    return { spec, tags: normalizeTags(result.tags) };
  }
}

export function createExtractor(dependencies?: Partial<ExtractorDependencies>): Extractor {
  return new DefaultExtractor({
    reader: dependencies?.reader ?? new DefaultReader(new NapiPdfInspector()),
    llm: dependencies?.llm ?? createOpenAiProvider(),
    validator: dependencies?.validator ?? new JsonSpecValidator(),
  });
}

export function extract(text: string, options?: ExtractOptions): Promise<SpecsResult>;
export function extract(
  text: string,
  options: ExtractOptions & { tags: true },
): Promise<TaggedResult>;
export function extract(file: Blob, options?: ExtractOptions): Promise<SpecsResult>;
export function extract(
  file: Blob,
  options: ExtractOptions & { tags: true },
): Promise<TaggedResult>;
export function extract(path: URL, options?: ExtractOptions): Promise<SpecsResult>;
export function extract(path: URL, options: ExtractOptions & { tags: true }): Promise<TaggedResult>;
export function extract(
  input: ExtractInput,
  options?: ExtractOptions,
): Promise<SpecsResult | TaggedResult> {
  return createExtractor({ llm: providerFrom(options) }).extract(input, options);
}

export function extractTags(input: ExtractInput, options?: ExtractOptions): Promise<TagsResult> {
  return createExtractor({ llm: providerFrom(options) }).extractTags(input, options);
}

function providerFrom(options?: ExtractOptions): LlmProvider {
  const providerOptions = options?.apiKey !== undefined ? { apiKey: options.apiKey } : undefined;
  return options?.provider === 'anthropic'
    ? createAnthropicProvider(providerOptions)
    : createOpenAiProvider(providerOptions);
}
