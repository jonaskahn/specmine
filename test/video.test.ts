import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultReader } from '../src/input/reader.js';
import {
  EMPTY_VIDEO_METADATA,
  fromInnertube,
  isVideoUrl,
  VIDEO_HOSTS,
  readVideoMetadata,
  videoIdOf,
  videoToText,
} from '../src/input/video.js';
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
    ...EMPTY_VIDEO_METADATA,
    title: 'Kettle review',
    author: 'Acme',
    description: 'A look at the 1.5L kettle',
    thumbnail: 'https://img.example.com/t.jpg',
  });
  assert.match(text, /# Kettle review/);
  assert.match(text, /Channel: Acme/);
  assert.match(text, /1\.5L kettle/);
  // A bare image url is not a specification, so it must not reach the prompt.
  assert.doesNotMatch(text, /img\.example\.com/);
});

test('video text labels every fact it carries', () => {
  const text = videoToText({
    ...EMPTY_VIDEO_METADATA,
    title: 'Kettle review',
    author: 'Acme',
    duration: 3725,
    viewCount: 1234,
    publishedAt: '2026-01-05',
    category: 'Science & Technology',
    keywords: ['kettle', 'review'],
  });
  assert.match(text, /Duration: 1:02:05/);
  assert.match(text, /Views: 1234/);
  assert.match(text, /Published: 2026-01-05/);
  assert.match(text, /Category: Science & Technology/);
  assert.match(text, /Keywords: kettle, review/);
});

test('a short video is labelled in minutes and seconds', () => {
  const text = videoToText({ ...EMPTY_VIDEO_METADATA, title: 'T', duration: 95 });
  assert.match(text, /Duration: 1:35/);
});

test('a live stream says so instead of a duration', () => {
  const text = videoToText({ ...EMPTY_VIDEO_METADATA, title: 'T', isLive: true, duration: 0 });
  assert.match(text, /Live stream/);
  assert.doesNotMatch(text, /Duration:/);
});

test('video metadata is empty when oEmbed omits fields', () => {
  const text = videoToText(EMPTY_VIDEO_METADATA);
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
    assert.doesNotMatch(result.text, /cdn\.example\.com/);
    assert.deepEqual(result.candidates?.[0]?.url, 'https://cdn.example.com/t.jpg');
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

test('reads a video id out of every youtube url spelling', () => {
  assert.equal(videoIdOf(new URL('https://youtu.be/D9p6GnDe4aI')), 'D9p6GnDe4aI');
  assert.equal(videoIdOf(new URL('https://www.youtube.com/watch?v=D9p6GnDe4aI')), 'D9p6GnDe4aI');
  assert.equal(videoIdOf(new URL('https://www.youtube.com/shorts/D9p6GnDe4aI')), 'D9p6GnDe4aI');
  assert.equal(videoIdOf(new URL('https://www.youtube.com/embed/D9p6GnDe4aI')), 'D9p6GnDe4aI');
  assert.equal(videoIdOf(new URL('https://www.youtube.com/live/D9p6GnDe4aI')), 'D9p6GnDe4aI');
});

test('a url without a usable video id is rejected', () => {
  assert.equal(videoIdOf(new URL('https://www.youtube.com/')), undefined);
  assert.equal(videoIdOf(new URL('https://www.youtube.com/watch?v=!!')), undefined);
  assert.equal(videoIdOf(new URL('https://vimeo.com/123')), undefined);
});

test('innertube info maps onto our metadata shape', () => {
  assert.deepEqual(
    fromInnertube({
      basic_info: {
        title: 'Kettle review',
        short_description: 'A look at the 1.5L kettle',
        author: 'Acme',
        duration: 3725,
        view_count: 1234,
        publish_date: '2026-01-05',
        keywords: ['kettle'],
        category: 'Science & Technology',
        is_live: false,
        thumbnail: [
          { url: 'https://i.ytimg.com/small.jpg', width: 120 },
          { url: 'https://i.ytimg.com/max.jpg', width: 1280 },
        ],
      },
    }),
    {
      ...EMPTY_VIDEO_METADATA,
      title: 'Kettle review',
      description: 'A look at the 1.5L kettle',
      author: 'Acme',
      duration: 3725,
      viewCount: 1234,
      publishedAt: '2026-01-05',
      keywords: ['kettle'],
      category: 'Science & Technology',
      thumbnail: 'https://i.ytimg.com/max.jpg',
    },
  );
});

test('sparse innertube info falls back to empty rather than undefined', () => {
  assert.deepEqual(fromInnertube({ basic_info: {} }), EMPTY_VIDEO_METADATA);
  assert.equal(fromInnertube(undefined), undefined);
  assert.equal(fromInnertube({}), undefined);
});

test('a live video is flagged and non-http thumbnails are ignored', () => {
  const info = fromInnertube({
    basic_info: { is_live: true, thumbnail: [{ url: 'data:image/png;base64,x', width: 999 }] },
  });
  assert.equal(info?.isLive, true);
  assert.equal(info?.thumbnail, '');
});

test('youtube metadata is preferred over oEmbed when youtubei.js answers', async () => {
  const restore = await stubFetch(() => {
    throw new Error('oEmbed must not be called');
  });
  try {
    const metadata = await readVideoMetadata(
      new URL('https://www.youtube.com/watch?v=D9p6GnDe4aI'),
      { lang: 'de', cookie: 'x' },
      async (session) => {
        assert.deepEqual(session, { lang: 'de', cookie: 'x' });
        return {
          getInfo: async (id: string) => {
            assert.equal(id, 'D9p6GnDe4aI');
            return { basic_info: { title: 'From Innertube', duration: 60 } };
          },
        };
      },
    );
    assert.equal(metadata.title, 'From Innertube');
    assert.equal(metadata.duration, 60);
  } finally {
    restore();
  }
});

test('an empty innertube answer falls back to oEmbed', async () => {
  const restore = await stubFetch((url) => {
    assert.match(url, /youtube\.com\/oembed/);
    return Response.json({ title: 'From oEmbed', thumbnail_url: 'https://img.example.com/t.jpg' });
  });
  try {
    const metadata = await readVideoMetadata(
      new URL('https://www.youtube.com/watch?v=D9p6GnDe4aI'),
      undefined,
      async () => ({ getInfo: async () => undefined }),
    );
    assert.equal(metadata.title, 'From oEmbed');
    assert.equal(metadata.thumbnail, 'https://img.example.com/t.jpg');
  } finally {
    restore();
  }
});

test('thumbnails without a stated width still rank by size', () => {
  const info = fromInnertube({
    basic_info: {
      thumbnail: [
        { url: 'https://i.ytimg.com/b.jpg', width: 480 },
        { url: 'https://i.ytimg.com/a.jpg' },
      ],
    },
  });
  assert.equal(info?.thumbnail, 'https://i.ytimg.com/b.jpg');
});

test('a missing youtubei.js falls back to oEmbed', async () => {
  const restore = await stubFetch((url) => {
    assert.match(url, /youtube\.com\/oembed/);
    return Response.json({ title: 'From oEmbed' });
  });
  try {
    const metadata = await readVideoMetadata(
      new URL('https://www.youtube.com/watch?v=D9p6GnDe4aI'),
      undefined,
      async () => undefined,
    );
    assert.equal(metadata.title, 'From oEmbed');
  } finally {
    restore();
  }
});

test('a widthless thumbnail is ranked below a sized one either way round', () => {
  for (const thumbnails of [
    [{ url: 'https://i.ytimg.com/a.jpg' }, { url: 'https://i.ytimg.com/b.jpg', width: 480 }],
    [{ url: 'https://i.ytimg.com/b.jpg', width: 480 }, { url: 'https://i.ytimg.com/a.jpg' }],
  ]) {
    assert.equal(
      fromInnertube({ basic_info: { thumbnail: thumbnails } })?.thumbnail,
      'https://i.ytimg.com/b.jpg',
    );
  }
});
