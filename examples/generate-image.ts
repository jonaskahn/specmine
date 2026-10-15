import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { generateImage } from '../src/index.js';

// Image only — renders a packshot from the content, no spec call
const image = await generateImage(
  'Acme stand mixer, matte cream finish, stainless steel bowl, tilt-head design.',
  { image: { size: '1024x1024' } },
);
console.log(image.prompt);
console.log(image.mimeType, image.blob.size);

await writeFile('./mixer.png', Buffer.from(await image.blob.arrayBuffer()));
console.log('saved ./mixer.png');
