/**
 * Stable process exit codes (CLI_SPEC). 0/4/6/10 serve the general pipeline;
 * activation results map 2 (cancelled) / 3 (failed but recovered) / 5 (failed
 * with rollback failure) through `exitCodeForActivation` (M1-005). Preflight
 * problems (invalid document, lock busy) are user-level 4, mirroring PRD.
 */
import { isActivationError, type OutcomeStatus } from '@lmps/core';
import { isDomainError } from '@lmps/domain';
import { LocaleResourceError } from '@lmps/i18n';
import { isProfileStoreError } from '@lmps/profile-store';

import { isCliError } from './errors.js';

export const EXIT = Object.freeze({
  SUCCESS: 0,
  USER_CANCELLED: 2,
  ACTIVATION_RECOVERED: 3,
  VALIDATION_OR_PREFLIGHT: 4,
  ACTIVATION_FAILED: 5,
  CAPABILITY_UNSUPPORTED: 6,
  INTERNAL: 10,
} as const);

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** User-input-level store failures: the request is wrong, not the environment. */
const VALIDATION_STORE_CODES = new Set([
  'STORE_NOT_FOUND',
  'STORE_ALREADY_EXISTS',
  'STORE_INVALID_ID',
  'STORE_IMPORT_FAILED',
  'STORE_LIMIT_EXCEEDED',
]);

/** Maps the outcome of a finished activation transaction to its exit code. */
export function exitCodeForActivation(status: OutcomeStatus): ExitCode {
  switch (status) {
    case 'active':
      return EXIT.SUCCESS;
    case 'canceled':
      return EXIT.USER_CANCELLED;
    case 'failed-but-recovered':
      return EXIT.ACTIVATION_RECOVERED;
    case 'failed':
      return EXIT.ACTIVATION_FAILED;
  }
}

export function exitCodeForError(error: unknown): ExitCode {
  if (isCliError(error)) {
    if (error.code === 'CAPABILITY_UNSUPPORTED') return EXIT.CAPABILITY_UNSUPPORTED;
    if (error.code === 'USAGE') return EXIT.VALIDATION_OR_PREFLIGHT;
    return EXIT.INTERNAL;
  }
  if (isActivationError(error)) {
    switch (error.code) {
      case 'ACTIVATION_LOCK_BUSY':
      case 'ACTIVATION_PREFLIGHT':
        return EXIT.VALIDATION_OR_PREFLIGHT;
      case 'ACTIVATION_CANCELED':
        return EXIT.USER_CANCELLED;
      default:
        // Step/timeout/rollback failures surface through the transaction status
        // (2/3/5) via exitCodeForActivation; a thrown one is a wiring bug.
        return EXIT.INTERNAL;
    }
  }
  if (isProfileStoreError(error)) {
    return VALIDATION_STORE_CODES.has(error.code) ? EXIT.VALIDATION_OR_PREFLIGHT : EXIT.INTERNAL;
  }
  if (isDomainError(error)) return EXIT.VALIDATION_OR_PREFLIGHT;
  if (error instanceof LocaleResourceError) return EXIT.INTERNAL;
  return EXIT.INTERNAL;
}