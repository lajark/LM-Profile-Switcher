/**
 * Registry of every top-level contract that gets a generated JSON Schema
 * artifact. Consumed by `scripts/generate-domain-schemas.mjs` (and its gate)
 * so the artifact list lives in one place.
 *
 * `jsonSchema` is lazy: building the JSON Schema costs a little and the output
 * files are diffed byte-for-byte by the CI gate (`domain:schema:check`).
 */
import { z } from 'zod';

import { BenchmarkResultSchema } from './benchmark.js';
import { CapabilityMatrixSchema } from './capability.js';
import { LoadEstimateSchema } from './estimate.js';
import { HardwareProfileSchema } from './hardware.js';
import {
  BehaviorProfileSchema,
  CompositeProfileSchema,
  GenerationProfileSchema,
  ModelProfileSchema,
  RuntimeProfileSchema,
  TaskProfileSchema,
} from './profile.js';
import { ActivationTransactionSchema } from './transaction.js';

export interface DomainSchemaEntry {
  /** Stable artifact id; also the generated JSON Schema file basename. */
  name: string;
  title: string;
  description: string;
  jsonSchema: () => Record<string, unknown>;
}

function entry(name: string, title: string, description: string, schema: z.ZodType<unknown>): DomainSchemaEntry {
  return {
    name,
    title,
    description,
    jsonSchema: () => z.toJSONSchema(schema) as unknown as Record<string, unknown>,
  };
}

export const DOMAIN_SCHEMAS: readonly DomainSchemaEntry[] = [
  entry('ModelProfile', 'Model Profile', 'Identity and provenance of a model file.', ModelProfileSchema),
  entry('TaskProfile', 'Task Profile', 'Task shape the profile is optimized for.', TaskProfileSchema),
  entry('RuntimeProfile', 'Runtime Profile', 'Engine loading parameters.', RuntimeProfileSchema),
  entry('GenerationProfile', 'Generation Profile', 'Sampling and completion controls.', GenerationProfileSchema),
  entry('BehaviorProfile', 'Behavior Profile', 'Activation policy and failure handling.', BehaviorProfileSchema),
  entry(
    'CompositeProfile',
    'Composite Profile',
    'One stored selection of model, task, runtime, generation and behavior.',
    CompositeProfileSchema,
  ),
  entry('HardwareProfile', 'Hardware Profile', 'Host environment snapshot (PRD FR-02).', HardwareProfileSchema),
  entry('LoadEstimate', 'Load Estimate', 'Expected resource usage for one model configuration.', LoadEstimateSchema),
  entry('BenchmarkResult', 'Benchmark Result', 'Objective benchmark of one model configuration.', BenchmarkResultSchema),
  entry('ActivationTransaction', 'Activation Transaction', 'Auditable record of one activation attempt.', ActivationTransactionSchema),
  entry('CapabilityMatrix', 'Capability Matrix', 'Per-adapter capability probing result.', CapabilityMatrixSchema),
];