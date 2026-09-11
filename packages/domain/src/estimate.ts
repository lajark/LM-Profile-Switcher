/**
 * LoadEstimate: expected resource usage for loading one model configuration
 * (PRD FR-10 + `lms load --estimate-only`). `provider` distinguishes an exact
 * engine estimate (`exact`) from a coarse project heuristic (`rough`), so the
 * UI can label confidence instead of guessing.
 *
 * M5-001 memory semantics: the engine answers with *three distinct* figures —
 * Estimated GPU Memory (`vramTotalBytes`), Estimated Total Memory
 * (`totalMemoryBytes`, the whole-footprint figure = GPU + host spill) and, when
 * the engine reports it, an explicit system-RAM figure (`systemRamBytes`).
 * Total Memory must never be mapped or labelled as System RAM.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { SCHEMA_VERSION } from './version.js';

const LoadEstimateDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  provider: z.enum(['exact', 'rough']),
  modelKey: z.string().min(1),
  quantization: z.string().nullable().optional(),
  contextLength: z.number().int().min(1).nullable().optional(),
  gpuOffload: z.number().min(0).max(1).nullable().optional(),
  /** Predicted VRAM usage in bytes (Estimated GPU Memory); null when a probe needed it failed. */
  vramTotalBytes: z.number().int().min(0).nullable(),
  /**
   * Predicted whole-footprint memory in bytes (Estimated Total Memory), i.e. the
   * model's total requirement across GPU and host memory. Additive M5-001 field:
   * legacy documents without it remain valid. Never derived from a System RAM
   * label and never to be displayed as System RAM.
   */
  totalMemoryBytes: z.number().int().min(0).nullable().optional(),
  /** Predicted system RAM usage in bytes; null when unknown. Only an explicit RAM label fills this — never Total Memory. */
  systemRamBytes: z.number().int().min(0).nullable(),
  hardwareFingerprint: z.string().nullable().optional(),
  lmStudioVersion: z.string().nullable().optional(),
  estimatedAt: isoDateTime('estimatedAt'),
  warnings: z.array(z.string()).default([]),
});

export const LoadEstimateSchema = LoadEstimateDefinition.passthrough();
export const StrictLoadEstimateSchema = LoadEstimateDefinition.strict();

export type LoadEstimate = z.infer<typeof LoadEstimateSchema>;