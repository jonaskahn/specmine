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
import { SPECS_SCHEMA } from '../spec/schema.js';

export const DEFAULT_ANTHROPIC_API_HOST = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_MODEL = 'haiku-4.5';
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicOptions extends LlmProviderOptions {
  anthropicVersion?: string;
}

type AnthropicRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: AnthropicRole;
  content: string | unknown[];
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; input?: unknown }>;
}

function resolve(options: AnthropicOptions | undefined): ResolvedSettings {
  return resolveSettings(
    options,
    process.env.SPECMINE_LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    { host: DEFAULT_ANTHROPIC_API_HOST, model: DEFAULT_ANTHROPIC_MODEL },
  );
}

function toContent(content: LlmMessage['content']): string | unknown[] {
  if (typeof content === 'string') return content;
  const parts: unknown[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
    } else {
      throw new ExtractionError('UNSUPPORTED_INPUT', 'Vision input is not supported');
    }
  }
  return parts;
}

function toSystem(messages: LlmMessage[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => toContent(message.content))
    .join('\n');
}

function toMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      result.push({ role: 'user', content: [{ type: 'tool_result', content: message.content }] });
      continue;
    }
    result.push({ role: message.role, content: toContent(message.content) });
  }
  return result;
}

export class AnthropicClient implements LlmProvider {
  private readonly settings: ResolvedSettings;
  private readonly version: string;

  constructor(options?: AnthropicOptions) {
    this.settings = resolve(options);
    this.version = options?.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
  }

  async complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse> {
    const { apiHost, apiKey, model } = this.settings;
    const system = toSystem(request.messages);
    const { body } = await requestJson(
      `${apiHost}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': this.version,
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          model: request.model ?? model,
          max_tokens: request.maxTokens ?? 1024,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(system ? { system } : {}),
          messages: toMessages(request.messages),
          tools: [
            {
              name: 'specmine',
              description:
                'Extract product specifications from the input content as a structured list.',
              input_schema: SPECS_SCHEMA,
            },
          ],
          tool_choice: { type: 'tool', name: 'specmine' },
        }),
      },
      options,
    );
    const response = body as AnthropicResponse;
    const toolUse = response.content?.find((block) => block.type === 'tool_use');
    if (toolUse?.input !== undefined) {
      return { content: JSON.stringify(toolUse.input) };
    }
    const content = response.content?.find((block) => block.type === 'text')?.text;
    if (typeof content !== 'string') {
      throw new ExtractionError('LLM_ERROR', 'LLM response is missing text content');
    }
    return { content };
  }
}

export function createAnthropicProvider(options?: AnthropicOptions): LlmProvider {
  return new AnthropicClient(options);
}
