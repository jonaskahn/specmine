import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  familyOf,
  getDomainProfile,
  listDomains,
  registerCategory,
  resetCategoryOverrides,
  resolveProfile,
} from '../src/category/registry.js';

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

test('regulated and abstract domains have expected archetypes', () => {
  assert.equal(resolveProfile('health_supplements').recipe.id, 'packshot');
  assert.equal(resolveProfile('organization_person').allowImage, false);
  assert.equal(resolveProfile('job_listing').recipe.id, 'none');
  assert.equal(resolveProfile('news_analysis').recipe.id, 'editorial_concept');
});
