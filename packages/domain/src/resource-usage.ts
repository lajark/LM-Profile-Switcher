/**
 * Versioned resource evidence captured by a benchmark. Values are deltas from
 * the pre-load host snapshot, never absolute VRAM usage. The contract stays
 * additive so legacy BenchmarkResult/Profile documents remain readable.
 */
import { z } from 'zod';

export const ResourceUsageEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    method: z.literal('host-snapshot-delta'),
    sampleCount: z.number().int().min(0),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    peakDelta: z.object({
      vramBytes: z.number().int().min(0).nullable(),
      systemRamBytes: z.number().int().min(0).nullable(),
      totalBytes: z.number().int().min(0).nullable(),
    }),
  })
  .passthrough();

export const StrictResourceUsageEvidenceSchema = ResourceUsageEvidenceSchema.strict();

export type ResourceUsageEvidence = z.infer<typeof ResourceUsageEvidenceSchema>;
