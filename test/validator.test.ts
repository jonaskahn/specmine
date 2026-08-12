import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonSpecValidator } from '../src/spec/validator.js';

const validator = new JsonSpecValidator();

test('accepts flat string-valued spec', () => {
  const result = validator.validate('{"Weight": "1.5 kg", "RAM": "8 GB"}');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, { Weight: '1.5 kg', RAM: '8 GB' });
});

test('accepts nested spec', () => {
  const result = validator.validate(
    '{"Hardware": {"Power Supply": "12 V DC", "Environment": {"Humidity": "0-95%"}}}',
  );
  assert.deepEqual(result.errors, []);
});

test('accepts empty object', () => {
  const result = validator.validate('{}');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, {});
});

test('accepts structured-output envelope', () => {
  const result = validator.validate(
    '{"specs":[{"key":"Weight","value":"1.5 kg","children":[]},{"key":"Hardware","value":"","children":[{"key":"Power Supply","value":"12 V DC","children":[]}]}]}',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, {
    Weight: '1.5 kg',
    Hardware: { 'Power Supply': '12 V DC' },
  });
});

test('accepts empty structured-output envelope', () => {
  const result = validator.validate('{"specs":[]}');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, {});
});

test('rejects envelope with malformed item', () => {
  const result = validator.validate('{"specs":[{"key":"Weight","value":1.5,"children":[]}]}');
  assert.equal(result.spec, undefined);
});

test('strips markdown fences', () => {
  const result = validator.validate('```json\n{"Weight": "1.5 kg"}\n```');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, { Weight: '1.5 kg' });
});

test('rejects non-string leaf value', () => {
  const result = validator.validate('{"Weight": 1.5}');
  assert.match(result.errors.join(';'), /must be a string/);
  assert.equal(result.spec, undefined);
});

test('rejects arrays', () => {
  const result = validator.validate('{"Colors": ["black"]}');
  assert.equal(result.spec, undefined);
});

test('rejects non-JSON', () => {
  const result = validator.validate('not json');
  assert.match(result.errors.join(';'), /valid JSON/);
  assert.equal(result.spec, undefined);
});

test('rejects non-object JSON', () => {
  const result = validator.validate('"hello"');
  assert.match(result.errors.join('; '), /not a JSON object/);
  assert.equal(result.spec, undefined);
});

test('extracts tags from a structured-output envelope', () => {
  const result = validator.validate(
    '{"specs":[{"key":"Weight","value":"1.5 kg","children":[]}],"tags":["kettle","stainless-steel"]}',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, { Weight: '1.5 kg' });
  assert.deepEqual(result.tags, ['kettle', 'stainless-steel']);
});

test('returns empty tags when the envelope has none', () => {
  const result = validator.validate('{"specs":[]}');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.tags, []);
});

test('returns empty tags for a bare spec object', () => {
  const result = validator.validate('{"Weight": "1.5 kg"}');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.tags, []);
});

test('rejects envelope with non-string tag', () => {
  const result = validator.validate('{"specs":[],"tags":["ok",42]}');
  assert.equal(result.spec, undefined);
});

test('returns empty tags on invalid output', () => {
  const result = validator.validate('{"Weight": 1.5}');
  assert.equal(result.spec, undefined);
  assert.deepEqual(result.tags, []);
});

test('rejects a JSON array response', () => {
  const result = validator.validate('[1, 2]');
  assert.match(result.errors.join('; '), /not a JSON object/);
  assert.equal(result.spec, undefined);
});

test('falls back to a bare object when specs is not an array', () => {
  const result = validator.validate('{"specs": "nope"}');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.spec, { specs: 'nope' });
});

test('rejects envelope with non-array tags', () => {
  const result = validator.validate('{"specs":[],"tags":"kettle"}');
  assert.equal(result.spec, undefined);
});

test('rejects envelope with a non-object spec item', () => {
  const result = validator.validate('{"specs":["Weight"]}');
  assert.equal(result.spec, undefined);
  assert.match(result.errors.join('; '), /must be a string or nested object/);
});

test('rejects envelope with malformed children content', () => {
  const result = validator.validate(
    '{"specs":[{"key":"Hardware","value":"","children":[{"key":1}]}]}',
  );
  assert.equal(result.spec, undefined);
});

test('reports <root> as the path for a non-string leaf under an empty key', () => {
  const result = validator.validate('{"": 1.5}');
  assert.equal(result.spec, undefined);
  assert.match(result.errors.join('; '), /Value at '<root>'/);
});
