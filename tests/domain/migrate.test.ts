// Versioned migration (FR-05): the published v1 baseline forwards into the v2
// contract (deep copy + schemaVersion stamp), the current shape passes through,
// future versions are rejected, and every migration is a pure function — the
// source is never mutated, so a failed migration rolls back to the untouched
// original.
import { describe, expect, it } from 'vitest';
import {
  CompositeProfileSchema,
  DomainError,
  migrateProfile,
  migrateV1Profile,
  migrateV2Profile,
  toSeparateProfiles,
} from '@lmps/domain';
import { currentSampleComposite, v1SampleComposite } from './fixtures.js';

describe('migrateV1Profile (v1 → v2 forward migration)', () => {
  it('forwards the published v1 sample into the current contract with a version stamp', () => {
    const record = migrateV1Profile(v1SampleComposite);
    expect(record.fromVersion).toBe(1);
    expect(record.toVersion).toBe(2);
    expect(record.profile).toEqual(currentSampleComposite);
    expect(record.profile.schemaVersion).toBe(2);
  });

  it('leaves the v1 source untouched (deep copy; rollback = unchanged original)', () => {
    const snapshot = JSON.stringify(v1SampleComposite);
    migrateV1Profile(v1SampleComposite);
    expect(JSON.stringify(v1SampleComposite)).toBe(snapshot);
  });

  it('keeps unknown fields when migrating (default preserve)', () => {
    const extended = { ...v1SampleComposite, vendorExtension: { whatever: 'kept' } };
    const record = migrateV1Profile(extended);
    expect(record.profile.schemaVersion).toBe(2);
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

  it('fails without touching the source object when the body is invalid', () => {
    const invalidBody = { ...v1SampleComposite, id: 42 };
    const snapshot = JSON.stringify(invalidBody);
    try {
      migrateV1Profile(invalidBody);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_VALIDATION_FAILED');
    }
    // The input is left byte-for-byte identical after a failed migration.
    expect(JSON.stringify(invalidBody)).toBe(snapshot);
  });

  it('refuses documents whose schemaVersion is not 1', () => {
    for (const wrong of [currentSampleComposite, { ...v1SampleComposite, schemaVersion: 99 }]) {
      try {
        migrateV1Profile(wrong);
        throw new Error('expected throw');
      } catch (error) {
        expect((error as DomainError).code).toBe('DOMAIN_VERSION_UNSUPPORTED');
      }
    }
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

describe('migrateV2Profile (current shape)', () => {
  it('passes a current document through unchanged', () => {
    const record = migrateV2Profile(currentSampleComposite);
    expect(record.fromVersion).toBe(2);
    expect(record.toVersion).toBe(2);
    expect(record.profile).toEqual(currentSampleComposite);
  });

  it('refuses v1 documents (they must go through migrateV1Profile)', () => {
    try {
      migrateV2Profile(v1SampleComposite);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_VERSION_UNSUPPORTED');
    }
  });
});

describe('migrateProfile dispatch', () => {
  it('routes v1 documents through the forward migration', () => {
    const record = migrateProfile(v1SampleComposite);
    expect(record.fromVersion).toBe(1);
    expect(record.toVersion).toBe(2);
    expect(record.profile.id).toBe(v1SampleComposite.id);
    expect(record.profile.schemaVersion).toBe(2);
  });

  it('routes current v2 documents through the validation pass', () => {
    const record = migrateProfile(currentSampleComposite);
    expect(record.fromVersion).toBe(2);
    expect(record.toVersion).toBe(2);
    expect(record.profile).toEqual(currentSampleComposite);
  });

  it('rejects documents without a supported migration path', () => {
    try {
      migrateProfile({ ...currentSampleComposite, schemaVersion: 99 });
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DomainError).code).toBe('DOMAIN_VERSION_UNSUPPORTED');
      expect(String((error as DomainError).message)).toMatch(/no migration path/);
    }
  });
});

describe('toSeparateProfiles (PRD §6 separation)', () => {
  it('splits a composite into independently valid contracts', () => {
    const separated = toSeparateProfiles(currentSampleComposite);
    expect(separated.model).toEqual(currentSampleComposite.model);
    expect(separated.task).toEqual(currentSampleComposite.task);
    expect(separated.runtime).toEqual(currentSampleComposite.runtime);
    expect(separated.generation).toEqual(currentSampleComposite.generation);
    expect(separated.behavior).toEqual(currentSampleComposite.behavior);
    // Each slice must satisfy its own contract (independently testable).
    expect(CompositeProfileSchema.shape.runtime.safeParse(separated.runtime).success).toBe(true);
    expect(CompositeProfileSchema.shape.generation.safeParse(separated.generation).success).toBe(true);
    expect(CompositeProfileSchema.shape.behavior.safeParse(separated.behavior).success).toBe(true);
  });

  it('keeps composite-only fields out of the slices', () => {
    const separated = toSeparateProfiles(currentSampleComposite);
    expect(separated.model).not.toHaveProperty('displayName');
    expect(separated.model).not.toHaveProperty('schemaVersion');
    expect(separated.runtime).not.toHaveProperty('schemaVersion');
    expect(separated.behavior.mode).toBe('exclusive');
  });
});