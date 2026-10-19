import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from '../src/category/registry.js';
import type { ResolvedProfile } from '../src/category/types.js';
import { buildSystemPrompt, taskLine } from '../src/prompts/spec.js';
import { currentDateLine } from '../src/time.js';

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

test('every system prompt carries the current date', () => {
  assert.match(currentDateLine(), /^Current date: \d{4}-\d{2}-\d{2} \(UTC\)\.$/);
  const today = new Date().toISOString().slice(0, 10);
  for (const mode of ['specs', 'specs-and-tags', 'tags-only'] as const) {
    assert.ok(buildSystemPrompt('en', mode).includes(today));
    assert.ok(buildSystemPrompt('de', mode, resolveProfile('electronics')).includes(today));
  }
});

test('profile always carries a category block with ignore list', () => {
  const prompt = buildSystemPrompt('en', 'specs', emptyHintsProfile());
  assert.ok(prompt.includes('Category: this content is general'));
  assert.ok(!prompt.includes('Ignore (never extract as specs)'));
  const apparel = buildSystemPrompt('en', 'specs', resolveProfile('apparel_footwear'));
  assert.ok(apparel.includes('Category: this content is apparel_footwear'));
  assert.ok(apparel.includes('Ignore (never extract as specs): size chart tables'));
  const both = buildSystemPrompt('en', 'specs-and-tags', emptyHintsProfile());
  assert.ok(both.includes('Category: this content is general'));
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

test('a video source is asked for its own facts, not for a product', () => {
  const prompt = buildSystemPrompt('en', 'specs', undefined, true);
  assert.match(prompt, /video's metadata and description, not a product page/);
  assert.match(prompt, /duration, views, publish date and category/);
  // The product-isolation instruction would produce an empty object here.
  assert.doesNotMatch(prompt, /Isolate the single/);
  assert.doesNotMatch(prompt, /unusual snake_case/);
});

test('the video prompt keeps key discipline and the output shape', () => {
  const prompt = buildSystemPrompt('en', 'specs', undefined, true);
  assert.match(prompt, /Key discipline/);
  assert.match(prompt, /Output shape/);
  assert.match(prompt, /Grounding/);
});

test('a video tags-only run skips the spec instructions', () => {
  const prompt = buildSystemPrompt('en', 'tags-only', undefined, true);
  assert.match(prompt, /video's metadata and description/);
  assert.doesNotMatch(prompt, /Output shape/);
});

test('a non-video profile run is unchanged by the video flag', () => {
  const profile = resolveProfile('electronics');
  assert.equal(
    buildSystemPrompt('en', 'specs', profile, false),
    buildSystemPrompt('en', 'specs', profile),
  );
});
