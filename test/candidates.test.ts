import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractImageCandidates,
  extractPageMeta,
  pickReusableImage,
} from '../src/media/candidates.js';
import { thumbnailCandidate } from '../src/input/video.js';

const BASE = 'https://example.com/products/kettle';

test('og:image outranks every other source', () => {
  const candidates = extractImageCandidates(
    `<html><head>
       <meta property="og:image" content="https://cdn.example.com/hero.jpg">
       <meta property="twitter:image" content="https://cdn.example.com/tw.jpg">
     </head><body><img src="/gallery.jpg" alt="kettle"></body></html>`,
    BASE,
  );
  assert.deepEqual(
    candidates.map((c) => c.source),
    ['og:image', 'twitter:image', 'gallery'],
  );
  assert.equal(candidates[0]?.url, 'https://cdn.example.com/hero.jpg');
});

test('meta attributes in either order are read', () => {
  const candidates = extractImageCandidates(
    `<meta content="https://cdn.example.com/a.jpg" property="og:image">`,
  );
  assert.equal(candidates[0]?.url, 'https://cdn.example.com/a.jpg');
});

test('twitter:image:src counts as a twitter source', () => {
  const candidates = extractImageCandidates(
    `<meta name="twitter:image:src" content="/a.jpg">`,
    BASE,
  );
  assert.equal(candidates[0]?.source, 'twitter:image');
  assert.equal(candidates[0]?.url, 'https://example.com/a.jpg');
});

test('relative sources resolve against the page url', () => {
  const candidates = extractImageCandidates(`<img src="pics/one.jpg" alt="one">`, BASE);
  assert.equal(candidates[0]?.url, 'https://example.com/products/pics/one.jpg');
});

test('a relative source with no base url is dropped', () => {
  assert.deepEqual(extractImageCandidates(`<img src="pics/one.jpg" alt="one">`), []);
});

test('sprites, spacers and undersized images are rejected', () => {
  const candidates = extractImageCandidates(
    `<img src="/logo.svg"><img src="https://cdn.example.com/spacer.gif">
     <img src="https://cdn.example.com/tiny.jpg?w=64"><img src="https://cdn.example.com/ok.jpg?w=800">`,
    BASE,
  );
  assert.deepEqual(
    candidates.map((c) => c.url),
    ['https://cdn.example.com/ok.jpg?w=800'],
  );
});

test('data urls are never candidates', () => {
  assert.deepEqual(extractImageCandidates(`<img src="data:image/png;base64,AAA">`, BASE), []);
});

test('duplicates across meta and img collapse to one candidate', () => {
  const candidates = extractImageCandidates(
    `<meta property="og:image" content="https://cdn.example.com/a.jpg"><img src="https://cdn.example.com/a.jpg">`,
  );
  assert.equal(candidates.length, 1);
});

test('an image with alt text but no source falls back to the alt', () => {
  const candidates = extractImageCandidates('<img alt="A kettle on a table">', BASE);
  assert.equal(candidates[0]?.source, 'alt');
  assert.equal(candidates[0]?.url, 'alt:A kettle on a table');
  assert.equal(candidates[0]?.alt, 'A kettle on a table');
});

test('markup with no images yields nothing', () => {
  assert.deepEqual(extractImageCandidates('<html><body><p>No pictures here</p></body></html>'), []);
  assert.deepEqual(extractImageCandidates('<meta name="description" content="x">'), []);
});

test('reuse picks the highest scoring usable candidate', () => {
  const best = pickReusableImage([
    { url: 'a', source: 'gallery', alt: '', score: 0.6 },
    { url: 'b', source: 'og:image', alt: '', score: 1 },
  ]);
  assert.equal(best?.url, 'b');
});

test('reuse declines when nothing scores high enough', () => {
  assert.equal(pickReusableImage([]), undefined);
  assert.equal(pickReusableImage([{ url: 'a', source: 'alt', alt: '', score: 0.2 }]), undefined);
});

test('an unresolvable source url is skipped', () => {
  assert.deepEqual(extractImageCandidates('<img src="/a.jpg">', 'not a url'), []);
});

test('a video thumbnail is reusable at thumbnail priority', () => {
  const candidates = thumbnailCandidate('https://img.youtube.com/vi/abc/hq.jpg');
  assert.deepEqual(candidates, [
    {
      url: 'https://img.youtube.com/vi/abc/hq.jpg',
      source: 'thumbnail',
      alt: '',
      score: 0.8,
      position: 0,
    },
  ]);
  assert.equal(pickReusableImage(candidates)?.url, 'https://img.youtube.com/vi/abc/hq.jpg');
});

test('a video with no thumbnail has no candidate', () => {
  assert.deepEqual(thumbnailCandidate(''), []);
});

test('every image on the page is returned, not just the best one', () => {
  const html = `
    <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    <img src="/a.jpg" alt="Front">
    <img src="/b.jpg" alt="Back">
    <img src="/c.jpg">
  `;
  assert.deepEqual(
    extractImageCandidates(html, 'https://example.com/p').map((c) => c.source),
    ['og:image', 'gallery', 'gallery', 'gallery'],
  );
});

test('og:image detail is read from its own meta tags', () => {
  const html = `
    <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    <meta property="og:image:width" content="1600">
    <meta property="og:image:height" content="900">
    <meta property="og:image:type" content="image/webp">
    <meta property="og:image:alt" content="The kettle">
  `;
  assert.deepEqual(extractImageCandidates(html)[0], {
    url: 'https://cdn.example.com/hero.jpg',
    source: 'og:image',
    alt: '',
    score: 1,
    position: 0,
    width: 1600,
    height: 900,
    type: 'image/webp',
    title: 'The kettle',
  });
});

test('an img tag contributes its own attributes', () => {
  const html = `<img src="/a.png" alt="Front" width="800" height="600" title="Front view">`;
  assert.deepEqual(extractImageCandidates(html, 'https://example.com/')[0], {
    url: 'https://example.com/a.png',
    source: 'gallery',
    alt: 'Front',
    score: 0.6,
    position: 0,
    width: 800,
    height: 600,
    type: 'image/png',
    title: 'Front view',
  });
});

test('an unquoted attribute and a url size hint still yield numbers', () => {
  const html = `<img src=/a.jpg width=640 alt=Front>`;
  assert.equal(extractImageCandidates(html, 'https://example.com/')[0]?.width, 640);
  const hinted = extractImageCandidates(
    `<img src="https://cdn.example.com/a.jpg?w=1024&h=768" alt="Front">`,
  );
  assert.equal(hinted[0]?.width, 1024);
  assert.equal(hinted[0]?.height, 768);
});

test('a detail-less image carries no empty keys', () => {
  assert.deepEqual(extractImageCandidates('<img src="/a">', 'https://example.com/')[0], {
    url: 'https://example.com/a',
    source: 'gallery',
    alt: '',
    score: 0.6,
    position: 0,
  });
});

test('position records document order, not score order', () => {
  const html = `<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">`;
  const list = extractImageCandidates(html, 'https://example.com/');
  assert.deepEqual(
    [...list].sort((a, b) => a.position - b.position).map((c) => c.url),
    ['https://example.com/a.jpg', 'https://example.com/b.jpg', 'https://example.com/c.jpg'],
  );
});

test('a page og:image outranks a video thumbnail in the same list', () => {
  const list = [
    ...thumbnailCandidate('https://img.example.com/thumb.jpg'),
    { url: 'https://cdn.example.com/hero.jpg', source: 'og:image' as const, alt: '', score: 1 },
  ];
  assert.equal(pickReusableImage(list)?.source, 'og:image');
});

/* --- the page's own title and description --- */

test('open graph states the title and description ahead of the tag', () => {
  assert.deepEqual(
    extractPageMeta(`<html><head>
      <meta property="og:title" content="Acme Kettle 1.5L">
      <meta property="og:description" content="A matte black kettle.">
      <title>Acme Kettle 1.5L | Acme</title></head></html>`),
    { title: 'Acme Kettle 1.5L', description: 'A matte black kettle.' },
  );
});

test('a page with no meta falls back to its title, and never invents a description', () => {
  assert.deepEqual(extractPageMeta('<html><head><title>Just A Title</title></head></html>'), {
    title: 'Just A Title',
  });
});

test('twitter cards and the standard meta tag are read when open graph is absent', () => {
  assert.deepEqual(
    extractPageMeta(`<head>
      <meta name="twitter:title" content="From Twitter">
      <meta name="twitter:description" content="Twitter blurb."></head>`),
    { title: 'From Twitter', description: 'Twitter blurb.' },
  );
  assert.deepEqual(extractPageMeta('<head><meta name="description" content="Standard."></head>'), {
    description: 'Standard.',
  });
});

test('entities and whitespace in a title are decoded', () => {
  assert.equal(
    extractPageMeta('<head><title>  Acme   &amp;  Sons &lt;Pro&gt; &#8212; Kettle  </title></head>')
      .title,
    'Acme & Sons <Pro> — Kettle',
  );
  assert.equal(
    extractPageMeta('<head><title>Caf&#xe9; &quot;Bean&quot; &#x2014; 2kg</title></head>').title,
    'Café "Bean" — 2kg',
  );
});

test('an unknown entity is left alone rather than dropped', () => {
  assert.equal(
    extractPageMeta('<head><title>A &notarealentity; B</title></head>').title,
    'A &notarealentity; B',
  );
});

test('a title or description that decodes to nothing counts as absent', () => {
  assert.deepEqual(extractPageMeta('<head><title>   </title></head>'), {});
  assert.deepEqual(
    extractPageMeta('<head><meta property="og:description" content=" "></head>'),
    {},
  );
});

/* --- one picture per main link --- */

test('the same asset referenced several ways is listed once', () => {
  const C = 'https://cdn.example.com';
  // One picture, four references: a CDN resize, a #anchor, and a www host.
  const candidates = extractImageCandidates(
    `<meta property="og:image" content="${C}/hero.jpg">
     <img src="${C}/hero.jpg?w=1600">
     <img src="${C}/hero.jpg#top">
     <img src="https://www.cdn.example.com/hero.jpg">`,
  );
  assert.equal(candidates.length, 1);
  // The first rule to reach it wins, so the og:image url is the one kept.
  assert.equal(candidates[0]?.url, `${C}/hero.jpg`);
  assert.equal(candidates[0]?.source, 'og:image');
});

test('a protocol-relative reference is the same picture as the absolute one', () => {
  const candidates = extractImageCandidates(
    `<img src="//cdn.example.com/hero.jpg"><img src="${BASE}/hero.jpg">`,
  );
  assert.equal(candidates.length, 1);
});

test('genuinely different pictures are all kept', () => {
  const candidates = extractImageCandidates(
    `<img src="${BASE}/A.jpg">
     <img src="${BASE}/a.jpg">
     <img src="${BASE}/x/a.jpg">
     <img src="https://other.example.com/a.jpg">`,
  );
  // Case can be significant in a path, and none of these share a main link.
  assert.equal(candidates.length, 4);
});

test('an alt-text fallback is keyed apart from any real url', () => {
  // With no usable src anywhere, the alt text stands in as the candidate. Its
  // "url" is not a url at all, so identity falls back to the raw string.
  const candidates = extractImageCandidates('<p><img alt="A kettle on a wooden table"></p>');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.source, 'alt');
  assert.equal(candidates[0]?.url, 'alt:A kettle on a wooden table');
});
