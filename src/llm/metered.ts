import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallOptions } from '../types.js';
import type { CostSummary } from '../telemetry/cost.js';
import { recordUsage } from '../telemetry/cost.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

/**
 * Wraps a provider so every call's reported usage lands in the run summary.
 * `stage` labels each call so the cost log reads like the pipeline does.
 *
 * The stage lives in an AsyncLocalStorage rather than a field because the
 * pipeline runs stages concurrently on one shared instance: a field would be
 * overwritten by whichever stage started last, so overlapping spec and image
 * calls would both be billed to the same label. Scoping it to the async context
 * keeps each call attributed to the stage that actually made it.
 */
export class MeteredProvider implements LlmProvider {
  private readonly stages = new AsyncLocalStorage<string>();

  constructor(
    private readonly inner: LlmProvider,
    private readonly summary: CostSummary,
  ) {}

  /** Calls made inside `run` are attributed to `stage`, including any that
   *  overlap a stage running elsewhere. */
  withStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
    return this.stages.run(stage, run);
  }

  async complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse> {
    const response = await this.inner.complete(request, options);
    recordUsage(this.summary, {
      stage: this.stages.getStore() ?? 'llm',
      // The request rarely names a model; the provider's resolved setting is the
      // truth about which one was billed.
      model: request.model ?? this.inner.model?.(request) ?? 'unknown',
      ...(response.usage?.inputTokens !== undefined
        ? { inputTokens: response.usage.inputTokens }
        : {}),
      ...(response.usage?.outputTokens !== undefined
        ? { outputTokens: response.usage.outputTokens }
        : {}),
    });
    return response;
  }
}
