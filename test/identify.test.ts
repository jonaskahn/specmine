import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdentifyQuestions,
  GENERIC_IDENTIFY,
  identifyContent,
  IDENTIFY_WINDOW_CHARS,
  messageOf,
} from '../src/classify/identify.js';

function stubFetch(handler: () => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => handler()) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('the four questions are asked in one request', () => {
  const questions = buildIdentifyQuestions();
  assert.deepEqual(Object.keys(questions).sort(), ['domain', 'has_photo', 'kind', 'language']);
});

test('reads language, domain, kind and has_photo from the answers', async () => {
  const restore = stubFetch(() =>
    Response.json({
      answers: {
        language: { answer: 'de' },
        domain: { answer: 'electronics' },
        kind: { answer: 'item_detail' },
        has_photo: { answer: true },
      },
    }),
  );
  try {
    const answer = await identifyContent('Ein kettle', { apiKey: 'k' });
    assert.deepEqual(answer, {
      language: 'de',
      domain: 'electronics',
      kind: 'item_detail',
      hasPhoto: true,
      category: 'general',
    });
  } finally {
    restore();
  }
});

test('an unknown domain or kind degrades to the generic answer', async () => {
  const restore = stubFetch(() =>
    Response.json({
      answers: { domain: { answer: 'spaceships' }, kind: { answer: 'haiku' } },
    }),
  );
  try {
    const answer = await identifyContent('text', { apiKey: 'k' });
    assert.equal(answer.domain, 'general');
    assert.equal(answer.kind, GENERIC_IDENTIFY.kind);
  } finally {
    restore();
  }
});

test('a response with no answers at all is the generic answer', async () => {
  const restore = stubFetch(() => Response.json({}));
  try {
    assert.deepEqual(await identifyContent('text', { apiKey: 'k' }), GENERIC_IDENTIFY);
  } finally {
    restore();
  }
});

test('a failed call is the generic answer, never a retry of the classifier', async () => {
  const restore = stubFetch(() => {
    throw new Error('network down');
  });
  try {
    assert.deepEqual(await identifyContent('text', { apiKey: 'k' }), GENERIC_IDENTIFY);
  } finally {
    restore();
  }
});

test('no key means no request at all', async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  const restore = stubFetch(() => {
    throw new Error('should not be called');
  });
  try {
    assert.deepEqual(await identifyContent('text'), GENERIC_IDENTIFY);
  } finally {
    restore();
    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
  }
});

test('only the opening window is sent as state', async () => {
  const original = globalThis.fetch;
  let body = '';
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    body = String(init?.body ?? '');
    return Response.json({ answers: {} });
  }) as typeof fetch;
  try {
    await identifyContent('x'.repeat(IDENTIFY_WINDOW_CHARS * 2), { apiKey: 'k' });
    assert.equal((JSON.parse(body) as { state: string }).state.length, IDENTIFY_WINDOW_CHARS);
  } finally {
    globalThis.fetch = original;
  }
});

test('the window size is reported through the usage callback', async () => {
  const seen: number[] = [];
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    await identifyContent('short', undefined, (chars) => seen.push(chars));
  } finally {
    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
  }
  assert.deepEqual(seen, [5]);
});

test('a non-string language and non-boolean photo answer fall back', async () => {
  const restore = stubFetch(() =>
    Response.json({
      answers: {
        language: { answer: 42 },
        has_photo: { answer: 'yes' },
        category: { answer: 'kettle' },
      },
    }),
  );
  try {
    const answer = await identifyContent('text', { apiKey: 'k' });
    assert.equal(answer.language, GENERIC_IDENTIFY.language);
    assert.equal(answer.hasPhoto, GENERIC_IDENTIFY.hasPhoto);
    assert.equal(answer.category, 'kettle');
  } finally {
    restore();
  }
});

test('a non-Error rejection is still a generic answer', async () => {
  const restore = stubFetch(() => {
    throw 'offline';
  });
  try {
    assert.deepEqual(await identifyContent('text', { apiKey: 'k' }), GENERIC_IDENTIFY);
  } finally {
    restore();
  }
});

test('an Error rejection is logged with its message', async () => {
  const restore = stubFetch(() => {
    throw new Error('jev exploded');
  });
  try {
    assert.deepEqual(await identifyContent('text', { apiKey: 'k' }), GENERIC_IDENTIFY);
  } finally {
    restore();
  }
});

test('messageOf stringifies a non-Error value', () => {
  assert.equal(messageOf(new Error('boom')), 'boom');
  assert.equal(messageOf('offline'), 'offline');
});
