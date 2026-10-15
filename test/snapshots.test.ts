import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDomains, resolveProfile } from '../src/category/registry.js';
import { buildVisualPrompts } from '../src/image/visual-extractor.js';
import { buildImagePrompt } from '../src/image/prompt-builder.js';
import { PROMPT_DIALECTS } from '../src/image/dialects.js';
import { buildSystemPrompt } from '../src/prompts/spec.js';

const DEMO_FACTS = {
  subject: 'demo item',
  colors: ['red'],
  materials: ['steel'],
  heroFeatures: ['handle'],
};

test('every domain snapshot: spec, visual and render prompts', () => {
  for (const domain of listDomains()) {
    if (domain === 'general') continue;
    const profile = resolveProfile(domain);
    const spec = buildSystemPrompt('en', 'specs', profile);
    assert.ok(
      spec.includes(`Category: this content is ${domain}`),
      `${domain}: spec prompt names the category`,
    );
    assert.ok(spec.includes(profile.subjectNoun), `${domain}: spec prompt names the subject`);
    const visual = buildVisualPrompts(profile);
    assert.ok(visual.system.includes(domain), `${domain}: visual prompt names the domain`);
    for (const slot of profile.visualSlots) {
      assert.ok(visual.slots.includes(slot), `${domain}: visual slots include ${slot}`);
    }
    const render = buildImagePrompt(DEMO_FACTS, profile, PROMPT_DIALECTS.generic);
    assert.ok(render.includes('demo item'), `${domain}: render prompt carries the subject`);
    if (profile.recipe.id !== 'none') {
      assert.ok(render.length > 50, `${domain}: render prompt is substantive`);
    }
  }
});
