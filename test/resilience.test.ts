import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResilientProvider, createResilientProvider } from '../src/llm/resilience.js';
import { ExtractionError } from '../src/errors.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';

function failingProvider(script: Array<'fail' | 'ok'>): { provider: LlmProvider; calls: number } {
  let calls = 0;
  const provider: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      const step = script[calls];
      calls += 1;
      if (step === 'fail') {
        throw new ExtractionError('LLM_ERROR', 'boom');
      }
      return { content: '{}' };
    },
  };
  return {
    provider,
    get calls() {
      return calls;
    },
  };
}

function failingProviderAlways(): { provider: LlmProvider; calls: number } {
  let calls = 0;
  return {
    provider: {
      async complete(): Promise<LlmResponse> {
        calls += 1;
        throw new ExtractionError('LLM_ERROR', 'boom');
      },
    },
    get calls() {
      return calls;
    },
  };
}

test('retries then succeeds', async () => {
  const state = failingProvider(['fail', 'fail', 'ok']);
  const resilient = new ResilientProvider(state.provider, {
    retry: { maxRetries: 2, backoffMs: 1 },
  });
  const response = await resilient.complete({ messages: [] });
  assert.equal(response.content, '{}');
  assert.equal(state.calls, 3);
});

test('stops retrying after maxRetries', async () => {
  const state = failingProviderAlways();
  const resilient = new ResilientProvider(state.provider, {
    retry: { maxRetries: 1, backoffMs: 1 },
  });
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  assert.equal(state.calls, 2);
});

test('opens circuit after failure threshold', async () => {
  const state = failingProviderAlways();
  const resilient = new ResilientProvider(state.provider, {
    retry: { maxRetries: 0, backoffMs: 1 },
    circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
  });
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  await assert.rejects(() => resilient.complete({ messages: [] }), /Circuit breaker is open/);
  assert.equal(state.calls, 2);
});

test('half-open probe closes circuit on success', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let calls = 0;
  const provider: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      calls += 1;
      if (calls <= 2) {
        throw new ExtractionError('LLM_ERROR', 'boom');
      }
      return { content: '{}' };
    },
  };
  const resilient = new ResilientProvider(provider, {
    retry: { maxRetries: 0, backoffMs: 1 },
    circuitBreaker: { failureThreshold: 2, cooldownMs: 1 },
  });
  await assert.rejects(() => resilient.complete({ messages: [] }));
  await assert.rejects(() => resilient.complete({ messages: [] }));
  await assert.rejects(() => resilient.complete({ messages: [] }), /Circuit breaker is open/);
  t.mock.timers.tick(5);
  const response = await resilient.complete({ messages: [] });
  assert.equal(response.content, '{}');
  await resilient.complete({ messages: [] });
  assert.equal(calls, 4);
});

test('reads circuit breaker settings from SPECMINE env', async () => {
  process.env.SPECMINE_LLM_FAILURE_THRESHOLD = '1';
  process.env.SPECMINE_LLM_COOLDOWN_MS = '60000';
  const state = failingProviderAlways();
  const resilient = new ResilientProvider(state.provider, { retry: { maxRetries: 0 } });
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  await assert.rejects(() => resilient.complete({ messages: [] }), /Circuit breaker is open/);
  assert.equal(state.calls, 1);
  delete process.env.SPECMINE_LLM_FAILURE_THRESHOLD;
  delete process.env.SPECMINE_LLM_COOLDOWN_MS;
});

test('does not retry unsupported input errors', async () => {
  let calls = 0;
  const provider: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      calls += 1;
      throw new ExtractionError('UNSUPPORTED_INPUT', 'nope');
    },
  };
  const resilient = new ResilientProvider(provider, { retry: { maxRetries: 3 } });
  await assert.rejects(() => resilient.complete({ messages: [] }), /nope/);
  assert.equal(calls, 1);
});

test('factory returns a working provider', async () => {
  const provider: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      return { content: '{}' };
    },
  };
  const resilient = createResilientProvider(provider);
  const response = await resilient.complete({ messages: [] });
  assert.equal(response.content, '{}');
});

test('aborts retry with TIMEOUT when the signal is aborted', async () => {
  let calls = 0;
  const provider: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      calls += 1;
      throw new ExtractionError('LLM_ERROR', 'boom');
    },
  };
  const controller = new AbortController();
  controller.abort();
  const resilient = new ResilientProvider(provider, { retry: { maxRetries: 3, backoffMs: 1 } });
  await assert.rejects(
    () => resilient.complete({ messages: [] }, { signal: controller.signal }),
    (error: unknown) => error instanceof ExtractionError && error.code === 'TIMEOUT',
  );
  assert.equal(calls, 1);
});

test('half-open probe failure reopens the circuit', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let calls = 0;
  const provider: LlmProvider = {
    async complete(): Promise<LlmResponse> {
      calls += 1;
      throw new ExtractionError('LLM_ERROR', 'boom');
    },
  };
  const resilient = new ResilientProvider(provider, {
    retry: { maxRetries: 0, backoffMs: 1 },
    circuitBreaker: { failureThreshold: 2, cooldownMs: 1 },
  });
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  await assert.rejects(() => resilient.complete({ messages: [] }), /Circuit breaker is open/);
  t.mock.timers.tick(5);
  await assert.rejects(() => resilient.complete({ messages: [] }), /boom/);
  await assert.rejects(() => resilient.complete({ messages: [] }), /Circuit breaker is open/);
  assert.equal(calls, 3);
});
