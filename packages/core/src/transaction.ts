/**
 * ActivationTransaction construction (M1-005 deliverable). The transaction is a
 * pure audit record conforming to the locked domain contract; the runner appends
 * stages and errors as the state machine progresses and one redacted copy is
 * flushed to the injected log sink at the end.
 */
import {
  ACTIVATION_STAGES,
  ACTIVATION_STATUS,
  SCHEMA_VERSION,
  StrictActivationTransactionSchema,
  type ActivationTransaction,
  type CompositeProfile,
  type TransactionError,
  type TransactionStage,
} from '@lmps/domain';

import type { ActiveState } from './ports.js';
import { redactDetail } from './redact.js';

/** Stage names as a union, derived from the domain constant (no contract change). */
export type ActivationStage = (typeof ACTIVATION_STAGES)[number];
/** Transaction statuses as a union, derived from the domain constant. */
export type ActivationStatus = (typeof ACTIVATION_STATUS)[number];

export interface ActivationPolicy {
  mode: 'exclusive' | 'coexist';
  rollback: 'always' | 'best-effort' | 'disabled';
}

export interface TransitionInput {
  id: string;
  targetProfileId: string;
  previousProfileId: string | null;
  policy: ActivationPolicy;
  now: string;
}

/** Resolves the stored behavior into the transaction policy (rollback default best-effort). */
export function resolvePolicy(profile: CompositeProfile): ActivationPolicy {
  return {
    mode: profile.behavior.mode,
    rollback: profile.behavior.rollback ?? 'best-effort',
  };
}

/** Previous active state, converted to the lowest-confusion identity reference. */
export function previousProfileIdOf(active: ActiveState | null): string | null {
  return active?.profileId ?? null;
}

export function beginTransaction(input: TransitionInput): ActivationTransaction {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    targetProfileId: input.targetProfileId,
    previousProfileId: input.previousProfileId,
    status: 'idle',
    policy: input.policy,
    stages: [{ name: 'idle', startedAt: input.now, outcome: 'completed' }],
    errors: [],
    startedAt: input.now,
    finishedAt: null,
  };
}

export function openStage(tx: ActivationTransaction, stage: ActivationStage, at: string): void {
  tx.stages.push({ name: stage, startedAt: at });
}

export function closeStage(
  tx: ActivationTransaction,
  stage: ActivationStage,
  outcome: 'completed' | 'failed' | 'timeout' | 'canceled',
  at: string,
): void {
  for (let i = tx.stages.length - 1; i >= 0; i -= 1) {
    const entry = tx.stages[i];
    if (entry !== undefined && entry.name === stage && entry.endedAt === undefined) {
      entry.endedAt = at;
      entry.outcome = outcome;
      return;
    }
  }
  // Stage was never opened (defensive); record it closed anyway.
  tx.stages.push({ name: stage, startedAt: at, endedAt: at, outcome });
}

/** Records a machine-coded error; `detail` is redacted before storage. */
export function recordError(tx: ActivationTransaction, code: string, at: string, detail: string | null): void {
  const entry: TransactionError = { code, at };
  if (detail !== null && detail !== '') entry.detail = redactDetail(detail);
  tx.errors.push(entry);
}

export function finishTransaction(
  tx: ActivationTransaction,
  status: Exclude<ActivationStatus, 'idle'>,
  at: string,
): void {
  tx.status = status;
  tx.finishedAt = at;
}

/** Stage list so far, for diagnostics and tests. */
export function stageNames(tx: ActivationTransaction): readonly ActivationStage[] {
  return tx.stages.map((stage) => stage.name);
}

export function lastStageOf(tx: ActivationTransaction): TransactionStage | undefined {
  return tx.stages[tx.stages.length - 1];
}

/** Validates a transaction against the strict domain schema; throws on drift. */
export function assertValidTransaction(tx: ActivationTransaction): void {
  StrictActivationTransactionSchema.parse(tx);
}