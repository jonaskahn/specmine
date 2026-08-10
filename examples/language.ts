import 'dotenv/config';
import { extract } from '../src/index.js';

const spec = await extract(
  'Der AXIS A9801 Security Relay wiegt 100 g, misst 48 x 45 x 30 mm und läuft mit 12 V DC.',
  { lang: 'de' },
);
console.log(JSON.stringify(spec, null, 2));
