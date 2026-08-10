import 'dotenv/config';
import { extract } from '../src/index.js';

const spec = await extract(
  new URL(
    'https://www.axis.com/dam/public/54/dc/6c/datasheet-axis-ta8201-recessed-mount-de-DE-307987.pdf',
  ),
  { flattened: true, lang: 'en' },
);

console.log(JSON.stringify(spec, null, 2));

const spec1 = await extract(
  new URL(
    'https://www.axis.com/dam/public/c6/2b/2e/datasheet-axis-ta1201-wall-mount-enclosure-de-DE-479483.pdf',
  ),
  { flattened: true, lang: 'en' },
);

console.log(JSON.stringify(spec1, null, 2));

const spec2 = await extract(
  new URL('https://www.axis.com/dam/public/6f/4e/48/datasheet-2n-ip-phone-d7a-en-US-435618.pdf'),
  { flattened: true, lang: 'en' },
);

console.log(JSON.stringify(spec2, null, 2));

const spec3 = await extract(
  new URL(
    'https://www.axis.com/dam/public/08/ff/f3/datasheet-axis-a8207-ve-mkii-network-video-door-station-de-DE-525769.pdf',
  ),
  { flattened: true, lang: 'en' },
);

console.log(JSON.stringify(spec3, null, 2));
