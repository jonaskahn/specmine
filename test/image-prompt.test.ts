import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from '../src/category/registry.js';
import { guessDialect, PROMPT_DIALECTS } from '../src/image/dialects.js';
import {
  countFilledSlots,
  hasEnoughFacts,
  parseVisualFacts,
  VISUAL_FACTS_SCHEMA,
} from '../src/image/facts.js';
import { pickVisualFacts } from '../src/image/fact-picker.js';
import {
  containsForbiddenNumbers,
  sanitizeFactsText,
  sanitizePrompt,
  stripMarketing,
  stripMeasurements,
} from '../src/image/hygiene.js';
import { buildImagePrompt } from '../src/image/prompt-builder.js';

test('visual facts schema lists every property as required', () => {
  assert.deepEqual(
    [...VISUAL_FACTS_SCHEMA.required],
    [
      'subject',
      'shape',
      'proportions',
      'colors',
      'materials',
      'finish',
      'heroFeatures',
      'viewpoint',
      'setting',
    ],
  );
});

test('parses visual facts and trims lists', () => {
  const facts = parseVisualFacts({
    subject: ' kettle ',
    colors: ['black', 'black', '', 42],
    materials: ['steel'],
    heroFeatures: ['a', 'b', 'c', 'd', 'e'],
    shape: 'rounded',
    finish: 'matte',
  });
  assert.equal(facts?.subject, 'kettle');
  assert.deepEqual(facts?.colors, ['black']);
  assert.equal(facts?.heroFeatures.length, 4);
  assert.equal(facts?.shape, 'rounded');
  assert.equal(facts?.proportions, undefined);
});

test('rejects facts without a subject or non-objects', () => {
  assert.equal(parseVisualFacts(null), undefined);
  assert.equal(parseVisualFacts({ subject: '  ' }), undefined);
  assert.equal(parseVisualFacts({ subject: 42 }), undefined);
  assert.equal(
    parseVisualFacts({ subject: 'x', viewpoint: 'front', setting: 'studio' })?.viewpoint,
    'front',
  );
});

test('counts slots and checks minimum', () => {
  const thin = parseVisualFacts({ subject: 'x' });
  assert.ok(thin);
  assert.equal(countFilledSlots(thin), 1);
  assert.equal(hasEnoughFacts(thin), false);
  assert.equal(hasEnoughFacts(thin, 1), true);
  const rich = parseVisualFacts({
    subject: 'kettle',
    shape: 'round',
    colors: ['black'],
    materials: ['steel'],
    heroFeatures: ['handle'],
  });
  assert.ok(rich);
  assert.equal(countFilledSlots(rich), 5);
});

test('picks visual facts from nested multilingual specs', () => {
  const facts = pickVisualFacts(
    {
      Farbe: 'mattschwarz',
      Material: 'Edelstahl, Glas',
      Form: 'rund',
      Oberfläche: 'matt',
      Marke: 'Acme',
    },
    ['kettle'],
  );
  assert.deepEqual(facts.colors, ['mattschwarz']);
  assert.deepEqual(facts.materials, ['Edelstahl', 'Glas']);
  assert.equal(facts.shape, 'rund');
  assert.equal(facts.finish, 'matt');
  assert.equal(facts.subject, 'Acme');
});

test('picks subject from tags when no name key exists', () => {
  const facts = pickVisualFacts({ Weight: '1.5 kg' }, ['kettle']);
  assert.equal(facts.subject, 'kettle');
  const fallback = pickVisualFacts({});
  assert.equal(fallback.subject, 'product');
  assert.deepEqual(fallback.colors, []);
});

test('guesses dialect from model names', () => {
  assert.equal(guessDialect('gpt-image-1').id, 'gpt-image');
  assert.equal(guessDialect('dall-e-3').id, 'dalle3');
  assert.equal(guessDialect('flux-pro').id, 'flux');
  assert.equal(guessDialect('stability/sdxl').id, 'sd');
  assert.equal(guessDialect(undefined).id, 'generic');
  assert.equal(guessDialect('unknown-model').id, 'generic');
  assert.equal(PROMPT_DIALECTS.sd.supportsNegativePrompt, true);
});

test('hygiene strips prices, skus, urls, measures and marketing', () => {
  assert.ok(!sanitizeFactsText('Kettle $49 https://x.test a@b.co +1 234').includes('$49'));
  assert.ok(!stripMeasurements('weighs 1.5 kg and 500 ml', false).includes('1.5 kg'));
  assert.equal(stripMeasurements('three shelves, two handles', true), 'three shelves, two handles');
  assert.ok(!stripMarketing('the best premium kettle').includes('best'));
  assert.equal(containsForbiddenNumbers('price $49'), true);
  assert.equal(containsForbiddenNumbers('SKU: ABC-123'), true);
  assert.equal(containsForbiddenNumbers('clean matte black kettle'), false);
  const long = sanitizePrompt(Array(300).fill('kettle').join(' '), 180);
  assert.ok(long.split(' ').length <= 180);
});

test('builds labeled prompt for gpt-image dialect', () => {
  const profile = resolveProfile('electronics');
  const prompt = buildImagePrompt(
    {
      subject: 'electric kettle',
      colors: ['matte black'],
      materials: ['stainless steel'],
      heroFeatures: ['carry handle on top', 'water window'],
      shape: 'cylindrical',
      finish: 'matte',
    },
    profile,
    PROMPT_DIALECTS['gpt-image'],
  );
  assert.ok(prompt.includes('Intent:'));
  assert.ok(prompt.includes('electric kettle'));
  assert.ok(prompt.includes('Constraints:'));
});

test('builds paragraph prompt with positive constraints for dalle3', () => {
  const profile = resolveProfile('electronics');
  const prompt = buildImagePrompt(
    { subject: 'kettle', colors: [], materials: [], heroFeatures: [] },
    profile,
    PROMPT_DIALECTS.dalle3,
    { style: 'custom style' },
  );
  assert.ok(!prompt.includes('Intent:'));
  assert.ok(prompt.includes('custom style'));
  assert.ok(prompt.includes('unbranded'));
  const plain = buildImagePrompt(
    { subject: 'kettle', colors: [], materials: [], heroFeatures: [] },
    profile,
    PROMPT_DIALECTS.dalle3,
    { style: '' },
  );
  assert.ok(plain.includes('kettle'));
});

test('uses facts viewpoint and setting over recipe defaults', () => {
  const profile = resolveProfile('food_beverage');
  const prompt = buildImagePrompt(
    {
      subject: 'noodle bowl',
      colors: ['red'],
      materials: ['ceramic'],
      heroFeatures: ['steam'],
      viewpoint: 'overhead angle',
      setting: 'on a rustic wood table',
    },
    profile,
    PROMPT_DIALECTS.generic,
  );
  assert.ok(prompt.includes('overhead angle'));
  assert.ok(prompt.includes('rustic wood table'));
});

test('builds labeled prompt with empty slots and no style', () => {
  const profile = resolveProfile('general');
  const bare = { ...profile, recipe: { ...profile.recipe, modifiers: [], forbidden: [] } };
  const prompt = buildImagePrompt(
    { subject: 'thing', colors: [], materials: [], heroFeatures: [] },
    bare,
    PROMPT_DIALECTS['gpt-image'],
    { style: '' },
  );
  assert.ok(prompt.includes('Subject: thing.'));
  assert.ok(!prompt.includes('Appearance:'));
  assert.ok(!prompt.includes('Constraints:'));
});

test('handles sparse facts and empty recipes', () => {
  const profile = resolveProfile('general');
  const bare = { ...profile, recipe: { ...profile.recipe, modifiers: [], forbidden: [] } };
  const prompt = buildImagePrompt(
    { subject: 'thing', colors: [], materials: [], heroFeatures: [], proportions: 'tall' },
    bare,
    PROMPT_DIALECTS.generic,
  );
  assert.ok(prompt.includes('thing'));
  assert.ok(prompt.includes('tall'));
  assert.ok(!prompt.includes('Constraints:'));
  const styled = buildImagePrompt(
    { subject: 'thing', colors: [], materials: [], heroFeatures: [] },
    { ...bare, recipe: { ...bare.recipe, forbidden: ['glitter', 'text'] } },
    PROMPT_DIALECTS.generic,
  );
  assert.ok(styled.includes('without glitter'));
  assert.ok(styled.includes('unbranded'));
});

test('parses proportions and ignores non-list colors', () => {
  const facts = parseVisualFacts({
    subject: 'vase',
    colors: 'blue',
    materials: 'glass',
    heroFeatures: [],
    proportions: 'tall and narrow',
  });
  assert.deepEqual(facts?.colors, []);
  assert.equal(facts?.proportions, 'tall and narrow');
});

test('picks facts from nested groups', () => {
  const facts = pickVisualFacts({
    Details: { Color: 'red', Material: 'cotton' },
  });
  assert.deepEqual(facts.colors, ['red']);
  assert.deepEqual(facts.materials, ['cotton']);
});

test('picks facts from deeply nested groups', () => {
  const facts = pickVisualFacts({ Group: { Sub: { Color: 'blue' } } }, ['vase']);
  assert.deepEqual(facts.colors, ['blue']);
  assert.equal(facts.subject, 'vase');
});
