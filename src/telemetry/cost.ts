import { logger } from '../log.js';

/**
 * Token accounting for a run. A provider-reported figure is recorded as given;
 * only identify infers one, and it is flagged so a reader can tell an estimate
 * from a measurement.
 */
export interface UsageEntry {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** tokens were inferred from payload size, not reported by the provider.
   *  Only identify does this — its endpoint returns no usage. */
  estimated?: boolean;
}

export interface CostSummary {
  calls: UsageEntry[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** true when any call's tokens were inferred rather than reported */
  estimated: boolean;
}

export const BLENDED_RATE_PER_MTOK = { jev: 0.042, llm: 1.73 } as const;

export function emptySummary(): CostSummary {
  return { calls: [], inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: false };
}

function isPriced(stage: string): boolean {
  return stage === 'identify' || stage === 'classify';
}

export function recordUsage(
  summary: CostSummary,
  entry: Omit<UsageEntry, 'inputTokens' | 'outputTokens'> & {
    inputTokens?: number;
    outputTokens?: number;
  },
): void {
  const inputTokens = entry.inputTokens ?? 0;
  const outputTokens = entry.outputTokens ?? 0;
  summary.calls.push({ ...entry, inputTokens, outputTokens });
  summary.inputTokens += inputTokens;
  summary.outputTokens += outputTokens;
  summary.totalTokens += inputTokens + outputTokens;
  if (entry.estimated === true) summary.estimated = true;
}

/** Dollars for the summary, at the spec's blended rates. Jev output is free. */
export function estimateCost(summary: CostSummary): number {
  const byStage = (stage: string, key: 'inputTokens' | 'outputTokens'): number =>
    summary.calls
      .filter((call) => call.stage === stage)
      .reduce((total, call) => total + call[key], 0);
  const jev = (byStage('identify', 'inputTokens') * BLENDED_RATE_PER_MTOK.jev) / 1_000_000;
  const llm =
    ((byStage('classify', 'inputTokens') +
      byStage('classify', 'outputTokens') +
      byStage('spec', 'inputTokens') +
      byStage('spec', 'outputTokens') +
      byStage('summary', 'inputTokens') +
      byStage('summary', 'outputTokens') +
      byStage('image', 'inputTokens') +
      byStage('image', 'outputTokens')) *
      BLENDED_RATE_PER_MTOK.llm) /
    1_000_000;
  return Number((jev + llm).toFixed(6));
}

export function logCostSummary(summary: CostSummary): void {
  logger().info('Run cost', {
    calls: summary.calls.length,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    usd: estimateCost(summary),
    estimated: summary.estimated,
    pricedStages: summary.calls.filter((call) => isPriced(call.stage)).length,
  });
}
