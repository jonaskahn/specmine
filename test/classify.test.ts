import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_CLASSIFICATION,
  isClassifierMode,
  isKnownKind,
  isKnownScope,
} from '../src/classify/classifier.js';
import {
  buildJevQuestions,
  createJevClassifier,
  isJevRetriable,
  JevClassifier,
} from '../src/classify/jev.js';
import { LlmClassifier } from '../src/classify/llm.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../src/llm/provider.js';

function mockFetch(body: unknown, status = 200): { url: string; init: RequestInit } {
  const captured: { url: string; init: RequestInit } = { url: '', init: {} };
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init ?? {};
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return captured;
}

function fakeLlm(content: string | Error): LlmProvider {
  return {
    async complete(): Promise<LlmResponse> {
      if (content instanceof Error) throw content;
      return { content };
    },
  };
}

test.afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch;
  delete process.env.TYPESAFE_API_KEY;
});

test('isClassifierMode validates mode values', () => {
  assert.equal(isClassifierMode('auto'), true);
  assert.equal(isClassifierMode('jev'), true);
  assert.equal(isClassifierMode('off'), true);
  assert.equal(isClassifierMode('sometimes'), false);
});

test('isKnownKind and isKnownScope validate values', () => {
  assert.equal(isKnownKind('item_detail'), true);
  assert.equal(isKnownKind('nope'), false);
  assert.equal(isKnownScope('single'), true);
  assert.equal(isKnownScope('nope'), false);
});

test('jev questions cover kind, domain, scope and visual', () => {
  const questions = buildJevQuestions() as Record<string, { criteria?: unknown }>;
  assert.ok(questions.kind);
  assert.ok(questions.domain);
  assert.ok(questions.scope);
  assert.ok(questions.visual);
  assert.ok((questions.domain?.criteria as Record<string, string>).electronics);
});

test('jev classifies content and posts to systemone', async () => {
  const captured = mockFetch({
    answers: {
      kind: { type: 'choice', choice: 'item_detail', confidence: 0.9 },
      domain: {
        type: 'choice',
        choice: 'electronics',
        confidence: 0.8,
        probabilities: { electronics: 0.8, software_app: 0.2 },
      },
      scope: { type: 'choice', choice: 'single', confidence: 0.95 },
      visual: { type: 'noul', noul: 0.9 },
    },
  });
  const classifier = new JevClassifier({ apiKey: 'k' });
  const result = await classifier.classify('x'.repeat(9000));
  assert.equal(captured.url, 'https://api.typesafe.ai/v1/systemone');
  const body = JSON.parse(String(captured.init.body)) as { model: string; state: string };
  assert.equal(body.model, 'jev-latest');
  assert.ok(body.state.length <= 8000);
  assert.equal(result.domain, 'electronics');
  assert.equal(result.kind, 'item_detail');
  assert.equal(result.visual, true);
  assert.equal(result.source, 'jev');
  assert.deepEqual(result.probabilities, { electronics: 0.8, software_app: 0.2 });
});

test('jev marks visual false below threshold and maps unknown domain', async () => {
  mockFetch({
    answers: {
      kind: { type: 'choice', choice: 'editorial', confidence: 0.7 },
      domain: { type: 'choice', choice: 'mystery', confidence: 0.4 },
      scope: { type: 'choice', choice: 'none', confidence: 0.6 },
      visual: { type: 'noul', noul: 0.2 },
    },
  });
  const classifier = createJevClassifier({ apiKey: 'k', apiHost: 'https://jev.example.com' });
  const result = await classifier.classify('text');
  assert.equal(result.domain, 'general');
  assert.equal(result.visual, false);
  assert.equal(result.scope, 'none');
  assert.equal(result.probabilities, undefined);
});

test('jev tolerates missing confidence and domain answers', async () => {
  mockFetch({
    answers: {
      kind: { type: 'choice', choice: 'item_detail' },
      scope: { type: 'choice', choice: 'single' },
    },
  });
  const classifier = new JevClassifier({ apiKey: 'k' });
  const result = await classifier.classify('text');
  assert.equal(result.domain, 'general');
  assert.equal(result.confidence, 0);
  assert.equal(result.visual, true);
});

test('jev falls back to generic on unparseable response', async () => {
  mockFetch({ answers: null });
  const classifier = new JevClassifier({ apiKey: 'k' });
  assert.deepEqual(await classifier.classify('text'), GENERIC_CLASSIFICATION);
  mockFetch({ nope: true });
  assert.deepEqual(await classifier.classify('text'), GENERIC_CLASSIFICATION);
  mockFetch({ answers: { kind: { choice: 'weird' }, scope: { choice: 'single' } } });
  assert.deepEqual(await classifier.classify('text'), GENERIC_CLASSIFICATION);
});

test('jev uses env key and custom model', async () => {
  process.env.TYPESAFE_API_KEY = 'env-key';
  const captured = mockFetch({ answers: null });
  const classifier = new JevClassifier({ model: 'jev-1.13.0' });
  await classifier.classify('text');
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer env-key');
  const body = JSON.parse(String(captured.init.body)) as { model: string };
  assert.equal(body.model, 'jev-1.13.0');
});

test('jev tolerates odd answer shapes and env host', async () => {
  process.env.TYPESAFE_API_HOST = 'https://jev-custom.example.com';
  const captured = mockFetch({
    answers: {
      kind: { type: 'choice', choice: 'item_detail', confidence: 'high' },
      domain: {
        type: 'choice',
        choice: 42,
        confidence: 0.5,
        probabilities: { electronics: 0.5, other: 'x' },
      },
      scope: { type: 'choice', choice: 'single', confidence: 0.5 },
    },
  });
  try {
    const classifier = new JevClassifier();
    const result = await classifier.classify('text');
    assert.equal(captured.url, 'https://jev-custom.example.com/v1/systemone');
    assert.equal(result.domain, 'general');
    assert.equal(result.visual, true);
    assert.equal(result.confidence, 0.5);
    const headers = captured.init.headers as Record<string, string>;
    assert.equal(headers.authorization, undefined);
  } finally {
    delete process.env.TYPESAFE_API_HOST;
  }
});

test('llm classifier parses classification JSON', async () => {
  const seen: LlmRequest[] = [];
  const llm: LlmProvider = {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      seen.push(request);
      return {
        content: JSON.stringify({
          kind: 'editorial',
          domain: 'news_analysis',
          scope: 'single',
          visual: false,
        }),
      };
    },
  };
  const classifier = new LlmClassifier(llm);
  const result = await classifier.classify('some article text', { model: 'm' });
  assert.equal(result.kind, 'editorial');
  assert.equal(result.domain, 'news_analysis');
  assert.equal(result.visual, false);
  assert.equal(result.source, 'llm');
  assert.equal(seen[0]?.model, 'm');
});

test('llm classifier falls back on llm error, bad json and bad values', async () => {
  assert.deepEqual(await new LlmClassifier(fakeLlm(new Error('down'))).classify('t'), {
    ...GENERIC_CLASSIFICATION,
    reason: 'llm_error',
  });
  assert.deepEqual(await new LlmClassifier(fakeLlm('not json')).classify('t'), {
    ...GENERIC_CLASSIFICATION,
    reason: 'llm_error',
  });
  assert.deepEqual(
    await new LlmClassifier(
      fakeLlm(JSON.stringify({ kind: 'weird', domain: 'x', scope: 'single', visual: true })),
    ).classify('t'),
    { ...GENERIC_CLASSIFICATION, reason: 'llm_error' },
  );
  assert.deepEqual(
    await new LlmClassifier(
      fakeLlm(JSON.stringify({ kind: 'editorial', domain: 'nope', scope: 'single' })),
    ).classify('t'),
    {
      kind: 'editorial',
      domain: 'general',
      scope: 'single',
      visual: true,
      confidence: 0.5,
      source: 'llm',
    },
  );
});

test('jev retries 429 then succeeds', async () => {
  const ok = {
    answers: {
      kind: { type: 'choice', choice: 'item_detail', confidence: 0.9 },
      domain: { type: 'choice', choice: 'electronics', confidence: 0.8 },
      scope: { type: 'choice', choice: 'single', confidence: 0.9 },
      visual: { type: 'noul', noul: 0.9 },
    },
  };
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response('rate limited', { status: 429 });
    return new Response(JSON.stringify(ok), { status: 200 });
  }) as typeof fetch;
  const result = await new JevClassifier({ apiKey: 'k' }).classify('text');
  assert.equal(result.domain, 'electronics');
  assert.equal(calls, 2);
});

test('jev gives up after max attempts and rethrows fatal errors', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('overloaded', { status: 529 });
  }) as typeof fetch;
  await assert.rejects(
    new JevClassifier({ apiKey: 'k' }).classify('text'),
    (error: unknown) => error instanceof Error && /responded 529/.test(error.message),
  );
  assert.equal(calls, 3);

  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('bad gateway', { status: 502 });
  }) as typeof fetch;
  await assert.rejects(
    new JevClassifier({ apiKey: 'k' }).classify('text'),
    (error: unknown) => error instanceof Error && /responded 502/.test(error.message),
  );
  assert.equal(calls, 1);
});

test('isJevRetriable matches 429 and 529 only', () => {
  assert.equal(isJevRetriable(new Error('LLM host responded 429: slow down')), true);
  assert.equal(isJevRetriable(new Error('LLM host responded 529: overloaded')), true);
  assert.equal(isJevRetriable(new Error('LLM host responded 503: nope')), false);
  assert.equal(isJevRetriable(new Error('boom')), false);
  assert.equal(isJevRetriable('responded 429'), true);
  assert.equal(isJevRetriable(undefined), false);
});

test('jev rethrows non-error rejections without retry', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw 'socket hung up';
  }) as typeof fetch;
  await assert.rejects(new JevClassifier({ apiKey: 'k' }).classify('text'), /socket hung up/);
  assert.equal(calls, 1);
});
