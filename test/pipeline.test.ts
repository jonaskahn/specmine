import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_CLASSIFICATION, type Classification } from '../src/classify/classifier.js';
import { neutralFacts } from '../src/image/ladder.js';
import { DefaultExtractor } from '../src/extractor.js';
import { ExtractionError } from '../src/errors.js';
import type { ImageProvider } from '../src/llm/openai-image.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';
import type { InputReader, ReadResult } from '../src/input/reader.js';
import { registerCategory, resetCategoryOverrides } from '../src/category/registry.js';
import type { ImageCandidate } from '../src/media/candidates.js';
import { JsonSpecValidator } from '../src/spec/validator.js';
import { estimateCost } from '../src/telemetry/cost.js';
import { PROSE_MAX_TOKENS } from '../src/prompts/summary.js';
import {
  analyze,
  createPipeline,
  DefaultPipeline,
  generateImage,
  generateImageBase64,
  imageOptionsFrom,
  providerFrom,
} from '../src/pipeline.js';
import type { ProcessOptions } from '../src/types.js';

const TEXT = 'Acme Kettle, matte black stainless steel, 1.5 L.';

function reader(text: string): InputReader {
  return {
    async read(): Promise<ReadResult> {
      return { text, imageOnly: false };
    },
  };
}

/**
 * Answers the prose stage on its own rather than consuming a scripted response,
 * so the existing positional scripts stay about spec and image. Tests that care
 * about prose pass `prose` instead.
 */
const DEFAULT_PROSE = JSON.stringify({
  title: 'Acme Kettle',
  description: 'A matte black stainless steel kettle.',
  summary: 'A short product listing for the Acme Kettle.',
});

function scriptLlm(
  responses: Array<string | Error>,
  prose: string = DEFAULT_PROSE,
): {
  llm: LlmProvider;
  count: () => number;
  proseCalls: () => number;
} {
  let index = 0;
  let proseCount = 0;
  return {
    count: () => index,
    proseCalls: () => proseCount,
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          proseCount += 1;
          return { content: prose, usage: { inputTokens: 100, outputTokens: 40 } };
        }
        const next = responses[index] ?? '{}';
        index += 1;
        if (next instanceof Error) throw next;
        return { content: next };
      },
    },
  };
}

function classifier(result: Classification | Error) {
  return {
    async classify(): Promise<Classification> {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function productClassification(): Classification {
  return {
    kind: 'item_detail',
    domain: 'electronics',
    scope: 'single',
    visual: true,
    confidence: 0.9,
    source: 'jev',
  };
}

function imageProvider(
  options: {
    fail?: Error;
    revisedPrompt?: string;
    seen?: Array<Record<string, unknown>>;
    onGenerate?: () => void;
  } = {},
): ImageProvider {
  return {
    async generate(request) {
      options.seen?.push(request as unknown as Record<string, unknown>);
      options.onGenerate?.();
      if (options.fail) throw options.fail;
      const out: { bytes: Uint8Array; mimeType: string; revisedPrompt?: string } = {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
      };
      if (options.revisedPrompt !== undefined) out.revisedPrompt = options.revisedPrompt;
      return out;
    },
  };
}

function pipeline(
  responses: Array<string | Error>,
  classification: Classification | Error = productClassification(),
  image: ImageProvider = imageProvider(),
  prose: string = DEFAULT_PROSE,
) {
  const script = scriptLlm(responses, prose);
  const deps = {
    reader: reader(TEXT),
    llm: script.llm,
    validator: new JsonSpecValidator(),
    classifier: classifier(classification),
    imageProvider: image,
  };
  return {
    pipeline: new DefaultPipeline(deps),
    calls: script.count,
    proseCalls: script.proseCalls,
  };
}

const SPECS_JSON = JSON.stringify({ Color: 'matte black', Capacity: '1.5 L' });
const RICH_SPECS_JSON = JSON.stringify({
  Color: 'matte black',
  Material: 'stainless steel',
  Shape: 'cylindrical',
  Finish: 'matte',
  Product: 'electric kettle',
});
const VISUAL_JSON = JSON.stringify({
  subject: 'electric kettle',
  colors: ['matte black'],
  materials: ['stainless steel'],
  heroFeatures: ['carry handle'],
});

test('spec-only output is the default with user category', async () => {
  const { pipeline: pipe, calls } = pipeline([SPECS_JSON]);
  const controller = new AbortController();
  const result = await pipe.process('anything', {
    category: 'electronics',
    timeoutMs: 5000,
    signal: controller.signal,
  });
  assert.deepEqual(result.spec, { Color: 'matte black', Capacity: '1.5 L' });
  assert.equal(result.image, undefined);
  assert.equal(result.category.source, 'user');
  assert.equal(result.category.reason, 'user_override');
  assert.equal(result.category.domain, 'electronics');
  assert.equal(result.category.family, 'goods');
  assert.equal(calls(), 1);
});

test('image-only output uses the dynamic visual flow', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const { pipeline: pipe } = pipeline(
    [VISUAL_JSON],
    productClassification(),
    imageProvider({ seen, revisedPrompt: 'rev' }),
  );
  const result = await pipe.process('anything', {
    outputs: ['image'],
    image: { includePrompt: true },
  });
  assert.ok(result.image);
  assert.equal(result.image?.mimeType, 'image/png');
  assert.ok(result.image?.prompt?.includes('electric kettle'));
  assert.equal(result.image?.revisedPrompt, 'rev');
  assert.equal(
    Buffer.from(result.image?.base64 ?? '', 'base64').toString(),
    Buffer.from(new Uint8Array([1, 2, 3])).toString(),
  );
  assert.ok(result.image?.dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(await result.image?.blob.arrayBuffer());
  assert.equal(result.spec, undefined);
  assert.equal(seen[0]?.size, '1024x1024');
});

test('image prompt stays hidden unless requested', async () => {
  const { pipeline: pipe } = pipeline(
    [VISUAL_JSON],
    productClassification(),
    imageProvider({ revisedPrompt: 'rev' }),
  );
  const result = await pipe.process('anything', { outputs: ['image'] });
  assert.ok(result.image?.base64);
  assert.equal(result.image?.prompt, undefined);
  assert.equal(result.image?.revisedPrompt, undefined);
});

test('parallel mode runs spec and image together', async () => {
  const { pipeline: pipe, calls } = pipeline([SPECS_JSON, VISUAL_JSON]);
  const result = await pipe.process('anything', { outputs: ['spec', 'image'] });
  assert.ok(result.spec);
  assert.ok(result.image);
  assert.equal(calls(), 2);
});

test('sequential mode builds the image from the extracted spec', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const { pipeline: pipe, calls } = pipeline(
    [RICH_SPECS_JSON],
    productClassification(),
    imageProvider({ seen }),
  );
  const result = await pipe.process('anything', {
    outputs: ['spec', 'image'],
    mode: 'sequential',
    image: { includePrompt: true },
  });
  assert.ok(result.spec);
  assert.ok(result.image?.prompt?.includes('electric kettle'));
  assert.equal(calls(), 1);
});

test('sequential mode falls back to dynamic flow on thin specs', async () => {
  const { pipeline: pipe } = pipeline(['{"Weight": "2 kg"}', VISUAL_JSON]);
  const result = await pipe.process('anything', {
    outputs: ['spec', 'image'],
    mode: 'sequential',
    image: { includePrompt: true },
  });
  assert.deepEqual(result.spec, { Weight: '2 kg' });
  assert.ok(result.image?.prompt?.includes('electric kettle'));
});

test('sequential mode still renders image when spec fails', async () => {
  const { pipeline: pipe } = pipeline(['not json', VISUAL_JSON]);
  const result = await pipe.process('anything', {
    outputs: ['spec', 'image'],
    mode: 'sequential',
  });
  assert.equal(result.spec, undefined);
  assert.ok(result.image);
  assert.equal(result.errors?.spec?.code, 'INVALID_OUTPUT');
});

test('partial failure keeps the successful output', async () => {
  const { pipeline: pipe } = pipeline(
    [SPECS_JSON, VISUAL_JSON],
    productClassification(),
    imageProvider({ fail: new ExtractionError('LLM_ERROR', 'blocked') }),
  );
  const result = await pipe.process('anything', { outputs: ['spec', 'image'] });
  assert.ok(result.spec);
  assert.equal(result.image, undefined);
  assert.equal(result.errors?.image?.code, 'LLM_ERROR');
});

test('failFast throws on partial failure', async () => {
  const { pipeline: pipe } = pipeline(
    [SPECS_JSON, VISUAL_JSON],
    productClassification(),
    imageProvider({ fail: new ExtractionError('LLM_ERROR', 'blocked') }),
  );
  await assert.rejects(
    pipe.process('anything', { outputs: ['spec', 'image'], failFast: true }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('failFast throws spec errors first', async () => {
  const { pipeline: pipe } = pipeline(['not json', VISUAL_JSON]);
  await assert.rejects(
    pipe.process('anything', { outputs: ['spec', 'image'], failFast: true, mode: 'sequential' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'INVALID_OUTPUT',
  );
});

test('sequential mode records image errors without losing the spec', async () => {
  const rich = pipeline(
    [RICH_SPECS_JSON],
    productClassification(),
    imageProvider({ fail: new ExtractionError('LLM_ERROR', 'blocked') }),
  );
  const failed = await rich.pipeline.process('anything', {
    outputs: ['spec', 'image'],
    mode: 'sequential',
  });
  assert.ok(failed.spec);
  assert.equal(failed.image, undefined);
  assert.equal(failed.errors?.image?.code, 'LLM_ERROR');

  const both = pipeline(
    ['not json', 'still bad'],
    productClassification(),
    imageProvider({ fail: new ExtractionError('LLM_ERROR', 'blocked') }),
  );
  await assert.rejects(
    both.pipeline.process('anything', { outputs: ['spec', 'image'], mode: 'sequential' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'INVALID_OUTPUT',
  );
});

test('throws when every requested flow fails', async () => {
  const { pipeline: pipe } = pipeline(['not json', 'also bad']);
  await assert.rejects(
    pipe.process('anything', { outputs: ['spec'] }),
    (error: unknown) => error instanceof ExtractionError,
  );
  const imageOnly = pipeline(
    ['bad visual'],
    productClassification(),
    imageProvider({ fail: new ExtractionError('LLM_ERROR', 'blocked') }),
  );
  await assert.rejects(
    imageOnly.pipeline.process('anything', { outputs: ['image'] }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('throws EMPTY_INPUT on empty text and non-content', async () => {
  const deps = {
    reader: reader('   '),
    llm: scriptLlm([]).llm,
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  };
  await assert.rejects(
    new DefaultPipeline(deps).process('anything'),
    (error: unknown) => error instanceof ExtractionError && error.code === 'EMPTY_INPUT',
  );
  const nonContent = pipeline([SPECS_JSON], { ...productClassification(), kind: 'non_content' });
  await assert.rejects(
    nonContent.pipeline.process('anything'),
    (error: unknown) => error instanceof ExtractionError && error.code === 'EMPTY_INPUT',
  );
});

test('collections, policy, hidden and entity content still render an image', async () => {
  for (const classification of [
    { ...productClassification(), kind: 'item_collection' },
    { ...productClassification(), scope: 'multiple' },
    { ...productClassification(), kind: 'policy_legal' },
    { ...productClassification(), kind: 'editorial', domain: 'news_analysis', visual: false },
    { ...productClassification(), domain: 'organization_person' },
    { ...productClassification(), domain: 'job_listing' },
  ] as Classification[]) {
    const { pipeline: pipe } = pipeline([SPECS_JSON], classification);
    const result = await pipe.process('anything', { outputs: ['spec', 'image'] });
    assert.ok(result.spec);
    assert.ok(result.image);
    assert.equal(result.errors, undefined);
  }
});

test('grounding ladder: literal, contextual, conceptual and neutral', async () => {
  const facts = (subject: string) =>
    JSON.stringify({ subject, colors: [], materials: [], heroFeatures: [] });
  const rich = JSON.stringify({
    subject: 'kettle',
    colors: ['black'],
    materials: ['steel'],
    heroFeatures: ['handle'],
  });
  const run = async (llm: string[], domain = 'electronics') => {
    const { pipeline: pipe } = pipeline(llm, {
      ...productClassification(),
      domain,
    } as Classification);
    return pipe.process('anything', { outputs: ['image'], image: { includePrompt: true } });
  };
  assert.equal((await run([rich])).image?.grounding, 'literal');
  assert.equal((await run(['bad', facts('townhouse')])).image?.grounding, 'contextual');
  const concept = await run(['bad', facts('lantern')], 'news_analysis');
  assert.equal(concept.image?.grounding, 'conceptual');
  const goods = await run(['bad', 'bad', facts('lantern')]);
  assert.equal(goods.image?.grounding, 'conceptual');
  const abstract = await run(['bad', facts('shapes')], 'software_app');
  assert.equal(abstract.image?.grounding, 'conceptual');
  const entity = await run(['bad', facts('office')], 'job_listing');
  assert.equal(entity.image?.grounding, 'contextual');
  assert.ok(entity.image?.prompt?.toLowerCase().includes('office'));
  const failing = await run(['bad', 'bad', 'bad']);
  assert.equal(failing.image?.grounding, 'neutral');
});

test('neutral fallback builds a safe subject from the first line', () => {
  assert.equal(
    neutralFacts('# Acme **Kettle** 1500W\nmore', 'thing').subject.includes('Acme'),
    true,
  );
  assert.equal(neutralFacts('', 'thing').subject, 'thing');
  assert.equal(neutralFacts('12 34', 'thing').subject, 'thing');
});

test('image retries transient and policy errors, then gives up on fatal ones', async () => {
  const prompts: string[] = [];
  let calls = 0;
  const flaky = (errors: Error[]): ImageProvider => ({
    async generate(request) {
      prompts.push(request.prompt);
      const next = errors[calls];
      calls += 1;
      if (next) throw next;
      return { bytes: new Uint8Array([1]), mimeType: 'image/png' };
    },
  });
  const opts = {
    outputs: ['image'],
    image: { retryBackoffMs: 1, includePrompt: true },
  } as ProcessOptions;
  const rich = JSON.stringify({
    subject: 'kettle',
    colors: ['black'],
    materials: ['steel'],
    heroFeatures: ['handle'],
  });

  const transient = pipeline(
    [rich],
    productClassification(),
    flaky([new ExtractionError('LLM_ERROR', 'LLM host responded 504: gateway')]),
  );
  assert.ok((await transient.pipeline.process('x', opts)).image);
  assert.equal(calls, 2);

  calls = 0;
  prompts.length = 0;
  const policy = pipeline(
    [rich],
    productClassification(),
    flaky([new ExtractionError('LLM_ERROR', 'LLM host responded 400: content_policy_violation')]),
  );
  assert.ok((await policy.pipeline.process('x', opts)).image);
  assert.notEqual(prompts[0], prompts[1]);
  assert.ok(!prompts[1]!.includes('kettle') || prompts[1]!.length < prompts[0]!.length + 200);

  calls = 0;
  const exhausted = pipeline(
    [rich],
    productClassification(),
    flaky([
      new ExtractionError('LLM_ERROR', 'LLM host responded 503'),
      new ExtractionError('LLM_ERROR', 'LLM host responded 503'),
      new ExtractionError('LLM_ERROR', 'LLM host responded 503'),
    ]),
  );
  await assert.rejects(exhausted.pipeline.process('x', opts));
  assert.equal(calls, 3);

  calls = 0;
  const deadline = pipeline(
    [rich],
    productClassification(),
    flaky([new ExtractionError('LLM_ERROR', 'LLM host responded 503')]),
  );
  await assert.rejects(deadline.pipeline.process('x', { ...opts, image: { totalTimeoutMs: -1 } }));
  assert.equal(calls, 1);

  calls = 0;
  const fatal = pipeline([rich], productClassification(), flaky([new Error('weird')]));
  await assert.rejects(fatal.pipeline.process('x', opts));
  assert.equal(calls, 1);
});
test('tags are included only when requested', async () => {
  const withTags = pipeline(['{"Color": "black", "tags": ["kettle"]}']);
  const result = await withTags.pipeline.process('anything', { tags: true });
  assert.deepEqual(result.tags, ['kettle']);
  const withoutTags = pipeline([SPECS_JSON]);
  const plain = await withoutTags.pipeline.process('anything');
  assert.equal(plain.tags, undefined);
});

test('classifier errors fall back to generic', async () => {
  const { pipeline: pipe } = pipeline([SPECS_JSON], new Error('classifier down'));
  const result = await pipe.process('anything');
  assert.equal(result.category.domain, 'general');
  assert.equal(result.category.source, 'fallback');
  assert.equal(result.category.reason, 'classify_error');
});

test('auto mode without a jev key skips classification', async () => {
  const built = createPipeline({ reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm }, {});
  const result = await built.process('anything');
  assert.equal(result.category.source, 'fallback');
  assert.equal(result.category.reason, 'no_key');
});

test('classifier mode wins over the deprecated provider alias', async () => {
  const built = createPipeline(
    { reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm },
    { classifier: { mode: 'off', provider: 'llm' } },
  );
  const result = await built.process('anything');
  assert.equal(result.category.reason, 'disabled');
});

test('SPECMINE_CLASSIFIER env selects the mode', async () => {
  const make = () => createPipeline({ reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm }, {});
  process.env.SPECMINE_CLASSIFIER = 'off';
  assert.equal((await make().process('anything')).category.reason, 'disabled');
  process.env.SPECMINE_CLASSIFIER = 'bogus';
  assert.equal((await make().process('anything')).category.reason, 'no_key');
  delete process.env.SPECMINE_CLASSIFIER;
});

test('user category accepts kind override and maps unknown domains', async () => {
  const { pipeline: pipe } = pipeline([SPECS_JSON]);
  const result = await pipe.process('anything', { category: 'nope', kind: 'editorial' });
  assert.equal(result.category.domain, 'general');
  assert.equal(result.category.kind, 'editorial');
  assert.equal(result.category.reason, 'user_override');
});

test('user category with non-content kind skips the image', async () => {
  const { pipeline: pipe } = pipeline([SPECS_JSON]);
  const result = await pipe.process('anything', {
    outputs: ['spec', 'image'],
    category: 'electronics',
    kind: 'non_content',
  });
  assert.ok(result.spec);
  assert.equal(result.image, undefined);
  assert.equal(result.errors?.image?.code, 'UNSUPPORTED_INPUT');
});

test('image options pass through size, quality, style and dialect', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const { pipeline: pipe } = pipeline(
    [VISUAL_JSON],
    productClassification(),
    imageProvider({ seen }),
  );
  await pipe.process('anything', {
    outputs: ['image'],
    image: {
      size: '1792x1024',
      quality: 'hd',
      style: 'noir',
      dialect: 'dalle3',
      background: 'opaque',
      timeoutMs: 5000,
    },
  });
  assert.equal(seen[0]?.size, '1792x1024');
  assert.equal(seen[0]?.quality, 'hd');
  assert.ok(String(seen[0]?.prompt).includes('noir'));
});

test('invalid dialect falls back to model guess', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const { pipeline: pipe } = pipeline(
    [VISUAL_JSON],
    productClassification(),
    imageProvider({ seen }),
  );
  await pipe.process('anything', {
    outputs: ['image'],
    image: { dialect: 'nope', model: 'gpt-image-1' },
  });
  assert.ok(String(seen[0]?.prompt).includes('Intent:'));
});

test('extractFromText rejects empty text', async () => {
  const extractor = new DefaultExtractor({
    reader: reader('x'),
    llm: scriptLlm([]).llm,
    validator: new JsonSpecValidator(),
  });
  await assert.rejects(
    extractor.extractFromText('  '),
    (error: unknown) => error instanceof ExtractionError && error.code === 'EMPTY_INPUT',
  );
});

function routeFetch() {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const body = JSON.parse(String((init as RequestInit).body ?? '{}')) as {
      response_format?: { json_schema?: { name?: string } };
    };
    if (target.includes('/images/generations')) {
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
        { status: 200 },
      );
    }
    const name = body.response_format?.json_schema?.name;
    if (name === 'classify_content') {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: 'item_detail',
                  domain: 'electronics',
                  scope: 'single',
                  visual: true,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (name === 'visual_facts') {
      return new Response(JSON.stringify({ choices: [{ message: { content: VISUAL_JSON } }] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: SPECS_JSON } }] }), {
      status: 200,
    });
  }) as typeof fetch;
}

test('createPipeline honors classifier off and llm providers', async () => {
  const off = createPipeline(
    { reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm },
    { classifier: { provider: 'off' } },
  );
  const offResult = await off.process('anything');
  assert.equal(offResult.category.source, 'fallback');

  const llm = createPipeline(
    { reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm },
    { classifier: { provider: 'llm', model: 'test-model' } },
  );
  const llmResult = await llm.process('anything', { classifier: { model: 'test-model' } });
  assert.equal(llmResult.category.source, 'fallback');
  assert.equal(llmResult.category.reason, 'llm_error');
  assert.ok(llmResult.spec);
});

test('top-level generateImage returns the blob and throws when skipped', async () => {
  routeFetch();
  try {
    const image = await generateImage('Acme kettle, matte black steel.');
    assert.equal(image.mimeType, 'image/png');
    assert.ok(image.base64.length > 0);
    assert.ok(image.dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(image.prompt, undefined);
    await assert.rejects(
      generateImage('Acme kettle.', { category: 'electronics', kind: 'non_content' }),
      (error: unknown) => error instanceof ExtractionError && error.code === 'UNSUPPORTED_INPUT',
    );
  } finally {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

test('top-level generateImageBase64 returns raw base64', async () => {
  routeFetch();
  try {
    const base64 = await generateImageBase64('Acme kettle, matte black steel.');
    assert.equal(Buffer.from(base64, 'base64').toString(), 'img');
  } finally {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

test('analyze integration with fetch-routed providers', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    calls.push(target);
    const body = JSON.parse(String((init as RequestInit).body ?? '{}')) as {
      state?: string;
      questions?: unknown;
      response_format?: { json_schema?: { name?: string } };
      model?: string;
    };
    if (target.includes('/v1/systemone')) {
      return new Response(
        JSON.stringify({
          answers: {
            kind: { type: 'choice', choice: 'item_detail', confidence: 0.9 },
            domain: { type: 'choice', choice: 'electronics', confidence: 0.85 },
            scope: { type: 'choice', choice: 'single', confidence: 0.9 },
            visual: { type: 'noul', noul: 0.9 },
          },
        }),
        { status: 200 },
      );
    }
    if (target.includes('/images/generations')) {
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
        { status: 200 },
      );
    }
    const name = body.response_format?.json_schema?.name;
    if (name === 'classify_content') {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: 'item_detail',
                  domain: 'electronics',
                  scope: 'single',
                  visual: true,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (name === 'visual_facts') {
      return new Response(JSON.stringify({ choices: [{ message: { content: VISUAL_JSON } }] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: SPECS_JSON } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    process.env.TYPESAFE_API_KEY = 'k';
    const result = await analyze('Acme kettle, black steel.', {
      outputs: ['spec', 'image'],
      mode: 'parallel',
    } satisfies ProcessOptions);
    assert.ok(result.spec);
    assert.ok(result.image);
    assert.equal(result.category.source, 'jev');
    assert.ok(calls.some((url) => url.includes('/images/generations')));
  } finally {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
    delete process.env.TYPESAFE_API_KEY;
  }
});

test('generic classification constant is a safe default', () => {
  assert.equal(GENERIC_CLASSIFICATION.domain, 'general');
});

test('wraps plain errors from failing flows', async () => {
  const { pipeline: pipe } = pipeline(
    [SPECS_JSON, VISUAL_JSON],
    productClassification(),
    imageProvider({ fail: new Error('boom') }),
  );
  const result = await pipe.process('anything', { outputs: ['spec', 'image'] });
  assert.ok(result.spec);
  assert.equal(result.errors?.image?.code, 'LLM_ERROR');
  assert.ok(result.errors?.image?.message.includes('boom'));

  const odd = pipeline(
    [SPECS_JSON, VISUAL_JSON],
    productClassification(),
    imageProvider({ fail: 'odd failure' as unknown as Error }),
  );
  const oddResult = await odd.pipeline.process('anything', { outputs: ['spec', 'image'] });
  assert.ok(oddResult.errors?.image?.message.includes('odd failure'));
});

test('low jev confidence falls back to generic without an llm call', async () => {
  process.env.TYPESAFE_API_KEY = 'k';
  const bodies: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const raw = String((init as RequestInit).body ?? '{}');
    bodies.push(raw);
    if (target.includes('/v1/systemone')) {
      return new Response(
        JSON.stringify({
          answers: {
            kind: { type: 'choice', choice: 'item_detail', confidence: 0.9 },
            domain: { type: 'choice', choice: 'electronics', confidence: 0.1 },
            scope: { type: 'choice', choice: 'single', confidence: 0.9 },
            visual: { type: 'noul', noul: 0.9 },
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: SPECS_JSON } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const pipe = createPipeline(undefined, {
      classifier: { minConfidence: 0.5, apiKey: 'jev-key', apiHost: 'https://jev.test' },
    });
    const result = await pipe.process('Acme article text here.', {
      classifier: { minConfidence: 0.5 },
    });
    assert.equal(result.category.source, 'fallback');
    assert.equal(result.category.reason, 'low_confidence');
    assert.ok(
      bodies.every((raw) => {
        const name = (JSON.parse(raw) as { response_format?: { json_schema?: { name?: string } } })
          .response_format?.json_schema?.name;
        return name !== 'classify_content';
      }),
    );
  } finally {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
    delete process.env.TYPESAFE_API_KEY;
  }
});

test('jev outage falls back to generic without an llm call', async () => {
  process.env.TYPESAFE_API_KEY = 'k';
  let llmCalls = 0;
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/v1/systemone')) {
      return new Response('bad gateway', { status: 502 });
    }
    llmCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: SPECS_JSON } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    // summary:false so the count stays about the spec call, which is what
    // "falls back without an llm call" is claiming.
    const pipe = createPipeline(undefined, {
      classifier: { provider: 'jev' },
      summary: false,
    });
    const result = await pipe.process('Acme kettle, black steel.');
    assert.equal(result.category.source, 'fallback');
    assert.equal(result.category.reason, 'jev_error');
    // Two, not one: the spec call, plus the prose call that always follows a
    // source stating no title or description. summary:false does not suppress
    // that — filling a missing title is the default, not the summary.
    assert.equal(llmCalls, 2);
  } finally {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
    delete process.env.TYPESAFE_API_KEY;
  }
});

test('resolves image options and text providers', () => {
  assert.deepEqual(imageOptionsFrom(undefined), {});
  assert.deepEqual(imageOptionsFrom({ image: { apiKey: 'i' } }), { apiKey: 'i' });
  assert.deepEqual(imageOptionsFrom({ apiKey: 't' }), { apiKey: 't' });
  assert.deepEqual(imageOptionsFrom({ image: { apiHost: 'h', model: 'm' } }), {
    apiHost: 'h',
    model: 'm',
  });
  assert.equal(typeof providerFrom(undefined).complete, 'function');
  assert.equal(typeof providerFrom({ provider: 'anthropic', apiKey: 'k' }).complete, 'function');
});

test('ladder briefs reuse the configured image model', async () => {
  const models: Array<string | undefined> = [];
  const llm: LlmProvider = {
    async complete(request): Promise<LlmResponse> {
      models.push(request.model);
      return {
        content: JSON.stringify({ subject: 'house', colors: [], materials: [], heroFeatures: [] }),
      };
    },
  };
  // This reader states its own title and description, so with summary:false
  // there is nothing left to generate and every call is an image brief.
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        return { text: TEXT, imageOnly: false, title: 'Acme Kettle', description: 'A kettle.' };
      },
    },
    llm,
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  // summary:false keeps every call an image brief, which is what the assertion
  // below is about.
  const result = await built.process('x', {
    outputs: ['image'],
    image: { model: 'img-model' },
    summary: false,
  });
  assert.equal(result.image?.grounding, 'contextual');
  assert.ok(models.every((model) => model === 'img-model'));
});

function readerWithPictures(text: string, candidates: ImageCandidate[]): InputReader {
  return {
    async read(): Promise<ReadResult> {
      return { text, imageOnly: false, kind: 'html', candidates };
    },
  };
}

test("the page's own picture is reused instead of drawn", async () => {
  let generated = 0;
  const built = createPipeline({
    reader: readerWithPictures(TEXT, [
      { url: 'https://cdn.example.com/hero.jpg', source: 'og:image', alt: 'the kettle', score: 1 },
    ]),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(() => {
      generated += 1;
    }),
  });
  const result = await built.process('x', { outputs: ['image'] });
  const chosen = result.images?.find((entry) => entry.selected);
  assert.equal(chosen?.type, 'extracted');
  assert.equal(chosen?.url, 'https://cdn.example.com/hero.jpg');
  assert.equal(chosen?.type === 'extracted' ? chosen.source : undefined, 'og:image');
  assert.equal(result.images?.length, 1);
  assert.equal(generated, 0);
});

test('a page with no picture falls through to drawing', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, []),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  assert.equal(result.images?.at(-1)?.type, 'generated');
});

test('non-content states a blocked outcome instead of staying silent', async () => {
  const built = createPipeline({
    reader: reader(TEXT),
    llm: scriptLlm([SPECS_JSON]).llm,
    classifier: classifier({ ...productClassification(), kind: 'non_content' }),
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', {
    outputs: ['image'],
    category: 'electronics',
    kind: 'non_content',
  });
  assert.deepEqual(result.images, [{ type: 'blocked', selected: true }]);
});

test('a spec-only run states no picture decision', async () => {
  const built = createPipeline({ reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm });
  const result = await built.process(TEXT);
  assert.deepEqual(result.images, []);
});

test('every candidate is returned, with the decision naming one of them', async () => {
  const candidates = [
    { url: 'https://cdn.example.com/hero.jpg', source: 'og:image' as const, alt: '', score: 1 },
    { url: 'https://cdn.example.com/a.jpg', source: 'gallery' as const, alt: 'A', score: 0.6 },
    { url: 'https://cdn.example.com/b.jpg', source: 'gallery' as const, alt: 'B', score: 0.6 },
  ];
  const built = createPipeline({
    reader: readerWithPictures(TEXT, candidates),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  assert.equal(result.images?.length, candidates.length);
  assert.deepEqual(
    result.images?.map((entry) => (entry.type === 'extracted' ? entry.url : entry.type)),
    candidates.map((candidate) => candidate.url),
  );
  // List order is preserved and exactly one entry is marked as the pick.
  assert.deepEqual(
    result.images?.map((entry) => entry.selected),
    [true, false, false],
  );
});

test('a page offering no pictures reports no image list', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, []),
    llm: scriptLlm([SPECS_JSON]).llm,
  });
  const result = await built.process('x');
  assert.deepEqual(result.images, []);
});

test('the run reports its token usage and cost', async () => {
  const llm: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      return { content: SPECS_JSON, usage: { inputTokens: 500, outputTokens: 100 } };
    },
  };
  const built = createPipeline({ reader: reader(TEXT), llm });
  const result = await built.process(TEXT);
  const spec = result.cost?.calls.find((call) => call.stage === 'spec');
  assert.deepEqual(spec, { stage: 'spec', model: 'unknown', inputTokens: 500, outputTokens: 100 });
  assert.ok((result.cost?.totalTokens ?? 0) >= 600);
});

test('identify tunes the domain when the classifier fell back', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      answers: { domain: { answer: 'furniture_decor' }, kind: { answer: 'item_detail' } },
    })) as typeof fetch;
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'k';
  try {
    const built = createPipeline({
      reader: reader(TEXT),
      llm: scriptLlm([SPECS_JSON]).llm,
      classifier: classifier({ ...GENERIC_CLASSIFICATION, reason: 'no_key' }),
    });
    const result = await built.process(TEXT, { classifier: { mode: 'off' } });
    assert.equal(result.category.domain, 'furniture_decor');
    assert.equal(result.cost?.calls[0]?.stage, 'identify');
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
});

test('an identify domain is not applied over a confident classification', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ answers: { domain: { answer: 'furniture_decor' } } })) as typeof fetch;
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'k';
  try {
    const built = createPipeline({
      reader: reader(TEXT),
      llm: scriptLlm([SPECS_JSON]).llm,
      classifier: classifier(productClassification()),
    });
    const result = await built.process(TEXT);
    assert.equal(result.category.domain, 'electronics');
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
});

test('identify receives the classifier host and model overrides', async () => {
  const original = globalThis.fetch;
  let url = '';
  globalThis.fetch = (async (input: unknown) => {
    url = String(input);
    return Response.json({ answers: {} });
  }) as typeof fetch;
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'k';
  try {
    const built = createPipeline({
      reader: reader(TEXT),
      llm: scriptLlm([SPECS_JSON]).llm,
      classifier: classifier(productClassification()),
    });
    await built.process(TEXT, {
      classifier: { apiKey: 'k', apiHost: 'https://jev.example', model: 'jev-x' },
    });
    assert.match(url, /^https:\/\/jev\.example\/v1\/systemone$/);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
});

test('a run without a classifier model override still identifies', async () => {
  const built = createPipeline({
    reader: reader(TEXT),
    llm: scriptLlm([SPECS_JSON]).llm,
    classifier: classifier(productClassification()),
  });
  const result = await built.process(TEXT);
  assert.equal(
    result.cost?.calls.some((call) => call.stage === 'identify'),
    true,
  );
});

test('a failed image draw states a blocked outcome', async () => {
  const built = createPipeline({
    reader: reader(TEXT),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider({ fail: new Error('refused') }),
  });
  const result = await built.process('x', {
    outputs: ['image', 'spec'],
    category: 'electronics',
  });
  assert.deepEqual(result.images, [{ type: 'blocked', selected: true }]);
  assert.ok(result.errors?.image);
});

test('a reader with no candidates field falls through to drawing', async () => {
  const built = createPipeline({
    reader: reader(TEXT),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'], category: 'electronics' });
  assert.equal(result.images?.at(-1)?.type, 'generated');
});

test('a category that forbids images states none rather than drawing', async () => {
  registerCategory('electronics', { allowImage: false });
  try {
    const built = createPipeline({
      reader: reader(TEXT),
      llm: scriptLlm([SPECS_JSON]).llm,
      classifier: classifier(productClassification()),
      imageProvider: imageProvider(),
    });
    const result = await built.process('x', { outputs: ['image'] });
    assert.deepEqual(result.images, [{ type: 'none', selected: true }]);
    assert.match(result.errors?.image?.message ?? '', /does not allow images/);
  } finally {
    resetCategoryOverrides();
  }
});

/* --- prose: title, description and summary --- */

/** A pipeline whose reader states the given title/description (undefined = the
 *  source states neither) and whose prose stage answers with `prose`. */
function prosePipeline(options: {
  stated?: { title?: string; description?: string };
  prose?: string;
  responses?: Array<string | Error>;
}): { pipeline: DefaultPipeline; proseCalls: () => number } {
  const script = scriptLlm(options.responses ?? [SPECS_JSON], options.prose ?? DEFAULT_PROSE);
  return {
    pipeline: new DefaultPipeline({
      reader: {
        async read(): Promise<ReadResult> {
          return {
            text: TEXT,
            imageOnly: false,
            ...(options.stated?.title !== undefined ? { title: options.stated.title } : {}),
            ...(options.stated?.description !== undefined
              ? { description: options.stated.description }
              : {}),
          };
        },
      },
      llm: script.llm,
      validator: new JsonSpecValidator(),
      classifier: classifier(productClassification()),
      imageProvider: imageProvider(),
    }),
    proseCalls: script.proseCalls,
  };
}

test('a source stating nothing leaves title, description and summary to the generator', async () => {
  const { pipeline: pipe, proseCalls } = prosePipeline({});
  const result = await pipe.process('x', { category: 'electronics' });
  assert.equal(result.title, 'Acme Kettle');
  assert.equal(result.description, 'A matte black stainless steel kettle.');
  assert.equal(result.summary, 'A short product listing for the Acme Kettle.');
  assert.equal(proseCalls(), 1);
});

test("a source's own title and description are never overwritten", async () => {
  const { pipeline: pipe } = prosePipeline({
    stated: { title: 'Source Title', description: 'Source blurb' },
    prose: JSON.stringify({
      title: 'Generated',
      description: 'Generated blurb',
      summary: 'An overview.',
    }),
  });
  const result = await pipe.process('x', { category: 'electronics' });
  assert.equal(result.title, 'Source Title');
  assert.equal(result.description, 'Source blurb');
  assert.equal(result.summary, 'An overview.');
});

test('a title-only source keeps its title and gains the rest', async () => {
  const { pipeline: pipe } = prosePipeline({ stated: { title: 'Only Title' } });
  const result = await pipe.process('x', { category: 'electronics' });
  assert.equal(result.title, 'Only Title');
  assert.equal(result.description, 'A matte black stainless steel kettle.');
  assert.ok(result.summary);
});

test('summary:false on a fully stated source makes no prose call at all', async () => {
  const { pipeline: pipe, proseCalls } = prosePipeline({
    stated: { title: 'T', description: 'D' },
  });
  const result = await pipe.process('x', { category: 'electronics', summary: false });
  assert.equal(proseCalls(), 0);
  assert.equal(result.title, 'T');
  assert.equal(result.description, 'D');
  assert.equal(result.summary, undefined);
});

test('summary:false still generates a title the source never stated', async () => {
  const { pipeline: pipe, proseCalls } = prosePipeline({});
  const result = await pipe.process('x', { category: 'electronics', summary: false });
  assert.equal(proseCalls(), 1);
  assert.equal(result.title, 'Acme Kettle');
  assert.equal(result.summary, undefined);
});

test('a prose response that is not json states a summary error, not a crash', async () => {
  const { pipeline: pipe } = prosePipeline({ prose: 'not json at all' });
  const result = await pipe.process('x', { category: 'electronics' });
  assert.equal(result.errors?.summary?.code, 'INVALID_OUTPUT');
  // The spec is untouched: prose never invalidates a good extraction.
  assert.deepEqual(result.spec, { Color: 'matte black', Capacity: '1.5 L' });
});

test('a prose response with no usable field is a summary error', async () => {
  const { pipeline: pipe } = prosePipeline({ prose: '{}' });
  const result = await pipe.process('x', { category: 'electronics' });
  assert.equal(result.errors?.summary?.code, 'INVALID_OUTPUT');
});

test('failFast surfaces a prose failure', async () => {
  const { pipeline: pipe } = prosePipeline({ prose: 'not json at all' });
  await assert.rejects(
    () => pipe.process('x', { category: 'electronics', failFast: true }),
    /JSON/,
  );
});

test('the prose stage is billed and priced as its own stage', async () => {
  const { pipeline: pipe } = prosePipeline({});
  const result = await pipe.process('x', { category: 'electronics' });
  const summaryCalls = result.cost?.calls.filter((call) => call.stage === 'summary') ?? [];
  assert.ok(summaryCalls.length > 0, 'the summary stage must appear in the cost summary');
  // Priced, not merely counted: a stage nobody pays for would still show up in
  // the call list, and only the dollar total would give it away.
  const withSummary = estimateCost(result.cost!);
  const withoutSummary = estimateCost({
    ...result.cost!,
    calls: result.cost!.calls.filter((call) => call.stage !== 'summary'),
  });
  assert.ok(withSummary > withoutSummary, 'the summary stage must add to the estimate');
});

test('prose reads only the head window while the spec still reads everything', async () => {
  const long = `${'HEAD '.repeat(2000)}TAIL MARKER`;
  const bodies: Array<{ prose: boolean; text: string }> = [];
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        return { text: long, imageOnly: false, title: 'T', description: 'D' };
      },
    },
    llm: {
      async complete(request): Promise<LlmResponse> {
        const isProse = request.schemaName === 'specmine_prose';
        bodies.push({ prose: isProse, text: String(request.messages[1]?.content) });
        return {
          content: isProse
            ? JSON.stringify({ title: 'x', description: 'y', summary: 'z' })
            : SPECS_JSON,
        };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  await built.process('x', { category: 'electronics' });
  const proseBody = bodies.find((b) => b.prose);
  const specBody = bodies.find((b) => !b.prose);
  assert.ok(proseBody);
  assert.ok(specBody);
  assert.ok(proseBody.text.length < long.length, 'prose must see only the window');
  assert.match(proseBody.text, /…truncated$/);
  assert.doesNotMatch(proseBody.text, /TAIL MARKER/);
  assert.match(specBody.text, /TAIL MARKER/);
});

test('a video run describes the prose request as a video transcript', async () => {
  let system = '';
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        return {
          text: '# A Video\n\n## Transcript\n\nspoken words',
          imageOnly: false,
          kind: 'video',
        };
      },
    },
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          system = String(request.messages[0]?.content);
          return { content: JSON.stringify({ title: 't', description: 'd', summary: 's' }) };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  await built.process('x', { category: 'electronics' });
  assert.match(system, /caption transcript/);
  assert.match(system, /Transcript section is what was actually said/);
});

test('a non-video run describes the prose request as a document', async () => {
  let system = '';
  const built = new DefaultPipeline({
    reader: reader(TEXT),
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          system = String(request.messages[0]?.content);
          return { content: JSON.stringify({ title: 't', description: 'd', summary: 's' }) };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  await built.process('x', { category: 'electronics' });
  assert.match(system, /The content is a document\./);
});

test('the prose schema asks only for the fields the source left unstated', async () => {
  const schemas: Array<unknown> = [];
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        // Title stated, description not: only those two may be requested.
        return { text: TEXT, imageOnly: false, title: 'Stated' };
      },
    },
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          schemas.push(request.schema);
          return {
            content: JSON.stringify({ description: 'Written', summary: 'Overview' }),
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { category: 'electronics' });
  assert.equal(result.title, 'Stated');
  assert.equal(result.description, 'Written');
  assert.deepEqual(schemas[0], {
    type: 'object',
    properties: { description: { type: 'string' }, summary: { type: 'string' } },
    required: ['description', 'summary'],
    additionalProperties: false,
  });
});

test('the prose stage leaves room for the model to think before answering', () => {
  // A tight cap made a reasoning model spend it all thinking and return
  // truncated JSON, which surfaced as INVALID_OUTPUT on a live video.
  assert.ok(PROSE_MAX_TOKENS >= 2000, `maxTokens was ${PROSE_MAX_TOKENS}`);
});

test('an extracted entry carries every dimension the markup stated', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, [
      {
        url: 'https://cdn.example.com/hero.webp',
        source: 'og:image',
        alt: 'the kettle',
        score: 1,
        width: 1600,
        height: 900,
        type: 'image/webp',
        title: 'The kettle',
      },
    ]),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  assert.deepEqual(result.images, [
    {
      type: 'extracted',
      url: 'https://cdn.example.com/hero.webp',
      source: 'og:image',
      alt: 'the kettle',
      score: 1,
      // The mime type is renamed so it cannot collide with the type tag.
      mediaType: 'image/webp',
      width: 1600,
      height: 900,
      title: 'The kettle',
      selected: true,
    },
  ]);
});

test('an extracted entry omits what the markup never stated', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, [
      { url: 'https://cdn.example.com/a.jpg', source: 'gallery', alt: 'A', score: 0.6 },
    ]),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  const entry = result.images?.[0];
  assert.ok(entry && entry.type === 'extracted');
  // Absent keys, not empty ones, so a caller can tell what the page omitted.
  assert.ok(!('width' in entry));
  assert.ok(!('height' in entry));
  assert.ok(!('mediaType' in entry));
  assert.ok(!('title' in entry));
  assert.ok(!('position' in entry));
});

test('a stated dimension is carried and an explicit undefined is not', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, [
      {
        url: 'https://cdn.example.com/a.jpg',
        source: 'gallery',
        alt: 'A',
        score: 0.6,
        position: 0,
        height: 900,
        title: undefined,
      },
    ]),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  const entry = result.images?.[0];
  assert.ok(entry && entry.type === 'extracted');
  assert.equal(entry.height, 900);
  assert.equal(entry.position, 0);
  // Keys the page never stated are absent rather than null or empty.
  assert.ok(!('width' in entry));
  assert.ok(!('mediaType' in entry));
  assert.ok(!('title' in entry));
});

test('a candidate with a stated width carries it, one without omits it', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, [
      { url: 'https://cdn.example.com/a.jpg', source: 'og:image', alt: '', score: 1, width: 800 },
      { url: 'https://cdn.example.com/b.jpg', source: 'gallery', alt: '', score: 0.6 },
    ]),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  const [first, second] = result.images ?? [];
  assert.ok(first?.type === 'extracted' && first.selected);
  assert.equal(first.width, 800);
  assert.ok(second?.type === 'extracted');
  assert.ok(!('width' in second));
});

test('a candidate the reader never scored is still listed', async () => {
  // Custom readers written against the older shape may omit the score; the
  // entry must still reach the caller rather than be dropped.
  const built = createPipeline({
    reader: readerWithPictures(TEXT, [
      { url: 'https://cdn.example.com/a.jpg', source: 'gallery', alt: 'A' } as ImageCandidate,
    ]),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  const entry = result.images?.[0];
  assert.ok(entry?.type === 'extracted');
  assert.equal(entry.url, 'https://cdn.example.com/a.jpg');
  assert.ok(!('score' in entry));
});

/* --- the prose call sees what the source stated about itself --- */

test('a title and description the source stated are handed to the prose stage', async () => {
  // og: tags never survive into the markdown, so without this the model writes
  // an overview having never seen the page's own description.
  const bodies: string[] = [];
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        return {
          text: '# Acme Kettle\n\nBoils fast.',
          imageOnly: false,
          kind: 'html',
          title: 'Acme Kettle 1.5L',
          description: 'A matte black stainless steel kettle, 1.5 litres.',
        };
      },
    },
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          bodies.push(String(request.messages[1]?.content));
          return {
            content: JSON.stringify({ summary: 'An overview.' }),
            usage: { inputTokens: 5, outputTokens: 2 },
          };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { category: 'electronics' });
  assert.match(bodies[0] ?? '', /The source states these about itself:/);
  assert.match(bodies[0] ?? '', /Title: Acme Kettle 1\.5L/);
  assert.match(bodies[0] ?? '', /Description: A matte black stainless steel kettle, 1\.5 litres\./);
  // The stated values still win, and the body follows them.
  assert.equal(result.title, 'Acme Kettle 1.5L');
  assert.equal(result.description, 'A matte black stainless steel kettle, 1.5 litres.');
  assert.equal(result.summary, 'An overview.');
});

test('a very long stated description is clipped, not pasted whole', async () => {
  const bodies: string[] = [];
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        return { text: 'body', imageOnly: false, description: 'D'.repeat(5000) };
      },
    },
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          bodies.push(String(request.messages[1]?.content));
          return {
            content: JSON.stringify({ title: 't', summary: 's' }),
            usage: { inputTokens: 5, outputTokens: 2 },
          };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  await built.process('x', { category: 'electronics' });
  const body = bodies[0] ?? '';
  assert.ok(body.includes('…'), 'a clipped value is marked as cut short');
  assert.ok(body.length < 1000, `stated block should stay bounded, was ${body.length}`);
});

test('a source stating nothing sends no stated block at all', async () => {
  const bodies: string[] = [];
  const built = new DefaultPipeline({
    reader: reader(TEXT),
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          bodies.push(String(request.messages[1]?.content));
          return {
            content: JSON.stringify({ title: 't', description: 'd', summary: 's' }),
            usage: { inputTokens: 5, outputTokens: 2 },
          };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  await built.process('x', { category: 'electronics' });
  assert.doesNotMatch(bodies[0] ?? '', /states these about itself/);
});

test('a stated title alone is passed without inventing a description line', async () => {
  const bodies: string[] = [];
  const built = new DefaultPipeline({
    reader: {
      async read(): Promise<ReadResult> {
        return { text: TEXT, imageOnly: false, title: 'Only A Title' };
      },
    },
    llm: {
      async complete(request): Promise<LlmResponse> {
        if (request.schemaName === 'specmine_prose') {
          bodies.push(String(request.messages[1]?.content));
          return {
            content: JSON.stringify({ description: 'Written', summary: 's' }),
            usage: { inputTokens: 5, outputTokens: 2 },
          };
        }
        return { content: SPECS_JSON };
      },
    },
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  await built.process('x', { category: 'electronics' });
  const body = bodies[0] ?? '';
  assert.match(body, /Title: Only A Title/);
  assert.doesNotMatch(body, /Description:/);
});
