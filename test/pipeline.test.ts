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

function scriptLlm(responses: Array<string | Error>): { llm: LlmProvider; count: () => number } {
  let index = 0;
  return {
    count: () => index,
    llm: {
      async complete(): Promise<LlmResponse> {
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
) {
  const script = scriptLlm(responses);
  const deps = {
    reader: reader(TEXT),
    llm: script.llm,
    validator: new JsonSpecValidator(),
    classifier: classifier(classification),
    imageProvider: image,
  };
  return { pipeline: new DefaultPipeline(deps), calls: script.count };
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
    const pipe = createPipeline(undefined, { classifier: { provider: 'jev' } });
    const result = await pipe.process('Acme kettle, black steel.');
    assert.equal(result.category.source, 'fallback');
    assert.equal(result.category.reason, 'jev_error');
    assert.equal(llmCalls, 1);
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
  const built = new DefaultPipeline({
    reader: reader(TEXT),
    llm,
    validator: new JsonSpecValidator(),
    classifier: classifier(productClassification()),
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'], image: { model: 'img-model' } });
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
  assert.equal(result.picture?.outcome, 'reused');
  assert.equal(result.picture?.url, 'https://cdn.example.com/hero.jpg');
  assert.equal(result.picture?.source, 'og:image');
  assert.equal(generated, 0);
});

test('a page with no picture falls through to drawing', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, []),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'] });
  assert.equal(result.picture?.outcome, 'generated');
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
  assert.equal(result.picture?.outcome, 'blocked');
});

test('a spec-only run states no picture decision', async () => {
  const built = createPipeline({ reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm });
  const result = await built.process(TEXT);
  assert.equal(result.picture, undefined);
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
  assert.deepEqual(result.images, candidates);
  assert.equal(result.picture?.url, candidates[0]?.url);
});

test('a page offering no pictures reports no image list', async () => {
  const built = createPipeline({
    reader: readerWithPictures(TEXT, []),
    llm: scriptLlm([SPECS_JSON]).llm,
  });
  const result = await built.process('x');
  assert.equal(result.images, undefined);
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
  assert.equal(result.picture?.outcome, 'blocked');
  assert.ok(result.errors?.image);
});

test('a reader with no candidates field falls through to drawing', async () => {
  const built = createPipeline({
    reader: reader(TEXT),
    llm: scriptLlm([SPECS_JSON]).llm,
    imageProvider: imageProvider(),
  });
  const result = await built.process('x', { outputs: ['image'], category: 'electronics' });
  assert.equal(result.picture?.outcome, 'generated');
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
    assert.equal(result.picture?.outcome, 'none');
    assert.match(result.errors?.image?.message ?? '', /does not allow images/);
  } finally {
    resetCategoryOverrides();
  }
});
