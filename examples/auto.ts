import 'dotenv/config';
import { analyze } from '../src/index.js';

// Auto mode (the default): Jev classifies when TYPESAFE_API_KEY is set,
// otherwise the general profile is used with zero classifier calls.
const result = await analyze('Acme kettle, matte black stainless steel, 1.5 L.', {
  outputs: ['spec'],
});
console.log(result.category);
// with key:    { kind: 'item_detail', domain: 'electronics', ..., source: 'jev' }
// without key: { kind: 'item_detail', domain: 'general', ..., source: 'fallback', reason: 'no_key' }
console.log(JSON.stringify(result.spec, null, 2));
