import 'dotenv/config';
import { analyze } from '../src/index.js';

// Sequential: extract the spec first, then render the image from it.
// Cheaper than parallel (no separate visual pass) when the spec is detailed.
const result = await analyze(
  'Acme trail backpack, 40 L, ripstop nylon, forest green, padded hip belt.',
  { outputs: ['spec', 'image'], mode: 'sequential', category: 'sports_outdoor_toys' },
);
console.log(JSON.stringify(result.spec, null, 2));
console.log(result.image?.dataUrl.slice(0, 60) + '...');
