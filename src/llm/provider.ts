import type { CallOptions } from '../types.js';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmTextPart {
  type: 'text';
  text: string;
}

export interface LlmPdfPart {
  type: 'pdf';
  data: Uint8Array;
}

export type LlmContentPart = LlmTextPart | LlmPdfPart;

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[];
}

export interface LlmRequest {
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** request the structured output to include a tags array */
  includeTags?: boolean;
  /** request the structured output to return tags only */
  tagsOnly?: boolean;
  /** override the structured-output schema (tool name stays provider default) */
  schema?: unknown;
  schemaName?: string;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmResponse {
  content: string;
  usage?: LlmUsage;
}

export interface LlmProviderOptions {
  apiHost?: string;
  apiKey?: string;
  model?: string;
}

export interface LlmProvider {
  complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse>;
  /** the model this provider will actually call. Lets a metered wrapper name
   *  the model even when the request itself does not specify one. */
  model?(request: LlmRequest): string | undefined;
}
