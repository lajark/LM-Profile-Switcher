/**
 * Export sanitization (PRD FR-01): exported documents must not carry tokens,
 * secret-looking keys or absolute private paths.
 *
 * Key decision: the sensitive-key scan only applies to keys that are NOT part
 * of the domain contract (collected from the CompositeProfileSchema shapes).
 * Guaranteed domain fields — including ones that happen to contain the word
 * "token", e.g. `typicalInputTokens` or `maxTokens` — are never nulled, while
 * unknown/passthrough keys like `apiKey`, `accessToken` or `secret` are.
 *
 * `sanitizeExport` is pure and deterministic: sensitive keys become null,
 * string values containing absolute home paths become `<private>`; everything
 * else is preserved, so a sanitized export still round-trips.
 */
import { CompositeProfileSchema, stringifyJsonDocument, stringifyYamlDocument } from '@lmps/domain';

const SENSITIVE_KEY_RE = /token|secret|api[-_]?key|password|passwd|authorization|credential/i;

// Windows (C:\Users\<name>\…), macOS/Unix (\Users\<name>\…, /Users/<name>/…,
// /home/<name>/…). Whole values containing such a segment are replaced, which
// covers substrings anywhere (nested paths, notes that mention a path).
const PRIVATE_PATH_RE = /(?:[A-Za-z]:\\Users\\|\\Users\\|\/Users\/|\/home\/)[^"'\s]+/;

/** Keys that are part of the domain contract and thus never secret. */
const CONTRACT_KEYS = collectContractKeys(CompositeProfileSchema);

interface ShapeCarrier {
  shape?: Record<string, ShapeCarrier | unknown>;
}

function collectContractKeys(schema: ShapeCarrier, out = new Set<string>()): Set<string> {
  if (schema.shape) {
    for (const [key, child] of Object.entries(schema.shape)) {
      out.add(key);
      if (isShapeCarrier(child)) collectContractKeys(child, out);
    }
  }
  return out;
}

function isShapeCarrier(value: unknown): value is ShapeCarrier {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { shape?: unknown }).shape !== undefined
  );
}

function isSensitiveKey(key: string): boolean {
  return !CONTRACT_KEYS.has(key) && SENSITIVE_KEY_RE.test(key);
}

export function sanitizeExport(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(sanitizeExport);
  }
  if (typeof value === 'string') {
    return PRIVATE_PATH_RE.test(value) ? '<private>' : value;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? null : sanitizeExport(child);
    }
    return out;
  }
  return value;
}

export function exportSanitizedJson(value: unknown): string {
  return stringifyJsonDocument(sanitizeExport(value));
}

export function exportSanitizedYaml(value: unknown): string {
  return stringifyYamlDocument(sanitizeExport(value));
}