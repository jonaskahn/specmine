export type SpecValue = string;

export interface ProductSpec {
  [key: string]: SpecValue;
}

export interface NestedSpecs {
  [key: string]: SpecValue | NestedSpecs;
}

export type SpecsResult = ProductSpec | NestedSpecs;

export type ExtractionErrorCode =
  'EMPTY_INPUT' | 'UNSUPPORTED_INPUT' | 'LLM_ERROR' | 'INVALID_OUTPUT' | 'TIMEOUT';

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExtractOptions extends CallOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  lang?: string;
  flattened?: boolean;
  /** flattened mode: keep parent-key prefixes (' · ') when true, innermost leaf pairs when false. Default: false */
  inheritance?: boolean;
}

export type ExtractInput = string | Blob | URL;
