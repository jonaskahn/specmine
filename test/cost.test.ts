import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySummary, estimateCost, recordUsage } from '../src/telemetry/cost.js';
import { MeteredProvider } from '../src/llm/metered.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';

function provider(response: LlmResponse): LlmProvider {
  return { complete: async () => response };
}

test('usage from the provider lands in the summary', async () => {
  const cost = emptySummary();
  const metered = new MeteredProvider(
    provider({ content: '{}', usage: { inputTokens: 100, outputTokens: 20 } }),
    cost,
  );
  await metered.complete({ messages: [], model: 'm' });
  assert.deepEqual(cost.calls, [{ stage: 'llm', model: 'm', inputTokens: 100, outputTokens: 20 }]);
  assert.equal(cost.totalTokens, 120);
});

test('a provider that reports no usage records zero, not a guess', async () => {
  const cost = emptySummary();
  await new MeteredProvider(provider({ content: '{}' }), cost).complete({ messages: [] });
  assert.equal(cost.calls[0]?.model, 'unknown');
  assert.equal(cost.totalTokens, 0);
});

test('the stage label reverts after the run it wraps', async () => {
  const cost = emptySummary();
  const metered = new MeteredProvider(provider({ content: '{}', usage: { inputTokens: 1 } }), cost);
  await metered.withStage('spec', () => metered.complete({ messages: [] }));
  await metered.complete({ messages: [] });
  assert.deepEqual(
    cost.calls.map((call) => call.stage),
    ['spec', 'llm'],
  );
});

test('the stage reverts even when the wrapped run throws', async () => {
  const cost = emptySummary();
  const metered = new MeteredProvider(provider({ content: '{}', usage: { inputTokens: 1 } }), cost);
  await assert.rejects(() =>
    metered.withStage('image', async () => {
      throw new Error('boom');
    }),
  );
  await metered.complete({ messages: [] });
  assert.deepEqual(
    cost.calls.map((call) => call.stage),
    ['llm'],
  );
});

test('identify is priced at the Jev rate and its output is free', () => {
  const cost = emptySummary();
  recordUsage(cost, { stage: 'identify', model: 'jev', inputTokens: 2500, outputTokens: 0 });
  assert.equal(estimateCost(cost), 0.000105);
});

test('llm stages are priced at the blended rate', () => {
  const cost = emptySummary();
  recordUsage(cost, { stage: 'spec', model: 'm', inputTokens: 1000, outputTokens: 1000 });
  assert.equal(estimateCost(cost), 0.00346);
});

test('an empty run costs nothing', () => {
  assert.equal(estimateCost(emptySummary()), 0);
});
