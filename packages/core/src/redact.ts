/**
 * Redaction for the activation transaction log (M1-005 deliverable). Every
 * record that can reach the log sink or CLI output passes through these pure
 * functions: secret-looking keys are nulled to `[redacted]` and absolute private
 * path segments (`C:\Users\…`, `/home/…`, `/Users/…`) become `<private>`.
 * Tokens, real profile content and private paths must never escape to disk or
 * stdout; this is the closing gate, not the only one.
 */
import type { ActivationTransaction } from '@lmps/domain';

/** Matches secret-bearing key names (case-insensitive). */
const SECRET_KEY_RE = /\b(password|passwd|token|secret|authorization|auth|credential|bearer)\b|api[-_]?key/i;

/** Absolute private path segment, Unix- or Windows-style. */
const PRIVATE_PATH_RE = /(?:[A-Za-z]:[\\/]|\/(?:home|Users)\/)[^\s;,})\]"']*/g;

const REDACTED_VALUE = '[redacted]';
const PRIVATE_PATH = '<private>';

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

export function redactDetail(detail: string): string {
  return detail.replace(PRIVATE_PATH_RE, PRIVATE_PATH);
}

/**
 * Deep redaction for arbitrary config/diagnostic records: secret-valued keys
 * become `[redacted]`, private-path strings become `<private>`, everything else
 * is preserved intact. Primitive fields (profile names, model keys, numbers)
 * pass through untouched.
 */
export function redactEffectiveConfig(value: unknown): unknown {
  if (typeof value === 'string') {
    return PRIVATE_PATH_RE.test(value) ? PRIVATE_PATH : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactEffectiveConfig(item));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? REDACTED_VALUE : redactEffectiveConfig(entry);
    }
    return out;
  }
  return value;
}

/** Returns a new redacted transaction; the input object is never mutated. */
export function redactTransaction(tx: ActivationTransaction): ActivationTransaction {
  const copy = structuredCloneSafe(tx);
  for (const error of copy.errors) {
    if (error.detail !== undefined && error.detail !== null) {
      error.detail = redactDetail(error.detail);
    }
  }
  return copy;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}