import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  familyOf,
  getDomainProfile,
  listDomains,
  registerCategory,
  resetCategoryOverrides,
  resolveProfile,
  tuneProfile,
} from '../src/category/registry.js';
import type { DomainId } from '../src/category/types.js';

test.afterEach(() => {
  resetCategoryOverrides();
});

test('lists all domains including general', () => {
  const domains = listDomains();
  assert.equal(domains.length, 25);
  assert.ok(domains.includes('electronics'));
  assert.ok(domains.includes('general'));
});

test('resolves profile with family inheritance', () => {
  const profile = resolveProfile('apparel_footwear');
  assert.equal(profile.family, 'goods');
  assert.ok(profile.familySpecHints.includes('brand'));
  assert.ok(profile.specHints.includes('fabric composition'));
  assert.equal(profile.recipe.id, 'apparel_flat');
  assert.equal(profile.defaultSize, '1024x1536');
});

test('falls back to general for unknown domain', () => {
  const profile = getDomainProfile('nope' as never);
  assert.equal(profile.domain, 'general');
  assert.equal(familyOf('nope' as never), 'concept');
});

test('registers and resets category overrides', () => {
  registerCategory('electronics', { defaultStyle: 'custom style' });
  assert.equal(getDomainProfile('electronics').defaultStyle, 'custom style');
  resetCategoryOverrides();
  assert.notEqual(getDomainProfile('electronics').defaultStyle, 'custom style');
});

test('override keeps domain and family unless patched', () => {
  registerCategory('electronics', { family: 'digital' });
  const profile = getDomainProfile('electronics');
  assert.equal(profile.domain, 'electronics');
  assert.equal(profile.family, 'digital');
});

test('registers a brand-new domain inheriting the general base', () => {
  registerCategory('wine' as DomainId, {
    family: 'goods',
    subjectNoun: 'bottle',
    specHints: ['vintage'],
    archetype: 'food_shot',
    defaultStyle: 'elegant bottle photo',
    defaultSize: '1024x1024',
    allowImage: true,
  });
  assert.ok(listDomains().includes('wine' as DomainId));
  const profile = resolveProfile('wine' as DomainId);
  assert.equal(profile.domain, 'wine');
  assert.equal(profile.family, 'goods');
  assert.equal(profile.subjectNoun, 'bottle');
  assert.equal(profile.recipe.id, 'food_shot');
  resetCategoryOverrides();
  assert.ok(!listDomains().includes('wine' as DomainId));
});

test('regulated and abstract domains have expected archetypes', () => {
  assert.equal(resolveProfile('health_supplements').recipe.id, 'packshot');
  assert.equal(resolveProfile('organization_person').allowImage, true);
  assert.equal(resolveProfile('organization_person').recipe.id, 'place_scene');
  assert.equal(resolveProfile('job_listing').recipe.id, 'place_scene');
  assert.equal(resolveProfile('news_analysis').recipe.id, 'editorial_concept');
});

test('domains carry visual fields with family fallback', () => {
  const estate = resolveProfile('real_estate');
  assert.deepEqual(estate.visualSlots, ['subject', 'setting']);
  assert.ok(estate.notDepictable.includes('price'));
  assert.ok(estate.specIgnore.includes('agent contact blocks'));
  assert.equal(estate.minFacts, 3);
  assert.ok(estate.keyMap.subject.includes('property'));
  assert.ok(estate.keyMap.subject.includes('brand'));
  const app = resolveProfile('software_app');
  assert.deepEqual(app.visualSlots, ['subject', 'colors', 'setting', 'mood']);
  const general = resolveProfile('general');
  assert.equal(general.recipe.id, 'generic_subject');
  assert.equal(general.minFacts, 2);
});

test('an identify key tunes ignore rules without stripping the profile', () => {
  const base = resolveProfile('software_app');
  const tuned = tuneProfile(base, 'software_app');
  assert.ok(tuned.specIgnore.includes('changelog entries'));
  assert.ok(base.specIgnore.length > 0, 'the built-in rules survive');
  assert.ok(tuned.familySpecHints.length > 0, 'family hints are untouched');
});

test('an unknown or generic identify key leaves the profile untouched', () => {
  const base = resolveProfile('electronics');
  assert.equal(tuneProfile(base, 'general'), base);
  assert.equal(tuneProfile(base, 'spaceships'), base);
});

test('tuning never duplicates a rule the profile already had', () => {
  const tuned = tuneProfile(resolveProfile('electronics'), 'electronics');
  assert.equal(new Set(tuned.specIgnore).size, tuned.specIgnore.length);
});
