import { ExtractionError } from './errors.js';
import { detectLanguage } from './input/language.js';
import { DefaultReader, type InputReader } from './input/reader.js';
import { NapiPdfInspector } from './input/napi-pdf-inspector.js';
import { createAnthropicProvider } from './llm/anthropic.js';
import { createOpenAiProvider } from './llm/openai.js';
import type { LlmMessage, LlmProvider, LlmRequest } from './llm/provider.js';
import { JsonSpecValidator, type SpecValidator } from './spec/validator.js';
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

const CORE_ATTRIBUTES_LINE =
  'brand, model number, color, material, weight, dimensions, capacity, quantity, size, country of origin';

const ROLE_LINE =
  'You are a precise, deterministic product-data extraction engine running inside an automated ETL pipeline. Your output is consumed directly by code, never read by a person, so it must be exact, minimal and stable across repeated runs on the same or near-duplicate content.';

const SOURCE_NOISE_BLOCK = `The content may be raw HTML, plain text, or text extracted from a PDF, and will often contain material unrelated to the product itself — navigation, cookie/consent banners, headers and footers, breadcrumbs, "related" or "customers also bought" blocks, reviews, and shipping or legal boilerplate; PDF extractions may also carry repeated page headers/footers and OCR artifacts.
First identify the single product this content describes and mentally isolate only the text about that product. Ignore everything else, including HTML tags and attributes — read markup as structure, not content. Extract only from the isolated, product-relevant text.`;

const KEY_DISCIPLINE_BLOCK = `Key discipline:
- Every spec key must be copied verbatim from the attribute label as it appears in the content — same wording, same spelling, same case, same punctuation, same language. This holds even when the label isn't in English, is in Title Case or ALL CAPS, or otherwise doesn't look like a conventional JSON key: the usual snake_case/English/lowercase convention for JSON keys does NOT apply here — verbatim fidelity to the source overrides it.
- Never lowercase a label, never convert it to snake_case, never translate it into another language, and never merge two differently-worded labels into one, even when they clearly mean the same thing.
- This applies to group labels too: if the content presents a labeled section or table heading over a set of related attributes, use that heading verbatim as the group key, with its own child attributes verbatim beneath it.
- Only when a fact is stated with no explicit attribute label to copy — plain prose, not a labeled field — coin the shortest, plain-English term for what's being described; if it matches one of these common concepts, use the plain term as-is: ${CORE_ATTRIBUTES_LINE}.
- If the exact same label appears more than once with different values, keep the first occurrence.`;

const KEY_VERBATIM_EXAMPLE = `Example — the label is copied exactly into the key, never translated or reshaped:
Content: "Marke: ExampleCorp. Gewicht: 2 kg. Lieferumfang: Handbuch, Netzteil."
Output: {"Marke": "ExampleCorp", "Gewicht": "2 kg", "Lieferumfang": "Handbuch, Netzteil"}
Notice "Marke" stayed German, not "brand"; "Gewicht" kept its capital G, not "gewicht" or "weight"; "Lieferumfang" was not renamed to something like "included_items".`;

const VALUE_FORMAT_BLOCK = `Value formatting:
- Every leaf value is a string, including numbers, and keeps the unit exactly as written in the source (e.g. "1.5 kg", not 1.5; "500 ml"; "42 EU").
- Do not convert, round or normalize units.
- Group related sub-attributes by nesting them one level under their shared source label — e.g. {"<group_label_from_source>": {"<sub_attribute_label_from_source>": "<value>"}} — instead of flattening them into one key.`;

const GROUNDING_BLOCK = `Grounding:
- Use ONLY the provided content — never outside or general knowledge about the brand, product line or category.
- Every value must be traceable to text actually present in the content.
- If a value isn't explicitly stated, omit that key entirely rather than guess, estimate or infer it. Returning fewer keys on sparse content is correct, not a failure.`;

const SPEC_OUTPUT_SHAPE = `Output shape — a single flat-or-nested JSON object, no wrapper key:
{"<attribute label exactly as in source>": "<value>", "<group label exactly as in source>": {"<sub-attribute label exactly as in source>": "<value>"}}
A missing or unstated attribute means its key is absent from the object entirely — never include one with a null or empty value.`;

const TAG_IDENTITY_BLOCK = `Tag identity and specificity:
- First determine the specific product (brand + line + model + type, as far as the content states it).
- Generate tags a shopper searching for THIS exact product would use — every tag must be defensible from the content.
- Prefer the most specific accurate term available. Don't emit broad category words (e.g. "electronics", "clothing", "kitchen") unless nothing more specific applies, and don't emit a tag that could equally describe most other products in the catalog.`;

const TAG_ORDER_BLOCK = `Tag ordering:
- For each candidate tag, judge internally how strongly and specifically it relates to this exact product.
- Output the tags array sorted from most relevant/most specific first to least relevant last. Do not output the scores — only the ordered array.`;

const TAG_FORMAT_BLOCK = `Tag format:
- 2 to 8 short, lowercase tags; an empty array is correct when nothing in the content is clearly taggable.
- Each tag is a single atomic concept — brand, product type, material, or use-case. Never combine two concepts into one tag (write "kettle" and "acme" separately, not "acme kettle"), and never emit two tags where one is a subset, superset, or rephrasing of another.
- Don't tag a raw measurement or quantity (a capacity, a weight, a dimension, a price) — those belong in specifications, not tags.`;

const OUTPUT_DISCIPLINE_BLOCK =
  'Output discipline:\n- Respond with a single JSON object and nothing else — no prose, no markdown code fences, no trailing commentary.';

const SPECS_SYSTEM_PROMPT = [
  ROLE_LINE,
  'Task: extract only specifications and measurable attributes explicitly stated in the content — never infer, assume or fabricate a value; focus on quantifiable features.',
  SOURCE_NOISE_BLOCK,
  KEY_DISCIPLINE_BLOCK,
  KEY_VERBATIM_EXAMPLE,
  VALUE_FORMAT_BLOCK,
  GROUNDING_BLOCK,
  SPEC_OUTPUT_SHAPE,
  OUTPUT_DISCIPLINE_BLOCK,
].join('\n\n');

const SPECS_AND_TAGS_SYSTEM_PROMPT = [
  ROLE_LINE,
  'Task: extract (a) specifications/measurable attributes explicitly stated in the content, and (b) descriptive tags that categorize the product — never infer, assume or fabricate either.',
  SOURCE_NOISE_BLOCK,
  KEY_DISCIPLINE_BLOCK,
  KEY_VERBATIM_EXAMPLE,
  VALUE_FORMAT_BLOCK,
  TAG_IDENTITY_BLOCK,
  TAG_ORDER_BLOCK,
  TAG_FORMAT_BLOCK,
  GROUNDING_BLOCK,
  `${SPEC_OUTPUT_SHAPE}\n"tags" is a reserved top-level key for the array described above — never use "tags" as a specification key, and never nest it inside a group.`,
  OUTPUT_DISCIPLINE_BLOCK,
].join('\n\n');

const TAGS_ONLY_SYSTEM_PROMPT = [
  ROLE_LINE,
  'Task: extract descriptive tags that categorize the product described in the content — never infer, assume or fabricate.',
  SOURCE_NOISE_BLOCK,
  TAG_IDENTITY_BLOCK,
  TAG_ORDER_BLOCK,
  TAG_FORMAT_BLOCK,
  'Grounding:\n- Only include a tag that is clearly supported by the content; when in doubt, leave it out rather than guess.',
  'Output discipline:\n- Respond with a single JSON object and nothing else, using this exact shape:\n  {"tags": ["tag1", "tag2"]}',
].join('\n\n');

type PromptMode = 'specs' | 'specs-and-tags' | 'tags-only';

const SYSTEM_PROMPTS: Record<PromptMode, string> = {
  specs: SPECS_SYSTEM_PROMPT,
  'specs-and-tags': SPECS_AND_TAGS_SYSTEM_PROMPT,
  'tags-only': TAGS_ONLY_SYSTEM_PROMPT,
};

function languageName(lang: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

const LANGUAGE_LINES: Record<PromptMode, (lang: string) => string> = {
  specs: (lang) => `Write every key and value in ${languageName(lang)}.`,
  'specs-and-tags': (lang) => `Write every key, value, and tag in ${languageName(lang)}.`,
  'tags-only': (lang) => `Write every tag in ${languageName(lang)}.`,
};

function buildSystemPrompt(lang: string, mode: PromptMode): string {
  const prompt = SYSTEM_PROMPTS[mode];
  if (lang === 'en') return prompt;
  return `${prompt}\n\n${LANGUAGE_LINES[mode](lang)}`;
}

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

  private async run(
    input: ExtractInput,
    options?: ExtractOptions,
    mode: PromptMode = 'specs',
  ): Promise<{ spec: SpecsResult; tags: TagsResult }> {
    const readResult = await this.dependencies.reader.read(input);
    const text = readResult.text.trim();
    if (readResult.imageOnly) {
      return { spec: {}, tags: [] };
    }
    if (!text) {
      throw new ExtractionError('EMPTY_INPUT', 'Input is empty');
    }
    const lang = options?.lang ?? detectLanguage(text) ?? 'en';
    const messages: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(lang, mode) },
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
    const response = await this.dependencies.llm.complete(request, callOptions);
    const result = this.dependencies.validator.validate(response.content);
    if (result.spec === undefined) {
      throw new ExtractionError('INVALID_OUTPUT', result.errors.join('; '));
    }
    const spec =
      options?.flattened !== true
        ? result.spec
        : options?.inheritance === true
          ? flattenSpecs(result.spec)
          : flattenInnermostPairs(result.spec);
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
