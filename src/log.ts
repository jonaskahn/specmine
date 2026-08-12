import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const DEFAULT_LOG_LEVEL = 'warn';
export const DEFAULT_LOG_DRIVER = 'auto';

const LEVELS = ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LEVELS)[number];

export type LogDriver = 'pino' | 'winston' | 'auto';

export interface LogMethods {
  trace(msg: string, obj?: unknown): void;
  debug(msg: string, obj?: unknown): void;
  info(msg: string, obj?: unknown): void;
  warn(msg: string, obj?: unknown): void;
  error(msg: string, obj?: unknown): void;
  fatal(msg: string, obj?: unknown): void;
  readonly level: string;
}

export function resolveLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env.SPECMINE_LOG_LEVEL ?? env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL;
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : DEFAULT_LOG_LEVEL;
}

export function resolveDriver(env: NodeJS.ProcessEnv = process.env): LogDriver {
  const raw = (env.SPECMINE_LOG_DRIVER ?? env.LOG_DRIVER ?? DEFAULT_LOG_DRIVER).toLowerCase();
  if (raw === 'pino' || raw === 'winston' || raw === 'auto') return raw;
  return 'auto';
}

function loadModule(specifier: string): unknown {
  try {
    return require(specifier);
  } catch {
    return null;
  }
}

function moduleSpecifier(envName: string, fallback: string): string {
  return process.env[envName] ?? fallback;
}

interface PinoLike {
  trace(msg: unknown, obj?: unknown): void;
  debug(msg: unknown, obj?: unknown): void;
  info(msg: unknown, obj?: unknown): void;
  warn(msg: unknown, obj?: unknown): void;
  error(msg: unknown, obj?: unknown): void;
  fatal(msg: unknown, obj?: unknown): void;
}

interface WinstonLike {
  silent: boolean;
  debug(msg: string, obj?: unknown): void;
  info(msg: string, obj?: unknown): void;
  warn(msg: string, obj?: unknown): void;
  error(msg: string, obj?: unknown): void;
  silly(msg: string, obj?: unknown): void;
}

type PinoFactory = (options: { level: string }) => PinoLike;

type WinstonModule = {
  createLogger(options: {
    level: string;
    silent: boolean;
    format: unknown;
    transports: unknown[];
  }): WinstonLike;
  format: { json(): unknown };
  transports: { Console: new () => unknown };
};

function noopMethod(): void {}

const noop: LogMethods = {
  trace: noopMethod,
  debug: noopMethod,
  info: noopMethod,
  warn: noopMethod,
  error: noopMethod,
  fatal: noopMethod,
  level: 'silent',
};

function pinoAdapter(moduleValue: unknown, level: LogLevel): LogMethods {
  const factory = (
    moduleValue && typeof moduleValue === 'object' && 'default' in moduleValue
      ? (moduleValue as { default: PinoFactory }).default
      : (moduleValue as PinoFactory)
  ) as PinoFactory;
  const log = factory({ level: level === 'silent' ? 'silent' : level });
  const levelName = level === 'silent' ? 'silent' : level;
  return {
    level: levelName,
    trace: (msg, obj) => void (obj === undefined ? log.trace(msg) : log.trace(obj, msg)),
    debug: (msg, obj) => void (obj === undefined ? log.debug(msg) : log.debug(obj, msg)),
    info: (msg, obj) => void (obj === undefined ? log.info(msg) : log.info(obj, msg)),
    warn: (msg, obj) => void (obj === undefined ? log.warn(msg) : log.warn(obj, msg)),
    error: (msg, obj) => void (obj === undefined ? log.error(msg) : log.error(obj, msg)),
    fatal: (msg, obj) => void (obj === undefined ? log.fatal(msg) : log.fatal(obj, msg)),
  };
}

function winstonAdapter(moduleValue: unknown, level: LogLevel): LogMethods {
  const winston = moduleValue as WinstonModule;
  const winstonLevel =
    level === 'trace' ? 'silly' : level === 'fatal' ? 'error' : level === 'silent' ? 'warn' : level;
  const log = winston.createLogger({
    level: winstonLevel,
    silent: level === 'silent',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
  });
  return {
    level,
    trace: (msg, obj) => void (obj === undefined ? log.silly(msg) : log.silly(msg, obj)),
    debug: (msg, obj) => void (obj === undefined ? log.debug(msg) : log.debug(msg, obj)),
    info: (msg, obj) => void (obj === undefined ? log.info(msg) : log.info(msg, obj)),
    warn: (msg, obj) => void (obj === undefined ? log.warn(msg) : log.warn(msg, obj)),
    error: (msg, obj) => void (obj === undefined ? log.error(msg) : log.error(msg, obj)),
    fatal: (msg, obj) => void (obj === undefined ? log.error(msg) : log.error(msg, obj)),
  };
}

export function createLogger(driver: LogDriver, level: LogLevel): LogMethods {
  if (driver === 'pino') {
    const moduleValue = loadModule(moduleSpecifier('SPECMINE_LOG_PINO_MODULE', 'pino'));
    return moduleValue === null ? noop : pinoAdapter(moduleValue, level);
  }
  if (driver === 'winston') {
    const moduleValue = loadModule(moduleSpecifier('SPECMINE_LOG_WINSTON_MODULE', 'winston'));
    return moduleValue === null ? noop : winstonAdapter(moduleValue, level);
  }
  const pinoValue = loadModule(moduleSpecifier('SPECMINE_LOG_PINO_MODULE', 'pino'));
  if (pinoValue !== null) return pinoAdapter(pinoValue, level);
  const winstonValue = loadModule(moduleSpecifier('SPECMINE_LOG_WINSTON_MODULE', 'winston'));
  return winstonValue === null ? noop : winstonAdapter(winstonValue, level);
}

let cached: LogMethods | undefined;

export function logger(): LogMethods {
  if (cached === undefined) {
    cached = createLogger(resolveDriver(), resolveLevel());
  }
  return cached;
}

export function resetLogger(): void {
  cached = undefined;
}
