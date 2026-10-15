import type { ClassifierMode } from './classify/classifier.js';

export type SpecValue = string;

export interface ProductSpec {
  [key: string]: SpecValue;
}

export interface NestedSpecs {
  [key: string]: SpecValue | NestedSpecs;
}

export type SpecsResult = ProductSpec | NestedSpecs;

export type TagsResult = string[];

export interface TaggedResult {
  spec: SpecsResult;
  tags: TagsResult;
}

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
  /** also return a short list of descriptive tags alongside the specs. Default: false */
  tags?: boolean;
}

export type ExtractInput = string | Blob | URL;

export type OutputKind = 'spec' | 'image';

export type ProcessMode = 'parallel' | 'sequential';

export interface ImageOutputOptions extends CallOptions {
  model?: string;
  apiHost?: string;
  apiKey?: string;
  size?: string;
  quality?: string;
  background?: string;
  style?: string;
  dialect?: string;
  /** include the internal render prompt in the result for debugging. Default: false */
  includePrompt?: boolean;
  /** retries for transient provider errors and policy rejections. Default: 2 */
  maxRetries?: number;
  /** base backoff between retries in ms. Default: 500 */
  retryBackoffMs?: number;
  /** stop retrying after this many ms in total. Default: 240000 */
  totalTimeoutMs?: number;
}

export interface ClassifierConfig extends CallOptions {
  /** explicit mode wins over `provider` and SPECMINE_CLASSIFIER. Default: 'auto' */
  mode?: ClassifierMode;
  /** deprecated alias of `mode` */
  provider?: ClassifierMode;
  apiKey?: string;
  apiHost?: string;
  model?: string;
  minConfidence?: number;
}

export interface ProcessOptions extends ExtractOptions {
  outputs?: OutputKind[];
  mode?: ProcessMode;
  category?: string;
  kind?: string;
  classifier?: ClassifierConfig;
  image?: ImageOutputOptions;
  failFast?: boolean;
}

export interface CategoryInfo {
  kind: string;
  domain: string;
  family: string;
  archetype: string;
  confidence: number;
  source: 'jev' | 'llm' | 'user' | 'fallback';
  reason?: string;
}

export type ImageGrounding = 'literal' | 'contextual' | 'conceptual' | 'neutral';

export interface GeneratedImage {
  /** how faithful the picture is: literal facts, stated context, a metaphor, or a neutral fallback */
  grounding: ImageGrounding;
  blob: Blob;
  mimeType: string;
  /** raw base64 image bytes, no data-url prefix */
  base64: string;
  /** ready for <img src>: `data:<mimeType>;base64,<base64>` */
  dataUrl: string;
  /** only present when image.includePrompt is true */
  prompt?: string;
  /** only present when image.includePrompt is true */
  revisedPrompt?: string;
}

export interface ProcessErrors {
  spec?: import('./errors.js').ExtractionError;
  image?: import('./errors.js').ExtractionError;
}

export interface ProcessResult {
  category: CategoryInfo;
  spec?: SpecsResult;
  tags?: TagsResult;
  image?: GeneratedImage;
  errors?: ProcessErrors;
}
