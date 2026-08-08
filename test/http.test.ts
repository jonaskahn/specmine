import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../src/llm/http.js';
import { ExtractionError } from '../src/errors.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExtractionError(error: unknown, code: string): boolean {
  return error instanceof ExtractionError && error.code === code;
}

test.afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test('aborts with TIMEOUT when the call exceeds timeoutMs', async () => {
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  }) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}, { timeoutMs: 20 }),
    (error: unknown) => isExtractionError(error, 'TIMEOUT'),
  );
});

test('aborts with TIMEOUT when the caller signal aborts', async () => {
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  }) as typeof fetch;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}, { signal: controller.signal }),
    (error: unknown) => isExtractionError(error, 'TIMEOUT'),
  );
});

test('maps plain Error rejections to LLM_ERROR', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}),
    (error: unknown) => isExtractionError(error, 'LLM_ERROR') && /network down/.test(error.message),
  );
});

test('does not treat non-DOMException aborts as timeouts', async () => {
  globalThis.fetch = (async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}),
    (error: unknown) => isExtractionError(error, 'LLM_ERROR') && /aborted/.test(error.message),
  );
});

test('maps non-Error rejections to LLM_ERROR', async () => {
  globalThis.fetch = (async () => {
    throw 'network down';
  }) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}),
    (error: unknown) => isExtractionError(error, 'LLM_ERROR') && /network down/.test(error.message),
  );
});

test('maps invalid JSON bodies to LLM_ERROR', async () => {
  globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}),
    (error: unknown) => isExtractionError(error, 'LLM_ERROR') && /invalid JSON/.test(error.message),
  );
});

test('clears the timer on a successful fast call', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  const response = await requestJson('https://api.example.com/v1', {}, { timeoutMs: 5_000 });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  await wait(10);
});

test('includes response body detail on non-ok status', async () => {
  globalThis.fetch = (async () => new Response('rate limited', { status: 429 })) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}),
    (error: unknown) =>
      isExtractionError(error, 'LLM_ERROR') && /429: rate limited/.test(error.message),
  );
});

test('ignores a failing response body when reading detail', async () => {
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => {
        throw new Error('body read failed');
      },
    }) as unknown as Response) as typeof fetch;
  await assert.rejects(
    () => requestJson('https://api.example.com/v1', {}),
    (error: unknown) =>
      isExtractionError(error, 'LLM_ERROR') && /LLM host responded 500$/.test(error.message),
  );
});
