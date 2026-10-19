import 'dotenv/config';
import { analyze, isVideoUrl } from '../src/index.js';

// A video page carries no readable prose, so the reader never scrapes HTML for
// it: YouTube is read through youtubei.js (falling back to oEmbed), Vimeo
// through oEmbed. Either way the metadata becomes labelled text.
// Video links are detected before any fetch, so pass the URL straight in.
const url = new URL('https://rog.asus.com/phones/rog-phone-9/');
console.log('video url?', isVideoUrl(url));

const result = await analyze(url, {
  outputs: ['spec', 'image'],
  // A video's own thumbnail is reused, so sequential avoids a wasted draw.
  mode: 'sequential',
  // Anything Innertube.create accepts, e.g. { lang: 'de', location: 'DE' }.
  videoSession: { lang: 'en', location: 'US' },
  // How long captions may take before the read settles for metadata alone.
  videoTranscriptMs: 15_000,
});
// console.log truncates at depth 2 and would print the candidates as [Object].
console.log(JSON.stringify(result, null, 2));
