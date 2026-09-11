/**
 * Profile contracts: the runtime/generation/behavior separation required by
 * PRD §6, plus the composite profile that stores one selection of each.
 *
 * Field constraints mirror `schemas/profile.schema.json` (v1, unchanged) so
 * documents written against that sample remain valid here; unknown-field
 * handling follows the documented policy — preserved by default, rejected in
 * the exported `Strict*` variants.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { SCHEMA_VERSION } from './version.js';

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

const profileId = z
  .string()
  .regex(PROFILE_ID_RE, { message: 'profile id must match ^[a-z0-9][a-z0-9._-]{1,63}$' });

/** Model file architectures recognised by the domain (PRD §6). */
export const MODEL_ARCHITECTURES = ['dense', 'moe', 'embedding', 'vision', 'unknown'] as const;
const modelArchitecture = z.enum(MODEL_ARCHITECTURES);

/** PRD FR-07 preset task kinds; `custom` covers user-defined task shapes. */
export const TASK_KINDS = [
  'quick-chat',
  'long-document',
  'rag',
  'investment-due-diligence',
  'meeting-minutes',
  'coding',
  'structured-extraction',
  'agent',
  'creative-writing',
  'vision',
  'custom',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Identity and provenance of the underlying model file. */
export const ModelProfileSchema = z
  .object({
    modelKey: z.string().min(1),
    fileHash: z.string().nullable().optional(),
    family: z.string().nullable().optional(),
    architecture: modelArchitecture.optional(),
    quantization: z.string().nullable().optional(),
  })
  .passthrough();

export const StrictModelProfileSchema = ModelProfileSchema.strict();

/** What the profile is optimized for (task type, token volume, tool use…). */
export const TaskProfileSchema = z
  .object({
    type: z.string().min(1),
    /** PRD FR-07 preset task kind; `custom` for shapes outside the taxonomy. */
    kind: z.enum(TASK_KINDS).optional(),
    typicalInputTokens: z.number().int().min(0).optional(),
    expectedOutputTokens: z.number().int().min(0).optional(),
    structuredOutput: z.boolean().optional(),
    toolUse: z.boolean().optional(),
    concurrency: z.number().int().min(1).optional(),
  })
  .passthrough();

export const StrictTaskProfileSchema = TaskProfileSchema.strict();

/**
 * Engine loading parameters. Every tunable is optional so a profile may defer
 * to LM Studio defaults; values echoed by the active runtime are what counts.
 */
export const RuntimeProfileSchema = z
  .object({
    contextLength: z.number().int().min(1).nullable().optional(),
    gpuOffload: z
      .union([z.enum(['auto', 'max', 'off']), z.number().min(0).max(1)])
      .nullable()
      .optional(),
    evalBatchSize: z.number().int().min(1).nullable().optional(),
    flashAttention: z.boolean().nullable().optional(),
    offloadKvCacheToGpu: z.boolean().nullable().optional(),
    kCacheQuantization: z.union([z.string(), z.boolean(), z.null()]).optional(),
    vCacheQuantization: z.union([z.string(), z.boolean(), z.null()]).optional(),
    ropeFrequencyBase: z.number().gt(0).nullable().optional(),
    ropeFrequencyScale: z.number().gt(0).nullable().optional(),
    tryMmap: z.boolean().nullable().optional(),
    keepModelInMemory: z.boolean().nullable().optional(),
    numExperts: z.number().int().min(1).nullable().optional(),
    parallelSlots: z.number().int().min(1).nullable().optional(),
  })
  .passthrough();

export const StrictRuntimeProfileSchema = RuntimeProfileSchema.strict();

/** Sampling and completion controls. */
export const GenerationProfileSchema = z
  .object({
    temperature: z.number().min(0).nullable().optional(),
    topP: z.number().min(0).max(1).nullable().optional(),
    topK: z.number().int().min(0).nullable().optional(),
    minP: z.number().min(0).max(1).nullable().optional(),
    repeatPenalty: z.number().gt(0).nullable().optional(),
    frequencyPenalty: z.number().nullable().optional(),
    presencePenalty: z.number().nullable().optional(),
    maxTokens: z.number().int().min(1).nullable().optional(),
    seed: z.number().int().nullable().optional(),
    reasoning: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),
    structuredOutputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
    systemPrompt: z.string().nullable().optional(),
    presetReference: z.string().nullable().optional(),
  })
  .passthrough();

export const StrictGenerationProfileSchema = GenerationProfileSchema.strict();

/**
 * How switching treats the target (exclusive vs coexist), how long it stays
 * active, and how failures are handled.
 */
export const BehaviorProfileSchema = z
  .object({
    identifier: z.string().nullable().optional(),
    ttlSeconds: z.number().int().min(0).nullable().optional(),
    mode: z.enum(['exclusive', 'coexist']),
    autoStartServer: z.boolean().optional(),
    healthCheck: z.enum(['model-status', 'minimal-prompt', 'both']).optional(),
    rollback: z.enum(['always', 'best-effort', 'disabled']).optional(),
  })
  .passthrough();

export const StrictBehaviorProfileSchema = BehaviorProfileSchema.strict();

/**
 * Evidence that a profile was actually exercised, bound to the environment and
 * adapter capability line (PRD §8): model key + file hash, quantization,
 * hardware fingerprint, LM Studio/runtime versions, adapter capability version
 * and benchmark time.
 */
export const ValidationInfoSchema = z
  .object({
    source: z.enum(['manual', 'snapshot', 'rule-recommended', 'benchmarked', 'imported']).optional(),
    hardwareFingerprint: z.string().nullable().optional(),
    lmStudioVersion: z.string().nullable().optional(),
    runtimeVersion: z.string().nullable().optional(),
    adapterCapabilityVersion: z.string().nullable().optional(),
    testedAt: isoDateTime('testedAt').nullable().optional(),
    benchmarkId: z.string().nullable().optional(),
    /** M5-003: measured peak memory footprint (bytes) captured by `benchmark --yes`. Advisory only — never overwrites the origin load estimate. */
    memoryPeakBytes: z.number().int().min(0).nullable().optional(),
  })
  .passthrough();

export const StrictValidationInfoSchema = ValidationInfoSchema.strict();

/** Record-keeping for the profile document; not model behavior. */
export const MetadataSchema = z
  .object({
    createdAt: isoDateTime('createdAt'),
    updatedAt: isoDateTime('updatedAt'),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

export const StrictMetadataSchema = MetadataSchema.strict();

/**
 * The stored profile: one selection of model/task/runtime/generation/behavior
 * plus validation evidence and metadata. Keep the shape compatible with the
 * published v1 sample (`schemas/profile.schema.json`).
 */
export const CompositeProfileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: profileId,
    displayName: z.object({
      'zh-CN': z.string().min(1),
      en: z.string().min(1),
    }),
    description: z.record(z.string(), z.string()).optional(),
    model: ModelProfileSchema,
    task: TaskProfileSchema,
    runtime: RuntimeProfileSchema,
    generation: GenerationProfileSchema,
    behavior: BehaviorProfileSchema,
    validation: ValidationInfoSchema.optional(),
    metadata: MetadataSchema,
  })
  .passthrough();

export const StrictCompositeProfileSchema = CompositeProfileSchema.strict();

export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type TaskProfile = z.infer<typeof TaskProfileSchema>;
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
export type GenerationProfile = z.infer<typeof GenerationProfileSchema>;
export type BehaviorProfile = z.infer<typeof BehaviorProfileSchema>;
export type ValidationInfo = z.infer<typeof ValidationInfoSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
export type CompositeProfile = z.infer<typeof CompositeProfileSchema>;