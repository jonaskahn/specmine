import 'dotenv/config';
import { extract, extractTags } from '../src/index.js';

// Tags alongside the specs
const result = await extract('The Acme Kettle holds 1.5 L, weighs 900 g.', {
  tags: true,
});
console.log(JSON.stringify(result, null, 2));
// { "spec": { "Capacity": "1.5 L", "Weight": "900 g" }, "tags": ["kettle"] }

// Tags only
const tags = await extractTags('The Acme Kettle holds 1.5 L, weighs 900 g.');
console.log(tags); // ["kettle"]
