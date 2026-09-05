/**
 * Versioned task rules (PRD FR-07, M2-001): the data contract behind the
 * candidate optimizer. One `RulesDocument` is a rule pack — a versioned bundle
 * of per-task-kind rules, each carrying hard constraints, parameter hints for
 * candidate generation, static-scoring weights and a bilingual rationale
 * (mirroring `CompositeProfile.displayName`). Rules are data, never scattered
 * constants in source: the document rides the global `SCHEMA_VERSION` and its
 * own `version` field tracks rule-pack evolution.
 */
import { z } from 'zod';

import { MODEL_ARCHITECTURES, TASK_KINDS } from './profile.js';
import { SCHEMA_VERSION } from './version.js';

/** Inclusive numeric range for a parameter hint (min ≤ max, enforced in validate). */
const RuleRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});

export const RuleSchema = z
  .object({
    /** PRD FR-07 task kind this rule applies to (exactly one per rule). */
    taskKind: z.enum(TASK_KINDS),
    /** Architectures the rule targets; absent = no architecture restriction. */
    applicableArchitectures: z.array(z.enum(MODEL_ARCHITECTURES)).optional(),
    /** Why this rule exists, in both project languages (PRD FR-07 rationale). */
    rationale: z.object({
      'zh-CN': z.string().min(1),
      en: z.string().min(1),
    }),
    /** Hard filters consumed by the candidate optimizer (M2-002). */
    constraints: z
      .object({
        minVramBytes: z.number().int().min(0).optional(),
        minContextLength: z.number().int().min(1).optional(),
        requiredCapabilities: z.array(z.string()).optional(),
        maxConcurrency: z.number().int().min(1).optional(),
      })
      .optional(),
    /** Recommended parameter ranges for candidate generation (M2-002). */
    parameterHints: z
      .object({
        contextLength: RuleRangeSchema.optional(),
        gpuOffload: RuleRangeSchema.optional(),
        evalBatchSize: RuleRangeSchema.optional(),
        flashAttention: z.boolean().optional(),
        temperature: RuleRangeSchema.optional(),
        topP: RuleRangeSchema.optional(),
        maxTokens: RuleRangeSchema.optional(),
      })
      .optional(),
    /** Static-scoring weights normalized by the consumer (M2-002). */
    scoringWeights: z
      .object({
        vramEfficiency: z.number().min(0),
        latency: z.number().min(0),
        throughput: z.number().min(0),
        quality: z.number().min(0),
      })
      .optional(),
  })
  .passthrough();

export const StrictRuleSchema = RuleSchema.strict();

export const RulesDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Rule-pack version (independent of the schema version, e.g. "2026.09.1"). */
    version: z.string().min(1),
    rules: z.array(RuleSchema).min(1),
  })
  .passthrough();

export const StrictRulesDocumentSchema = RulesDocumentSchema.strict();

export type Rule = z.infer<typeof RuleSchema>;
export type RulesDocument = z.infer<typeof RulesDocumentSchema>;