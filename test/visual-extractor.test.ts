import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from '../src/category/registry.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';
import { resolveGroundedFacts } from '../src/image/ladder.js';
import { buildVisualPrompts, VisualExtractor } from '../src/image/visual-extractor.js';

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

test('builds category visual prompts with exclusions', () => {
  const { system, slots } = buildVisualPrompts(resolveProfile('apparel_footwear'));
  assert.ok(slots.includes('colors'));
  assert.ok(system.includes('Never depict or include: size, fit tables'));
  assert.ok(system.includes('Current date:'));
  const general = buildVisualPrompts(resolveProfile('general'));
  assert.ok(!general.system.includes('Never depict'));
  const bare = buildVisualPrompts({ ...resolveProfile('general'), visualSlots: [] });
  assert.ok(bare.slots.includes('subject'));
});

test('refuses thin facts below the minimum', async () => {
  const thin = JSON.stringify({ subject: 'thing', colors: [], materials: [], heroFeatures: [] });
  const profile = resolveProfile('electronics');
  assert.equal(
    await new VisualExtractor(fakeLlm(thin)).extract('text', profile, { minFacts: 2 }),
    undefined,
  );
  assert.ok(await new VisualExtractor(fakeLlm(thin)).extract('text', profile));
});

test('conceptual briefs stay unbranded even when the llm names a brand', async () => {
  const profile = resolveProfile('software_app');
  const brief = JSON.stringify({
    subject: 'ascending glass prisms',
    colors: ['blue'],
    materials: [],
    heroFeatures: [],
    brand: 'Acme',
  });
  const result = await resolveGroundedFacts({
    text: 'Acme course platform',
    profile,
    llm: fakeLlm(brief),
    literal: async () => undefined,
    call: {},
  });
  assert.equal(result.grounding, 'conceptual');
  assert.equal(result.facts.brand, undefined);
});

test('contextual briefs keep the brand as a design cue', async () => {
  const profile = resolveProfile('electronics');
  const brief = JSON.stringify({
    subject: 'electric kettle',
    colors: ['black'],
    materials: [],
    heroFeatures: [],
    brand: 'Acme',
  });
  const result = await resolveGroundedFacts({
    text: 'Acme electric kettle',
    profile,
    llm: fakeLlm(brief),
    literal: async () => undefined,
    call: {},
  });
  assert.equal(result.grounding, 'contextual');
  assert.equal(result.facts.brand, 'Acme');
});

test('ladder briefs stamp the current date on the system prompt', async () => {
  const seen: string[] = [];
  const llm: LlmProvider = {
    async complete(request): Promise<LlmResponse> {
      const first = request.messages[0];
      seen.push(typeof first?.content === 'string' ? first.content : '');
      return { content: JSON.stringify({ subject: 'office', colors: [], materials: [] }) };
    },
  };
  const result = await resolveGroundedFacts({
    text: 'Acme office',
    profile: resolveProfile('electronics'),
    llm,
    literal: async () => undefined,
    call: {},
  });
  assert.equal(result.grounding, 'contextual');
  assert.ok(seen[0]?.includes('Current date:'));
});
