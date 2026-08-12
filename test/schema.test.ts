import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECS_SCHEMA,
  TAGGED_SPECS_SCHEMA,
  TAGS_ONLY_SCHEMA,
  envelopeToResult,
  envelopeToSpecs,
} from '../src/spec/schema.js';

test('envelopeToSpecs returns undefined for non-record input', () => {
  assert.equal(envelopeToSpecs([]), undefined);
  assert.equal(envelopeToSpecs('specs'), undefined);
});

test('envelopeToResult returns undefined for non-record input', () => {
  assert.equal(envelopeToResult([{ key: 'Weight', value: '1.5 kg', children: [] }]), undefined);
});

test('envelopeToResult returns specs and tags from an envelope', () => {
  const result = envelopeToResult({
    specs: [{ key: 'Weight', value: '1.5 kg', children: [] }],
    tags: ['kettle'],
  });
  assert.deepEqual(result, { spec: { Weight: '1.5 kg' }, tags: ['kettle'] });
});

test('envelopeToResult treats missing tags as an empty list', () => {
  const result = envelopeToResult({ specs: [] });
  assert.deepEqual(result, { spec: {}, tags: [] });
});

test('envelopeToResult rejects non-string tags', () => {
  assert.equal(envelopeToResult({ specs: [], tags: [1] }), undefined);
});

test('envelopeToResult accepts a tags-only envelope', () => {
  const result = envelopeToResult({ tags: ['kettle', 'stainless-steel'] });
  assert.deepEqual(result, { spec: {}, tags: ['kettle', 'stainless-steel'] });
});

test('envelopeToResult accepts an empty tags-only envelope', () => {
  const result = envelopeToResult({ tags: [] });
  assert.deepEqual(result, { spec: {}, tags: [] });
});

test('envelopeToResult rejects a tags-only envelope with non-array tags', () => {
  assert.equal(envelopeToResult({ tags: 'kettle' }), undefined);
});

test('envelopeToResult rejects a tags-only envelope with non-string tags', () => {
  assert.equal(envelopeToResult({ tags: ['ok', 42] }), undefined);
});

test('envelopeToResult returns undefined when neither specs nor tags are present', () => {
  assert.equal(envelopeToResult({}), undefined);
  assert.equal(envelopeToResult({ specs: 'nope' }), undefined);
});

test('SPECS_SCHEMA, TAGGED_SPECS_SCHEMA and TAGS_ONLY_SCHEMA expose the expected shapes', () => {
  assert.equal(SPECS_SCHEMA.type, 'object');
  assert.deepEqual(SPECS_SCHEMA.required, ['specs']);
  assert.equal(SPECS_SCHEMA.additionalProperties, false);
  assert.deepEqual(TAGGED_SPECS_SCHEMA.required, ['specs', 'tags']);
  assert.deepEqual(TAGGED_SPECS_SCHEMA.properties.tags, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.equal(TAGS_ONLY_SCHEMA.type, 'object');
  assert.deepEqual(TAGS_ONLY_SCHEMA.required, ['tags']);
  assert.equal(TAGS_ONLY_SCHEMA.additionalProperties, false);
  assert.deepEqual(TAGS_ONLY_SCHEMA.properties, {
    tags: { type: 'array', items: { type: 'string' } },
  });
});
