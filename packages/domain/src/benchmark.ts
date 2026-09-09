/**
 * BenchmarkResult: the objective, bounded benchmark of one model configuration
 * (PRD FR-07). Raw inputs are not stored by default; the recorded metrics are
 * the bound-value source for rule recommendations and validity evidence.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { SCHEMA_VERSION } from './version.js';

export const BenchmarkMetricsSchema = z
  .object({
    /**
     * Per-phase timing and throughput added by M2-003 Benchmark Lite. All are
     * nullable-optional so a partial measurement (missing phases, non-NVIDIA
     * host with no VRAM figure, aborted before completion) still validates.
     * `tokensPerSecond` is kept as the total-throughput alias and equals
     * `decodeTokensPerSecond`; the decode field names the segment explicitly.
     */
    tokensPerSecond: z.number().min(0).nullable().optional(),
    latencyP50Ms: z.number().min(0).nullable().optional(),
    memoryPeakBytes: z.number().int().min(0).nullable().optional(),
    samples: z.number().int().min(0).default(0).optional(),
    /** Model load wall-clock, measured by the adapter (ms). */
    loadMs: z.number().min(0).nullable().optional(),
    /** First token latency in ms. Null when the stream never produced a token. */
    ttftMs: z.number().min(0).nullable().optional(),
    /** Feature prefill throughput, approxPromptTokens / ttftMs (tokens/s). */
    prefillTokensPerSecond: z.number().min(0).nullable().optional(),
    /** Decode-phase throughput, generatedTokens / (totalMs - ttftMs) (tokens/s). */
    decodeTokensPerSecond: z.number().min(0).nullable().optional(),
  })
  .passthrough();

const BenchmarkResultDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  modelKey: z.string().min(1),
  quantization: z.string().nullable().optional(),
  taskType: z.string().min(1),
  status: z.enum(['completed', 'failed', 'canceled']),
  metrics: BenchmarkMetricsSchema,
  hardwareFingerprint: z.string().nullable().optional(),
  lmStudioVersion: z.string().nullable().optional(),
  runtimeVersion: z.string().nullable().optional(),
  adapterCapabilityVersion: z.string().nullable().optional(),
  startedAt: isoDateTime('startedAt'),
  finishedAt: isoDateTime('finishedAt').nullable().optional(),
  errorCode: z.string().nullable().optional(),
  /** Model file hash the benchmark ran against (nullable; REST never provides it). */
  modelFileHash: z.string().nullable().optional(),
  /** Seed prompt suite identity the benchmark derives its prompts from. */
  promptSuiteId: z.string().nullable().optional(),
  promptSuiteVersion: z.string().nullable().optional(),
});

export const BenchmarkResultSchema = BenchmarkResultDefinition.passthrough();
export const StrictBenchmarkResultSchema = BenchmarkResultDefinition.strict();

export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;
export type BenchmarkMetrics = z.infer<typeof BenchmarkMetricsSchema>;