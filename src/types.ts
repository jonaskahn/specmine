import type { ClassifierMode } from './classify/classifier.js';
import type { ImageCandidate } from './media/candidates.js';

import type { CostSummary } from './telemetry/cost.js';

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

export interface CdpOptions {
  /** WebSocket CDP endpoint, or an HTTP(S) browser discovery URL. */
  endpoint: string;
  /** CDP connection/discovery headers, e.g. Authorization for Obscura. */
  headers?: Record<string, string>;
  /** Total browser read deadline in ms. Default: timeoutMs from the call, or 30_000. */
  timeoutMs?: number;
  /** Navigation readiness. Default: 'networkidle2'. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** Wait for this CSS selector after navigation, before capturing HTML. */
  waitForSelector?: string;
}

export interface ReadOptions extends CallOptions {
  /** Render HTTP(S) pages through an existing Obscura/Chromium CDP server. */
  cdp?: CdpOptions;
}

export interface ExtractOptions extends ReadOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  lang?: string;
  flattened?: boolean;
  /** flattened mode: keep parent-key prefixes (' · ') when true, innermost leaf pairs when false. Default: false */
  inheritance?: boolean;
  /** also return a short list of descriptive tags alongside the specs. Default: false */
  tags?: boolean;
  /** youtubei.js session options for video input — lang, location, cookie,
   *  client_type, and the rest. See https://ytjs.dev/guide/getting-started.html */
  videoSession?: Record<string, unknown>;
  /** how long a video's caption fetch may take before falling back to
   *  metadata-only. Default: 15_000 */
  videoTranscriptMs?: number;
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
  /** also return a short factual overview of the content. Default: true. A
   *  source that states its own title and description still costs one call for
   *  the overview unless this is false. */
  summary?: boolean;
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

/**
 * What each entry of `ProcessResult.images` is. `extracted` is a picture the
 * source already carried, `generated` one we drew; `blocked` and `none` are the
 * two ways no picture exists — the draw was refused or failed, or the category
 * never takes one. They are entries rather than an empty array so a caller
 * reading the first entry always learns what happened.
 */
export type ImageType = 'extracted' | 'generated' | 'blocked' | 'none';

export interface ExtractedImage {
  type: 'extracted';
  url: string;
  /** where the source carried it: og:image, twitter:image, gallery, thumbnail, alt */
  source: ImageCandidate['source'];
  alt: string;
  /** 0–1 plausibility, when there was more than one candidate to rank */
  score?: number;
  /** where it sat in the source: meta tags first, then images in document order */
  position?: number;
  width?: number;
  height?: number;
  /** the image mime type, when the markup or its extension stated one */
  mediaType?: string;
  /** the image's own title, when it had one */
  title?: string;
  /** true for exactly the entry the pipeline chose */
  selected: boolean;
}

export interface GeneratedImageEntry {
  type: 'generated';
  image: GeneratedImage;
  selected: true;
}

/** No picture exists, and this says why. */
export interface AbsentImage {
  type: 'blocked' | 'none';
  selected: true;
}

export type ImageEntry = ExtractedImage | GeneratedImageEntry | AbsentImage;

export interface ProcessErrors {
  spec?: import('./errors.js').ExtractionError;
  image?: import('./errors.js').ExtractionError;
  summary?: import('./errors.js').ExtractionError;
}

export interface ProcessResult {
  category: CategoryInfo;
  /** what this content is called. The source's own title when it stated one —
   *  a video's title, a page's og:title or <title> — otherwise written from the
   *  content, because a source that states no title would otherwise have none. */
  title?: string;
  /** the source's own description when it stated one; otherwise written from
   *  the content on the same terms as `title`. */
  description?: string;
  /** two to four factual sentences on what the content is and what it states.
   *  Omitted when `summary: false`. */
  summary?: string;
  spec?: SpecsResult;
  tags?: TagsResult;
  image?: GeneratedImage;
  /**
   * Every picture the input offered, best-scoring first, each entry saying what
   * it is and whether it was the one we chose. Holds the decision as well as
   * the evidence: the chosen entry carries `selected`, and a run with no picture
   * carries a single `blocked` or `none` entry explaining why. Empty when no
   * image was requested, or when the input offered none and nothing was drawn.
   */
  images?: ImageEntry[];
  /** token usage and estimated dollars for this run */
  cost?: CostSummary;
  errors?: ProcessErrors;
}
