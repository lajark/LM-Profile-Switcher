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
    tokensPerSecond: z.number().min(0).nullable().optional(),
    latencyP50Ms: z.number().min(0).nullable().optional(),
    memoryPeakBytes: z.number().int().min(0).nullable().optional(),
    samples: z.number().int().min(0).default(0).optional(),
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
});

export const BenchmarkResultSchema = BenchmarkResultDefinition.passthrough();
export const StrictBenchmarkResultSchema = BenchmarkResultDefinition.strict();

export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;
export type BenchmarkMetrics = z.infer<typeof BenchmarkMetricsSchema>;