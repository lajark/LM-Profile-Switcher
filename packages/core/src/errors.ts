/**
 * Stable machine codes for the activation transaction (M1-005). Every outcome
 * the CLI must map to a distinct exit code is an ActivationError: preflight and
 * lock-busy failures are user-level (exit 4); CANCELED answers Ctrl+C (exit 2);
 * step/timeout/rollback failures surface through the transaction status
 * (failed-but-recovered → 3, failed → 5) instead of being rethrown.
 */
import type { ActivationStage } from './transaction.js';

export const ACTIVATION_ERROR_CODES = [
  'ACTIVATION_PREFLIGHT',
  'ACTIVATION_LOCK_BUSY',
  'ACTIVATION_STEP_FAILED',
  'ACTIVATION_TIMEOUT',
  'ACTIVATION_CANCELED',
  'ACTIVATION_ROLLBACK_FAILED',
] as const;

export type ActivationErrorCode = (typeof ACTIVATION_ERROR_CODES)[number];

export interface ActivationErrorOptions {
  /** The stage that failed, when the error is stage-scoped. */
  stage?: ActivationStage;
  /** Diagnostic text; must never carry tokens or private paths. */
  detail?: string;
  cause?: unknown;
}

export class ActivationError extends Error {
  readonly code: ActivationErrorCode;
  readonly stage?: ActivationStage;
  readonly detail?: string;

  constructor(code: ActivationErrorCode, message: string, options: ActivationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ActivationError';
    this.code = code;
    this.stage = options.stage;
    this.detail = options.detail;
  }
}

export function isActivationError(error: unknown): error is ActivationError {
  return error instanceof ActivationError;
}

/**
 * Stable machine codes for benchmark runs (M2-003). User-level guard failures
 * (battery, lock busy, empty suite) throw so the CLI exits 4; measurement
 * failures (timeout/OOM/crash) become a `status:'failed'` result with the
 * matching errorCode instead — the audit record is still produced.
 */
export const BENCHMARK_ERROR_CODES = [
  'BENCHMARK_BATTERY_GUARD',
  'BENCHMARK_LOCK_BUSY',
  'BENCHMARK_PREFLIGHT',
  'BENCHMARK_TIMEOUT',
  'BENCHMARK_OOM',
  'BENCHMARK_CRASH',
  'BENCHMARK_CANCELED',
] as const;

export type BenchmarkErrorCode = (typeof BENCHMARK_ERROR_CODES)[number];

export interface BenchmarkErrorOptions {
  /** Diagnostic text; must never carry tokens or private paths. */
  detail?: string;
  cause?: unknown;
}

export class BenchmarkError extends Error {
  readonly code: BenchmarkErrorCode;
  readonly detail?: string;

  constructor(code: BenchmarkErrorCode, message: string, options: BenchmarkErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BenchmarkError';
    this.code = code;
    this.detail = options.detail;
  }
}

export function isBenchmarkError(error: unknown): error is BenchmarkError {
  return error instanceof BenchmarkError;
}
