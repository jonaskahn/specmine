import type { CallOptions } from '../types.js';
import type { CostSummary } from '../telemetry/cost.js';
import { recordUsage } from '../telemetry/cost.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

/**
 * Wraps a provider so every call's reported usage lands in the run summary.
 * `stage` labels each call so the cost log reads like the pipeline does.
 */
export class MeteredProvider implements LlmProvider {
  private stage = 'llm';

  constructor(
    private readonly inner: LlmProvider,
    private readonly summary: CostSummary,
  ) {}

  /** Subsequent calls are attributed to `stage` until changed again. */
  withStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
    const previous = this.stage;
    this.stage = stage;
    return run().finally(() => {
      this.stage = previous;
    });
  }

  async complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse> {
    const response = await this.inner.complete(request, options);
    recordUsage(this.summary, {
      stage: this.stage,
      model: request.model ?? 'unknown',
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
