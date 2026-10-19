import { listDomains } from '../category/registry.js';
import type { CallOptions } from '../types.js';
import type { DomainId } from '../category/types.js';
import { requestJson } from '../llm/http.js';
import { debugBody, logger } from '../log.js';
import { GENERIC_CLASSIFICATION, isKnownKind, type Classification } from './classifier.js';

/**
 * The cheap first read of the content, before any prompt is tuned. It looks at
 * the opening window as text only — no pixels — and answers four questions in
 * one request. Whatever comes back shapes the picture decision; a failure
 * falls back to the generic profile and never to a second classifier call.
 */
export const IDENTIFY_WINDOW_CHARS = 8000;
export const DEFAULT_IDENTIFY_API_HOST = 'https://api.typesafe.ai';

export interface IdentifyAnswer {
  language: string;
  domain: DomainId;
  kind: Classification['kind'];
  /** does the page already carry a usable picture? */
  hasPhoto: boolean;
  /** profile key chosen for this content */
  category: string;
}

export const GENERIC_IDENTIFY: IdentifyAnswer = {
  language: 'en',
  domain: 'general',
  kind: GENERIC_CLASSIFICATION.kind,
  hasPhoto: false,
  category: 'general',
};

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseAnswers(body: unknown): IdentifyAnswer {
  const answers = (body as { answers?: Record<string, { answer?: unknown }> }).answers ?? {};
  const domainRaw = asString(answers.domain?.answer, GENERIC_IDENTIFY.domain);
  return {
    language: asString(answers.language?.answer, GENERIC_IDENTIFY.language),
    domain: listDomains().includes(domainRaw as DomainId) ? (domainRaw as DomainId) : 'general',
    kind: isKnownKind(answers.kind?.answer)
      ? (answers.kind?.answer as Classification['kind'])
      : GENERIC_IDENTIFY.kind,
    hasPhoto: asBoolean(answers.has_photo?.answer, GENERIC_IDENTIFY.hasPhoto),
    category: asString(answers.category?.answer, GENERIC_IDENTIFY.category),
  };
}

/** The four quick questions the identify step asks in a single request. */
export function buildIdentifyQuestions(): Record<string, unknown> {
  return {
    language: {
      type: 'noul',
      instructions: 'What language is this content written in?',
      criteria: { true: 'Return the BCP-47 language tag, e.g. en, de, fr', false: 'unknown' },
    },
    domain: {
      type: 'choice',
      instructions: 'What subject domain is this content about?',
      criteria: Object.fromEntries(listDomains().map((domain) => [domain, domain])),
    },
    kind: {
      type: 'choice',
      instructions: 'What kind of document is this content?',
      criteria: {
        item_detail: 'One thing described in depth',
        item_collection: 'Many items listed together',
        editorial: 'News, blog, review, or opinion',
        instructional: 'Manual, how-to, or tutorial',
        policy_legal: 'Terms, privacy policy, or legal notice',
        non_content: 'Error page, login wall, or empty shell',
      },
    },
    has_photo: {
      type: 'noul',
      instructions: 'Does this content already carry a usable picture?',
      criteria: {
        true: 'A real product, person, or scene photo is already present',
        false: 'No picture, or only icons, logos, and decorative graphics',
      },
    },
  };
}

export interface IdentifyOptions extends CallOptions {
  apiKey?: string;
  apiHost?: string;
  model?: string;
}

/**
 * Runs identify once and hands the answer to `onUsage`. Never throws: a failed
 * or unusable answer is a generic profile, which is the spec's stated contract.
 */
export async function identifyContent(
  text: string,
  options?: IdentifyOptions,
  onUsage?: (stateChars: number) => void,
): Promise<IdentifyAnswer> {
  const state = text.slice(0, IDENTIFY_WINDOW_CHARS);
  onUsage?.(state.length);
  const apiKey = options?.apiKey ?? process.env.TYPESAFE_API_KEY ?? '';
  const apiHost = options?.apiHost ?? process.env.TYPESAFE_API_HOST ?? DEFAULT_IDENTIFY_API_HOST;
  if (!apiKey) {
    logger().debug('Identify skipped: no key, using generic profile');
    return GENERIC_IDENTIFY;
  }
  const payload = {
    model: options?.model ?? 'jev-latest',
    state,
    questions: buildIdentifyQuestions(),
  };
  debugBody('Identify request body', payload);
  try {
    const { body } = await requestJson(
      `${apiHost}/v1/systemone`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      },
      options,
    );
    debugBody('Identify response body', body);
    const answer = parseAnswers(body);
    logger().info('Jev identify', {
      kind: answer.kind,
      domain: answer.domain,
      category: answer.category,
      confidence: 1,
    });
    return answer;
  } catch (error) {
    logger().warn('Jev identify failed, using generic profile', { error: messageOf(error) });
    return GENERIC_IDENTIFY;
  }
}
