/**
 * Schema versioning shared by every top-level domain contract.
 *
 * Contracts carry a literal `schemaVersion` so storage and the CLI can detect
 * shape drift. Bumping the constant is a breaking change: add a forward
 * migration plus a rollback test in `tests/domain/migrate.test.ts` at the same
 * time. Migration must never silently drop fields.
 *
 * v2 (2026-09-05): `VolumeInfo` gains `driveType`/`bus`/`external`/`model` so
 * the hardware probe can tell built-in and external (removable / USB) volumes
 * apart. Profiles themselves are bump-for-bump: a v1 profile forwards by
 * stamping the new version; software-generated records (transactions, hardware
 * probe output) now carry the same constant instead of a hardcoded literal.
 */
export const SCHEMA_VERSION = 2 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;