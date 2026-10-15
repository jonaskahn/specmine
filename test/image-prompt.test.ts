import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listDomains,
  registerCategory,
  resetCategoryOverrides,
  resolveProfile,
} from '../src/category/registry.js';
import { guessDialect, PROMPT_DIALECTS } from '../src/image/dialects.js';
import type { SpecsResult } from '../src/types.js';
import {
  countFilledSlots,
  hasEnoughFacts,
  parseVisualFacts,
  VISUAL_FACTS_SCHEMA,
} from '../src/image/facts.js';
import { pickVisualFacts } from '../src/image/fact-picker.js';

test.afterEach(() => {
  resetCategoryOverrides();
});
import {
  containsForbiddenNumbers,
  isMeasureOnly,
  sanitizeBrandName,
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
      'brand',
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
  const { keyMap } = resolveProfile('electronics');
  const facts = pickVisualFacts(
    {
      Farbe: 'mattschwarz',
      Material: 'Edelstahl, Glas',
      Form: 'rund',
      Oberfläche: 'matt',
      Marke: 'Acme',
    },
    ['kettle'],
    'product',
    keyMap,
  );
  assert.deepEqual(facts.colors, ['mattschwarz']);
  assert.deepEqual(facts.materials, ['Edelstahl', 'Glas']);
  assert.equal(facts.shape, 'rund');
  assert.equal(facts.finish, 'matt');
  // The manufacturer is kept as a design-language cue, not the subject.
  assert.equal(facts.subject, 'kettle');
  assert.equal(facts.brand, 'Acme');
});

test('picks brand across major languages, never as a feature', () => {
  const { keyMap } = resolveProfile('electronics');
  const cases: Array<[SpecsResult, string]> = [
    [{ 'ブランド': 'Acme' }, 'Acme'],
    [{ Details: { Merek: 'Acme' } }, 'Acme'],
    [{ Hersteller: 'Acme', Product: 'kettle' }, 'Acme'],
    [{ 'nhà sản xuất': 'Acme' }, 'Acme'],
    [{ 'الشركة المصنعة': 'Acme' }, 'Acme'],
    [{ '制造商': 'Acme' }, 'Acme'],
  ];
  for (const [spec, brand] of cases) {
    const facts = pickVisualFacts(spec, ['kettle'], 'product', keyMap);
    assert.equal(facts.brand, brand);
    assert.ok(!facts.heroFeatures.includes('Acme'));
  }
  const named = pickVisualFacts({ Hersteller: 'Acme', Product: 'kettle' }, [], 'product', keyMap);
  assert.equal(named.subject, 'kettle');
});

test('picks subject from tags when no name key exists', () => {
  const { keyMap } = resolveProfile('electronics');
  const facts = pickVisualFacts({ Weight: '1.5 kg' }, ['kettle'], 'product', keyMap);
  assert.equal(facts.subject, 'kettle');
  assert.deepEqual(facts.heroFeatures, []);
  const fallback = pickVisualFacts({}, [], 'product', keyMap);
  assert.equal(fallback.subject, 'product');
  assert.deepEqual(fallback.colors, []);
});

test('excludes prices, measurements and brand noise from hero features', () => {
  const { keyMap } = resolveProfile('electronics');
  const facts = pickVisualFacts(
    {
      Product: 'Acme kettle',
      Color: 'matte black',
      Price: '$49.99',
      Capacity: '1.5 L',
      Weight: '900 g',
      Model: 'K-2000',
      Feature: 'cordless pouring',
    },
    [],
    'product',
    keyMap,
  );
  assert.equal(facts.subject, 'Acme kettle');
  assert.deepEqual(facts.colors, ['matte black']);
  for (const feature of facts.heroFeatures) {
    assert.ok(!feature.includes('$'));
    assert.ok(!/\d/.test(feature) || /[a-zA-Z]{3,}/.test(feature));
  }
  assert.ok(facts.heroFeatures.includes('cordless pouring'));
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
  const { keyMap } = resolveProfile('apparel_footwear');
  const facts = pickVisualFacts(
    {
      Details: { Color: 'red', Material: 'cotton' },
    },
    [],
    'product',
    keyMap,
  );
  assert.deepEqual(facts.colors, ['red']);
  assert.deepEqual(facts.materials, ['cotton']);
});

test('picks facts from deeply nested groups', () => {
  const { keyMap } = resolveProfile('apparel_footwear');
  const facts = pickVisualFacts({ Group: { Sub: { Color: 'blue' } } }, ['vase'], 'product', keyMap);
  assert.deepEqual(facts.colors, ['blue']);
  assert.equal(facts.subject, 'vase');
});

test('custom keyMap additions merge with the family map', () => {
  registerCategory(
    'custom-test' as never,
    {
      family: 'goods',
      keyMapAdd: { color: ['paint'] },
    } as never,
  );
  const { keyMap } = resolveProfile('custom-test' as never);
  assert.ok(keyMap.color.includes('paint'));
  assert.ok(keyMap.color.includes('color'));
  assert.ok(keyMap.subject.includes('brand'));
  resetCategoryOverrides();
  assert.ok(!listDomains().includes('custom-test' as never));
});

test('works without a keyMap and drops overlong values', () => {
  const facts = pickVisualFacts({ Weight: '2 kg' }, ['kettle']);
  assert.equal(facts.subject, 'kettle');
  assert.deepEqual(facts.colors, []);
  const long = pickVisualFacts({ Note: 'x'.repeat(81) }, [], 'product', {});
  assert.deepEqual(long.heroFeatures, []);
});

test('sanitizes brand names to short design-language tokens', () => {
  assert.equal(sanitizeBrandName('Acme'), 'Acme');
  assert.equal(sanitizeBrandName('  "Acme"\n premium '), 'Acme');
  assert.equal(sanitizeBrandName(42), undefined);
  assert.equal(sanitizeBrandName('$49.99'), undefined);
  assert.equal(sanitizeBrandName('x'.repeat(41)), undefined);
  assert.equal(sanitizeBrandName('2000'), undefined);
  assert.equal(isMeasureOnly('1.5 kg'), true);
  assert.equal(isMeasureOnly('matte black'), false);
});

test('parses brand from visual facts and drops unusable values', () => {
  assert.equal(parseVisualFacts({ subject: 'kettle', brand: 'Acme' })?.brand, 'Acme');
  assert.equal(parseVisualFacts({ subject: 'kettle', brand: '' })?.brand, undefined);
  assert.equal(parseVisualFacts({ subject: 'kettle', brand: '$9' })?.brand, undefined);
  assert.equal(parseVisualFacts({ subject: 'kettle' })?.brand, undefined);
});

test('renders brand as a design cue, never as drawn text', () => {
  const profile = resolveProfile('electronics');
  const facts = {
    subject: 'electric kettle',
    colors: ['matte black'],
    materials: ['stainless steel'],
    heroFeatures: ['carry handle'],
    brand: 'Acme',
  };
  const labeled = buildImagePrompt(facts, profile, PROMPT_DIALECTS['gpt-image']);
  assert.ok(labeled.includes('Subject: Acme-style electric kettle.'));
  const paragraph = buildImagePrompt(facts, profile, PROMPT_DIALECTS.generic);
  assert.ok(paragraph.includes('Acme-style electric kettle'));
  for (const prompt of [labeled, paragraph]) {
    assert.ok(!prompt.includes('Acme"'));
    assert.ok(!/Acme(?!-style)/.test(prompt.replace('Acme-style', '')));
  }
});

test('keeps guardrails when the prompt overflows its word budget', () => {
  const profile = resolveProfile('electronics');
  const tight = { ...PROMPT_DIALECTS.generic, maxWords: 60 };
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
    tight,
  );
  assert.ok(prompt.split(/\s+/).length <= 60);
  assert.ok(prompt.includes('electric kettle'));
  assert.ok(prompt.includes('unbranded'));
  assert.ok(
    !prompt.includes('Real photograph') ||
      prompt.indexOf('unbranded') < prompt.indexOf('Real photograph'),
  );
});

test('maps brand-text exclusions to a blank-label guardrail', () => {
  const profile = resolveProfile('food_beverage');
  const prompt = buildImagePrompt(
    { subject: 'coffee bag', colors: [], materials: [], heroFeatures: [] },
    profile,
    PROMPT_DIALECTS.generic,
  );
  assert.ok(prompt.includes('blank unmarked label'));
});

test('dialect word budgets stay in the concise band', () => {
  for (const dialect of Object.values(PROMPT_DIALECTS)) {
    assert.ok(dialect.maxWords <= 140, `${dialect.id} over budget`);
  }
});
