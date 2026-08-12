import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DefaultReader, REMOTE_TEMP_PREFIX } from '../src/input/reader.js';
import { ExtractionError } from '../src/errors.js';
import { KNOWN_USER_AGENTS } from '../src/input/user-agent.js';
import type { PdfInspector } from '../src/input/pdf.js';

async function remoteTempFiles(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith(REMOTE_TEMP_PREFIX));
}

// Other test files (e.g. html.test.ts) also exercise readUrl() concurrently against the same
// shared tmpdir(), so a file with this prefix can transiently belong to a sibling test rather
// than a leak from this one. Assert only on files new since `before` that are still present,
// with a short settle window to ride out that unrelated overlap.
async function assertNoLeakedRemoteTempFile(before: string[]): Promise<void> {
  const beforeSet = new Set(before);
  const deadline = Date.now() + 500;
  for (;;) {
    const leaked = (await remoteTempFiles()).filter((name) => !beforeSet.has(name));
    if (leaked.length === 0 || Date.now() >= deadline) {
      assert.deepEqual(leaked, []);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const textInspector: PdfInspector = {
  classify: () => ({ pdfType: 'TextBased', confidence: 1, pagesNeedingOcr: [] }),
  process: () => ({ pdfType: 'TextBased', markdown: '# Specs\n\nWeight: 1.5 kg' }),
};

const imageInspector: PdfInspector = {
  classify: () => ({ pdfType: 'ImageBased', confidence: 0.9, pagesNeedingOcr: [1] }),
  process: () => ({ pdfType: 'ImageBased', markdown: null }),
};

function pdfBlob(): Blob {
  return new Blob(['%PDF-1.4\nfake pdf body'], { type: 'application/pdf' });
}

test('string input passes through', async () => {
  const reader = new DefaultReader();
  const result = await reader.read('the quick brown fox');
  assert.equal(result.text, 'the quick brown fox');
  assert.equal(result.imageOnly, false);
});

test('text blob reads as text', async () => {
  const reader = new DefaultReader();
  const result = await reader.read(new Blob(['plain text content']));
  assert.equal(result.text, 'plain text content');
});

test('blob shorter than the pdf magic reads as text', async () => {
  const reader = new DefaultReader();
  const result = await reader.read(new Blob(['ab'], { type: '' }));
  assert.equal(result.text, 'ab');
  assert.equal(result.imageOnly, false);
});

test('pdf blob with text is extracted to markdown', async () => {
  const reader = new DefaultReader(textInspector);
  const result = await reader.read(pdfBlob());
  assert.equal(result.text, '# Specs\n\nWeight: 1.5 kg');
  assert.equal(result.imageOnly, false);
});

test('all-image pdf returns imageOnly', async () => {
  const reader = new DefaultReader(imageInspector);
  const result = await reader.read(pdfBlob());
  assert.equal(result.text, '');
  assert.equal(result.imageOnly, true);
});

test('pdf without inspector throws UNSUPPORTED_INPUT', async () => {
  const reader = new DefaultReader();
  await assert.rejects(
    () => reader.read(pdfBlob()),
    (error: unknown) => error instanceof ExtractionError && error.code === 'UNSUPPORTED_INPUT',
  );
});

test('file URL reads pdf from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'specmine-'));
  const file = join(dir, 'doc.pdf');
  await writeFile(file, '%PDF-1.4\nfake pdf body');
  const reader = new DefaultReader(textInspector);
  const result = await reader.read(pathToFileURL(file));
  assert.equal(result.imageOnly, false);
  assert.match(result.text, /Weight: 1.5 kg/);
});

test('unsupported URL scheme throws UNSUPPORTED_INPUT', async () => {
  const reader = new DefaultReader();
  await assert.rejects(
    () => reader.read(new URL('ftp://example.com/doc.pdf')),
    (error: unknown) => error instanceof ExtractionError && error.code === 'UNSUPPORTED_INPUT',
  );
});

test('http URL reads text content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('fetched text content', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })) as typeof fetch;
  try {
    const reader = new DefaultReader();
    const result = await reader.read(new URL('https://example.com/doc.txt'));
    assert.equal(result.text, 'fetched text content');
    assert.equal(result.imageOnly, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('http URL with non-ok status throws LLM_ERROR', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
  try {
    const reader = new DefaultReader();
    await assert.rejects(
      () => reader.read(new URL('https://example.com/missing.txt')),
      (error: unknown) => error instanceof ExtractionError && error.code === 'LLM_ERROR',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('http URL fetch sends a known desktop User-Agent header', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: HeadersInit | undefined;
  globalThis.fetch = (async (_url, init) => {
    capturedHeaders = init?.headers;
    return new Response('fetched text content', { status: 200 });
  }) as typeof fetch;
  try {
    const reader = new DefaultReader();
    await reader.read(new URL('https://example.com/doc.txt'));
    const userAgent = (capturedHeaders as Record<string, string> | undefined)?.['User-Agent'];
    assert.ok(userAgent && KNOWN_USER_AGENTS.includes(userAgent));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('http URL download leaves no temp file after a successful read', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('fetched text content', { status: 200 })) as typeof fetch;
  try {
    const before = await remoteTempFiles();
    const reader = new DefaultReader();
    await reader.read(new URL('https://example.com/doc.txt'));
    await assertNoLeakedRemoteTempFile(before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('http URL download removes temp file even when pdf processing throws', async () => {
  const throwingInspector: PdfInspector = {
    classify: () => ({ pdfType: 'TextBased', confidence: 1, pagesNeedingOcr: [] }),
    process: () => {
      throw new Error('boom');
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('%PDF-1.4\nfake pdf body', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })) as typeof fetch;
  try {
    const before = await remoteTempFiles();
    const reader = new DefaultReader(throwingInspector);
    await assert.rejects(() => reader.read(new URL('https://example.com/doc.pdf')));
    await assertNoLeakedRemoteTempFile(before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('http URL download without content-type still detects pdf by magic bytes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new TextEncoder().encode('%PDF-1.4\nfake pdf body'), {
      status: 200,
    })) as typeof fetch;
  try {
    const reader = new DefaultReader(textInspector);
    const result = await reader.read(new URL('https://example.com/doc.pdf'));
    assert.equal(result.text, '# Specs\n\nWeight: 1.5 kg');
    assert.equal(result.imageOnly, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('file URL reads plain text from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'specmine-'));
  const file = join(dir, 'notes.txt');
  await writeFile(file, 'plain notes');
  const reader = new DefaultReader();
  const result = await reader.read(pathToFileURL(file));
  assert.equal(result.text, 'plain notes');
  assert.equal(result.imageOnly, false);
});

test('detects pdf by magic bytes when content-type missing', async () => {
  const reader = new DefaultReader(imageInspector);
  const blob = new Blob(['%PDF-1.4\nfake'], { type: '' });
  const result = await reader.read(blob);
  assert.equal(result.imageOnly, true);
});
