import { ExtractionError } from '../errors.js';
import type { InputKind } from '../input/reader.js';
import type { LlmRequest } from '../llm/provider.js';
import { currentDateLine } from '../time.js';

/**
 * Prose generation reads a head window, never the whole document. Every other
 * LLM stage in this library does the same — classify and identify both read
 * 8 000 chars, the visual extractor 6 000 — because the metadata, heading and
 * opening of any source sit at the front and the tail is boilerplate. The spec
 * stage still reads everything, so nothing is lost; this only bounds what the
 * prose call pays for and waits on.
 */
export const PROSE_WINDOW_CHARS = 8_000;

/**
 * Enough for a title, a one-paragraph description and a few sentences. Reasoning
 * models draw on the same budget as the visible answer — a 500-token cap on a
 * Gemini-class model left 479 tokens of thinking and 6 of truncated JSON.
 */
export const PROSE_MAX_TOKENS = 2000;

export interface ProseResult {
  title: string;
  description: string;
  summary: string;
}

export type ProseField = 'title' | 'description' | 'summary';

/** Which of the three the source left unstated, and therefore which we must write. */
export interface ProseNeeds {
  title: boolean;
  description: boolean;
  summary: boolean;
}

const ROLE_LINE =
  'You write short factual descriptions of documents for a data pipeline. Your output is consumed by code, so it is plain text and stable across repeated runs on the same content.';

const GROUNDING_BLOCK = `Grounding:
- Use ONLY the content given to you — never outside knowledge about the brand, product, channel or subject.
- Every claim must be traceable to something the content actually states.
- If something cannot be stated from the content, leave it out rather than guess or pad.`;

/** Stated once and reused; only which fields are requested changes. */
const FIELDS: Record<ProseField, string> = {
  title:
    'A short, plain title naming the one subject this content is about. No quotes, no trailing punctuation, no filename.',
  description:
    'One or two plain sentences describing what this content is, drawn from what it says. No marketing language, no superlatives.',
  summary:
    'Two to four plain factual sentences covering what the content is, what it covers, and the notable things it explicitly states. No opinion, no narrative, no calls to action.',
};

function proseSystemPrompt(asked: ProseField[], kind: InputKind): string {
  return [
    ROLE_LINE,
    `Task: write ${asked.join(', ')} for the content given to you.`,
    GROUNDING_BLOCK,
    `Answer straight away — do not reason about the content first. Write ${
      asked.length === 1 ? 'this one field' : `all ${asked.length} fields`
    }, using these definitions:\n${asked.map((key) => `- "${key}": ${FIELDS[key]}`).join('\n')}`,
    'Output a single JSON object matching the schema and nothing else — no prose, no markdown code fences, no trailing commentary.',
    kind === 'video'
      ? "The content is a video's metadata, description and caption transcript. Its title, channel, duration, views, publish date and category are already stated at the top; the Transcript section is what was actually said."
      : 'The content is a document.',
    'When the source states a title or description of its own, that is its own wording: keep it and write the summary from it, rather than inventing a different one.',
  ].join('\n\n');
}

/**
 * Only the fields the source left unstated are requested, and the schema asks
 * for exactly those. A strict schema requires every property it names, so
 * listing all three would make the model write a title and description we are
 * about to discard — tokens spent on output nobody reads.
 */
function schemaFor(asked: ProseField[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(asked.map((key) => [key, { type: 'string' }])),
    required: asked,
    additionalProperties: false,
  };
}

/**
 * The title and description the reader already parsed out of the markup. These
 * never appear in the converted text — turndown drops `<meta>` tags — so
 * without this the model would be asked to write an overview of a page whose
 * own one-line description it cannot see. `undefined` means the source stated
 * none, which is the case generation exists for.
 */
export interface ProseContext {
  title?: string;
  description?: string;
}

/**
 * How much of a stated title or description to pass on. A uploader description
 * can run to thousands of characters, and the point of this block is that the
 * model can see the source's own words — not that it re-reads them. A title is
 * a phrase by nature; a description is one or two sentences before it stops
 * being a description, so the cap sits well below the window.
 */
export const MAX_STATED_CHARS = 600;

function clip(value: string): string {
  return value.length > MAX_STATED_CHARS ? `${value.slice(0, MAX_STATED_CHARS)}…` : value;
}

/** Labelled so the model can tell the source's own words from the body below. */
function statedBlock(context: ProseContext): string[] {
  const lines: string[] = [];
  if (context.title !== undefined) lines.push(`Title: ${clip(context.title)}`);
  if (context.description !== undefined) lines.push(`Description: ${clip(context.description)}`);
  return lines.length > 0 ? ['The source states these about itself:', ...lines] : [];
}

/**
 * Builds the request for the prose stage. `text` is windowed here rather than
 * by the caller, so no caller can accidentally hand over a whole document.
 */
export function buildProseRequest(
  text: string,
  kind: InputKind,
  needs: ProseNeeds,
  context: ProseContext = {},
): LlmRequest {
  const window = text.slice(0, PROSE_WINDOW_CHARS);
  const truncated = text.length > PROSE_WINDOW_CHARS ? '\n…truncated' : '';
  const asked = (Object.keys(FIELDS) as ProseField[]).filter((key) => needs[key]);
  const stated = statedBlock(context);
  return {
    schema: schemaFor(asked),
    schemaName: 'specmine_prose',
    // Reasoning models spend most of this budget thinking before writing, so a
    // tight cap truncates the JSON mid-string rather than shortening the answer.
    maxTokens: PROSE_MAX_TOKENS,
    messages: [
      {
        role: 'system',
        content: `${proseSystemPrompt(asked, kind)}\n\n${currentDateLine()}`,
      },
      {
        role: 'user',
        content: [...stated, '', window + truncated].join('\n'),
      },
    ],
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads the prose out of a structured response. Deliberately not
 * `JsonSpecValidator`: that validates the `{spec, tags}` envelope, a different
 * shape, and routing this through it would mean fighting its own rules.
 */
export function parseProse(raw: string): ProseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, ''),
    );
  } catch {
    // INVALID_OUTPUT rather than LLM_ERROR: the call succeeded, its answer did
    // not parse, which is the same failure the spec stage reports for this.
    throw new ExtractionError('INVALID_OUTPUT', 'Prose response is not valid JSON');
  }
  const record = parsed as Record<string, unknown> | null;
  const result = {
    title: text(record?.title),
    description: text(record?.description),
    summary: text(record?.summary),
  };
  if (!result.title && !result.description && !result.summary) {
    throw new ExtractionError('INVALID_OUTPUT', 'Prose response contained no usable fields');
  }
  return result;
}
