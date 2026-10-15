import 'dotenv/config';
import { analyze, registerCategory } from '../src/index.js';
import type { DomainId } from '../src/index.js';

// Auto: Jev decision model picks kind + domain (needs TYPESAFE_API_KEY,
// otherwise an LLM classifier is used, otherwise generic)
const auto = await analyze('Acme espresso machine, 15 bar, 1.8 L tank.', {
  outputs: ['spec'],
});
console.log(auto.category);

// Skip classification with an explicit domain
const fixed = await analyze('Acme espresso machine, 15 bar, 1.8 L tank.', {
  outputs: ['spec'],
  category: 'home_appliance',
});
console.log(fixed.category);

// Non-depictable content returns the spec with an image error, not a throw
const policy = await analyze('Privacy policy update effective January.', {
  outputs: ['spec', 'image'],
  category: 'general',
  kind: 'policy_legal',
});
console.log(policy.errors?.image?.message);

// Custom domains inherit their family profile
registerCategory('wine' as DomainId, {
  family: 'goods',
  subjectNoun: 'bottle',
  criteria: 'Wine and wine product pages',
  specHints: ['vintage', 'region', 'grape variety', 'alcohol content'],
  archetype: 'food_shot',
  defaultStyle: 'elegant bottle photo',
  defaultSize: '1024x1024',
  allowImage: true,
});
const custom = await analyze('Château Example 2019, Bordeaux, 75 cl.', {
  outputs: ['spec'],
  category: 'wine',
});
console.log(JSON.stringify(custom.spec, null, 2));
