/**
 * @lmps/benchmark — deterministic benchmark data and metrics (M2-003).
 *
 * Purely functional: the fixed prompt suite, per-phase metrics aggregation,
 * fingerprint/identity invalidation and result construction. It never touches
 * the file system, the network or LM Studio — measurement itself lives in the
 * adapter's `BenchmarkRuntime`, orchestration in core's `BenchmarkService`.
 */
export { SEED_BENCHMARK_SUITE } from './suites.js';
export type { BenchmarkPrompt, BenchmarkSuite } from './suites.js';

export { aggregateSamples } from './metrics.js';
export type { AggregateOptions, SampleMetrics } from './metrics.js';

export { isBenchmarkValidFor } from './validity.js';
export type { BenchmarkIdentity, Validity } from './validity.js';

export { buildBenchmarkResult } from './result.js';
export type { BuildBenchmarkResultInput } from './result.js';