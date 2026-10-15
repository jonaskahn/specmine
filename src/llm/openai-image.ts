import { ExtractionError } from '../errors.js';
import { logger } from '../log.js';
import type { CallOptions } from '../types.js';
import { requestJson } from './http.js';
import type { LlmProviderOptions } from './provider.js';
import { resolveSettings, type ResolvedSettings } from './settings.js';
import { DEFAULT_OPENAI_API_HOST } from './openai.js';

export const DEFAULT_IMAGE_MODEL = 'dall-e-3';
export const DEFAULT_IMAGE_TIMEOUT_MS = 120_000;

export type OpenAiImageOptions = LlmProviderOptions;

export interface ImageGenerateRequest {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  n?: number;
}

export interface ImageGenerateResult {
  bytes: Uint8Array;
  mimeType: string;
  revisedPrompt?: string;
}

export interface ImageProvider {
  generate(request: ImageGenerateRequest, options?: CallOptions): Promise<ImageGenerateResult>;
}

interface ImageApiItem {
  b64_json?: string | null;
  url?: string | null;
  revised_prompt?: string | null;
}

interface ImageApiBody {
  data?: ImageApiItem[];
}

function resolve(options: OpenAiImageOptions | undefined): ResolvedSettings {
  const settings = resolveSettings(
    options,
    process.env.SPECMINE_IMAGE_API_KEY ??
      process.env.SPECMINE_LLM_API_KEY ??
      process.env.OPENAI_API_KEY,
    { host: DEFAULT_OPENAI_API_HOST, model: DEFAULT_IMAGE_MODEL },
  );
  return {
    ...settings,
    model:
      options?.model ??
      process.env.SPECMINE_IMAGE_MODEL ??
      process.env.SPECMINE_LLM_MODEL ??
      DEFAULT_IMAGE_MODEL,
  };
}

function imageHost(): string {
  return process.env.SPECMINE_IMAGE_API_HOST ?? process.env.SPECMINE_LLM_API_HOST ?? '';
}

async function fetchUrlAsBytes(url: string, options?: CallOptions): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const onSignal = () => controller.abort();
  options?.signal?.addEventListener('abort', onSignal);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ExtractionError('LLM_ERROR', `Image host responded ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ExtractionError('TIMEOUT', 'Image fetch aborted', error);
    }
    throw new ExtractionError(
      'LLM_ERROR',
      `Image fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  } finally {
    if (timer) clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onSignal);
  }
}

function decodeBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export class OpenAiImageClient implements ImageProvider {
  private readonly settings: ResolvedSettings;
  private readonly hostOverride: string;

  constructor(options?: OpenAiImageOptions) {
    this.settings = resolve(options);
    this.hostOverride = options?.apiHost ?? imageHost();
  }

  private get apiHost(): string {
    return this.hostOverride || this.settings.apiHost;
  }

  async generate(
    request: ImageGenerateRequest,
    options?: CallOptions,
  ): Promise<ImageGenerateResult> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new ExtractionError('EMPTY_INPUT', 'Image prompt is empty');
    }
    const { apiKey, model } = this.settings;
    const apiHost = this.apiHost;
    const body = JSON.stringify({
      model: request.model ?? model,
      prompt,
      ...(request.size !== undefined ? { size: request.size } : {}),
      ...(request.quality !== undefined ? { quality: request.quality } : {}),
      ...(request.background !== undefined ? { background: request.background } : {}),
      n: request.n ?? 1,
    });
    logger().debug('Image generation request', {
      model: request.model ?? model,
      apiHost,
      chars: prompt.length,
    });
    const callOptions: CallOptions = {
      timeoutMs: options?.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    };
    const { body: responseBody } = await requestJson(
      `${apiHost}/images/generations`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body,
      },
      callOptions,
    );
    const parsed = responseBody as ImageApiBody;
    const item = parsed.data?.[0];
    if (!item) {
      throw new ExtractionError('LLM_ERROR', 'Image API returned no data');
    }
    const revisedPrompt = typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined;
    if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
      logger().info('Image generation complete', { mode: 'b64_json' });
      return {
        bytes: decodeBase64(item.b64_json),
        mimeType: 'image/png',
        ...(revisedPrompt !== undefined ? { revisedPrompt } : {}),
      };
    }
    if (typeof item.url === 'string' && item.url.length > 0) {
      logger().info('Image generation complete', { mode: 'url' });
      const bytes = await fetchUrlAsBytes(item.url, options);
      return {
        bytes,
        mimeType: 'image/png',
        ...(revisedPrompt !== undefined ? { revisedPrompt } : {}),
      };
    }
    throw new ExtractionError('LLM_ERROR', 'Image API returned neither b64_json nor url');
  }
}

export function createOpenAiImageProvider(options?: OpenAiImageOptions): ImageProvider {
  return new OpenAiImageClient(options);
}
