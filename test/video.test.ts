import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultReader } from '../src/input/reader.js';
import { isVideoUrl, videoToText, VIDEO_HOSTS } from '../src/input/video.js';
import { ExtractionError } from '../src/errors.js';

test('recognises video hosts only over http(s)', () => {
  assert.equal(isVideoUrl(new URL('https://www.youtube.com/watch?v=abc')), true);
  assert.equal(isVideoUrl(new URL('https://youtu.be/abc')), true);
  assert.equal(isVideoUrl(new URL('https://vimeo.com/123')), true);
  assert.equal(isVideoUrl(new URL('https://example.com/watch?v=abc')), false);
  assert.equal(isVideoUrl(new URL('file:///videos/abc.mp4')), false);
  assert.ok(VIDEO_HOSTS.includes('youtu.be'));
});

test('video text carries title, author and description', () => {
  const text = videoToText({
    title: 'Kettle review',
    author: 'Acme',
    description: 'A look at the 1.5L kettle',
    thumbnail: 'https://img.example.com/t.jpg',
  });
  assert.match(text, /# Kettle review/);
  assert.match(text, /By Acme/);
  assert.match(text, /1\.5L kettle/);
  assert.match(text, /https:\/\/img\.example.com\/t\.jpg/);
});

test('video metadata is empty when oEmbed omits fields', () => {
  const text = videoToText({ title: '', author: '', description: '', thumbnail: '' });
  assert.equal(text.trim(), '#');
});

async function stubFetch(handler: (url: string) => Response): Promise<() => void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('reads a youtube url as video metadata', async () => {
  const restore = await stubFetch((url) => {
    assert.match(url, /youtube\.com\/oembed\?url=/);
    return Response.json({
      title: 'Kettle review',
      author_name: 'Acme',
      description: 'A look at the 1.5L kettle',
      thumbnail_url: 'https://img.example.com/t.jpg',
    });
  });
  try {
    const result = await new DefaultReader().read(new URL('https://www.youtube.com/watch?v=abc'));
    assert.equal(result.kind, 'video');
    assert.match(result.text, /Kettle review/);
  } finally {
    restore();
  }
});

test('a failing oEmbed endpoint surfaces as an extraction error', async () => {
  const restore = await stubFetch(() => new Response('nope', { status: 502 }));
  try {
    await assert.rejects(
      () => new DefaultReader().read(new URL('https://vimeo.com/123')),
      (error: unknown) => error instanceof ExtractionError && /502/.test((error as Error).message),
    );
  } finally {
    restore();
  }
});

test('oEmbed fields fall back to empty strings when absent', async () => {
  const restore = await stubFetch(() => Response.json({ title: 'Only a title' }));
  try {
    const result = await new DefaultReader().read(new URL('https://youtu.be/abc'));
    assert.match(result.text, /Only a title/);
    assert.doesNotMatch(result.text, /Thumbnail/);
  } finally {
    restore();
  }
});

test('a thumbnail under our own field name is still read', async () => {
  const restore = await stubFetch(() =>
    Response.json({ title: 'T', thumbnail: 'https://cdn.example.com/t.jpg' }),
  );
  try {
    const result = await new DefaultReader().read(new URL('https://vimeo.com/123'));
    assert.match(result.text, /https:\/\/cdn\.example\.com\/t\.jpg/);
  } finally {
    restore();
  }
});

test('an oEmbed body with no title at all still reads', async () => {
  const restore = await stubFetch(() => Response.json({}));
  try {
    const result = await new DefaultReader().read(new URL('https://vimeo.com/123'));
    assert.equal(result.text.trim(), '#');
  } finally {
    restore();
  }
});

test('a video url is labelled video and carries its thumbnail', async () => {
  const restore = await stubFetch(() =>
    Response.json({ title: 'T', thumbnail_url: 'https://img.example.com/t.jpg' }),
  );
  try {
    const result = await new DefaultReader().read(new URL('https://www.youtube.com/watch?v=abc'));
    assert.equal(result.kind, 'video');
    assert.deepEqual(result.candidates, [
      {
        url: 'https://img.example.com/t.jpg',
        source: 'thumbnail',
        alt: '',
        score: 0.8,
        position: 0,
      },
    ]);
  } finally {
    restore();
  }
});

test('a video with no thumbnail carries no candidate', async () => {
  const restore = await stubFetch(() => Response.json({ title: 'T' }));
  try {
    const result = await new DefaultReader().read(new URL('https://youtu.be/abc'));
    assert.deepEqual(result.candidates, []);
  } finally {
    restore();
  }
});
