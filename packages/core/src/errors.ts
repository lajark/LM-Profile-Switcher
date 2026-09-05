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
