export type {
  CallOptions,
  CategoryInfo,
  ClassifierConfig,
  ExtractInput,
  ExtractOptions,
  ExtractionErrorCode,
  GeneratedImage,
  ImageGrounding,
  ImageOutputOptions,
  NestedSpecs,
  OutputKind,
  PictureInfo,
  PictureOutcome,
  ProcessErrors,
  ProcessMode,
  ProcessOptions,
  ProcessResult,
  ProductSpec,
  SpecsResult,
  TaggedResult,
  TagsResult,
} from './types.js';
export { ExtractionError, isExtractionError } from './errors.js';
export type { Extractor, ExtractorDependencies } from './extractor.js';
export { createExtractor, DefaultExtractor, extract, extractTags } from './extractor.js';
export type { InputKind, InputReader, ReadResult } from './input/reader.js';
export { DefaultReader } from './input/reader.js';
export type { PdfClassification, PdfExtraction, PdfInspector, PdfType } from './input/pdf.js';
export type { VideoMetadata, VideoSessionOptions } from './input/video.js';
export {
  EMPTY_VIDEO_METADATA,
  isVideoUrl,
  readVideoMetadata,
  thumbnailCandidate,
  videoToText,
} from './input/video.js';
export { NapiPdfInspector } from './input/napi-pdf-inspector.js';
export type {
  LlmContentPart,
  LlmMessage,
  LlmPdfPart,
  LlmProvider,
  LlmProviderOptions,
  LlmRequest,
  LlmResponse,
  LlmRole,
  LlmTextPart,
  LlmUsage,
} from './llm/provider.js';
export type { AnthropicOptions } from './llm/anthropic.js';
export {
  AnthropicClient,
  createAnthropicProvider,
  DEFAULT_ANTHROPIC_API_HOST,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_VERSION,
} from './llm/anthropic.js';
export type { OpenAiCompatibleOptions } from './llm/openai.js';
export {
  createOpenAiProvider,
  DEFAULT_OPENAI_API_HOST,
  DEFAULT_OPENAI_MODEL,
  OpenAiClient,
} from './llm/openai.js';
export type { CircuitBreakerPolicy, ResilienceOptions, RetryPolicy } from './llm/resilience.js';
export {
  createResilientProvider,
  DEFAULT_BACKOFF_MS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MAX_RETRIES,
  ResilientProvider,
} from './llm/resilience.js';
export type { SpecValidationResult, SpecValidator } from './spec/validator.js';
export { JsonSpecValidator } from './spec/validator.js';
export type {
  ArchetypeId,
  ArchetypeRecipe,
  ContentKind,
  DomainId,
  DomainProfile,
  FamilyId,
  FamilyProfile,
  ResolvedProfile,
  ScopeKind,
} from './category/types.js';
export {
  familyOf,
  getDomainProfile,
  listDomains,
  registerCategory,
  resetCategoryOverrides,
  resolveProfile,
  tuneProfile,
} from './category/registry.js';
export type {
  Classification,
  ClassifierMode,
  ClassifierOptions,
  ContentClassifier,
  FallbackReason,
} from './classify/classifier.js';
export { JevClassifier, createJevClassifier } from './classify/jev.js';
export type { IdentifyAnswer, IdentifyOptions } from './classify/identify.js';
export {
  buildIdentifyQuestions,
  GENERIC_IDENTIFY,
  IDENTIFY_WINDOW_CHARS,
  identifyContent,
} from './classify/identify.js';
export type { CandidateSource, ImageCandidate } from './media/candidates.js';
export { extractImageCandidates, pickReusableImage } from './media/candidates.js';
export type { CostSummary, UsageEntry } from './telemetry/cost.js';
export {
  BLENDED_RATE_PER_MTOK,
  emptySummary,
  estimateCost,
  recordUsage,
} from './telemetry/cost.js';
export { LlmClassifier } from './classify/llm.js';
export type { PromptMode } from './prompts/spec.js';
export { buildSystemPrompt } from './prompts/spec.js';
export type {
  ImageProvider,
  ImageGenerateRequest,
  ImageGenerateResult,
} from './llm/openai-image.js';
export {
  OpenAiImageClient,
  createOpenAiImageProvider,
  DEFAULT_IMAGE_MODEL,
} from './llm/openai-image.js';
export type { VisualFacts } from './image/facts.js';
export { parseVisualFacts, hasEnoughFacts, countFilledSlots } from './image/facts.js';
export { VisualExtractor } from './image/visual-extractor.js';
export { pickVisualFacts } from './image/fact-picker.js';
export { guessDialect, PROMPT_DIALECTS } from './image/dialects.js';
export type { PromptDialect, PromptDialectId } from './image/dialects.js';
export { buildImagePrompt } from './image/prompt-builder.js';
export { sanitizePrompt, stripMarketing, stripMeasurements } from './image/hygiene.js';
export type { PipelineDependencies } from './pipeline.js';
export {
  DefaultPipeline,
  createPipeline,
  analyze,
  generateImage,
  generateImageBase64,
} from './pipeline.js';
