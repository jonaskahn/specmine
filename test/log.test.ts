import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, logger, resolveDriver, resolveLevel, resetLogger } from '../src/log.js';

const ENV_VARS = [
  'SPECMINE_LOG_LEVEL',
  'LOG_LEVEL',
  'SPECMINE_LOG_DRIVER',
  'LOG_DRIVER',
  'SPECMINE_LOG_PINO_MODULE',
  'SPECMINE_LOG_WINSTON_MODULE',
];

interface MockCall {
  level?: string;
  args: unknown[];
}

const setMockCalls = (): Array<MockCall> => {
  const calls: Array<MockCall> = [];
  (globalThis as unknown as { __SPECMINE_MOCK_CALLS__: Array<MockCall> }).__SPECMINE_MOCK_CALLS__ =
    calls;
  return calls;
};

test.beforeEach(() => {
  for (const name of ENV_VARS) delete process.env[name];
  resetLogger();
});

test.afterEach(() => {
  for (const name of ENV_VARS) delete process.env[name];
  resetLogger();
  delete (globalThis as { __SPECMINE_MOCK_CALLS__?: unknown }).__SPECMINE_MOCK_CALLS__;
});

test('resolveLevel defaults to warn', () => {
  assert.equal(resolveLevel(), 'warn');
});

test('resolveLevel accepts SPECMINE_LOG_LEVEL', () => {
  assert.equal(resolveLevel({ SPECMINE_LOG_LEVEL: 'debug' }), 'debug');
});

test('resolveLevel falls back to global LOG_LEVEL', () => {
  assert.equal(resolveLevel({ LOG_LEVEL: 'info' }), 'info');
});

test('resolveLevel prefers SPECMINE_LOG_LEVEL over LOG_LEVEL', () => {
  assert.equal(resolveLevel({ SPECMINE_LOG_LEVEL: 'trace', LOG_LEVEL: 'error' }), 'trace');
});

test('resolveLevel falls back to warn on invalid values', () => {
  assert.equal(resolveLevel({ SPECMINE_LOG_LEVEL: 'bogus' }), 'warn');
  assert.equal(resolveLevel({ LOG_LEVEL: 'bogus' }), 'warn');
});

test('resolveDriver defaults to auto', () => {
  assert.equal(resolveDriver(), 'auto');
});

test('resolveDriver accepts SPECMINE_LOG_DRIVER and is case-insensitive', () => {
  assert.equal(resolveDriver({ SPECMINE_LOG_DRIVER: 'PINO' }), 'pino');
  assert.equal(resolveDriver({ SPECMINE_LOG_DRIVER: 'winston' }), 'winston');
});

test('resolveDriver falls back to global LOG_DRIVER', () => {
  assert.equal(resolveDriver({ LOG_DRIVER: 'winston' }), 'winston');
});

test('resolveDriver prefers SPECMINE_LOG_DRIVER over LOG_DRIVER', () => {
  assert.equal(resolveDriver({ SPECMINE_LOG_DRIVER: 'pino', LOG_DRIVER: 'winston' }), 'pino');
});

test('resolveDriver falls back to auto on invalid values', () => {
  assert.equal(resolveDriver({ SPECMINE_LOG_DRIVER: 'bogus' }), 'auto');
});

test('createLogger with real pino at silent level', () => {
  const log = createLogger('pino', 'silent');
  assert.equal(log.level, 'silent');
  assert.doesNotThrow(() => log.info('should not print', { a: 1 }));
});

test('createLogger with real winston at silent level', () => {
  const log = createLogger('winston', 'silent');
  assert.equal(log.level, 'silent');
  assert.doesNotThrow(() => log.info('should not print', { a: 1 }));
});

test('createLogger auto detects pino when installed', () => {
  const log = createLogger('auto', 'warn');
  assert.equal(log.level, 'warn');
});

test('createLogger auto falls back to winston when pino module is missing', () => {
  process.env.SPECMINE_LOG_PINO_MODULE = 'node:no-such-module-specmine-pino';
  const log = createLogger('auto', 'warn');
  assert.equal(log.level, 'warn');
});

test('createLogger auto returns noop when no driver is loadable', () => {
  process.env.SPECMINE_LOG_PINO_MODULE = 'node:no-such-module-specmine-pino';
  process.env.SPECMINE_LOG_WINSTON_MODULE = 'node:no-such-module-specmine-winston';
  const log = createLogger('auto', 'warn');
  assert.equal(log.level, 'silent');
  assert.doesNotThrow(() => log.fatal('should not throw', { a: 1 }));
});

test('createLogger pino returns noop when module is missing', () => {
  process.env.SPECMINE_LOG_PINO_MODULE = 'node:no-such-module-specmine-pino';
  const log = createLogger('pino', 'info');
  assert.equal(log.level, 'silent');
});

test('createLogger winston returns noop when module is missing', () => {
  process.env.SPECMINE_LOG_WINSTON_MODULE = 'node:no-such-module-specmine-winston';
  const log = createLogger('winston', 'info');
  assert.equal(log.level, 'silent');
});

test('pino adapter routes msg and obj to the factory', () => {
  const calls = setMockCalls();
  const modulePath = writeMockModule(`
    module.exports = (options) => ({
      level: options.level,
      trace: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'trace', args }),
      debug: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'debug', args }),
      info: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'info', args }),
      warn: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'warn', args }),
      error: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'error', args }),
      fatal: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'fatal', args }),
    });
  `);
  process.env.SPECMINE_LOG_PINO_MODULE = modulePath;
  const log = createLogger('pino', 'info');
  log.trace('trace plain');
  log.trace('trace obj', { a: 1 });
  log.debug('debug plain');
  log.debug('debug obj', { a: 1 });
  log.info('info plain');
  log.info('info obj', { a: 1 });
  log.warn('warn plain');
  log.warn('warn obj', { a: 1 });
  log.error('error plain');
  log.error('error obj', { a: 1 });
  log.fatal('fatal plain');
  log.fatal('fatal obj', { a: 1 });
  const expected = [
    ['trace', 'trace plain'],
    ['trace', { a: 1 }, 'trace obj'],
    ['debug', 'debug plain'],
    ['debug', { a: 1 }, 'debug obj'],
    ['info', 'info plain'],
    ['info', { a: 1 }, 'info obj'],
    ['warn', 'warn plain'],
    ['warn', { a: 1 }, 'warn obj'],
    ['error', 'error plain'],
    ['error', { a: 1 }, 'error obj'],
    ['fatal', 'fatal plain'],
    ['fatal', { a: 1 }, 'fatal obj'],
  ];
  assert.equal(calls.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(calls[i]?.level, expected[i]?.[0]);
    assert.deepEqual(calls[i]?.args, expected[i]?.slice(1));
  }
});

test('pino adapter supports ESM default interop', () => {
  const calls = setMockCalls();
  const modulePath = writeMockModule(`
    module.exports = {
      default: (options) => ({
        level: options.level,
        trace: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ args }),
        debug: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ args }),
        info: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ args }),
        warn: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ args }),
        error: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ args }),
        fatal: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ args }),
      }),
    };
  `);
  process.env.SPECMINE_LOG_PINO_MODULE = modulePath;
  const log = createLogger('pino', 'warn');
  assert.equal(log.level, 'warn');
  log.warn('with object', { a: 1 });
  assert.deepEqual(calls[0]?.args, [{ a: 1 }, 'with object']);
});

test('winston adapter maps levels and routes msg and obj', () => {
  const calls = setMockCalls();
  const modulePath = writeMockModule(`
    module.exports = {
      createLogger: (options) => ({
        level: options.level,
        silent: options.silent,
        debug: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'debug', args }),
        info: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'info', args }),
        warn: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'warn', args }),
        error: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'error', args }),
        silly: (...args) => globalThis.__SPECMINE_MOCK_CALLS__.push({ level: 'silly', args }),
      }),
      format: { json: () => ({}) },
      transports: { Console: class {} },
    };
  `);
  process.env.SPECMINE_LOG_WINSTON_MODULE = modulePath;
  const log = createLogger('winston', 'info');
  log.trace('trace plain');
  log.trace('trace obj', { a: 1 });
  log.debug('debug plain');
  log.debug('debug obj', { a: 1 });
  log.info('info plain');
  log.info('info obj', { a: 1 });
  log.warn('warn plain');
  log.warn('warn obj', { a: 1 });
  log.error('error plain');
  log.error('error obj', { a: 1 });
  log.fatal('fatal plain');
  log.fatal('fatal obj', { a: 1 });
  const expected = [
    ['silly', 'trace plain'],
    ['silly', 'trace obj', { a: 1 }],
    ['debug', 'debug plain'],
    ['debug', 'debug obj', { a: 1 }],
    ['info', 'info plain'],
    ['info', 'info obj', { a: 1 }],
    ['warn', 'warn plain'],
    ['warn', 'warn obj', { a: 1 }],
    ['error', 'error plain'],
    ['error', 'error obj', { a: 1 }],
    ['error', 'fatal plain'],
    ['error', 'fatal obj', { a: 1 }],
  ];
  assert.equal(calls.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(calls[i]?.level, expected[i]?.[0]);
    assert.deepEqual(calls[i]?.args, expected[i]?.slice(1));
  }
});

test('winston adapter maps trace and fatal levels', () => {
  const calls = setMockCalls();
  const modulePath = writeMockModule(`
    module.exports = {
      createLogger: (options) => ({ level: options.level, silent: options.silent }),
      format: { json: () => ({}) },
      transports: { Console: class {} },
    };
  `);
  process.env.SPECMINE_LOG_WINSTON_MODULE = modulePath;
  assert.equal(createLogger('winston', 'trace').level, 'trace');
  assert.equal(createLogger('winston', 'fatal').level, 'fatal');
  assert.equal(calls.length, 0);
});

test('logger memoizes and resetLogger creates a new instance', () => {
  process.env.SPECMINE_LOG_LEVEL = 'debug';
  const first = logger();
  assert.equal(logger(), first);
  resetLogger();
  assert.notEqual(logger(), first);
  assert.equal(logger().level, 'debug');
});

function writeMockModule(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'specmine-log-'));
  const path = join(dir, 'mock.cjs');
  writeFileSync(path, source);
  return path;
}
