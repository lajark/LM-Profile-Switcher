/**
 * Ports for the activation transaction (PRD FR-04, M1-005). Every host
 * coupling — LM Studio calls, clocks, timers, the file system — enters through
 * these interfaces, so packages/core stays a pure module exercisable with
 * in-memory fakes in every environment (tests, the CLI, the future sidecar and
 * the desktop WebView).
 */
import type { CompositeProfile, LoadEstimate, ActivationTransaction } from '@lmps/domain';

/** What the host currently has loaded; null fields mean "nothing active". */
export interface ActiveState {
  profileId: string | null;
  modelKey: string | null;
  since: string | null;
}

/**
 * The LM Studio runtime behind one activation. The adapter surfaces every
 * switch-related operation through this single boundary; the state machine
 * never calls LM Studio directly (architecture rule).
 */
export interface ActivationRuntime {
  /** Current active state, used for idempotency and as the rollback target. */
  getActiveState(): Promise<ActiveState>;
  /** Unload the current configuration (exclusive switches only). */
  unload(): Promise<void>;
  /** Restore the configuration that was active before this switch. */
  restore(): Promise<void>;
  /**
   * Load the target profile under the given estimate; resolves with the
   * effective configuration as read back from the host.
   */
  load(profile: CompositeProfile, estimate: LoadEstimate): Promise<Record<string, unknown>>;
  /** Post-load health check (model status / minimal prompt / both). */
  healthCheck(profile: CompositeProfile): Promise<void>;
  /** Optional host diagnostics; the runner redacts whatever reaches the log. */
  collectDiagnostics?(): Promise<Record<string, unknown>>;
  /** Effective configuration for a target profile (idempotency comparison). */
  readEffectiveConfig(profile: CompositeProfile): Promise<Record<string, unknown>>;
}

/** Mutual-exclusion guard for activations, memory- or file-backed. */
export interface ActivationLock {
  /** Acquires the lock; false means another activation holds it. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

/** Resource estimation for a target profile before it is loaded (PRD FR-10). */
export interface EstimatePort {
  estimate(profile: CompositeProfile): Promise<LoadEstimate>;
}

/** Audit sink for the redacted transaction record (M1-005 deliverable). */
export interface TransactionLogSink {
  write(transaction: ActivationTransaction): Promise<void>;
}

/**
 * Injected ambient capabilities: clock, cancellable wait, the default per-stage
 * timeout and transaction ids. `now()` must yield ISO 8601 strings and
 * `createTxId()` unique ids so the runner never touches host RNG or the clock.
 */
export interface RunnerContext {
  now(): string;
  /**
   * Resolves once `ms` elapses. Aborting `signal` rejects with an
   * ACTIVATION_CANCELED ActivationError so cancellation interrupts waits.
   */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  /** Per-stage timeout; a run may override it (CLI --timeout). */
  defaultStageTimeoutMs: number;
  createTxId(): string;
}