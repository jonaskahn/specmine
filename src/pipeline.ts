import { familyOf, listDomains, resolveProfile, tuneProfile } from './category/registry.js';
import type { DomainId, ResolvedProfile } from './category/types.js';
import {
  GENERIC_CLASSIFICATION,
  isClassifierMode,
  type Classification,
  type ClassifierMode,
  type ContentClassifier,
  type FallbackReason,
} from './classify/classifier.js';
import { identifyContent, GENERIC_IDENTIFY, type IdentifyAnswer } from './classify/identify.js';
import { JevClassifier } from './classify/jev.js';
import { LlmClassifier } from './classify/llm.js';
import { ExtractionError } from './errors.js';
import { DefaultReader, type InputReader } from './input/reader.js';
import { NapiPdfInspector } from './input/napi-pdf-inspector.js';
import { createAnthropicProvider } from './llm/anthropic.js';
import { createOpenAiImageProvider, type ImageProvider } from './llm/openai-image.js';
import { createOpenAiProvider } from './llm/openai.js';
import { MeteredProvider } from './llm/metered.js';
import type { LlmProvider } from './llm/provider.js';
import { logger } from './log.js';
import { DefaultExtractor } from './extractor.js';
import { JsonSpecValidator, type SpecValidator } from './spec/validator.js';
import { guessDialect, PROMPT_DIALECTS, type PromptDialectId } from './image/dialects.js';
import { hasEnoughFacts } from './image/facts.js';
import { resolveGroundedFacts } from './image/ladder.js';
import { ARCHETYPE_RECIPES } from './category/archetypes.js';
import { pickVisualFacts } from './image/fact-picker.js';
import type { ImageCandidate } from './media/candidates.js';
import { buildProseRequest, parseProse, type ProseResult } from './prompts/summary.js';
import { pickReusableImage } from './media/candidates.js';
import { emptySummary, logCostSummary, recordUsage } from './telemetry/cost.js';
import { buildImagePrompt } from './image/prompt-builder.js';
import { VisualExtractor } from './image/visual-extractor.js';
import type {
  CallOptions,
  ExtractInput,
  GeneratedImage,
  ImageEntry,
  ProcessOptions,
  ProcessResult,
  SpecsResult,
  TagsResult,
} from './types.js';

export interface PipelineDependencies {
  reader: InputReader;
  llm: LlmProvider;
  validator: SpecValidator;
  classifier: ContentClassifier;
  imageProvider: ImageProvider;
}

function asDomainId(value: string): DomainId {
  return listDomains().includes(value as DomainId) ? (value as DomainId) : 'general';
}

function callOptionsOf(options?: ProcessOptions): CallOptions {
  return {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  };
}

function defaultClassifier(llm: LlmProvider, options?: ProcessOptions): ContentClassifier {
  const fallback = (reason: FallbackReason): ContentClassifier => ({
    classify: async () => ({ ...GENERIC_CLASSIFICATION, reason }),
  });
  const raw =
    options?.classifier?.mode ?? options?.classifier?.provider ?? process.env.SPECMINE_CLASSIFIER;
  const mode: ClassifierMode = isClassifierMode(raw) ? raw : 'auto';
  if (mode === 'off') return fallback('disabled');
  if (mode === 'llm') return new LlmClassifier(llm);
  const jevApiKey = options?.classifier?.apiKey ?? options?.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (mode === 'jev' || (mode === 'auto' && jevApiKey)) {
    const primary = new JevClassifier({
      ...(options?.classifier?.apiKey !== undefined ? { apiKey: options.classifier.apiKey } : {}),
      ...(options?.classifier?.apiHost !== undefined
        ? { apiHost: options.classifier.apiHost }
        : {}),
    });
    return {
      classify: async (text, opts) => {
        try {
          const result = await primary.classify(text, opts);
          const min = options?.classifier?.minConfidence ?? 0;
          if (result.confidence >= min) return result;
          logger().warn('Jev confidence below minimum, using generic classification');
          return { ...GENERIC_CLASSIFICATION, reason: 'low_confidence' };
        } catch {
          logger().warn('Jev classification failed, using generic classification');
          return { ...GENERIC_CLASSIFICATION, reason: 'jev_error' };
        }
      },
    };
  }
  return fallback('no_key');
}

/**
 * The identify answer tunes the classification: a domain it already settled
 * wins over the classifier's guess, but never over an explicit user category.
 */
async function classifyInput(
  text: string,
  classifier: ContentClassifier,
  options: ProcessOptions | undefined,
  callOptions: CallOptions,
  identified: IdentifyAnswer,
): Promise<Classification> {
  if (options?.category !== undefined) {
    return {
      kind: (options.kind as Classification['kind']) ?? 'item_detail',
      domain: asDomainId(options.category),
      scope: 'single',
      visual: true,
      confidence: 1,
      source: 'user',
      reason: 'user_override',
    };
  }
  try {
    const result = await classifier.classify(text, {
      ...callOptions,
      ...(options?.classifier?.model !== undefined ? { model: options.classifier.model } : {}),
      ...(options?.classifier?.minConfidence !== undefined
        ? { minConfidence: options.classifier.minConfidence }
        : {}),
    });
    const tuned =
      result.source === 'fallback' && identified.domain !== GENERIC_IDENTIFY.domain
        ? { ...result, domain: identified.domain }
        : result;
    logger().info('Classification resolved', {
      kind: tuned.kind,
      domain: tuned.domain,
      confidence: tuned.confidence,
    });
    return tuned;
  } catch {
    return { ...GENERIC_CLASSIFICATION, reason: 'classify_error' };
  }
}

/**
 * The profile identify selected tunes every downstream prompt. When identify
 * is unsure or failed, `GENERIC_IDENTIFY.category` is the generic key, which
 * contributes no tuning — the generic profile, as the spec requires.
 */
function profileOf(classification: Classification, identified: IdentifyAnswer): ResolvedProfile {
  return tuneProfile(resolveProfile(classification.domain), identified.category);
}

/**
 * A block is content that *should* have had a picture but cannot; a refusal is
 * a category that never takes one. They read differently in the outcome field.
 */
function imageBlocker(
  classification: Classification,
  profile: ResolvedProfile,
): 'blocked' | 'refused' | undefined {
  if (classification.kind === 'non_content') return 'blocked';
  if (!profile.allowImage) return 'refused';
  return undefined;
}

const POLICY_PATTERN = /content[_ ]policy|safety system|moderation|responsible ai|rejected/i;
const TRANSIENT_PATTERN = /responded (429|5\d\d)\b/;

function classifyImageError(error: unknown): 'policy' | 'transient' | 'fatal' {
  const message = error instanceof Error ? error.message : String(error);
  if (POLICY_PATTERN.test(message)) return 'policy';
  if (TRANSIENT_PATTERN.test(message)) return 'transient';
  return 'fatal';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class DefaultPipeline {
  constructor(private readonly dependencies: PipelineDependencies) {}

  async process(input: ExtractInput, options?: ProcessOptions): Promise<ProcessResult> {
    const log = logger();
    const outputs = options?.outputs ?? ['spec'];
    const wantSpec = outputs.includes('spec');
    const wantImage = outputs.includes('image');
    const mode = options?.mode ?? 'parallel';
    const callOptions = callOptionsOf(options);
    const readResult = await this.dependencies.reader.read(input);
    const text = readResult.text.trim();
    if (!text) {
      throw new ExtractionError('EMPTY_INPUT', 'Input is empty');
    }
    const cost = emptySummary();
    const metered = new MeteredProvider(this.dependencies.llm, cost);
    const identified = await identifyContent(
      text,
      {
        ...(options?.classifier?.apiKey !== undefined ? { apiKey: options.classifier.apiKey } : {}),
        ...(options?.classifier?.apiHost !== undefined
          ? { apiHost: options.classifier.apiHost }
          : {}),
        ...(options?.classifier?.model !== undefined ? { model: options.classifier.model } : {}),
      },
      (stateChars) =>
        recordUsage(cost, {
          stage: 'identify',
          model: 'jev-latest',
          inputTokens: Math.ceil(stateChars / 4),
          // Jev's endpoint returns no usage block, so this one is inferred.
          estimated: true,
        }),
    );
    const classification = await classifyInput(
      text,
      this.dependencies.classifier,
      options,
      callOptions,
      identified,
    );
    if (classification.kind === 'non_content' && options?.category === undefined) {
      throw new ExtractionError('EMPTY_INPUT', 'Input contains no usable content');
    }
    const profile = profileOf(classification, identified);
    log.info('Process started', {
      kind: classification.kind,
      domain: classification.domain,
      input: readResult.kind,
      mode,
      outputs: outputs.join(','),
    });
    const startedAt = Date.now();
    const extractor = new DefaultExtractor({
      reader: this.dependencies.reader,
      llm: metered,
      validator: this.dependencies.validator,
    });
    const specMode = options?.tags === true ? 'specs-and-tags' : 'specs';

    // A title or description the source states for itself is free and always
    // wins; generation only fills what is missing. With a summary not wanted
    // and both stated, there is nothing left to ask for and no call is made.
    const haveTitle = readResult.title !== undefined;
    const haveDescription = readResult.description !== undefined;
    const wantSummary = options?.summary !== false;
    const needProse = wantSummary || !haveTitle || !haveDescription;

    const runProse = async (): Promise<ProseResult> =>
      metered
        .withStage('summary', () =>
          // `metered`, not the raw provider: without it the call happens but
          // its tokens never reach the cost summary.
          metered.complete(
            buildProseRequest(
              text,
              readResult.kind,
              {
                title: !haveTitle,
                description: !haveDescription,
                summary: wantSummary,
              },
              {
                // Whatever the source stated is handed over even though we then
                // keep it: the model needs the real wording to write a summary
                // that agrees with it, and for html it never appears in the text.
                ...(readResult.title !== undefined ? { title: readResult.title } : {}),
                ...(readResult.description !== undefined
                  ? { description: readResult.description }
                  : {}),
              },
            ),
            callOptions,
          ),
        )
        .then((response) => parseProse(response.content));

    const runSpec = async (): Promise<{ spec: SpecsResult; tags: TagsResult }> =>
      metered.withStage('spec', () =>
        extractor.extractFromText(text, options, specMode, profile, readResult.kind),
      );

    const dynamicFacts = async () => {
      const visual = new VisualExtractor(metered);
      return metered.withStage('image', () =>
        visual.extract(text, profile, {
          ...callOptions,
          ...(options?.image?.model !== undefined ? { model: options.image.model } : {}),
          minFacts: profile.minFacts,
        }),
      );
    };

    const runImageDynamic = async (): Promise<GeneratedImage> =>
      this.runImage(profile, options, callOptions, text, dynamicFacts, metered);

    const runImageFromSpec = async (spec: SpecsResult, tags: TagsResult): Promise<GeneratedImage> =>
      this.runImage(
        profile,
        options,
        callOptions,
        text,
        async () => pickVisualFacts(spec, tags, profile.subjectNoun, profile.keyMap),
        metered,
      );

    let spec: SpecsResult | undefined;
    let tags: TagsResult | undefined;
    let image: GeneratedImage | undefined;
    let specError: ExtractionError | undefined;
    let imageError: ExtractionError | undefined;
    let prose: ProseResult | undefined;
    let proseError: ExtractionError | undefined;

    const blocker = wantImage ? imageBlocker(classification, profile) : undefined;
    const skipReason =
      blocker === 'blocked'
        ? 'No content to depict'
        : blocker === 'refused'
          ? `Category ${classification.domain} does not allow images`
          : undefined;
    if (skipReason) {
      imageError = new ExtractionError('UNSUPPORTED_INPUT', skipReason);
    }
    // Stage 1+2 of the decision: rules find the page's own pictures, reuse takes
    // the best one. Only when the page carries none do we fall through to draw.
    const reusable =
      wantImage && skipReason === undefined
        ? pickReusableImage(readResult.candidates ?? [])
        : undefined;

    const drawImage = wantImage && skipReason === undefined && reusable === undefined;

    if (mode === 'sequential' && wantSpec && wantImage && !skipReason) {
      try {
        const result = await runSpec();
        spec = result.spec;
        tags = result.tags;
      } catch (error) {
        specError = toExtractionError(error);
      }
      if (spec !== undefined && tags !== undefined) {
        if (drawImage) {
          try {
            const picked = pickVisualFacts(spec, tags, profile.subjectNoun, profile.keyMap);
            image = hasEnoughFacts(picked, profile.minFacts)
              ? await runImageFromSpec(spec, tags)
              : await runImageDynamic();
          } catch (error) {
            imageError = toExtractionError(error);
          }
        }
      } else if (drawImage) {
        try {
          image = await runImageDynamic();
        } catch (error) {
          imageError = toExtractionError(error);
        }
      }
      // Sequential means one call at a time, so the prose waits its turn rather
      // than riding the parallel path.
      if (needProse) {
        try {
          prose = await runProse();
        } catch (error) {
          proseError = toExtractionError(error);
        }
      }
    } else {
      const tasks: Array<Promise<unknown>> = [];
      if (wantSpec) {
        tasks.push(
          runSpec().then(
            (result) => {
              spec = result.spec;
              tags = result.tags;
            },
            (error: unknown) => {
              specError = toExtractionError(error);
            },
          ),
        );
      }
      if (drawImage) {
        tasks.push(
          runImageDynamic().then(
            (result) => {
              image = result;
            },
            (error: unknown) => {
              imageError = toExtractionError(error);
            },
          ),
        );
      }
      if (needProse) {
        tasks.push(
          runProse().then(
            (result) => {
              prose = result;
            },
            (error: unknown) => {
              proseError = toExtractionError(error);
            },
          ),
        );
      }
      await Promise.all(tasks);
    }

    if (options?.failFast === true) {
      if (specError) throw specError;
      if (imageError && wantImage && image === undefined) throw imageError;
      if (proseError) throw proseError;
    }
    const picture: ImageEntry[] = toImageEntries({
      wantImage,
      candidates: readResult.candidates ?? [],
      reusable,
      image,
      blocker,
    });
    // A reused picture satisfies the image output just as a drawn one does.
    const imageSatisfied = image !== undefined || reusable !== undefined;
    const specFailed = wantSpec && spec === undefined;
    const imageFailed = drawImage && image === undefined;
    if (specFailed && !imageSatisfied) {
      throw specError!;
    }
    if (imageFailed && spec === undefined) {
      throw imageError!;
    }

    const result: ProcessResult = {
      category: {
        kind: classification.kind,
        domain: classification.domain,
        family: profile.family,
        archetype: profile.recipe.id,
        confidence: classification.confidence,
        source: classification.source,
        ...(classification.reason !== undefined ? { reason: classification.reason } : {}),
      },
    };
    if (readResult.title !== undefined) result.title = readResult.title;
    if (readResult.description !== undefined) result.description = readResult.description;
    if (prose !== undefined) {
      // Generation fills gaps only: whatever the source stated stands.
      if (!haveTitle && prose.title) result.title = prose.title;
      if (!haveDescription && prose.description) result.description = prose.description;
      if (wantSummary && prose.summary) result.summary = prose.summary;
    }
    if (spec !== undefined) result.spec = spec;
    if (tags !== undefined && options?.tags === true) result.tags = tags;
    if (image !== undefined) result.image = image;
    // Every picture the input offered plus the decision, so a caller can pick a
    // different image than we did without re-reading the source.
    result.images = picture;
    result.cost = cost;
    logCostSummary(cost);
    if (specError ?? imageError ?? proseError) {
      result.errors = {
        ...(specError ? { spec: specError } : {}),
        ...(imageError ? { image: imageError } : {}),
        ...(proseError ? { summary: proseError } : {}),
      };
    }
    log.info('Process complete', {
      domain: classification.domain,
      hasSpec: spec !== undefined,
      hasImage: image !== undefined,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  private async runImage(
    profile: ResolvedProfile,
    options: ProcessOptions | undefined,
    callOptions: CallOptions,
    text: string,
    literal: () => Promise<import('./image/facts.js').VisualFacts | undefined>,
    metered: MeteredProvider,
  ): Promise<GeneratedImage> {
    const grounded = await metered.withStage('image', () =>
      resolveGroundedFacts({
        text,
        profile,
        llm: metered,
        literal,
        ...(options?.image?.model !== undefined ? { model: options.image.model } : {}),
        call: callOptions,
      }),
    );
    const model = options?.image?.model;
    const dialectId = (options?.image?.dialect ?? '') as PromptDialectId;
    const dialect =
      dialectId && dialectId in PROMPT_DIALECTS ? PROMPT_DIALECTS[dialectId] : guessDialect(model);
    const style = options?.image?.style;
    const build = (facts: import('./image/facts.js').VisualFacts, using: ResolvedProfile): string =>
      buildImagePrompt(facts, using, dialect, { ...(style !== undefined ? { style } : {}) });
    let prompt = build(grounded.facts, grounded.profile);
    const neutral = {
      subject: profile.subjectNoun,
      colors: [],
      materials: [],
      heroFeatures: [],
    };
    const safePrompt = build(neutral, {
      ...profile,
      recipe: ARCHETYPE_RECIPES.generic_subject,
    });
    const size = options?.image?.size ?? grounded.profile.defaultSize;
    const maxRetries = options?.image?.maxRetries ?? 2;
    const backoff = options?.image?.retryBackoffMs ?? 500;
    const deadline = Date.now() + (options?.image?.totalTimeoutMs ?? 240_000);
    let attempt = 0;
    let generated: Awaited<ReturnType<ImageProvider['generate']>>;
    for (;;) {
      try {
        generated = await this.dependencies.imageProvider.generate(
          {
            prompt,
            ...(model !== undefined ? { model } : {}),
            size,
            ...(options?.image?.quality !== undefined ? { quality: options.image.quality } : {}),
            ...(options?.image?.background !== undefined
              ? { background: options.image.background }
              : {}),
          },
          {
            ...callOptions,
            ...(options?.image?.timeoutMs !== undefined
              ? { timeoutMs: options.image.timeoutMs }
              : {}),
          },
        );
        break;
      } catch (error) {
        const kind = classifyImageError(error);
        if (kind === 'fatal' || attempt >= maxRetries || Date.now() >= deadline) throw error;
        attempt += 1;
        logger().warn('Image generation retry', { attempt, kind });
        if (kind === 'policy') prompt = safePrompt;
        else await sleep(backoff * attempt);
      }
    }
    const blob = new Blob([generated.bytes as Uint8Array<ArrayBuffer>], {
      type: generated.mimeType,
    });
    const base64 = Buffer.from(generated.bytes).toString('base64');
    const result: GeneratedImage = {
      grounding: grounded.grounding,
      blob,
      mimeType: generated.mimeType,
      base64,
      dataUrl: `data:${generated.mimeType};base64,${base64}`,
    };
    if (options?.image?.includePrompt === true) {
      result.prompt = prompt;
      if (generated.revisedPrompt !== undefined) result.revisedPrompt = generated.revisedPrompt;
    }
    return result;
  }
}

/**
 * One entry per picture the input offered, each saying what it is and whether it
 * was the one we picked — so a caller can choose a different image without
 * re-reading the source. A run that ends with no picture still gets an entry,
 * because `blocked` (the draw was refused or failed) and `none` (the category
 * never takes one) are recorded nowhere else.
 */
function toImageEntries(options: {
  wantImage: boolean;
  candidates: ImageCandidate[];
  reusable: ImageCandidate | undefined;
  image: GeneratedImage | undefined;
  blocker: 'blocked' | 'refused' | undefined;
}): ImageEntry[] {
  const { wantImage, candidates, reusable, image, blocker } = options;
  // No image was asked for, so no decision was made and none is reported.
  if (!wantImage) return [];

  const extracted: ImageEntry[] = candidates.map((candidate) => ({
    type: 'extracted',
    url: candidate.url,
    source: candidate.source,
    alt: candidate.alt,
    ...(candidate.score !== undefined ? { score: candidate.score } : {}),
    ...(candidate.position !== undefined ? { position: candidate.position } : {}),
    ...(candidate.width !== undefined ? { width: candidate.width } : {}),
    ...(candidate.height !== undefined ? { height: candidate.height } : {}),
    ...(candidate.type !== undefined ? { mediaType: candidate.type } : {}),
    ...(candidate.title !== undefined ? { title: candidate.title } : {}),
    selected: candidate === reusable,
  }));

  if (reusable !== undefined) return extracted;
  if (image !== undefined) return [...extracted, { type: 'generated', image, selected: true }];
  return [{ type: blocker === 'refused' ? 'none' : 'blocked', selected: true }];
}

function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  return new ExtractionError(
    'LLM_ERROR',
    error instanceof Error ? error.message : String(error),
    error,
  );
}

export function createPipeline(
  dependencies?: Partial<PipelineDependencies> & { llm?: LlmProvider },
  options?: ProcessOptions,
): DefaultPipeline {
  const llm = dependencies?.llm ?? providerFrom(options);
  const validator = dependencies?.validator ?? new JsonSpecValidator();
  const reader =
    dependencies?.reader ??
    new DefaultReader(new NapiPdfInspector(), options?.videoSession, options?.videoTranscriptMs);
  return new DefaultPipeline({
    reader,
    llm,
    validator,
    classifier: dependencies?.classifier ?? defaultClassifier(llm, options),
    imageProvider:
      dependencies?.imageProvider ?? createOpenAiImageProvider(imageOptionsFrom(options)),
  });
}

export function imageOptionsFrom(options?: ProcessOptions): {
  apiKey?: string;
  apiHost?: string;
  model?: string;
} {
  return {
    ...((options?.image?.apiKey ?? options?.apiKey)
      ? { apiKey: options?.image?.apiKey ?? options?.apiKey }
      : {}),
    ...(options?.image?.apiHost ? { apiHost: options.image.apiHost } : {}),
    ...(options?.image?.model ? { model: options.image.model } : {}),
  };
}

export function providerFrom(options?: ProcessOptions): LlmProvider {
  const providerOptions = options?.apiKey !== undefined ? { apiKey: options.apiKey } : undefined;
  return options?.provider === 'anthropic'
    ? createAnthropicProvider(providerOptions)
    : createOpenAiProvider(providerOptions);
}

export function analyze(input: ExtractInput, options?: ProcessOptions): Promise<ProcessResult> {
  return createPipeline(undefined, options).process(input, options);
}

export async function generateImage(
  input: ExtractInput,
  options?: ProcessOptions,
): Promise<GeneratedImage> {
  const result = await analyze(input, { ...options, outputs: ['image'] });
  if (result.image) return result.image;
  throw result.errors!.image!;
}

export async function generateImageBase64(
  input: ExtractInput,
  options?: ProcessOptions,
): Promise<string> {
  return (await generateImage(input, options)).base64;
}

export { getDomainProfile, resolveProfile, registerCategory } from './category/registry.js';
export type { Classification } from './classify/classifier.js';
export { VisualExtractor } from './image/visual-extractor.js';
export { buildImagePrompt } from './image/prompt-builder.js';
export { pickVisualFacts } from './image/fact-picker.js';
export { guessDialect } from './image/dialects.js';
export { familyOf };
