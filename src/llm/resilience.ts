import { ExtractionError, isExtractionError } from '../errors.js';
import type { CallOptions } from '../types.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BACKOFF_MS = 200;
export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_COOLDOWN_MS = 30_000;

export interface RetryPolicy {
  maxRetries?: number;
  backoffMs?: number;
}

export interface CircuitBreakerPolicy {
  failureThreshold?: number;
  cooldownMs?: number;
}

export interface ResilienceOptions {
  retry?: RetryPolicy;
  circuitBreaker?: CircuitBreakerPolicy;
}

interface Settings {
  maxRetries: number;
  backoffMs: number;
  failureThreshold: number;
  cooldownMs: number;
}

function resolveSettings(options?: ResilienceOptions): Settings {
  return {
    maxRetries: resolveNumber(
      options?.retry?.maxRetries,
      'SPECMINE_LLM_MAX_RETRIES',
      DEFAULT_MAX_RETRIES,
    ),
    backoffMs: resolveNumber(
      options?.retry?.backoffMs,
      'SPECMINE_LLM_BACKOFF_MS',
      DEFAULT_BACKOFF_MS,
    ),
    failureThreshold: resolveNumber(
      options?.circuitBreaker?.failureThreshold,
      'SPECMINE_LLM_FAILURE_THRESHOLD',
      DEFAULT_FAILURE_THRESHOLD,
    ),
    cooldownMs: resolveNumber(
      options?.circuitBreaker?.cooldownMs,
      'SPECMINE_LLM_COOLDOWN_MS',
      DEFAULT_COOLDOWN_MS,
    ),
  };
}

function resolveNumber(value: number | undefined, envName: string, fallback: number): number {
  if (value !== undefined) return value;
  const raw = process.env[envName];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRetryable(error: unknown): boolean {
  return isExtractionError(error) && (error.code === 'LLM_ERROR' || error.code === 'TIMEOUT');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ResilientProvider implements LlmProvider {
  private readonly settings: Settings;
  private failures = 0;
  private openUntil = 0;
  private probing = false;

  constructor(
    private readonly provider: LlmProvider,
    options?: ResilienceOptions,
  ) {
    this.settings = resolveSettings(options);
  }

  async complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse> {
    this.assertClosed();
    const attempts = this.settings.maxRetries + 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await sleep(this.settings.backoffMs * attempt);
        if (options?.signal?.aborted) {
          throw new ExtractionError('TIMEOUT', 'LLM call aborted');
        }
      }
      try {
        const response = await this.provider.complete(request, options);
        this.recordSuccess();
        return response;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) break;
      }
    }
    this.recordFailure();
    throw lastError;
  }

  private assertClosed(): void {
    if (this.openUntil === 0) return;
    if (Date.now() < this.openUntil) {
      throw new ExtractionError('LLM_ERROR', 'Circuit breaker is open');
    }
    this.probing = true;
    this.openUntil = 0;
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.probing = false;
    this.openUntil = 0;
  }

  private recordFailure(): void {
    if (this.probing) {
      this.probing = false;
      this.openUntil = Date.now() + this.settings.cooldownMs;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.settings.failureThreshold) {
      this.openUntil = Date.now() + this.settings.cooldownMs;
      this.failures = 0;
    }
  }
}

export function createResilientProvider(
  provider: LlmProvider,
  options?: ResilienceOptions,
): LlmProvider {
  return new ResilientProvider(provider, options);
}
