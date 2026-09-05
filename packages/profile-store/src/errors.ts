/**
 * Stable machine error codes for the profile store (M1-002, PRD FR-05).
 * Mirrors the domain/newError pattern: narrow exported code list, structured
 * error with optional detail + cause. Messages and details never include file
 * paths — users must not learn about the layout from an error, and logs must
 * not leak it.
 */

export const PROFILE_STORE_ERROR_CODES = [
  'STORE_IO_FAILED',
  'STORE_NOT_FOUND',
  'STORE_ALREADY_EXISTS',
  'STORE_INVALID_ID',
  'STORE_CORRUPTED',
  'STORE_IMPORT_FAILED',
  'STORE_LIMIT_EXCEEDED',
] as const;

export type ProfileStoreErrorCode = (typeof PROFILE_STORE_ERROR_CODES)[number];

export interface ProfileStoreErrorOptions {
  /** Machine-readable, path-free context (e.g. which phase failed). */
  detail?: string;
  cause?: unknown;
}

export class ProfileStoreError extends Error {
  readonly code: ProfileStoreErrorCode;
  readonly detail?: string;
  override readonly cause?: unknown;

  constructor(code: ProfileStoreErrorCode, message: string, options: ProfileStoreErrorOptions = {}) {
    super(message);
    this.name = 'ProfileStoreError';
    this.code = code;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function isProfileStoreError(error: unknown): error is ProfileStoreError {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (PROFILE_STORE_ERROR_CODES as readonly string[]).includes(code);
}