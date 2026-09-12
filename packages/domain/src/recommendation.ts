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
import { ResourceFitSchema } from './resource-fit.js';
import { SCHEMA_VERSION } from './version.js';

const CandidateSafetySchema = z
  .object({
    /** @deprecated M5-001: VRAM-only verdict; prefer `resourceFit`/`recommendable`. */
    safe: z.boolean(),
    /** Human-readable reason for the safety verdict (data, not an i18n key). */
    reason: z.string().nullable().optional(),
    /** Predicted used VRAM at load time; null when the estimate could not tell. */
    vramUsedBytes: z.number().int().min(0).nullable(),
    /** Available VRAM on the probed hardware; null when unknown. */
    vramAvailableBytes: z.number().int().min(0).nullable(),
    /** @deprecated M5-001: VRAM-only headroom; the RAM budget fields below are the new contract. */
    headroomBytes: z.number().int().nullable(),
    /**
     * M5-001 resource-fit class (PRD FR-07 / CONTEXT.md). Additive field with a
     * fail-closed default: legacy documents without it read as `resource-unknown`.
     */
    resourceFit: ResourceFitSchema.default('resource-unknown'),
    /**
     * M5-001: whether the candidate may be recommended under the resource
     * contract — true for GPU-resident, Hybrid-memory and Host-memory. The
     * legacy `safe` field above is VRAM-only and unchanged; `recommendable` is
     * the new RAM-aware verdict (Hybrid/Host display still needs the M5-002/003
     * warnings before being offered).
     */
    recommendable: z.boolean().default(false),
    /** Reserved VRAM for headroom (max(512 MiB, 5% total VRAM)); null when total VRAM is unknown. */
    vramReserveBytes: z.number().int().min(0).nullable().default(null),
    /** Predicted system RAM usage (LoadEstimate.systemRamBytes); null when unknown. */
    ramUsedBytes: z.number().int().min(0).nullable().default(null),
    /** Available system RAM considered for the verdict; null when unknown. */
    ramAvailableBytes: z.number().int().min(0).nullable().default(null),
    /** Reserved RAM for headroom (max(2 GiB, 10% total RAM)); null when total RAM is unknown. */
    ramReserveBytes: z.number().int().min(0).nullable().default(null),
    /** ramAvailableBytes - ramReserveBytes - ramUsedBytes; null unless all three are known. */
    ramHeadroomBytes: z.number().int().nullable().default(null),
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
    /** Whether measured feedback was applied to this candidate's ranking. */
    measured: z.boolean().default(false),
    /**
     * Measured-feedback evidence (measured-feedback loop): the benchmark record
     * this candidate was matched against. Present only when `measured` is true.
     */
    measuredEvidence: z
      .object({
        decodeTokensPerSecond: z.number().min(0),
        ttftMs: z.number().min(0).nullable(),
        samples: z.number().int().min(0),
        recordedAt: isoDateTime('measuredEvidence.recordedAt'),
      })
      .optional(),
    /**
     * Effective ranking value used by the sort: the measured blend for
     * measured-feedback candidates, otherwise equal to `total`. `total` above
     * always stays the pure static score so both views remain readable.
     */
    adjustedTotal: z.number().min(0).optional(),
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
  /** Safe candidates only, sorted by the effective ranking value (`adjustedTotal ?? total`) descending; measured-feedback candidates rank above unmeasured ones. */
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