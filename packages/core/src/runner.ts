/**
 * The activation state machine (PRD FR-04, M1-005): validating → estimating →
 * locking → unloading-conflicts → loading → health-checking → active, with the
 * recovery path collecting-diagnostics → cleaning-failed-instance →
 * restoring-previous-profile. Every stage is a first-class transition that can
 * fail, time out or be cancelled, and the outcome is classified by the SPEC:
 * active → 0, canceled → 2, failed-but-recovered → 3, failed → 5. User-level
 * preflights (invalid document, lock busy) throw an ActivationError instead of
 * producing a failed transaction. The runner is pure: all host capability
 * arrives through the injected ports and context.
 */
import {
  StrictCompositeProfileSchema,
  type ActivationTransaction,
  type CompositeProfile,
} from '@lmps/domain';

import { ActivationError, isActivationError } from './errors.js';
import type {
  ActivationLock,
  ActivationRuntime,
  ActiveState,
  EstimatePort,
  RunnerContext,
  TransactionLogSink,
} from './ports.js';
import {
  beginTransaction,
  closeStage,
  finishTransaction,
  openStage,
  previousProfileIdOf,
  recordError,
  resolvePolicy,
  type ActivationStage,
  type ActivationPolicy,
} from './transaction.js';
import { redactDetail, redactTransaction } from './redact.js';

export interface ActivationRunnerPorts {
  runtime: ActivationRuntime;
  lock: ActivationLock;
  estimate: EstimatePort;
  log: TransactionLogSink;
}

export interface ActivationRunOptions {
  /** Cooperative cancellation; aborts waits and stage boundaries. */
  signal?: AbortSignal;
  /** Per-stage timeout in ms; 0 disables the stage timeout entirely. */
  stageTimeoutMs?: number;
}

export type OutcomeStatus = 'active' | 'canceled' | 'failed-but-recovered' | 'failed';

export interface ActivationOutcome {
  status: OutcomeStatus;
  /** True when the run short-circuited because the target was already active. */
  alreadyActive: boolean;
}

export interface ActivationRunResult {
  outcome: ActivationOutcome;
  /** The redacted transaction as flushed to the log sink. */
  transaction: ActivationTransaction;
}

export interface ActivationRunner {
  run(profile: CompositeProfile, options?: ActivationRunOptions): Promise<ActivationRunResult>;
}

type RunConfig = Required<Pick<ActivationRunOptions, 'stageTimeoutMs'>> & {
  signal?: AbortSignal;
};

interface RunStageDone<T> {
  kind: 'done';
  value: T;
}

interface RunStageFailure {
  kind: 'failed';
  error: unknown;
}

interface RunStageCode {
  kind: 'timeout' | 'canceled';
}

type RunStageResult<T> = RunStageDone<T> | RunStageFailure | RunStageCode;

export function createActivationRunner(ctx: RunnerContext, ports: ActivationRunnerPorts): ActivationRunner {
  return { run: (profile, options = {}) => run(ctx, ports, profile, options) };
}

async function run(
  ctx: RunnerContext,
  ports: ActivationRunnerPorts,
  profile: CompositeProfile,
  options: ActivationRunOptions,
): Promise<ActivationRunResult> {
  const runConfig: RunConfig = {
    stageTimeoutMs: options.stageTimeoutMs ?? ctx.defaultStageTimeoutMs,
    signal: options.signal,
  };

  // validating — invalid documents are a user-level preflight (exit 4), never a
  // failed transaction: nothing was loaded, so there is nothing to roll back.
  const parsed = StrictCompositeProfileSchema.safeParse(profile);
  if (!parsed.success) {
    throw new ActivationError('ACTIVATION_PREFLIGHT', 'profile document failed validation', {
      stage: 'validating',
      detail: 'profile document failed validation',
      cause: parsed.error,
    });
  }

  const policy = resolvePolicy(profile);
  const tx = beginTransaction({
    id: ctx.createTxId(),
    targetProfileId: profile.id,
    previousProfileId: null,
    policy,
    now: ctx.now(),
  });

  openStage(tx, 'validating', ctx.now());

  let active: ActiveState | null;
  try {
    active = await ports.runtime.getActiveState();
  } catch (error) {
    throw new ActivationError('ACTIVATION_PREFLIGHT', 'failed to read the active state', {
      stage: 'validating',
      detail: 'failed to read the active state',
      cause: error,
    });
  }
  tx.previousProfileId = previousProfileIdOf(active);

  // Idempotency: same target already active — confirm the effective config and
  // close the transaction as active without touching the host again.
  if (active.profileId === profile.id) {
    const readback = await readEffectiveBestEffort(ports.runtime, profile);
    if (readback !== null && effectiveMatches(profile, readback)) {
      closeStage(tx, 'validating', 'completed', ctx.now());
      finishTransaction(tx, 'active', ctx.now());
      await flushLog(ports.log, tx);
      return { outcome: { status: 'active', alreadyActive: true }, transaction: tx };
    }
  }
  closeStage(tx, 'validating', 'completed', ctx.now());

  const acquired = await acquireLock(ports.lock);
  if (!acquired) {
    throw new ActivationError('ACTIVATION_LOCK_BUSY', 'another activation is in progress', {
      stage: 'locking',
      detail: 'another activation is in progress',
    });
  }
  try {
    return await runLocked(ctx, ports, tx, profile, policy, runConfig);
  } finally {
    await safeReleaseLock(ports.lock);
  }
}

async function runLocked(
  ctx: RunnerContext,
  ports: ActivationRunnerPorts,
  tx: ActivationTransaction,
  profile: CompositeProfile,
  policy: ActivationPolicy,
  runConfig: RunConfig,
): Promise<ActivationRunResult> {
  const estimateStep = await runStage(ctx, ports, tx, 'estimating', runConfig, () =>
    ports.estimate.estimate(profile),
  );
  if (estimateStep.kind !== 'done') {
    return recoverFromFailure(ctx, ports, tx, policy, estimateStep.kind === 'canceled');
  }

  // exclusive switches unload the previous configuration first; coexist leaves it.
  const unloadStep =
    policy.mode === 'exclusive'
      ? await runStage(ctx, ports, tx, 'unloading-conflicts', runConfig, () => ports.runtime.unload())
      : { kind: 'done' as const, value: undefined };
  if (unloadStep.kind !== 'done') {
    return recoverFromFailure(ctx, ports, tx, policy, unloadStep.kind === 'canceled');
  }

  const loadStep = await runStage(ctx, ports, tx, 'loading', runConfig, () =>
    ports.runtime.load(profile, estimateStep.value),
  );
  if (loadStep.kind !== 'done') {
    return recoverFromFailure(ctx, ports, tx, policy, loadStep.kind === 'canceled');
  }

  const healthStep = await runStage(ctx, ports, tx, 'health-checking', runConfig, () =>
    ports.runtime.healthCheck(profile),
  );
  if (healthStep.kind !== 'done') {
    return recoverFromFailure(ctx, ports, tx, policy, healthStep.kind === 'canceled');
  }

  finishTransaction(tx, 'active', ctx.now());
  await flushLog(ports.log, tx);
  return { outcome: { status: 'active', alreadyActive: false }, transaction: tx };
}

/**
 * Failure path: collect (redacted) diagnostics, best-effort clean the failed
 * instance, then restore the previous profile unless rollback is disabled.
 * Restoration runs with cancellation suppressed so Ctrl+C cannot cut recovery.
 */
async function recoverFromFailure(
  ctx: RunnerContext,
  ports: ActivationRunnerPorts,
  tx: ActivationTransaction,
  policy: ActivationPolicy,
  wasCanceled: boolean,
): Promise<ActivationRunResult> {
  await runBestEffortStage(ctx, ports, tx, 'collecting-diagnostics', () =>
    Promise.resolve(ports.runtime.collectDiagnostics?.()),
  );
  await runBestEffortStage(ctx, ports, tx, 'cleaning-failed-instance', () => ports.runtime.unload());

  if (policy.rollback === 'disabled') {
    closeStage(tx, 'restoring-previous-profile', 'failed', ctx.now());
    recordError(tx, 'ACTIVATION_ROLLBACK_FAILED', ctx.now(), 'rollback disabled for this profile');
    finishTransaction(tx, wasCanceled ? 'canceled' : 'failed', ctx.now());
    await flushLog(ports.log, tx);
    return { outcome: { status: wasCanceled ? 'canceled' : 'failed', alreadyActive: false }, transaction: tx };
  }

  const restored = await runStrictStage(ctx, ports, tx, 'restoring-previous-profile', () =>
    ports.runtime.restore(),
  );
  // A cancellation still runs the best-effort clean-up, but the transaction keeps
  // its canceled identity (exit 2) regardless of whether recovery itself failed.
  const status: OutcomeStatus = wasCanceled ? 'canceled' : restored ? 'failed-but-recovered' : 'failed';
  finishTransaction(tx, status, ctx.now());
  await flushLog(ports.log, tx);
  return { outcome: { status, alreadyActive: false }, transaction: tx };
}

/**
 * One allocated stage: runs the action against the per-stage timeout and the
 * injectable cancellation signal. Timeouts and step failures are recorded into
 * the transaction with stable codes and closed stage outcomes.
 */
async function runStage<T>(
  ctx: RunnerContext,
  ports: ActivationRunnerPorts,
  tx: ActivationTransaction,
  stage: ActivationStage,
  runConfig: RunConfig,
  action: () => Promise<T>,
): Promise<RunStageResult<T>> {
  openStage(tx, stage, ctx.now());
  const result = await runWithGuards<T>(action, runConfig, ctx);
  if (result.kind === 'done') {
    closeStage(tx, stage, 'completed', ctx.now());
    return result;
  }
  closeStage(tx, stage, result.kind, ctx.now());
  recordError(tx, errorCodeForResult(result), ctx.now(), errorDetailFor(result));
  return result;
}

/** Best-effort recovery stages never fail the transaction; errors are recorded. */
async function runBestEffortStage(
  ctx: RunnerContext,
  ports: ActivationRunnerPorts,
  tx: ActivationTransaction,
  stage: ActivationStage,
  action: () => Promise<unknown>,
): Promise<void> {
  openStage(tx, stage, ctx.now());
  const result = await runWithGuards<unknown>(action, runConfigRecovery(ctx), ctx);
  if (result.kind === 'done') {
    closeStage(tx, stage, 'completed', ctx.now());
    return;
  }
  closeStage(tx, stage, result.kind, ctx.now());
  recordError(tx, errorCodeForResult(result), ctx.now(), errorDetailFor(result));
}

/** Strict recovery stage: its outcome decides recovered (status 3) vs failed (5). */
async function runStrictStage(
  ctx: RunnerContext,
  ports: ActivationRunnerPorts,
  tx: ActivationTransaction,
  stage: ActivationStage,
  action: () => Promise<unknown>,
): Promise<boolean> {
  openStage(tx, stage, ctx.now());
  const result = await runWithGuards<unknown>(action, runConfigRecovery(ctx), ctx);
  if (result.kind === 'done') {
    closeStage(tx, stage, 'completed', ctx.now());
    return true;
  }
  closeStage(tx, stage, result.kind, ctx.now());
  recordError(tx, 'ACTIVATION_ROLLBACK_FAILED', ctx.now(), errorDetailFor(result));
  return false;
}

/**
 * Runs `action` under the stage timeout and cancellation signal. The timeout is
 * implemented with the injected `ctx.wait` so the pure module never touches
 * host timers. A cancelled action (signal abort) surfaces as the canceled
 * outcome; a timeout as the timeout outcome; anything else as failed.
 */
async function runWithGuards<T>(action: () => Promise<T>, runConfig: RunConfig, ctx: RunnerContext): Promise<RunStageResult<T>> {
  if (runConfig.signal?.aborted === true) return { kind: 'canceled' };
  try {
    const timeoutMs = runConfig.stageTimeoutMs;
    if (timeoutMs <= 0) {
      // Stage timeout disabled: still honour an abort at the boundary; a
      // long-running action is cancelled cooperatively by its own port.
      const value = await action();
      return { kind: 'done', value };
    }
    const wait = ctx
      .wait(timeoutMs, runConfig.signal)
      .then(
        () => ({ kind: 'timeout' }) as const,
        (error: unknown) => {
          throw error;
        },
      );
    const result = await Promise.race([action().then((value) => ({ kind: 'done' as const, value })), wait]);
    return result;
  } catch (error) {
    if (isActivationError(error) && error.code === 'ACTIVATION_CANCELED') {
      return { kind: 'canceled' };
    }
    return { kind: 'failed', error };
  }
}

function runConfigRecovery(ctx: RunnerContext): RunConfig {
  // Recovery stages are bounded by the context default timeout (a failed
  // restore must not hang forever) but drop the caller's signal so a
  // cancellation cannot interrupt the clean-up/restore sequence.
  return { stageTimeoutMs: ctx.defaultStageTimeoutMs, signal: undefined };
}

function errorCodeForResult(result: RunStageFailure | RunStageCode): string {
  if (result.kind === 'timeout') return 'ACTIVATION_TIMEOUT';
  if (result.kind === 'canceled') return 'ACTIVATION_CANCELED';
  return 'ACTIVATION_STEP_FAILED';
}

/** Doom-scroll safe: only shallow, redacted detail ever reaches the record. */
function errorDetailFor(result: RunStageFailure | RunStageCode): string | null {
  if (result.kind === 'failed' && result.error instanceof Error && result.error.message !== '') {
    return redactDetail(result.error.message);
  }
  return null;
}

async function readEffectiveBestEffort(
  runtime: ActivationRuntime,
  profile: CompositeProfile,
): Promise<Record<string, unknown> | null> {
  try {
    return await runtime.readEffectiveConfig(profile);
  } catch {
    return null;
  }
}

function effectiveMatches(profile: CompositeProfile, readback: Record<string, unknown>): boolean {
  const runtime = readback['runtime'];
  if (typeof runtime !== 'object' || runtime === null) return false;
  const actual = runtime as Record<string, unknown>;
  for (const [key, value] of Object.entries(profile.runtime)) {
    if (value === undefined || value === null) continue;
    if (!(key in actual) || actual[key] !== value) return false;
  }
  return true;
}

async function acquireLock(lock: ActivationLock): Promise<boolean> {
  try {
    return await lock.acquire();
  } catch (error) {
    throw new ActivationError('ACTIVATION_PREFLIGHT', 'lock acquisition failed', {
      stage: 'locking',
      detail: 'lock acquisition failed',
      cause: error,
    });
  }
}

async function safeReleaseLock(lock: ActivationLock): Promise<void> {
  try {
    await lock.release();
  } catch {
    // A failed release leaves a lease that the next acquire treats as residue.
  }
}

async function flushLog(log: TransactionLogSink, tx: ActivationTransaction): Promise<void> {
  // The redacted copy is the audited record; the in-memory tx keeps its raw
  // (already clean) fields for the runner's own return value.
  await log.write(redactTransaction(tx));
}
