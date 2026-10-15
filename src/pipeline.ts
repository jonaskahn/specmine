import { familyOf, listDomains, resolveProfile } from './category/registry.js';
import type { DomainId, ResolvedProfile } from './category/types.js';
import {
  GENERIC_CLASSIFICATION,
  type Classification,
  type ContentClassifier,
} from './classify/classifier.js';
import { JevClassifier } from './classify/jev.js';
import { LlmClassifier } from './classify/llm.js';
import { ExtractionError } from './errors.js';
import { DefaultReader, type InputReader } from './input/reader.js';
import { NapiPdfInspector } from './input/napi-pdf-inspector.js';
import { createAnthropicProvider } from './llm/anthropic.js';
import { createOpenAiImageProvider, type ImageProvider } from './llm/openai-image.js';
import { createOpenAiProvider } from './llm/openai.js';
import type { LlmProvider } from './llm/provider.js';
import { logger } from './log.js';
import { DefaultExtractor } from './extractor.js';
import { JsonSpecValidator, type SpecValidator } from './spec/validator.js';
import { guessDialect, PROMPT_DIALECTS, type PromptDialectId } from './image/dialects.js';
import { hasEnoughFacts } from './image/facts.js';
import { pickVisualFacts } from './image/fact-picker.js';
import { buildImagePrompt } from './image/prompt-builder.js';
import { VisualExtractor } from './image/visual-extractor.js';
import type {
  CallOptions,
  ExtractInput,
  GeneratedImage,
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
  const provider = options?.classifier?.provider ?? 'auto';
  if (provider === 'off') return { classify: async () => ({ ...GENERIC_CLASSIFICATION }) };
  if (provider === 'llm') return new LlmClassifier(llm);
  const jevApiKey = options?.classifier?.apiKey ?? options?.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (provider === 'jev' || jevApiKey) {
    const primary = new JevClassifier({
      ...(options?.classifier?.apiKey !== undefined ? { apiKey: options.classifier.apiKey } : {}),
      ...(options?.classifier?.apiHost !== undefined
        ? { apiHost: options.classifier.apiHost }
        : {}),
    });
    const fallback = new LlmClassifier(llm);
    return {
      classify: async (text, opts) => {
        try {
          const result = await primary.classify(text, opts);
          const min = options?.classifier?.minConfidence ?? 0;
          if (result.confidence >= min) return result;
          return fallback.classify(text, opts);
        } catch {
          return fallback.classify(text, opts);
        }
      },
    };
  }
  return new LlmClassifier(llm);
}

async function classifyInput(
  text: string,
  classifier: ContentClassifier,
  options: ProcessOptions | undefined,
  callOptions: CallOptions,
): Promise<Classification> {
  if (options?.category !== undefined) {
    return {
      kind: (options.kind as Classification['kind']) ?? 'item_detail',
      domain: asDomainId(options.category),
      scope: 'single',
      visual: true,
      confidence: 1,
      source: 'user',
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
    return result;
  } catch {
    return { ...GENERIC_CLASSIFICATION };
  }
}

function profileOf(classification: Classification): ResolvedProfile {
  return resolveProfile(classification.domain);
}

function imageSkipped(
  classification: Classification,
  profile: ResolvedProfile,
): string | undefined {
  if (!classification.visual) return 'Content has no depictable subject';
  if (classification.kind === 'non_content') return 'No content to depict';
  if (classification.kind === 'item_collection' || classification.scope === 'multiple') {
    return 'Collections describe multiple items; image skipped';
  }
  if (classification.kind === 'policy_legal') return 'Policy content is not depicted';
  if (!profile.allowImage) return `Domain ${profile.domain} does not allow image generation`;
  return undefined;
}

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
    const classification = await classifyInput(
      text,
      this.dependencies.classifier,
      options,
      callOptions,
    );
    if (classification.kind === 'non_content' && options?.category === undefined) {
      throw new ExtractionError('EMPTY_INPUT', 'Input contains no usable content');
    }
    const profile = profileOf(classification);
    log.info('Process started', {
      kind: classification.kind,
      domain: classification.domain,
      mode,
      outputs: outputs.join(','),
    });
    const startedAt = Date.now();
    const extractor = new DefaultExtractor({
      reader: this.dependencies.reader,
      llm: this.dependencies.llm,
      validator: this.dependencies.validator,
    });
    const specMode = options?.tags === true ? 'specs-and-tags' : 'specs';

    const runSpec = async (): Promise<{ spec: SpecsResult; tags: TagsResult }> =>
      extractor.extractFromText(text, options, specMode, profile);

    const runImageDynamic = async (): Promise<GeneratedImage> =>
      this.runImage(
        profile,
        options,
        callOptions,
        async () => {
          const visual = new VisualExtractor(this.dependencies.llm);
          return visual.extract(text, profile, {
            ...callOptions,
            ...(options?.image?.model !== undefined ? { model: options.image.model } : {}),
          });
        },
        undefined,
      );

    const runImageFromSpec = async (spec: SpecsResult, tags: TagsResult): Promise<GeneratedImage> =>
      this.runImage(profile, options, callOptions, undefined, () =>
        pickVisualFacts(spec, tags, profile.subjectNoun),
      );

    let spec: SpecsResult | undefined;
    let tags: TagsResult | undefined;
    let image: GeneratedImage | undefined;
    let specError: ExtractionError | undefined;
    let imageError: ExtractionError | undefined;

    const skipReason = wantImage ? imageSkipped(classification, profile) : undefined;
    if (skipReason) {
      imageError = new ExtractionError('UNSUPPORTED_INPUT', skipReason);
    }

    if (mode === 'sequential' && wantSpec && wantImage && !skipReason) {
      try {
        const result = await runSpec();
        spec = result.spec;
        tags = result.tags;
      } catch (error) {
        specError = toExtractionError(error);
      }
      if (spec !== undefined && tags !== undefined) {
        try {
          const picked = pickVisualFacts(spec, tags, profile.subjectNoun);
          image = hasEnoughFacts(picked)
            ? await runImageFromSpec(spec, tags)
            : await runImageDynamic();
        } catch (error) {
          imageError = toExtractionError(error);
        }
      } else {
        try {
          image = await runImageDynamic();
        } catch (error) {
          imageError = toExtractionError(error);
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
      if (wantImage && !skipReason) {
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
      await Promise.all(tasks);
    }

    if (options?.failFast === true) {
      if (specError) throw specError;
      if (imageError && wantImage && image === undefined) throw imageError;
    }
    const specFailed = wantSpec && spec === undefined;
    const imageFailed = wantImage && image === undefined && !skipReason;
    if (specFailed && (!wantImage || image === undefined)) {
      throw specError!;
    }
    if (imageFailed && (!wantSpec || spec === undefined)) {
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
      },
    };
    if (spec !== undefined) result.spec = spec;
    if (tags !== undefined && options?.tags === true) result.tags = tags;
    if (image !== undefined) result.image = image;
    if (specError ?? imageError) {
      result.errors = {
        ...(specError ? { spec: specError } : {}),
        ...(imageError ? { image: imageError } : {}),
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
    dynamic: (() => Promise<import('./image/facts.js').VisualFacts | undefined>) | undefined,
    fromSpec: (() => import('./image/facts.js').VisualFacts) | undefined,
  ): Promise<GeneratedImage> {
    const facts = fromSpec ? fromSpec() : await dynamic?.();
    if (!facts) {
      throw new ExtractionError('LLM_ERROR', 'Could not determine visual facts for image');
    }
    const model = options?.image?.model;
    const dialectId = (options?.image?.dialect ?? '') as PromptDialectId;
    const dialect =
      dialectId && dialectId in PROMPT_DIALECTS ? PROMPT_DIALECTS[dialectId] : guessDialect(model);
    const prompt = buildImagePrompt(facts, profile, dialect, {
      ...(options?.image?.style !== undefined ? { style: options.image.style } : {}),
    });
    const size = options?.image?.size ?? profile.defaultSize;
    const generated = await this.dependencies.imageProvider.generate(
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
        ...(options?.image?.timeoutMs !== undefined ? { timeoutMs: options.image.timeoutMs } : {}),
      },
    );
    const blob = new Blob([generated.bytes as Uint8Array<ArrayBuffer>], {
      type: generated.mimeType,
    });
    const base64 = Buffer.from(generated.bytes).toString('base64');
    const result: GeneratedImage = {
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
  const reader = dependencies?.reader ?? new DefaultReader(new NapiPdfInspector());
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
