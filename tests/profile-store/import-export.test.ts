// policy-scan:fixture — sk-test-123 apiKey / 'very-secret' credential round-trip fixture; exemption in scripts/lib/policy-scan-exemptions.json
// JSON/YAML import-export tests (M1-002, PRD FR-01/FR-05): round trips preserve
// the contract; strict mode rejects unknown fields and unsupported versions;
// export sanitizes tokens and absolute private paths before it leaves the store.
import { stringifyYamlDocument } from '@lmps/domain';
import { describe, expect, it } from 'vitest';

import { ALPHA, FAKE_NOW, PROFILE_DIR, profileJson, validProfile } from './fixtures';
import { createMemStore } from './helpers';

export function storeErrorCode<T>(fn: () => T): string {
  try {
    fn();
    throw new Error('expected the call to throw');
  } catch (error) {
    return (error as { code: string }).code;
  }
}

describe('import', () => {
  it('importFromJson persists the profile and returns it', () => {
    const { store } = createMemStore();
    const imported = store.importFromJson(profileJson(ALPHA));
    expect(imported).toEqual(ALPHA);
    expect(store.get('alpha')).toEqual(ALPHA);
  });

  it('importFromYaml persists the profile and returns it', () => {
    const { store } = createMemStore();
    const imported = store.importFromYaml(stringifyYamlDocument(ALPHA));
    expect(imported).toEqual(ALPHA);
    expect(store.get('alpha')).toEqual(ALPHA);
  });

  it('strict mode (default) rejects unknown fields with STORE_IMPORT_FAILED', () => {
    const { store } = createMemStore();
    const withExtra = { ...ALPHA, legacy: 42 };
    expect(storeErrorCode(() => store.importFromJson(JSON.stringify(withExtra)))).toBe(
      'STORE_IMPORT_FAILED',
    );
  });

  it('strict:false preserves unknown fields through save and reload', () => {
    const { store, fs } = createMemStore();
    const withExtra = { ...ALPHA, legacy: 42 } as never;
    const imported = store.importFromJson(JSON.stringify(withExtra), { strict: false }) as unknown as {
      legacy?: number;
    };
    expect(imported.legacy).toBe(42);
    expect(fs.readFileUtf8(`${PROFILE_DIR}/alpha.json`)).toContain('"legacy"');
  });

  it('migrates a v1 document through import (schemaVersion stamped to current)', () => {
    const { store } = createMemStore();
    const v1 = JSON.parse(JSON.stringify(ALPHA)) as Record<string, unknown>;
    v1.schemaVersion = 1;
    const imported = store.importFromJson(JSON.stringify(v1));
    expect(imported).toEqual(ALPHA);
    expect(store.get('alpha').schemaVersion).toBe(2);
  });

  it('rejects an unsupported schemaVersion with STORE_IMPORT_FAILED', () => {
    const { store } = createMemStore();
    const future = { ...ALPHA, schemaVersion: 999 };
    expect(storeErrorCode(() => store.importFromJson(JSON.stringify(future)))).toBe(
      'STORE_IMPORT_FAILED',
    );
  });

  it('rejects input beyond maxImportBytes with STORE_LIMIT_EXCEEDED before parsing', () => {
    const { store } = createMemStore({ maxImportBytes: 10 });
    expect(storeErrorCode(() => store.importFromJson(profileJson(ALPHA)))).toBe(
      'STORE_LIMIT_EXCEEDED',
    );
    expect(storeErrorCode(() => store.importFromYaml(profileJson(ALPHA)))).toBe(
      'STORE_LIMIT_EXCEEDED',
    );
  });

  it('rejects a hostile id in the document (STORE_IMPORT_FAILED, path safety)', () => {
    const { store } = createMemStore();
    const hostile = validProfile('../escape');
    expect(storeErrorCode(() => store.importFromJson(JSON.stringify(hostile)))).toBe(
      'STORE_IMPORT_FAILED',
    );
  });
});

describe('import: id collisions', () => {
  it('duplicate id errors unless allowRename is set', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    expect(storeErrorCode(() => store.importFromJson(profileJson(validProfile('alpha'))))).toBe(
      'STORE_ALREADY_EXISTS',
    );
    const renamed = store.importFromJson(profileJson(validProfile('alpha')), { allowRename: true });
    expect(renamed.id).toBe('alpha-copy');
  });

  it('allowRename suffixes further collisions deterministically', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    const first = store.importFromJson(profileJson(validProfile('alpha')), { allowRename: true });
    const second = store.importFromJson(profileJson(validProfile('alpha')), { allowRename: true });
    expect(first.id).toBe('alpha-copy');
    expect(second.id).toBe('alpha-copy-2');
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha', 'alpha-copy', 'alpha-copy-2']);
  });
});

describe('export', () => {
  it('exportJson round-trips an untouched profile', () => {
    const { store: first } = createMemStore();
    first.create(ALPHA);
    const text = first.exportJson('alpha');
    expect(JSON.parse(text)).toEqual(ALPHA);
    // Re-import into a fresh store: an id that already exists must not collide.
    const { store: second } = createMemStore();
    expect(second.importFromJson(text)).toEqual(ALPHA);
  });

  it('exportYaml round-trips through importFromYaml', () => {
    const { store: first } = createMemStore();
    first.create(ALPHA);
    const text = first.exportYaml('alpha');
    const { store: second } = createMemStore();
    expect(second.importFromYaml(text)).toEqual(ALPHA);
  });

  it('round-trips synchronized resource evidence without rewriting legacy fields', () => {
    const evidenceProfile = {
      ...ALPHA,
      validation: {
        source: 'benchmarked' as const,
        testedAt: FAKE_NOW,
        memoryPeakBytes: 6 * 1024 ** 3,
        resourceUsage: {
          schemaVersion: 1 as const,
          method: 'host-snapshot-delta' as const,
          sampleCount: 2,
          completeness: 'complete' as const,
          peakDelta: { vramBytes: 4 * 1024 ** 3, systemRamBytes: 2 * 1024 ** 3, totalBytes: 6 * 1024 ** 3 },
        },
      },
    };
    const { store: first } = createMemStore();
    first.create(evidenceProfile);
    const text = first.exportJson('alpha');
    const { store: second } = createMemStore();
    expect(second.importFromJson(text)).toEqual(evidenceProfile);
  });

  it('export throws STORE_NOT_FOUND for a missing profile', () => {
    const { store } = createMemStore();
    expect(storeErrorCode(() => store.exportJson('ghost'))).toBe('STORE_NOT_FOUND');
  });

  it('export sanitizes secret-looking keys to null while keeping benign unknown fields', () => {
    const { store } = createMemStore();
    const sensitive = {
      ...ALPHA,
      apiKey: 'sk-test-123',
      credential: 'very-secret',
      benignNote: 'stays',
    };
    store.create(sensitive as never);
    const exported = JSON.parse(store.exportJson('alpha')) as Record<string, unknown>;
    expect(exported.apiKey).toBeNull();
    expect(exported.credential).toBeNull();
    expect(exported.benignNote).toBe('stays');
  });

  it('export redacts absolute private path segments inside string values', () => {
    const { store } = createMemStore();
    const profile = validProfile('alpha', {
      description: { en: 'stored at C:\\Users\\lajar\\AppData\\Local\\LMPS' },
    });
    store.create(profile);
    const exported = JSON.parse(store.exportJson('alpha')) as { description: { en: string } };
    expect(exported.description.en).toBe('<private>');
  });

  it('export redacts POSIX home paths (backup for path patterns seen on macOS)', () => {
    const { store } = createMemStore();
    const profile = validProfile('alpha', {
      description: { en: 'note under /home/alice/Library' },
    });
    store.create(profile);
    const exported = JSON.parse(store.exportJson('alpha')) as { description: { en: string } };
    expect(exported.description.en).toBe('<private>');
  });
});
