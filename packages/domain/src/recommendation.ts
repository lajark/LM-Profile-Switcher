/**
 * Candidate + Recommendation: the machine contract of the candidate optimizer
 * (PRD FR-07). A `Recommendation` is produced by the `RecommendationService`
 * (core) from a baseline profile, a matched rule, per-candidate `LoadEstimate`s,
 * the capability matrix and the hardware profile. Candidates are already
 * filtered (unsafe ones never appear) and sorted by score; `selectedIndex` names
 * the head candidate to save, or is null when nothing is safe to recommend.
 *
 * This is a computed contract, not a stored document: it never goes through
 * `migrateProfile`, so it rides the global `SCHEMA_VERSION` like the other
 * contracts but has no migration entry.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { LoadEstimateSchema } from './estimate.js';
import { CompositeProfileSchema, TASK_KINDS } from './profile.js';
import { SCHEMA_VERSION } from './version.js';

const CandidateSafetySchema = z
  .object({
    safe: z.boolean(),
    /** Human-readable reason for the safety verdict (data, not an i18n key). */
    reason: z.string().nullable().optional(),
    /** Predicted used VRAM at load time; null when the estimate could not tell. */
    vramUsedBytes: z.number().int().min(0).nullable(),
    /** Available VRAM on the probed hardware; null when unknown. */
    vramAvailableBytes: z.number().int().min(0).nullable(),
    /** available - used; negative only when the estimate exceeded available VRAM. */
    headroomBytes: z.number().int().nullable(),
  })
  .passthrough();

const ScoreBreakdownSchema = z
  .object({
    vramEfficiency: z.number(),
    latency: z.number(),
    throughput: z.number(),
    quality: z.number(),
  })
  .passthrough();

const CandidateScoreSchema = z
  .object({
    total: z.number().min(0),
    breakdown: ScoreBreakdownSchema,
    /**
     * `high` only when the estimate is `exact` AND the safety margin is safe;
     * otherwise `low` (rough estimate, unknown capability, thin margin, …).
     */
    confidence: z.enum(['high', 'low']),
    /** Whether the score reflects measured calibration (M2-003). Always false in M2-002. */
    measured: z.boolean().default(false),
  })
  .passthrough();

const ParameterDiffEntrySchema = z
  .object({
    /** Dotted profile path, e.g. `runtime.contextLength`. */
    path: z.string().min(1),
    baseline: z.unknown().nullable(),
    candidate: z.unknown().nullable(),
  })
  .passthrough();

const CandidateDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  /** Full candidate composite profile, ready to save on confirmation. */
  profile: CompositeProfileSchema,
  baselineProfileId: z.string().min(1),
  estimate: LoadEstimateSchema,
  safety: CandidateSafetySchema,
  score: CandidateScoreSchema,
  /** Field-level differences against the baseline profile (runtime/generation). */
  diff: z.array(ParameterDiffEntrySchema),
  /** Why this candidate scores as it does, in both project languages. */
  rationale: z.object({
    'zh-CN': z.string().min(1),
    en: z.string().min(1),
  }),
});

export const CandidateSchema = CandidateDefinition.passthrough();
/** The strict variant also rejects unknown capability fields at candidate level. */
export const StrictCandidateSchema = CandidateDefinition.strict();

const RecommendationDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  baselineProfileId: z.string().min(1),
  /** PRD FR-07 task kind the recommendation was made for. */
  taskKind: z.enum(TASK_KINDS),
  /** Rule-pack version the matched rule came from (`RulesDocument.version`). */
  ruleVersion: z.string().min(1),
  /** Safe candidates only, sorted by `score.total` descending. */
  candidates: z.array(CandidateSchema).min(0),
  /** Head candidate index; null when no candidate is safe to recommend. */
  selectedIndex: z.number().int().min(0).nullable(),
  generatedAt: isoDateTime('generatedAt'),
  /** Non-fatal notes (rule mismatch, dropped estimates, unknown capability…). */
  warnings: z.array(z.string()).default([]),
});

/** Strict variant validates candidates transitively (unknown fields rejected). */
const StrictRecommendationDefinition = RecommendationDefinition.extend({
  candidates: z.array(StrictCandidateSchema).min(0),
});

export const RecommendationSchema = RecommendationDefinition.passthrough();
export const StrictRecommendationSchema = StrictRecommendationDefinition.strict();

export type Candidate = z.infer<typeof CandidateSchema>;
export type CandidateSafety = z.infer<typeof CandidateSafetySchema>;
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;
export type ParameterDiffEntry = z.infer<typeof ParameterDiffEntrySchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;