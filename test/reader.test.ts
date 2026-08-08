import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DefaultReader } from '../src/input/reader.js';
import { ExtractionError } from '../src/errors.js';
import type { PdfInspector } from '../src/input/pdf.js';

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
