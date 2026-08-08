import { ExtractionError } from './errors.js';
import { detectLanguage } from './input/language.js';
import { DefaultReader, type InputReader } from './input/reader.js';
import { NapiPdfInspector } from './input/napi-pdf-inspector.js';
import { createAnthropicProvider } from './llm/anthropic.js';
import { createOpenAiProvider } from './llm/openai.js';
import type { LlmMessage, LlmProvider, LlmRequest } from './llm/provider.js';
import { JsonSpecValidator, type SpecValidator } from './spec/validator.js';
import type { ExtractInput, ExtractOptions, SpecsResult, CallOptions } from './types.js';

export interface Extractor {
  extract(input: ExtractInput, options?: ExtractOptions): Promise<SpecsResult>;
}

export interface ExtractorDependencies {
  reader: InputReader;
  llm: LlmProvider;
  validator: SpecValidator;
}

const SYSTEM_PROMPT = `You are a precise product-specification extraction assistant. Extract only technical specifications and measurable attributes that are explicitly stated in the given content — never infer, estimate, or fabricate a value.

Focus on quantifiable features such as:
- Dimensions
- Weight
- Technical specifications (e.g., processor, RAM, storage)
- Material composition
- Performance metrics

Rules:
- Respond with a single JSON object and nothing else — no prose, no markdown code fences.
- Every value must be a string, including numbers — keep the original unit (e.g. "1.5 kg", not 1.5).
- Use one consistent key per attribute; never create near-duplicate keys for the same fact.
- If no specifications are found, return {}.`;

function languageName(lang: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

function buildSystemPrompt(lang: string): string {
  if (lang === 'en') return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\nWrite every key and value in ${languageName(lang)}.`;
}

export class DefaultExtractor implements Extractor {
  constructor(private readonly dependencies: ExtractorDependencies) {}

  async extract(input: ExtractInput, options?: ExtractOptions): Promise<SpecsResult> {
    const readResult = await this.dependencies.reader.read(input);
    const text = readResult.text.trim();
    if (readResult.imageOnly) {
      return {};
    }
    if (!text) {
      throw new ExtractionError('EMPTY_INPUT', 'Input is empty');
    }
    const lang = options?.lang ?? detectLanguage(text) ?? 'en';
    const messages: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(lang) },
      { role: 'user', content: text },
    ];
    const request: LlmRequest = {
      messages,
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
    return result.spec;
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
export function extract(file: Blob, options?: ExtractOptions): Promise<SpecsResult>;
export function extract(path: URL, options?: ExtractOptions): Promise<SpecsResult>;
export function extract(input: ExtractInput, options?: ExtractOptions): Promise<SpecsResult> {
  const providerOptions = options?.apiKey !== undefined ? { apiKey: options.apiKey } : undefined;
  const llm =
    options?.provider === 'anthropic'
      ? createAnthropicProvider(providerOptions)
      : createOpenAiProvider(providerOptions);
  return createExtractor({ llm }).extract(input, options);
}
