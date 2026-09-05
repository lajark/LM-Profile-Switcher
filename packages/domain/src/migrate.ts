/**
 * Versioned, testable, reversible migrations (PRD FR-05).
 *
 * `migrateProfile` forwards a stored document into the current contract shape.
 * Every migration is a pure function: on failure the source object is left
 * untouched (rollback = keep the original + its backup), and unsupported
 * future versions are rejected instead of being silently reshaped.
 */
import { z } from 'zod';

import { DomainError } from './errors.js';
import {
  BehaviorProfileSchema,
  CompositeProfileSchema,
  GenerationProfileSchema,
  ModelProfileSchema,
  RuntimeProfileSchema,
  StrictCompositeProfileSchema,
  TaskProfileSchema,
  type CompositeProfile,
} from './profile.js';
import { zodErrorToDomainError } from './serialize.js';
import { SCHEMA_VERSION } from './version.js';

export interface MigrationRecord {
  fromVersion: number;
  toVersion: number;
  profile: CompositeProfile;
}

/** Reads a numeric `schemaVersion` from a document, raising on malformed input. */
function readVersion(value: unknown, context: string): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('DOMAIN_PARSE_FAILED', `${context}: expected a profile object`);
  }
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number') {
    throw new DomainError('DOMAIN_PARSE_FAILED', `${context}: missing numeric schemaVersion`);
  }
  return version;
}

/**
 * Forwards a v1-shaped composite document (as published in
 * `schemas/profile.schema.json`) into the v2 contract. v1→v2 is a version
 * stamp for composite profiles (the v2 shape change lives in
 * `VolumeInfo`, part of `HardwareProfile` documents that are never migrated —
 * they are produced fresh by each probe). The migration deep-copies the
 * source, stamps `schemaVersion` 2, then validates the copy; on failure the
 * source object is left byte-for-byte untouched, so a caller can roll back to
 * the original + its backup. Unknown fields follow the caller's policy option
 * (preserve by default, reject in strict mode).
 */
export function migrateV1Profile(source: unknown, options: { strict?: boolean } = {}): MigrationRecord {
  const fromVersion = readVersion(source, 'migrateV1Profile');
  if (fromVersion !== 1) {
    throw new DomainError(
      'DOMAIN_VERSION_UNSUPPORTED',
      `migrateV1Profile expects schemaVersion 1, received ${fromVersion}`,
    );
  }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new DomainError('DOMAIN_PARSE_FAILED', 'migrateV1Profile: expected a profile object');
  }
  // Deep copy first so a failed validation can never leak mutated fields back
  // into the caller's document (rollback = unchanged original).
  const stamped = JSON.parse(JSON.stringify({ ...(source as Record<string, unknown>), schemaVersion: SCHEMA_VERSION }));
  const schema = options.strict ? StrictCompositeProfileSchema : CompositeProfileSchema;
  const result = schema.safeParse(stamped);
  if (!result.success) {
    throw zodErrorToDomainError(result.error);
  }
  return { fromVersion, toVersion: SCHEMA_VERSION, profile: result.data };
}

/**
 * Validates a v2 document (the current shape). Records the version transition
 * and never mutates the source. Unknown fields follow the caller's policy
 * option (preserve by default, reject in strict mode).
 */
export function migrateV2Profile(source: unknown, options: { strict?: boolean } = {}): MigrationRecord {
  const fromVersion = readVersion(source, 'migrateV2Profile');
  if (fromVersion !== 2) {
    throw new DomainError(
      'DOMAIN_VERSION_UNSUPPORTED',
      `migrateV2Profile expects schemaVersion 2, received ${fromVersion}`,
    );
  }
  const schema = options.strict ? StrictCompositeProfileSchema : CompositeProfileSchema;
  const result = schema.safeParse(source);
  if (!result.success) {
    throw zodErrorToDomainError(result.error);
  }
  return { fromVersion, toVersion: SCHEMA_VERSION, profile: result.data };
}

/** Dispatches a stored document to the migration for its schemaVersion. */
export function migrateProfile(source: unknown, options: { strict?: boolean } = {}): MigrationRecord {
  const fromVersion = readVersion(source, 'migrateProfile');
  switch (fromVersion) {
    case 1:
      return migrateV1Profile(source, options);
    case 2:
      return migrateV2Profile(source, options);
    default:
      throw new DomainError(
        'DOMAIN_VERSION_UNSUPPORTED',
        `no migration path for schemaVersion ${fromVersion}; supported: 1, 2`,
      );
  }
}

/**
 * Splits a composite into the independent model/task/runtime/generation/
 * behavior contracts (PRD §6). Re-validates each slice through its own schema
 * so the separation is independently testable; returns fresh plain objects.
 */
export function toSeparateProfiles(composite: CompositeProfile): {
  model: z.infer<typeof ModelProfileSchema>;
  task: z.infer<typeof TaskProfileSchema>;
  runtime: z.infer<typeof RuntimeProfileSchema>;
  generation: z.infer<typeof GenerationProfileSchema>;
  behavior: z.infer<typeof BehaviorProfileSchema>;
} {
  return {
    model: ModelProfileSchema.parse(composite.model),
    task: TaskProfileSchema.parse(composite.task),
    runtime: RuntimeProfileSchema.parse(composite.runtime),
    generation: GenerationProfileSchema.parse(composite.generation),
    behavior: BehaviorProfileSchema.parse(composite.behavior),
  };
}