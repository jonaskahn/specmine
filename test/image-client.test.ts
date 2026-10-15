import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionError } from '../src/errors.js';
import {
  createOpenAiImageProvider,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_TIMEOUT_MS,
  OpenAiImageClient,
} from '../src/llm/openai-image.js';

function imageFetch(
  body: unknown,
  status = 200,
): { url: string; init: RequestInit; calls: number } {
  const captured = { url: '', init: {} as RequestInit, calls: 0 };
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.calls += 1;
    if (captured.calls === 1) {
      captured.url = String(url);
      captured.init = init ?? {};
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  }) as typeof fetch;
  return captured;
}

function bytesFetch(status = 200): void {
  globalThis.fetch = (async () => new Response(new ArrayBuffer(8), { status })) as typeof fetch;
}

test.afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch;
  delete process.env.SPECMINE_IMAGE_API_KEY;
  delete process.env.SPECMINE_IMAGE_API_HOST;
  delete process.env.SPECMINE_IMAGE_MODEL;
  delete process.env.SPECMINE_LLM_API_KEY;
  delete process.env.SPECMINE_LLM_API_HOST;
  delete process.env.SPECMINE_LLM_MODEL;
  delete process.env.OPENAI_API_KEY;
});

test('generates image from b64_json', async () => {
  const captured = imageFetch({
    data: [{ b64_json: Buffer.from('png-bytes').toString('base64'), revised_prompt: 'rev' }],
  });
  const client = new OpenAiImageClient({ apiKey: 'k', apiHost: 'http://litellm:4000' });
  const result = await client.generate({
    prompt: 'a kettle',
    model: 'm',
    size: '1024x1024',
    quality: 'hd',
    background: 'opaque',
  });
  assert.equal(captured.url, 'http://litellm:4000/images/generations');
  const body = JSON.parse(String(captured.init.body)) as Record<string, unknown>;
  assert.equal(body.model, 'm');
  assert.equal(body.n, 1);
  assert.equal(new TextDecoder().decode(result.bytes), 'png-bytes');
  assert.equal(result.revisedPrompt, 'rev');
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer k');
});

test('fetches image bytes when url is returned', async () => {
  imageFetch({ data: [{ url: 'https://cdn.test/img.png' }] });
  const client = createOpenAiImageProvider({ apiKey: 'k' });
  const result = await client.generate({ prompt: 'a kettle' });
  assert.equal(result.bytes.length, 4);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.revisedPrompt, undefined);
});

test('rejects empty prompt and empty data', async () => {
  imageFetch({ data: [] });
  const client = new OpenAiImageClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.generate({ prompt: '   ' }),
    (error: unknown) => {
      return error instanceof ExtractionError && error.code === 'EMPTY_INPUT';
    },
  );
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    (error: unknown) => {
      return error instanceof ExtractionError && error.code === 'LLM_ERROR';
    },
  );
  imageFetch({ data: [{}] });
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    (error: unknown) => {
      return error instanceof ExtractionError && error.code === 'LLM_ERROR';
    },
  );
});

test('maps host errors to LLM_ERROR', async () => {
  imageFetch({ error: 'bad' }, 500);
  const client = new OpenAiImageClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('maps url fetch failures', async () => {
  imageFetch({ data: [{ url: 'https://cdn.test/img.png' }] });
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/img.png' }] }), {
        status: 200,
      });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const client = new OpenAiImageClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('maps aborted url fetch to TIMEOUT', async () => {
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/img.png' }] }), {
        status: 200,
      });
    }
    throw new DOMException('aborted', 'AbortError');
  }) as typeof fetch;
  const client = new OpenAiImageClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'TIMEOUT',
  );
});

test('maps url fetch network errors to LLM_ERROR', async () => {
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/img.png' }] }), {
        status: 200,
      });
    }
    throw new Error('dns down');
  }) as typeof fetch;
  const client = new OpenAiImageClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('resolves key and host from env with image-first precedence', async () => {
  process.env.SPECMINE_IMAGE_API_KEY = 'img-key';
  process.env.SPECMINE_IMAGE_API_HOST = 'http://img-host';
  process.env.SPECMINE_LLM_API_KEY = 'llm-key';
  const captured = imageFetch({ data: [{ b64_json: Buffer.from('x').toString('base64') }] });
  await new OpenAiImageClient().generate({ prompt: 'x' });
  assert.ok(captured.url.startsWith('http://img-host'));
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer img-key');
  const body = JSON.parse(String(captured.init.body)) as { model: string };
  assert.equal(body.model, DEFAULT_IMAGE_MODEL);
  void DEFAULT_IMAGE_TIMEOUT_MS;
  void bytesFetch;
});

test('falls back to SPECMINE_LLM_* when no image settings exist', async () => {
  process.env.SPECMINE_LLM_API_KEY = 'llm-key';
  process.env.SPECMINE_LLM_API_HOST = 'http://llm-host';
  process.env.SPECMINE_LLM_MODEL = 'llm-image-model';
  const captured = imageFetch({ data: [{ b64_json: Buffer.from('x').toString('base64') }] });
  await new OpenAiImageClient().generate({ prompt: 'x' });
  assert.ok(captured.url.startsWith('http://llm-host'));
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer llm-key');
  const body = JSON.parse(String(captured.init.body)) as { model: string };
  assert.equal(body.model, 'llm-image-model');
});

test('prefers SPECMINE_IMAGE_MODEL over the LLM model', async () => {
  process.env.SPECMINE_IMAGE_MODEL = 'img-model';
  process.env.SPECMINE_LLM_MODEL = 'llm-model';
  const captured = imageFetch({ data: [{ b64_json: Buffer.from('x').toString('base64') }] });
  await new OpenAiImageClient().generate({ prompt: 'x' });
  const body = JSON.parse(String(captured.init.body)) as { model: string };
  assert.equal(body.model, 'img-model');
});

test('omits auth header without a key and honors timeout plus signal', async () => {
  const captured = imageFetch({ data: [{ url: 'https://cdn.test/img.png' }] });
  const controller = new AbortController();
  const client = new OpenAiImageClient();
  const result = await client.generate(
    { prompt: 'x' },
    { timeoutMs: 5000, signal: controller.signal },
  );
  assert.equal(result.bytes.length, 4);
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, undefined);
});

test('keeps revised prompt on url responses and maps odd failures', async () => {
  imageFetch({ data: [{ url: 'https://cdn.test/img.png', revised_prompt: 'rev2' }] });
  const client = new OpenAiImageClient({ apiKey: 'k' });
  const result = await client.generate({ prompt: 'x' });
  assert.equal(result.revisedPrompt, 'rev2');

  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/img.png' }] }), {
        status: 200,
      });
    }
    throw 'string failure';
  }) as typeof fetch;
  await assert.rejects(
    client.generate({ prompt: 'x' }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});
