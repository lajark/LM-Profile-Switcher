/**
 * Schema versioning shared by every top-level domain contract.
 *
 * Contracts carry a literal `schemaVersion` so storage and the CLI can detect
 * shape drift. Bumping the constant is a breaking change: add a forward
 * migration plus a rollback test in `tests/domain/migrate.test.ts` at the same
 * time. Migration must never silently drop fields.
 */
export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;