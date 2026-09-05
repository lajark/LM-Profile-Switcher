/**
 * Structured CLI errors with stable machine codes. The message is English-only
 * diagnostic text; user-facing rendering always goes through an i18n key, so a
 * USAGE error may carry its own localized message key plus interpolation values.
 */
import type { ResourceKey } from '@lmps/i18n';

export const CLI_ERROR_CODES = ['USAGE', 'CAPABILITY_UNSUPPORTED', 'INTERNAL'] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

export interface CliErrorParams {
  /** Localized message key; defaults to error.usage (or error.capabilityUnsupported). */
  key?: ResourceKey;
  values?: Record<string, string>;
}

export interface CliErrorOptions {
  /** Machine-readable detail; must never include tokens or private paths. */
  detail?: string;
  params?: CliErrorParams;
  cause?: unknown;
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly detail?: string;
  readonly params?: CliErrorParams;

  constructor(code: CliErrorCode, message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.code = code;
    this.detail = options.detail;
    this.params = options.params;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

/**
 * Builds a "capability not wired" error: the honest default for models/current/
 * snapshot until M1-003/M1-005 wire their ports. Exit 6, machine CAPABILITY_UNSUPPORTED.
 */
export function capabilityUnsupported(field: string): CliError {
  return new CliError('CAPABILITY_UNSUPPORTED', `capability not wired: ${field}`, {
    detail: field,
    params: { values: { field } },
  });
}