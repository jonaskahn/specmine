import { listDomains, getDomainProfile } from '../category/registry.js';
import type { ContentKind, DomainId, ScopeKind } from '../category/types.js';
import { requestJson } from '../llm/http.js';
import { debugBody, logger } from '../log.js';
import {
  GENERIC_CLASSIFICATION,
  isKnownKind,
  isKnownScope,
  type Classification,
  type ClassifierOptions,
  type ContentClassifier,
} from './classifier.js';

export const DEFAULT_JEV_API_HOST = 'https://api.typesafe.ai';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const JEV_STATE_LIMIT = 8000;
// Docs: retry 429/529 with exponential backoff (the SDKs do this by default).
export const JEV_MAX_ATTEMPTS = 3;
export const JEV_RETRY_BACKOFF_MS = 500;

export function isJevRetriable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /responded (429|529)\b/.test(message);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface JevOptions extends ClassifierOptions {
  apiHost?: string;
}

interface JevChoiceAnswer {
  type?: string;
  choice?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
}

interface JevNoulAnswer {
  type?: string;
  noul?: unknown;
}

interface JevResponse {
  answers?: {
    kind?: JevChoiceAnswer;
    domain?: JevChoiceAnswer;
    scope?: JevChoiceAnswer;
    visual?: JevNoulAnswer;
  };
}

function asRecord(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') out[key] = entry;
  }
  return out;
}

function choiceOf(answer: JevChoiceAnswer | undefined, fallback: string): string {
  return typeof answer?.choice === 'string' ? answer.choice : fallback;
}

function confidenceOf(answer: JevChoiceAnswer | undefined): number {
  return typeof answer?.confidence === 'number' ? answer.confidence : 0;
}

export function buildJevQuestions(): Record<string, unknown> {
  const domains = listDomains();
  return {
    kind: {
      type: 'choice',
      instructions: 'What kind of document is this content?',
      criteria: {
        item_detail:
          'One thing described in depth: product page, datasheet, listing, profile, recipe',
        item_collection: 'Many items: category page, search results, comparison table, catalog',
        editorial: 'News, blog, review, opinion, or research article',
        instructional: 'Manual, how-to, API docs, or tutorial',
        policy_legal: 'Terms, privacy policy, contract, or legal notice',
        non_content: 'Error page, login wall, cookie wall, or empty shell with no real content',
      },
    },
    domain: {
      type: 'choice',
      instructions: 'What subject domain is this content about?',
      criteria: Object.fromEntries(
        domains.map((domain) => [domain, getDomainProfile(domain).criteria]),
      ),
    },
    scope: {
      type: 'choice',
      instructions: 'How many distinct items does the content describe?',
      criteria: {
        single: 'Exactly one item or subject',
        multiple: 'Several distinct items, each with its own details',
        none: 'No item at all: policy, error, or empty content',
      },
    },
    visual: {
      type: 'noul',
      instructions: 'Does the content describe something that can be depicted in a picture?',
      criteria: {
        true: 'A specific thing, place, or scene is described and could be shown in a picture',
        false: 'Abstract, legal, or empty content with nothing concrete to depict',
      },
    },
  };
}

function parseResponse(body: unknown): Classification | undefined {
  const response = body as JevResponse;
  const answers = response.answers;
  if (!answers) return undefined;
  const kindRaw = choiceOf(answers.kind, 'item_detail');
  const domainRaw = choiceOf(answers.domain, 'general');
  const scopeRaw = choiceOf(answers.scope, 'single');
  if (!isKnownKind(kindRaw) || !isKnownScope(scopeRaw)) return undefined;
  const kind: ContentKind = kindRaw;
  const scope: ScopeKind = scopeRaw;
  const domain: DomainId = listDomains().includes(domainRaw as DomainId)
    ? (domainRaw as DomainId)
    : 'general';
  const visualAnswer = answers.visual;
  const visual = typeof visualAnswer?.noul === 'number' ? visualAnswer.noul >= 0.5 : true;
  const probabilities = asRecord(answers.domain?.probabilities);
  return {
    kind,
    domain,
    scope,
    visual,
    confidence: confidenceOf(answers.domain ?? answers.kind),
    ...(probabilities !== undefined ? { probabilities } : {}),
    source: 'jev',
  };
}

export class JevClassifier implements ContentClassifier {
  constructor(private readonly options?: JevOptions) {}

  async classify(text: string, options?: ClassifierOptions): Promise<Classification> {
    const apiKey = options?.apiKey ?? this.options?.apiKey ?? process.env.TYPESAFE_API_KEY ?? '';
    const apiHost = this.options?.apiHost ?? process.env.TYPESAFE_API_HOST ?? DEFAULT_JEV_API_HOST;
    const model =
      options?.model ?? this.options?.model ?? process.env.JEV_MODEL ?? DEFAULT_JEV_MODEL;
    const state = text.slice(0, JEV_STATE_LIMIT);
    logger().debug('Jev classification request', { model, chars: state.length });
    const payload = { model, state, questions: buildJevQuestions() };
    debugBody('Jev classification request body', payload);
    // The docs ask callers to retry 429/529 with exponential backoff
    // (the official SDKs do this automatically); raw HTTP must do it here.
    let attempt = 0;
    for (;;) {
      try {
        const { body } = await requestJson(
          `${apiHost}/v1/systemone`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(payload),
          },
          options,
        );
        debugBody('Jev classification response body', body);
        const parsed = parseResponse(body);
        if (!parsed) {
          logger().warn('Jev response unparseable, using generic classification');
          return { ...GENERIC_CLASSIFICATION };
        }
        logger().info('Jev classification', {
          kind: parsed.kind,
          domain: parsed.domain,
          confidence: parsed.confidence,
        });
        return parsed;
      } catch (error) {
        if (attempt >= JEV_MAX_ATTEMPTS - 1 || !isJevRetriable(error)) throw error;
        attempt += 1;
        logger().warn('Jev rate limited, retrying', { attempt });
        await sleep(JEV_RETRY_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }
}

export function createJevClassifier(options?: JevOptions): ContentClassifier {
  return new JevClassifier(options);
}
