/**
 * Stable error classification across the REST / CLI / SDK / probe adapters
 * (M0-005). `kind` is the stable code the CLI maps to user-level failures
 * (offline → unreachable, 401 → auth, …); `detail` never carries tokens,
 * credentials or private paths.
 */

export const LM_SUBSYSTEMS = ['rest', 'cli', 'sdk', 'probe'] as const;
export type LmSubsystem = (typeof LM_SUBSYSTEMS)[number];

export const LM_ERROR_KINDS = [
  'unreachable',
  'auth',
  'timeout',
  'unsupported',
  'parse',
  'process',
  'health',
  'internal',
] as const;
export type LmErrorKind = (typeof LM_ERROR_KINDS)[number];

export interface LmStudioErrorOptions {
  subsystem: LmSubsystem;
  kind: LmErrorKind;
  /** Stable, redactable context (e.g. the endpoint path — never the token). */
  detail?: string;
  cause?: unknown;
}

export class LmStudioError extends Error {
  readonly subsystem: LmSubsystem;
  readonly kind: LmErrorKind;
  readonly detail: string | undefined;

  constructor(message: string, options: LmStudioErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LmStudioError';
    this.subsystem = options.subsystem;
    this.kind = options.kind;
    this.detail = options.detail;
  }
}

export function isLmStudioError(error: unknown): error is LmStudioError {
  return error instanceof LmStudioError;
}

/**
 * Maps a REST failure to a stable kind. `status === null` means the transport
 * itself failed (connection refused, DNS, aborted socket).
 */
export function classifyHttpFailure(status: number | null): LmErrorKind {
  if (status === null) return 'unreachable';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'unsupported';
  if (status === 408 || status === 429) return 'timeout';
  if (status >= 500) return 'internal';
  return 'parse';
}

/** Short, redacted description of any thrown value (safe for probe notes). */
export function describeError(error: unknown): string {
  if (error instanceof LmStudioError) {
    return `${error.subsystem}:${error.kind}${error.detail === undefined ? '' : ` ${error.detail}`}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}