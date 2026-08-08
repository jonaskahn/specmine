import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiClient } from '../src/llm/openai.js';
import { AnthropicClient } from '../src/llm/anthropic.js';

const ENV_VARS = [
  'SPECMINE_LLM_API_KEY',
  'SPECMINE_LLM_API_HOST',
  'SPECMINE_LLM_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
];

test.beforeEach(() => {
  for (const name of ENV_VARS) delete process.env[name];
});

test('openai uses explicit options over env and defaults', () => {
  process.env.SPECMINE_LLM_API_KEY = 'env-key';
  const client = new OpenAiClient({ apiHost: 'https://opt.example.com/v1', model: 'opt-model' });
  let captured: RequestInit | undefined;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  return client.complete({ messages: [{ role: 'user', content: 'x' }] }).then(() => {
    const body = JSON.parse(String(captured?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.model, 'opt-model');
  });
});

test('openai resolves SPECMINE key before native key and defaults', async () => {
  process.env.SPECMINE_LLM_API_KEY = 'specmine-key';
  process.env.OPENAI_API_KEY = 'native-key';
  const client = new OpenAiClient();
  let captured: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const headers = captured?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer specmine-key');
});

test('openai falls back to native OPENAI_API_KEY', async () => {
  process.env.OPENAI_API_KEY = 'native-key';
  const client = new OpenAiClient();
  let captured: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const headers = captured?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer native-key');
});

test('openai defaults to gpt-5.6-luna without env', async () => {
  const client = new OpenAiClient();
  let captured: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const body = JSON.parse(String(captured?.body)) as { model: string };
  assert.equal(body.model, 'gpt-5.6-luna');
});

test('anthropic resolves native ANTHROPIC_API_KEY', async () => {
  process.env.ANTHROPIC_API_KEY = 'anthropic-key';
  const client = new AnthropicClient();
  let captured: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const headers = captured?.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'anthropic-key');
});

test('openai resolves SPECMINE_LLM_API_HOST and SPECMINE_LLM_MODEL from env', async () => {
  process.env.SPECMINE_LLM_API_HOST = 'https://env.example.com/v1';
  process.env.SPECMINE_LLM_MODEL = 'env-model';
  const client = new OpenAiClient();
  let captured: { url?: unknown; init?: RequestInit } = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.url, 'https://env.example.com/v1/chat/completions');
  const body = JSON.parse(String(captured.init?.body)) as { model: string };
  assert.equal(body.model, 'env-model');
});

test('openai prefers explicit apiHost/model over env', async () => {
  process.env.SPECMINE_LLM_API_HOST = 'https://env.example.com/v1';
  process.env.SPECMINE_LLM_MODEL = 'env-model';
  const client = new OpenAiClient({ apiHost: 'https://opt.example.com/v1', model: 'opt-model' });
  let captured: { url?: unknown; init?: RequestInit } = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.url, 'https://opt.example.com/v1/chat/completions');
  const body = JSON.parse(String(captured.init?.body)) as { model: string };
  assert.equal(body.model, 'opt-model');
});

test('anthropic resolves SPECMINE_LLM_API_HOST and SPECMINE_LLM_MODEL from env', async () => {
  process.env.SPECMINE_LLM_API_HOST = 'https://env.example.com';
  process.env.SPECMINE_LLM_MODEL = 'env-model';
  const client = new AnthropicClient();
  let captured: { url?: unknown; init?: RequestInit } = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.url, 'https://env.example.com/v1/messages');
  const body = JSON.parse(String(captured.init?.body)) as { model: string };
  assert.equal(body.model, 'env-model');
});

test('anthropic defaults to haiku-4.5 without env', async () => {
  const client = new AnthropicClient();
  let captured: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await client.complete({ messages: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const body = JSON.parse(String(captured?.body)) as { model: string };
  assert.equal(body.model, 'haiku-4.5');
});
