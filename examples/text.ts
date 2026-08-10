import 'dotenv/config';
import { extract } from '../src/index.js';

const spec = await extract('The Acme Kettle holds 1.5 L, weighs 900 g, 2200 W.');
console.log(JSON.stringify(spec, null, 2));
