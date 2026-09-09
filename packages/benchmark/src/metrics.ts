/**
 * Deterministic aggregation of measured samples into BenchmarkMetrics (M2-003).
 * Pure functions: no I/O, no clock. TTFT/prefill/decode latencies and rates are
 * aggregated per-sample then summarized by median (p50); memory peak is the
 * maximum across the sample points. Any phase with no measurable sample stays
 * null rather than being invented.
 */
import type { BenchmarkMetrics } from '@lmps/domain';

/** One measured inference round-trip over the streaming seam. */
export interface SampleMetrics {
  /** Milliseconds until the first content delta; null when none arrived. */
  ttftMs: number | null;
  /** Number of generated tokens (usage count preferred over delta blocks). */
  generatedTokens: number;
  /** Total round-trip wall-clock in milliseconds. */
  totalMs: number;
  /** Approximate prompt token count (from the suite) for prefill estimation. */
  promptTokens: number;
}

export interface AggregateOptions {
  loadMs?: number | null;
  /** VRAM-used sample points; the maximum becomes memoryPeakBytes. */
  memoryPeaks?: readonly number[];
}

export function aggregateSamples(samples: readonly SampleMetrics[], options: AggregateOptions = {}): BenchmarkMetrics {
  const ttftValues = samples
    .map((sample) => sample.ttftMs)
    .filter((value): value is number => value !== null && value > 0);
  // Timings are milliseconds; rates report tokens per second, so ×1000.
  const prefillRates = samples
    .filter((sample) => sample.ttftMs !== null && sample.ttftMs > 0 && sample.promptTokens > 0)
    .map((sample) => ((sample.promptTokens * 1000) / (sample.ttftMs as number)));
  const decodeRates = samples
    .filter((sample) => sample.ttftMs !== null && sample.totalMs > (sample.ttftMs as number) && sample.generatedTokens > 0)
    .map((sample) => ((sample.generatedTokens * 1000) / (sample.totalMs - (sample.ttftMs as number))));

  const ttftMs = median(ttftValues);
  const prefillTokensPerSecond = median(prefillRates);
  const decodeTokensPerSecond = median(decodeRates);
  const peaks = options.memoryPeaks ?? [];

  return {
    tokensPerSecond: decodeTokensPerSecond,
    latencyP50Ms: null,
    memoryPeakBytes: peaks.length === 0 ? null : Math.max(...peaks),
    samples: samples.length,
    loadMs: options.loadMs ?? null,
    ttftMs,
    prefillTokensPerSecond,
    decodeTokensPerSecond,
  };
}

/** Median of a numeric list; undefined input yields null (deterministic). */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
}