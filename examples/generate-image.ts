import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { generateImage } from '../src/index.js';

// Image only — renders a packshot from the content, no spec call.
// The prompt is built internally; the result is the image itself.
const image = await generateImage(
  'Acme stand mixer, matte cream finish, stainless steel bowl, tilt-head design.',
  { image: { size: '1024x1024' } },
);
console.log(image.mimeType, image.blob.size);
console.log(image.dataUrl.slice(0, 60) + '...');

await writeFile('./mixer.png', Buffer.from(image.base64, 'base64'));
console.log('saved ./mixer.png');
