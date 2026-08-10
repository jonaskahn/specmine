import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultReader } from '../src/input/reader.js';
import { htmlToMarkdown } from '../src/input/html.js';

test('htmlToMarkdown passes plain text through unchanged', () => {
  assert.equal(htmlToMarkdown('The Acme Kettle holds 1.5 L.'), 'The Acme Kettle holds 1.5 L.');
});

test('htmlToMarkdown leaves comparison operators alone', () => {
  const text = 'Input min. 11 V, max. 13 V, so 11 < 13 holds.';
  assert.equal(htmlToMarkdown(text), text);
});

test('htmlToMarkdown ignores unknown tags', () => {
  const text = 'Wraps in <foo>angle</foo> brackets.';
  assert.equal(htmlToMarkdown(text), text);
});

test('htmlToMarkdown converts a full html document', () => {
  const html =
    '<!doctype html><html><head><title>T</title></head><body><h1>Kettle</h1><p>1.5 L</p></body></html>';
  const markdown = htmlToMarkdown(html);
  assert.match(markdown, /# Kettle/);
  assert.match(markdown, /1\.5 L/);
  assert.doesNotMatch(markdown, /<h1>/);
});

test('htmlToMarkdown converts a fragment with lists and links', () => {
  const html =
    '<div><h2>Specs</h2><ul><li>Weight: 900 g</li><li>Power: <a href="https://example.com">2200 W</a></li></ul></div>';
  const markdown = htmlToMarkdown(html);
  assert.match(markdown, /## Specs/);
  assert.match(markdown, /Weight: 900 g/);
  assert.match(markdown, /\[2200 W\]\(https:\/\/example\.com\)/);
  assert.doesNotMatch(markdown, /<div>/);
});

test('htmlToMarkdown converts tables', () => {
  const html =
    '<table><tr><th>Attribute</th><th>Value</th></tr><tr><td>Weight</td><td>900 g</td></tr></table>';
  const markdown = htmlToMarkdown(html);
  assert.match(markdown, /\| Weight \|/);
  assert.doesNotMatch(markdown, /<table>/);
});

test('reader converts html string input to markdown', async () => {
  const reader = new DefaultReader();
  const result = await reader.read('<div><h1>Kettle</h1><p>1.5 L</p></div>');
  assert.equal(result.imageOnly, false);
  assert.match(result.text, /# Kettle/);
});

test('reader leaves plain string input untouched', async () => {
  const reader = new DefaultReader();
  const result = await reader.read('The Acme Kettle holds 1.5 L.');
  assert.equal(result.text, 'The Acme Kettle holds 1.5 L.');
});

test('reader converts html blob to markdown', async () => {
  const reader = new DefaultReader();
  const result = await reader.read(new Blob(['<p>Weight: 900 g</p>'], { type: 'text/html' }));
  assert.match(result.text, /Weight: 900 g/);
  assert.doesNotMatch(result.text, /<p>/);
});

test('reader converts html from a url', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<html><body><h1>Kettle</h1><p>1.5 L</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;
  try {
    const reader = new DefaultReader();
    const result = await reader.read(new URL('https://example.com/kettle.html'));
    assert.match(result.text, /# Kettle/);
    assert.doesNotMatch(result.text, /<html>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
