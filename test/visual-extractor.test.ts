import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from '../src/category/registry.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';
import { VisualExtractor } from '../src/image/visual-extractor.js';

function fakeLlm(content: string | Error): LlmProvider {
  return {
    async complete(): Promise<LlmResponse> {
      if (content instanceof Error) throw content;
      return { content };
    },
  };
}

test('extracts visual facts from content', async () => {
  const extractor = new VisualExtractor(
    fakeLlm(
      JSON.stringify({ subject: 'kettle', colors: ['black'], materials: [], heroFeatures: [] }),
    ),
  );
  const facts = await extractor.extract('a black kettle', resolveProfile('electronics'));
  assert.equal(facts?.subject, 'kettle');
});

test('returns undefined on llm error, bad json and bad shape', async () => {
  const profile = resolveProfile('electronics');
  assert.equal(
    await new VisualExtractor(fakeLlm(new Error('down'))).extract('text', profile),
    undefined,
  );
  assert.equal(await new VisualExtractor(fakeLlm('nope')).extract('text', profile), undefined);
  assert.equal(
    await new VisualExtractor(fakeLlm('{"colors": []}')).extract('text', profile),
    undefined,
  );
});
