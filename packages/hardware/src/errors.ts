/**
 * Structured hardware-probe errors with stable machine codes.
 *
 * Codes are part of the machine contract and must not change once published.
 * User-facing wording is a presentation concern (i18n) handled by the CLI/UI
 * layers, so this module never localizes — it carries a stable code plus a
 * diagnostic detail that must never contain secrets or private paths.
 */
export const HARDWARE_ERROR_CODES = [
  'HARDWARE_PROBE_FAILED',
  'HARDWARE_PROBE_TIMEOUT',
  'HARDWARE_PARSE_ERROR',
  'HARDWARE_RUNNER_ERROR',
] as const;

export type HardwareErrorCode = (typeof HARDWARE_ERROR_CODES)[number];

export interface HardwareErrorOptions {
  /** Machine-readable detail; must never include tokens or private paths. */
  detail?: string;
  /** Original failure, kept for diagnostics only. */
  cause?: unknown;
}

export class HardwareError extends Error {
  readonly code: HardwareErrorCode;
  readonly detail?: string;

  constructor(code: HardwareErrorCode, message: string, options: HardwareErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HardwareError';
    this.code = code;
    this.detail = options.detail;
  }
}

export function isHardwareError(error: unknown): error is HardwareError {
  return error instanceof HardwareError;
}