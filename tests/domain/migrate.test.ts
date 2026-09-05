// Versioned migration (FR-05): the v1 sample shape forwards into the domain
// contract, future versions are rejected, and every migration is a pure
// function — the source is never mutated, so a failed migration rolls back to
// the untouched original.
import { describe, expect, it } from 'vitest';
import {
  CompositeProfileSchema,
  DomainError,
  migrateProfile,
  migrateV1Profile,
  toSeparateProfiles,
} from '@lmps/domain';
import { v1SampleComposite } from './fixtures.js';

describe('migrateV1Profile', () => {
  it('migrates a v1 sample shape into the domain contract and records versions', () => {
    const record = migrateV1Profile(v1SampleComposite);
    expect(record.fromVersion).toBe(1);
    expect(record.toVersion).toBe(1);
    expect(record.profile).toEqual(v1SampleComposite);
    expect(record.profile.schemaVersion).toBe(1);
  });

  it('keeps unknown fields when migrating (default preserve)', () => {
    const extended = { ...v1SampleComposite, vendorExtension: { whatever: 'kept' } };
    const record = migrateV1Profile(extended);
    expect(record.profile.vendorExtension).toEqual({ whatever: 'kept' });
  });

  it('rejects a strict migration of an object with unknown fields', () => {
    const extended = { ...v1SampleComposite, vendorExtension: true };
    try {
      migrateV1Profile(extended, { strict: true });
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_UNKNOWN_FIELD');
    }
  });

  it('fails without touching the source object (rollback = unchanged original)', () => {
    const future = { ...v1SampleComposite, schemaVersion: 2 };
    const snapshot = JSON.stringify(future);
    try {
      migrateV1Profile(future);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_VERSION_UNSUPPORTED');
    }
    // The input is left byte-for-byte identical after a failed migration.
    expect(JSON.stringify(future)).toBe(snapshot);
  });

  it('rejects malformed sources as parse errors', () => {
    for (const bad of [null, 'text', 42, [], { noVersion: true }]) {
      try {
        migrateV1Profile(bad);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as DomainError).code).toBe('DOMAIN_PARSE_FAILED');
      }
    }
  });
});

describe('migrateProfile dispatch', () => {
  it('routes v1 documents to the v1 migration', () => {
    const record = migrateProfile(v1SampleComposite);
    expect(record.fromVersion).toBe(1);
    expect(record.profile).toEqual(v1SampleComposite);
  });

  it('rejects documents without a supported migration path', () => {
    try {
      migrateProfile({ ...v1SampleComposite, schemaVersion: 99 });
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_VERSION_UNSUPPORTED');
      expect(String((error as DomainError).message)).toMatch(/no migration path/);
    }
  });
});

describe('toSeparateProfiles (PRD §6 separation)', () => {
  it('splits a composite into independently valid contracts', () => {
    const separated = toSeparateProfiles(v1SampleComposite);
    expect(separated.model).toEqual(v1SampleComposite.model);
    expect(separated.task).toEqual(v1SampleComposite.task);
    expect(separated.runtime).toEqual(v1SampleComposite.runtime);
    expect(separated.generation).toEqual(v1SampleComposite.generation);
    expect(separated.behavior).toEqual(v1SampleComposite.behavior);
    // Each slice must satisfy its own contract (independently testable).
    expect(CompositeProfileSchema.shape.runtime.safeParse(separated.runtime).success).toBe(true);
    expect(CompositeProfileSchema.shape.generation.safeParse(separated.generation).success).toBe(true);
    expect(CompositeProfileSchema.shape.behavior.safeParse(separated.behavior).success).toBe(true);
  });

  it('keeps composite-only fields out of the slices', () => {
    const separated = toSeparateProfiles(v1SampleComposite);
    expect(separated.model).not.toHaveProperty('displayName');
    expect(separated.model).not.toHaveProperty('schemaVersion');
    expect(separated.runtime).not.toHaveProperty('schemaVersion');
    expect(separated.behavior.mode).toBe('exclusive');
  });
});