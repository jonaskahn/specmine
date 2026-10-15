import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_CLASSIFICATION, type Classification } from '../src/classify/classifier.js';
import { DefaultExtractor } from '../src/extractor.js';
import { ExtractionError } from '../src/errors.js';
import type { ImageProvider } from '../src/llm/openai-image.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';
import type { InputReader, ReadResult } from '../src/input/reader.js';
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
  options: { fail?: Error; revisedPrompt?: string; seen?: Array<Record<string, unknown>> } = {},
): ImageProvider {
  return {
    async generate(request) {
      options.seen?.push(request as unknown as Record<string, unknown>);
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

  const both = pipeline(['not json', 'still bad']);
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
  const imageOnly = pipeline(['bad visual'], productClassification());
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

test('skips image for collections, policy, hidden and non-visual content', async () => {
  for (const classification of [
    { ...productClassification(), kind: 'item_collection' },
    { ...productClassification(), scope: 'multiple' },
    { ...productClassification(), kind: 'policy_legal' },
    { ...productClassification(), kind: 'editorial', domain: 'news_analysis', visual: false },
    { ...productClassification(), domain: 'organization_person' },
  ] as Classification[]) {
    const { pipeline: pipe } = pipeline([SPECS_JSON], classification);
    const result = await pipe.process('anything', { outputs: ['spec', 'image'] });
    assert.ok(result.spec);
    assert.equal(result.image, undefined);
    assert.equal(result.errors?.image?.code, 'UNSUPPORTED_INPUT');
  }
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
  const built = createPipeline(
    { reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm },
    {},
  );
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
  const make = () =>
    createPipeline({ reader: reader(TEXT), llm: scriptLlm([SPECS_JSON]).llm }, {});
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
      generateImage('Acme Corp company profile and history.', { category: 'organization_person' }),
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
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes('/v1/systemone')) {
      return new Response('bad gateway', { status: 502 });
    }
    llmCalls += 1;
    const raw = String((init as RequestInit).body ?? '{}');
    return new Response(
      JSON.stringify({ choices: [{ message: { content: SPECS_JSON } }] }),
      { status: 200 },
    );
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
