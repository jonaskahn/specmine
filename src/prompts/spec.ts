import type { ResolvedProfile } from '../category/types.js';
import { currentDateLine } from '../time.js';

export type PromptMode = 'specs' | 'specs-and-tags' | 'tags-only';

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

/**
 * A video page has no product to isolate: the source is channel, duration,
 * views, publish date, category, keywords and a description written by the
 * uploader. Asking for "the single product" there yields an empty object, so
 * the video path extracts the video's own stated facts instead.
 */
const VIDEO_FACTS_TASK =
  'Task: extract the factual attributes this content explicitly states — for a video: its title, channel, duration, views, publish date and category, plus every product, place, company, person or event named in the transcript or description, with their stated attributes. Never infer, assume or fabricate.';

const VIDEO_FACTS_BLOCK = `This content is a video's metadata, description and caption transcript, not a product page.
- The labelled leading lines (Channel, Duration, Views, Published, Category, Keywords) are the video's own stated facts: extract each one whose value is non-empty, under a key describing what it is.
- The Transcript section is what was actually said. Mine it for concrete things named with stated attributes — a product and its specs, a place, a company, a dated event, a person and their role — and extract only what the words actually state.
- The description is written by the uploader and may promote or link elsewhere: treat its claims as stated only when it states them plainly.
- The title names the video; it is context, never a key.
- Narrative, opinion, speculation and calls to action are not facts. Someone saying a thing might happen, or wishing it would, is not a specification.
- Keywords are a comma list: when you do include them, keep the list intact as one value, never split into one key per keyword.`;

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

const SPECS_TASK =
  'Task: extract only specifications and measurable attributes explicitly stated in the content — never infer, assume or fabricate a value; focus on quantifiable features.';

const SPECS_AND_TAGS_TASK =
  'Task: extract (a) specifications/measurable attributes explicitly stated in the content, and (b) descriptive tags that categorize the product — never infer, assume or fabricate either.';

const TAGS_ONLY_TASK =
  'Task: extract descriptive tags that categorize the product described in the content — never infer, assume or fabricate.';

function subjectNoiseBlock(profile: ResolvedProfile): string {
  return `${SOURCE_NOISE_BLOCK}\nSubject: this content is a ${profile.domain} (${profile.subjectNoun}). Isolate the single ${profile.subjectNoun} described and extract only from its relevant text.`;
}

function categoryBlock(profile: ResolvedProfile): string {
  const hints = [...new Set([...profile.familySpecHints, ...profile.specHints])];
  const lines = [
    `Category: this content is ${profile.domain} — the subject is a ${profile.subjectNoun}.`,
    `Look for these concepts when stated, still copying source labels verbatim: ${hints.join(', ')}.`,
  ];
  if (profile.specIgnore.length > 0) {
    lines.push(`Ignore (never extract as specs): ${profile.specIgnore.join('; ')}.`);
  }
  return lines.join('\n');
}

function tagIdentityBlock(profile: ResolvedProfile): string {
  return `${TAG_IDENTITY_BLOCK}\nSubject: the ${profile.subjectNoun} in this ${profile.domain} content.`;
}

export function taskLine(mode: PromptMode, profile?: ResolvedProfile): string {
  if (!profile) {
    if (mode === 'specs') return SPECS_TASK;
    if (mode === 'specs-and-tags') return SPECS_AND_TAGS_TASK;
    return TAGS_ONLY_TASK;
  }
  const noun = profile.subjectNoun;
  if (mode === 'specs') {
    return `Task: extract only specifications and measurable attributes of the ${noun} explicitly stated in this ${profile.domain} content — never infer, assume or fabricate a value.`;
  }
  if (mode === 'specs-and-tags') {
    return `Task: extract (a) specifications/measurable attributes of the ${noun} explicitly stated in this ${profile.domain} content, and (b) descriptive tags that categorize it — never infer, assume or fabricate either.`;
  }
  return `Task: extract descriptive tags that categorize the ${noun} described in this ${profile.domain} content — never infer, assume or fabricate.`;
}

function hintsBlock(profile: ResolvedProfile): string {
  return categoryBlock(profile);
}

const SPECS_SYSTEM_PROMPT = [
  ROLE_LINE,
  SPECS_TASK,
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
  SPECS_AND_TAGS_TASK,
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
  TAGS_ONLY_TASK,
  SOURCE_NOISE_BLOCK,
  TAG_IDENTITY_BLOCK,
  TAG_ORDER_BLOCK,
  TAG_FORMAT_BLOCK,
  'Grounding:\n- Only include a tag that is clearly supported by the content; when in doubt, leave it out rather than guess.',
  'Output discipline:\n- Respond with a single JSON object and nothing else, using this exact shape:\n  {"tags": ["tag1", "tag2"]}',
].join('\n\n');

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

export function buildSystemPrompt(
  lang: string,
  mode: PromptMode,
  profile?: ResolvedProfile,
  /** the source is a video's metadata, not a product page */
  video = false,
): string {
  const dateLine = currentDateLine();
  if (video) {
    const parts =
      mode === 'tags-only'
        ? [
            ROLE_LINE,
            VIDEO_FACTS_TASK,
            VIDEO_FACTS_BLOCK,
            TAG_FORMAT_BLOCK,
            OUTPUT_DISCIPLINE_BLOCK,
          ]
        : [
            ROLE_LINE,
            VIDEO_FACTS_TASK,
            VIDEO_FACTS_BLOCK,
            KEY_DISCIPLINE_BLOCK,
            SPEC_OUTPUT_SHAPE,
            GROUNDING_BLOCK,
            OUTPUT_DISCIPLINE_BLOCK,
          ];
    return [...parts, dateLine].join('\n\n');
  }
  if (!profile) {
    const prompt = SYSTEM_PROMPTS[mode];
    if (lang === 'en') return `${prompt}\n\n${dateLine}`;
    return `${prompt}\n\n${LANGUAGE_LINES[mode](lang)}\n\n${dateLine}`;
  }
  const hints = hintsBlock(profile);
  const parts =
    mode === 'specs'
      ? [
          ROLE_LINE,
          taskLine(mode, profile),
          subjectNoiseBlock(profile),
          KEY_DISCIPLINE_BLOCK,
          KEY_VERBATIM_EXAMPLE,
          VALUE_FORMAT_BLOCK,
          hints,
          GROUNDING_BLOCK,
          SPEC_OUTPUT_SHAPE,
          OUTPUT_DISCIPLINE_BLOCK,
        ]
      : mode === 'specs-and-tags'
        ? [
            ROLE_LINE,
            taskLine(mode, profile),
            subjectNoiseBlock(profile),
            KEY_DISCIPLINE_BLOCK,
            KEY_VERBATIM_EXAMPLE,
            VALUE_FORMAT_BLOCK,
            tagIdentityBlock(profile),
            TAG_ORDER_BLOCK,
            TAG_FORMAT_BLOCK,
            hints,
            GROUNDING_BLOCK,
            `${SPEC_OUTPUT_SHAPE}\n"tags" is a reserved top-level key for the array described above — never use "tags" as a specification key, and never nest it inside a group.`,
            OUTPUT_DISCIPLINE_BLOCK,
          ]
        : [
            ROLE_LINE,
            taskLine(mode, profile),
            subjectNoiseBlock(profile),
            tagIdentityBlock(profile),
            TAG_ORDER_BLOCK,
            TAG_FORMAT_BLOCK,
            hints,
            'Grounding:\n- Only include a tag that is clearly supported by the content; when in doubt, leave it out rather than guess.',
            'Output discipline:\n- Respond with a single JSON object and nothing else, using this exact shape:\n  {"tags": ["tag1", "tag2"]}',
          ];
  const prompt = parts.join('\n\n');
  if (lang === 'en') return `${prompt}\n\n${dateLine}`;
  return `${prompt}\n\n${LANGUAGE_LINES[mode](lang)}\n\n${dateLine}`;
}
