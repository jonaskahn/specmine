import { ExtractionError } from '../errors.js';
import type { CallOptions } from '../types.js';
import { requestJson } from './http.js';
import type {
  LlmMessage,
  LlmProvider,
  LlmProviderOptions,
  LlmRequest,
  LlmResponse,
} from './provider.js';
import { resolveSettings, type ResolvedSettings } from './settings.js';
import { SPECS_SCHEMA, TAGGED_SPECS_SCHEMA, TAGS_ONLY_SCHEMA } from '../spec/schema.js';

export const DEFAULT_OPENAI_API_HOST = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';

export type OpenAiCompatibleOptions = LlmProviderOptions;

interface OpenAiChoice {
  message?: {
    content?: string | null;
  };
}

interface OpenAiBody {
  choices?: OpenAiChoice[];
}

function resolve(options: OpenAiCompatibleOptions | undefined): ResolvedSettings {
  return resolveSettings(options, process.env.SPECMINE_LLM_API_KEY ?? process.env.OPENAI_API_KEY, {
    host: DEFAULT_OPENAI_API_HOST,
    model: DEFAULT_OPENAI_MODEL,
  });
}

function toContent(content: LlmMessage['content']): string {
  if (typeof content === 'string') return content;
  const texts: string[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      texts.push(part.text);
    } else {
      throw new ExtractionError('UNSUPPORTED_INPUT', 'Vision input is not supported');
    }
  }
  return texts.join('\n');
}

export class OpenAiClient implements LlmProvider {
  private readonly settings: ResolvedSettings;

  constructor(options?: OpenAiCompatibleOptions) {
    this.settings = resolve(options);
  }

  async complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse> {
    const { apiHost, apiKey, model } = this.settings;
    const { body } = await requestJson(
      `${apiHost}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model ?? model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: toContent(message.content),
          })),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'extracted_specs',
              strict: true,
              schema:
                request.tagsOnly === true
                  ? TAGS_ONLY_SCHEMA
                  : request.includeTags === true
                    ? TAGGED_SPECS_SCHEMA
                    : SPECS_SCHEMA,
            },
          },
        }),
      },
      options,
    );
    const openAiBody = body as OpenAiBody;
    const content = openAiBody.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ExtractionError('LLM_ERROR', 'LLM response is missing message content');
    }
    return { content };
  }
}

export function createOpenAiProvider(options?: OpenAiCompatibleOptions): LlmProvider {
  return new OpenAiClient(options);
}
