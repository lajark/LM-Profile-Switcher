/**
 * JSON/YAML serialization with a documented unknown-field policy.
 *
 * Policy: unknown fields are PRESERVED by default (schemas are built with
 * `.passthrough()`) so forward-compatible documents round-trip unchanged; the
 * explicit `strict` option rejects unknown fields and is used when importing
 * untrusted documents. Documents with an unsupported `schemaVersion` are
 * rejected with `DOMAIN_VERSION_UNSUPPORTED` — never silently reshaped.
 *
 * This module is platform-independent: parsing and stringifying touch plain
 * data only, so it also runs in the WebView.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { DomainError, type DomainErrorCode } from './errors.js';
import { SCHEMA_VERSION } from './version.js';

export interface ParseOptions {
  /** Reject unknown fields instead of preserving them. Default: false. */
  strict?: boolean;
}

/** Rejects documents carrying a schemaVersion newer/older than supported. */
export function assertSupportedVersion(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) {
    return;
  }
  if (typeof version !== 'number' || version !== SCHEMA_VERSION) {
    throw new DomainError(
      'DOMAIN_VERSION_UNSUPPORTED',
      `unsupported schemaVersion ${JSON.stringify(version)}; expected ${SCHEMA_VERSION}`,
    );
  }
}

/** Converts a Zod validation failure into a structured {@link DomainError}. */
export function zodErrorToDomainError(error: unknown): DomainError {
  if (error instanceof z.ZodError) {
    const onlyUnknownKeys = error.issues.every((issue) => issue.code === 'unrecognized_keys');
    const code: DomainErrorCode = onlyUnknownKeys ? 'DOMAIN_UNKNOWN_FIELD' : 'DOMAIN_VALIDATION_FAILED';
    const first = error.issues[0];
    return new DomainError(code, 'document failed schema validation', {
      detail: first ? `${first.path.join('.') || '<root>'}: ${first.message}` : 'unknown validation issue',
      cause: error,
    });
  }
  return new DomainError('DOMAIN_VALIDATION_FAILED', 'document failed schema validation', { cause: error });
}

/** A schema root that supports the `.strict()` modifier (all here are objects). */
interface Strictable {
  strict(): z.ZodType<unknown>;
}

/** Applies strict mode when requested; preserved mode is the schemas' default. */
function effectiveSchema<T>(schema: z.ZodType<T>, options: ParseOptions): z.ZodType<T> {
  if (!options.strict) {
    return schema;
  }
  if (typeof (schema as unknown as Strictable).strict !== 'function') {
    throw new DomainError(
      'DOMAIN_VALIDATION_FAILED',
      'schema does not support strict mode',
    );
  }
  return (schema as unknown as Strictable).strict() as z.ZodType<T>;
}

/**
 * Validates an already-deserialized value against a contract. Public so other
 * consumers (store, migrate) share the same version/unknown-field policy.
 */
export function parseDocumentValue<T>(raw: unknown, schema: z.ZodType<T>, options: ParseOptions = {}): T {
  assertSupportedVersion(raw);
  const result = effectiveSchema(schema, options).safeParse(raw);
  if (!result.success) {
    throw zodErrorToDomainError(result.error);
  }
  return result.data;
}

/**
 * Deserializes JSON text to a plain value without the version gate or schema
 * validation. Used by importers that must forward older documents through
 * `migrateProfile` before validating against the current contract.
 */
export function deserializeJsonDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new DomainError('DOMAIN_PARSE_FAILED', 'invalid JSON document', {
      detail: 'JSON.parse failed before schema validation',
      cause,
    });
  }
}

/** YAML counterpart of {@link deserializeJsonDocument}. */
export function deserializeYamlDocument(text: string): unknown {
  try {
    return parseYaml(text);
  } catch (cause) {
    throw new DomainError('DOMAIN_PARSE_FAILED', 'invalid YAML document', { cause });
  }
}

/** Parses a JSON document, then validates it against a contract. */
export function parseJsonDocument<T>(text: string, schema: z.ZodType<T>, options: ParseOptions = {}): T {
  return parseDocumentValue(deserializeJsonDocument(text), schema, options);
}

/** Parses a YAML document, then validates it against a contract. */
export function parseYamlDocument<T>(text: string, schema: z.ZodType<T>, options: ParseOptions = {}): T {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    throw new DomainError('DOMAIN_PARSE_FAILED', 'invalid YAML document', { cause });
  }
  return parseDocumentValue(raw, schema, options);
}

/** Pretty-prints a domain document as JSON. */
export function stringifyJsonDocument(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Pretty-prints a domain document as YAML. */
export function stringifyYamlDocument(value: unknown): string {
  return stringifyYaml(value, { indent: 2 });
}