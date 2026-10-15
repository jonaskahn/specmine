import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { analyze } from '../src/index.js';

// Auto mode (the default): Jev classifies when TYPESAFE_API_KEY is set,
// otherwise the general profile is used with zero classifier calls.
const specOnly = await analyze('Acme kettle, matte black stainless steel, 1.5 L.', {
  outputs: ['spec'],
});
console.log(specOnly.category);
// with key:    { kind: 'item_detail', domain: 'electronics', ..., source: 'jev' }
// without key: { kind: 'item_detail', domain: 'general', ..., source: 'fallback', reason: 'no_key' }
console.log(JSON.stringify(specOnly.spec, null, 2));

// Auto + parallel: spec and image from the same content in one call
const parallel = await analyze('Acme kettle, matte black stainless steel, 1.5 L.', {
  outputs: ['spec', 'image'],
  mode: 'parallel',
});
console.log(parallel.category);
console.log(JSON.stringify(parallel.spec, null, 2));
console.log(parallel.image?.mimeType, parallel.image?.base64.length, 'base64 chars');

// Auto + sequential: extract the spec first, then render the image from it.
// Cheaper than parallel (no separate visual pass) when the spec is detailed.
const sequential = await analyze('Acme kettle, matte black stainless steel, 1.5 L.', {
  outputs: ['spec', 'image'],
  mode: 'sequential',
});
console.log(sequential.category);
console.log(JSON.stringify(sequential.spec, null, 2));

await writeFile('./auto-kettle.png', Buffer.from(sequential.image?.base64 ?? '', 'base64'));
console.log('saved ./auto-kettle.png');
