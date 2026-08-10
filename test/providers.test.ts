import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiClient, createOpenAiProvider } from '../src/llm/openai.js';
import { AnthropicClient, createAnthropicProvider } from '../src/llm/anthropic.js';
import { ExtractionError } from '../src/errors.js';

function mockFetch(body: unknown, status = 200): { url: string; init: RequestInit } {
  const captured: { url: string; init: RequestInit } = { url: '', init: {} };
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init ?? {};
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return captured;
}

const ENV_VARS = ['SPECMINE_LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

test.beforeEach(() => {
  for (const name of ENV_VARS) delete process.env[name];
});

test.afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test('openai sends chat/completions request with system, user and tool messages', async () => {
  const captured = mockFetch({ choices: [{ message: { content: '{"ok":"1"}' } }] });
  const client = new OpenAiClient({ apiKey: 'k', apiHost: 'https://litellm.example.com' });
  const response = await client.complete({
    model: 'azure/gpt-5.6-luna',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'tool', content: 'result' },
    ],
    temperature: 0,
    maxTokens: 100,
  });
  assert.equal(captured.url, 'https://litellm.example.com/chat/completions');
  const body = JSON.parse(String(captured.init.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    max_tokens: number;
    response_format: {
      type: string;
      json_schema: { name: string; strict: boolean; schema: { type: string } };
    };
  };
  assert.equal(body.model, 'azure/gpt-5.6-luna');
  assert.deepEqual(
    body.messages.map((m) => m.role),
    ['system', 'user', 'tool'],
  );
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 100);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.name, 'extracted_specs');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.type, 'object');
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer k');
  assert.equal(response.content, '{"ok":"1"}');
});

test('openai maps non-2xx to LLM_ERROR', async () => {
  mockFetch({ error: 'bad' }, 500);
  const client = new OpenAiClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.complete({ messages: [{ role: 'user', content: 'x' }] }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('openai rejects vision parts with UNSUPPORTED_INPUT', async () => {
  mockFetch({ choices: [{ message: { content: '{}' } }] });
  const client = new OpenAiClient({ apiKey: 'k' });
  await assert.rejects(
    () =>
      client.complete({
        messages: [{ role: 'user', content: [{ type: 'pdf', data: new Uint8Array() }] }],
      }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'UNSUPPORTED_INPUT',
  );
});

test('openai throws on missing content', async () => {
  mockFetch({ choices: [{ message: {} }] });
  const client = new OpenAiClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.complete({ messages: [] }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('openai factory returns a provider', () => {
  assert.equal(typeof createOpenAiProvider({ apiKey: 'k' }).complete, 'function');
});

test('anthropic sends /v1/messages with system field and tool_result block', async () => {
  const captured = mockFetch({ content: [{ type: 'text', text: '{"ok":"1"}' }] });
  const client = new AnthropicClient({ apiKey: 'k', apiHost: 'https://api.example.com' });
  const response = await client.complete({
    messages: [
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'hello' },
      { role: 'tool', content: 'tool result' },
    ],
  });
  assert.equal(captured.url, 'https://api.example.com/v1/messages');
  const body = JSON.parse(String(captured.init.body)) as {
    system: string;
    messages: Array<{ role: string; content: unknown }>;
    max_tokens: number;
    tools: Array<{ name: string; input_schema: { type: string } }>;
    tool_choice: { type: string; name: string };
  };
  assert.equal(body.system, 'sys prompt');
  assert.deepEqual(
    body.messages.map((m) => m.role),
    ['user', 'user'],
  );
  const toolMessage = body.messages[1];
  const toolBlock = (toolMessage.content as Array<{ type: string; content: string }>)[0];
  assert.equal(toolBlock.type, 'tool_result');
  assert.equal(toolBlock.content, 'tool result');
  assert.equal(body.tools[0]?.name, 'specmine');
  assert.equal(body.tools[0]?.input_schema.type, 'object');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'specmine' });
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'k');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(response.content, '{"ok":"1"}');
});

test('anthropic returns the forced tool_use input as JSON content', async () => {
  const captured = mockFetch({
    content: [
      {
        type: 'tool_use',
        name: 'specmine',
        input: { specs: [{ key: 'Weight', value: '1.5 kg', children: [] }] },
      },
    ],
  });
  const client = new AnthropicClient({ apiKey: 'k' });
  const response = await client.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(
    response.content,
    JSON.stringify({ specs: [{ key: 'Weight', value: '1.5 kg', children: [] }] }),
  );
  const body = JSON.parse(String(captured.init.body)) as { tool_choice: unknown };
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'specmine' });
});

test('anthropic maps non-2xx to LLM_ERROR', async () => {
  mockFetch({ error: 'bad' }, 429);
  const client = new AnthropicClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.complete({ messages: [] }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('anthropic passes model, maxTokens and temperature to the request', async () => {
  const captured = mockFetch({ content: [{ type: 'text', text: '{}' }] });
  const client = new AnthropicClient({ apiKey: 'k' });
  await client.complete({
    model: 'custom-model',
    maxTokens: 512,
    temperature: 0.2,
    messages: [{ role: 'user', content: 'hi' }],
  });
  const body = JSON.parse(String(captured.init.body)) as {
    model: string;
    max_tokens: number;
    temperature: number;
  };
  assert.equal(body.model, 'custom-model');
  assert.equal(body.max_tokens, 512);
  assert.equal(body.temperature, 0.2);
});

test('anthropic rejects vision parts with UNSUPPORTED_INPUT', async () => {
  mockFetch({ content: [{ type: 'text', text: '{}' }] });
  const client = new AnthropicClient({ apiKey: 'k' });
  await assert.rejects(
    () =>
      client.complete({
        messages: [{ role: 'user', content: [{ type: 'pdf', data: new Uint8Array() }] }],
      }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'UNSUPPORTED_INPUT',
  );
});

test('anthropic sends text parts as a content array', async () => {
  const captured = mockFetch({ content: [{ type: 'text', text: '{}' }] });
  const client = new AnthropicClient({ apiKey: 'k' });
  await client.complete({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  });
  const body = JSON.parse(String(captured.init.body)) as {
    messages: Array<{ content: unknown }>;
  };
  assert.deepEqual(body.messages[0]?.content, [{ type: 'text', text: 'hi' }]);
});

test('anthropic throws on missing text content', async () => {
  mockFetch({ content: [] });
  const client = new AnthropicClient({ apiKey: 'k' });
  await assert.rejects(
    () => client.complete({ messages: [] }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
  );
});

test('anthropic uses custom anthropicVersion', async () => {
  const captured = mockFetch({ content: [{ type: 'text', text: '{}' }] });
  const client = new AnthropicClient({ apiKey: 'k', anthropicVersion: '2024-01-01' });
  await client.complete({ messages: [] });
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers['anthropic-version'], '2024-01-01');
});

test('anthropic factory returns a provider', () => {
  assert.equal(typeof createAnthropicProvider({ apiKey: 'k' }).complete, 'function');
});

test('openai joins text parts into a single message', async () => {
  const captured = mockFetch({ choices: [{ message: { content: '{}' } }] });
  const client = new OpenAiClient({ apiKey: 'k' });
  await client.complete({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    ],
  });
  const body = JSON.parse(String(captured.init.body)) as {
    messages: Array<{ content: string }>;
  };
  assert.equal(body.messages[0]?.content, 'a\nb');
});

test('openai omits authorization header without an api key', async () => {
  const captured = mockFetch({ choices: [{ message: { content: '{}' } }] });
  const client = new OpenAiClient();
  await client.complete({ messages: [] });
  const headers = captured.init.headers as Record<string, string>;
  assert.equal(headers.authorization, undefined);
});
