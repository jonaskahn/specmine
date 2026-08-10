import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExtractor, DefaultExtractor, extract } from '../src/extractor.js';
import { ExtractionError } from '../src/errors.js';
import { JsonSpecValidator } from '../src/spec/validator.js';
import type { InputReader, ReadResult } from '../src/input/reader.js';
import type { CallOptions } from '../src/types.js';
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from '../src/llm/provider.js';

function fakeReader(text: string, imageOnly = false): InputReader {
  return {
    async read(): Promise<ReadResult> {
      return { text, imageOnly };
    },
  };
}

function fakeLlm(responses: string[]): { llm: LlmProvider; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let index = 0;
  return {
    calls,
    llm: {
      async complete(request: LlmRequest): Promise<LlmResponse> {
        calls.push(request);
        const content = responses[index] ?? '{}';
        index += 1;
        return { content };
      },
    },
  };
}

test('extracts flat spec from text input', async () => {
  const { llm } = fakeLlm(['{"Weight": "1.5 kg"}']);
  const extractor = createExtractor({
    reader: fakeReader('The device weighs 1.5 kg.'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('anything');
  assert.deepEqual(spec, { Weight: '1.5 kg' });
});

test('builds system and user messages with default lang', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('content');
  const messages = calls[0]?.messages ?? [];
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user'],
  );
  assert.equal(messages[1]?.content, 'content');
});

test('appends language line for non-en lang', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('content', { lang: 'de' });
  const system = calls[0]?.messages[0] as LlmMessage;
  assert.match(String(system.content), /Write every key and value in German/);
});

test('detects input language when lang is not given', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('Das Gerät wiegt 1,5 kg.'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('anything');
  const system = calls[0]?.messages[0] as LlmMessage;
  assert.match(String(system.content), /Write every key and value in German/);
});

test('explicit lang wins over detected input language', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('Das Gerät wiegt 1,5 kg.', { lang: 'fr' });
  const system = calls[0]?.messages[0] as LlmMessage;
  assert.match(String(system.content), /Write every key and value in French/);
});

test('does not append language line for en', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('content', { lang: 'en' });
  const system = calls[0]?.messages[0] as LlmMessage;
  assert.doesNotMatch(String(system.content), /Write every key and value in/);
});

test('returns empty spec for all-image pdf without calling llm', async () => {
  let called = false;
  const llm: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      called = true;
      return { content: '{}' };
    },
  };
  const extractor = createExtractor({
    reader: fakeReader('', true),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('whatever');
  assert.deepEqual(spec, {});
  assert.equal(called, false);
});

test('throws EMPTY_INPUT for empty text', async () => {
  const extractor = createExtractor({
    reader: fakeReader('   '),
    llm: fakeLlm(['{}']).llm,
    validator: new JsonSpecValidator(),
  });
  await assert.rejects(
    () => extractor.extract('   '),
    (error: unknown) => error instanceof ExtractionError && error.code === 'EMPTY_INPUT',
  );
});

test('throws INVALID_OUTPUT when validator rejects', async () => {
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm: fakeLlm(['{"bad": 1}']).llm,
    validator: new JsonSpecValidator(),
  });
  await assert.rejects(
    () => extractor.extract('content'),
    (error: unknown) => error instanceof ExtractionError && error.code === 'INVALID_OUTPUT',
  );
});

test('passes model and timeout through to llm', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('content', { model: 'm1', timeoutMs: 5_000 });
  assert.equal(calls[0]?.model, 'm1');
});

test('extract() works end to end with a fake provider', async () => {
  const llm: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      return { content: '{"Weight": "1.5 kg"}' };
    },
  };
  const spec = await createExtractor({ llm }).extract('weighs 1.5 kg');
  assert.deepEqual(spec, { Weight: '1.5 kg' });
});

test('DefaultExtractor is instantiable directly', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = new DefaultExtractor({
    reader: fakeReader('x'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('x');
  assert.equal(calls.length, 1);
});

test('passes signal through to llm call options', async () => {
  let received: CallOptions | undefined;
  const llm: LlmProvider = {
    async complete(_request: LlmRequest, options?: CallOptions): Promise<LlmResponse> {
      received = options;
      return { content: '{}' };
    },
  };
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const controller = new AbortController();
  await extractor.extract('content', { signal: controller.signal });
  assert.equal(received?.signal, controller.signal);
});

test('falls back to raw lang when Intl.DisplayNames cannot resolve it', async () => {
  const { llm, calls } = fakeLlm(['{}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  await extractor.extract('content', { lang: '' });
  const system = calls[0]?.messages[0] as LlmMessage;
  assert.match(String(system.content), /Write every key and value in \./);
});

test('createExtractor defaults reader, llm and validator', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"Weight": "1.5 kg"}' } }] }), {
      status: 200,
    })) as typeof fetch;
  try {
    const extractor = createExtractor();
    const spec = await extractor.extract('weighs 1.5 kg');
    assert.deepEqual(spec, { Weight: '1.5 kg' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract() uses the anthropic provider when requested', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":"1"}' }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const spec = await extract('weighs 1.5 kg', { provider: 'anthropic', apiKey: 'k' });
    assert.deepEqual(spec, { ok: '1' });
    assert.match(capturedUrl, /\/v1\/messages$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract() defaults to the openai provider', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const spec = await extract('weighs 1.5 kg', { apiKey: 'k' });
    assert.deepEqual(spec, {});
    assert.match(capturedUrl, /\/chat\/completions$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract() resolves apiKey-less provider options', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    })) as typeof fetch;
  try {
    const spec = await extract('weighs 1.5 kg');
    assert.deepEqual(spec, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('flattened: true with inheritance: true reduces nested output to leaf pairs with path keys', async () => {
  const { llm } = fakeLlm(['{"Hardware": {"Power Supply": "12 V DC", "Casing": "ABS plastic"}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true, inheritance: true });
  assert.deepEqual(spec, {
    'Hardware · Power Supply': '12 V DC',
    'Hardware · Casing': 'ABS plastic',
  });
});

test('flattened: true with inheritance: true flattens arbitrarily deep nesting', async () => {
  const { llm } = fakeLlm(['{"A": {"B": {"C": "1", "D": "2"}}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true, inheritance: true });
  assert.deepEqual(spec, { 'A · B · C': '1', 'A · B · D': '2' });
});

test('flattened: true leaves an already-flat spec unchanged', async () => {
  const { llm } = fakeLlm(['{"Weight": "1.5 kg", "Colour": "red"}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true });
  assert.deepEqual(spec, { Weight: '1.5 kg', Colour: 'red' });
});

test('flattened: false keeps the nested shape', async () => {
  const { llm } = fakeLlm(['{"Hardware": {"Power Supply": "12 V DC"}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: false });
  assert.deepEqual(spec, { Hardware: { 'Power Supply': '12 V DC' } });
});

test('flattened: true with inheritance: true keeps duplicate leaf keys distinct via paths', async () => {
  const { llm } = fakeLlm(['{"Front": {"Length": "10 cm"}, "Rear": {"Length": "12 cm"}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true, inheritance: true });
  assert.deepEqual(spec, { 'Front · Length': '10 cm', 'Rear · Length': '12 cm' });
});

test('flattened: true keeps only innermost leaf pairs by default', async () => {
  const { llm } = fakeLlm(['{"Hardware": {"Power Supply": "12 V DC", "Casing": "ABS plastic"}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true });
  assert.deepEqual(spec, { 'Power Supply': '12 V DC', Casing: 'ABS plastic' });
});

test('flattened: true drops all intermediate keys in deep nesting by default', async () => {
  const { llm } = fakeLlm(['{"A": {"B": {"C": "1", "D": "2"}}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true, inheritance: false });
  assert.deepEqual(spec, { C: '1', D: '2' });
});

test('flattened: true overwrites colliding leaf keys, last one wins', async () => {
  const { llm } = fakeLlm(['{"Front": {"Length": "10 cm"}, "Rear": {"Length": "12 cm"}}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true });
  assert.deepEqual(spec, { Length: '12 cm' });
});

test('flattened: true keeps top-level leaves alongside innermost pairs', async () => {
  const { llm } = fakeLlm(['{"Hardware": {"Power Supply": "12 V DC"}, "Model": "AX-1"}']);
  const extractor = createExtractor({
    reader: fakeReader('content'),
    llm,
    validator: new JsonSpecValidator(),
  });
  const spec = await extractor.extract('content', { flattened: true });
  assert.deepEqual(spec, { 'Power Supply': '12 V DC', Model: 'AX-1' });
});
