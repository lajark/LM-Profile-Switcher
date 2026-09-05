/**
 * ActivationTransaction: the auditable record of one activation attempt
 * (PRD FR-04). The state machine drives Idle → Validating → Estimating →
 * Locking → UnloadingConflicts → Loading → HealthChecking → Active with an
 * explicit recovery path; the transaction keeps every stage, outcome and
 * error code so a failed switch can be diagnosed and rerun safely.
 */
import { z } from 'zod';

import { isoDateTime } from './iso-date.js';
import { SCHEMA_VERSION } from './version.js';

export const ACTIVATION_STAGES = [
  'idle',
  'validating',
  'estimating',
  'locking',
  'unloading-conflicts',
  'loading',
  'health-checking',
  'collecting-diagnostics',
  'cleaning-failed-instance',
  'restoring-previous-profile',
] as const;

export const ACTIVATION_STATUS = [
  'idle',
  'active',
  'failed',
  'failed-but-recovered',
  'canceled',
] as const;

export const TransactionStageSchema = z
  .object({
    name: z.enum(ACTIVATION_STAGES),
    startedAt: isoDateTime('stage.startedAt'),
    endedAt: isoDateTime('stage.endedAt').nullable().optional(),
    outcome: z.enum(['completed', 'failed', 'timeout', 'canceled']).nullable().optional(),
  })
  .passthrough();

export const TransactionErrorSchema = z
  .object({
    /** Stable machine code; user-facing wording is a presentation concern. */
    code: z.string().min(1),
    at: isoDateTime('error.at'),
    detail: z.string().nullable().optional(),
  })
  .passthrough();

const ActivationTransactionDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  targetProfileId: z.string().min(1),
  previousProfileId: z.string().nullable().optional(),
  status: z.enum(ACTIVATION_STATUS),
  policy: z.object({
    mode: z.enum(['exclusive', 'coexist']),
    rollback: z.enum(['always', 'best-effort', 'disabled']),
  }),
  stages: z.array(TransactionStageSchema).default([]),
  errors: z.array(TransactionErrorSchema).default([]),
  startedAt: isoDateTime('startedAt'),
  finishedAt: isoDateTime('finishedAt').nullable().optional(),
});

export const ActivationTransactionSchema = ActivationTransactionDefinition.passthrough();
export const StrictActivationTransactionSchema = ActivationTransactionDefinition.strict();

export type ActivationTransaction = z.infer<typeof ActivationTransactionSchema>;
export type TransactionStage = z.infer<typeof TransactionStageSchema>;
export type TransactionError = z.infer<typeof TransactionErrorSchema>;