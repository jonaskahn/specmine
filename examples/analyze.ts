import 'dotenv/config';
import { analyze } from '../src/index.js';

const result = await analyze('The Acme Kettle holds 1.5L, matte black stainless steel, £49.', {
  outputs: ['spec', 'image'],
  mode: 'parallel',
});
console.log(JSON.stringify(result.category, null, 2));
console.log(JSON.stringify(result.spec, null, 2));
console.log(result.image?.mimeType, result.image?.base64.length, 'base64 chars');

const specOnly = await analyze('Der Acme Wasserkocher fasst 1,5 Liter.', {
  outputs: ['spec'],
  category: 'home_appliance',
});
console.log(JSON.stringify(specOnly.spec, null, 2));
