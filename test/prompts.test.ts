import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from '../src/category/registry.js';
import type { ResolvedProfile } from '../src/category/types.js';
import { buildSystemPrompt, taskLine } from '../src/prompts/spec.js';

function emptyHintsProfile(): ResolvedProfile {
  const base = resolveProfile('general');
  return { ...base, specHints: [], familySpecHints: [], familyVisualSlots: [] };
}

test('default prompts stay product-oriented without a profile', () => {
  const prompt = buildSystemPrompt('en', 'specs');
  assert.ok(prompt.includes('single product'));
  assert.ok(!prompt.includes('Category hints'));
});

test('profile prompts name the subject and add hints', () => {
  const profile = resolveProfile('apparel_footwear');
  const prompt = buildSystemPrompt('en', 'specs', profile);
  assert.ok(prompt.includes('apparel_footwear'));
  assert.ok(prompt.includes('fabric composition'));
  assert.ok(prompt.includes('product'));
});

test('specs-and-tags and tags-only modes adapt to profile', () => {
  const profile = resolveProfile('real_estate');
  const both = buildSystemPrompt('en', 'specs-and-tags', profile);
  assert.ok(both.includes('real_estate'));
  assert.ok(both.includes('"tags" is a reserved top-level key'));
  const tagsOnly = buildSystemPrompt('en', 'tags-only', profile);
  assert.ok(tagsOnly.includes('{"tags": ["tag1", "tag2"]}'));
  const legacyTags = buildSystemPrompt('en', 'tags-only');
  assert.ok(legacyTags.includes('categorize the product'));
});

test('language line is appended for non-english with and without profile', () => {
  assert.ok(buildSystemPrompt('de', 'specs').includes('German'));
  assert.ok(
    buildSystemPrompt('de', 'specs-and-tags', resolveProfile('electronics')).includes('German'),
  );
  assert.ok(buildSystemPrompt('de', 'tags-only').includes('German'));
});

test('profile without hints omits the hints block', () => {
  const prompt = buildSystemPrompt('en', 'specs', emptyHintsProfile());
  assert.ok(!prompt.includes('Category hints'));
  const tagsOnly = buildSystemPrompt('en', 'tags-only', emptyHintsProfile());
  assert.ok(!tagsOnly.includes('Category hints'));
  const both = buildSystemPrompt('en', 'specs-and-tags', emptyHintsProfile());
  assert.ok(!both.includes('Category hints'));
});

test('taskLine covers every mode with and without a profile', () => {
  const profile = resolveProfile('electronics');
  assert.ok(taskLine('specs').includes('quantifiable features'));
  assert.ok(taskLine('specs-and-tags').includes('(a) specifications'));
  assert.ok(taskLine('tags-only').includes('descriptive tags'));
  assert.ok(taskLine('specs', profile).includes('electronics'));
  assert.ok(taskLine('specs-and-tags', profile).includes('electronics'));
  assert.ok(taskLine('tags-only', profile).includes('electronics'));
});
