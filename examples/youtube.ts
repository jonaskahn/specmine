import 'dotenv/config';
import { analyze, isVideoUrl } from '../src/index.js';

// A video page carries no readable prose, so the reader never scrapes HTML for
// it: it asks oEmbed for title/description/author and renders them as text.
// YouTube/Vimeo links are detected before any fetch, so pass the URL straight in.
const url = new URL('https://www.youtube.com/watch?v=D9p6GnDe4aI');
console.log('video url?', isVideoUrl(url));

const result = await analyze(url, {
  outputs: ['spec', 'image'],
  mode: 'sequential',
});

console.log(result.category);

// The one picture a video page truly has is its own thumbnail, so the picture
// decision normally lands on 'reused' and no image is generated. 'generated'
// here would mean YouTube returned no thumbnail at all.
console.log(result.picture);
console.log(JSON.stringify(result.spec, null, 2));

console.log(result.cost?.calls);
