import 'dotenv/config';
import { extract } from '../src/index.js';

const spec = await extract(
  new URL('https://www.axis.com/dam/public/83/2c/70/datasheet-axis-a9801-de-DE-286970.pdf'),
);
console.log(JSON.stringify(spec, null, 2));

const spec1 = await extract(
  new URL('https://www.axis.com/dam/public/83/2c/70/datasheet-axis-a9801-de-DE-286970.pdf'),
);
console.log(JSON.stringify(spec1, null, 2));

const spec2 = await extract(
  new URL('https://www.axis.com/dam/public/83/2c/70/datasheet-axis-a9801-de-DE-286970.pdf'),
);
console.log(JSON.stringify(spec2, null, 2));
