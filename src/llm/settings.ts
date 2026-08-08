import type { LlmProviderOptions } from './provider.js';

export interface ResolvedSettings {
  apiHost: string;
  apiKey: string;
  model: string;
}

export function resolveSettings(
  options: LlmProviderOptions | undefined,
  envKey: string | undefined,
  defaults: { host: string; model: string },
): ResolvedSettings {
  return {
    apiHost: options?.apiHost ?? process.env.SPECMINE_LLM_API_HOST ?? defaults.host,
    apiKey: options?.apiKey ?? envKey ?? '',
    model: options?.model ?? process.env.SPECMINE_LLM_MODEL ?? defaults.model,
  };
}
