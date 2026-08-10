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
  assert.match(result.errors.join(';'), /not a JSON object/);
  assert.equal(result.spec, undefined);
});
