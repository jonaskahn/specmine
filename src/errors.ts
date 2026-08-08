import type { ExtractionErrorCode } from './types.js';

export class ExtractionError extends Error {
  code: ExtractionErrorCode;
  cause?: unknown;

  constructor(code: ExtractionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.cause = cause;
  }
}

export function isExtractionError(error: unknown): error is ExtractionError {
  return error instanceof ExtractionError;
}
