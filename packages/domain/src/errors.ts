/**
 * Structured domain errors with stable machine codes.
 *
 * Codes are part of the machine contract and must not change once published.
 * User-facing wording is a presentation concern (i18n), so this module never
 * localizes; it only carries a stable code plus a diagnostic detail that must
 * never contain secrets or private paths.
 */
export const DOMAIN_ERROR_CODES = [
  'DOMAIN_PARSE_FAILED',
  'DOMAIN_VERSION_UNSUPPORTED',
  'DOMAIN_UNKNOWN_FIELD',
  'DOMAIN_VALIDATION_FAILED',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainErrorOptions {
  /** Machine-readable detail; must never include tokens or private paths. */
  detail?: string;
  /** Original failure, kept for diagnostics only. */
  cause?: unknown;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly detail?: string;

  constructor(code: DomainErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.detail = options.detail;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}