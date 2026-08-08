import { ExtractionError } from '../errors.js';
import type { CallOptions } from '../types.js';

export interface JsonResponse {
  status: number;
  body: unknown;
}

export async function requestJson(
  url: string,
  init: RequestInit,
  options?: CallOptions,
): Promise<JsonResponse> {
  const controller = new AbortController();
  const timer = options?.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const onSignal = () => controller.abort();
  options?.signal?.addEventListener('abort', onSignal);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ExtractionError(
        'LLM_ERROR',
        `LLM host responded ${response.status}${await detail(response)}`,
      );
    }
    const body: unknown = await response.json().catch(() => {
      throw new ExtractionError('LLM_ERROR', 'LLM host returned invalid JSON');
    });
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    if (isAbortError(error)) {
      throw new ExtractionError('TIMEOUT', 'LLM call aborted', error);
    }
    throw new ExtractionError(
      'LLM_ERROR',
      `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  } finally {
    if (timer) clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onSignal);
  }
}

async function detail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text ? `: ${text.slice(0, 200)}` : '';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
