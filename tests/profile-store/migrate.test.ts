// Migration-behavior tests (M1-002, PRD FR-05): every stored document is
// forwarded through the domain migrateProfile before use. v1 is the current
// shape today, so the meaningful contracts here are transparency for v1 and
// hard rejection (never silent reshaping) for unsupported versions — with the
// file and its backups left untouched when migration refuses.
import { describe, expect, it } from 'vitest';

import { ALPHA, BACKUP_DIR, PROFILE_DIR } from './fixtures';
import { createMemStore } from './helpers';

const MAIN = `${PROFILE_DIR}/alpha.json`;

describe('stored v1 documents', () => {
  it('load unchanged: id and fields survive a get exactly', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    expect(store.get('alpha')).toEqual(ALPHA);
  });
});

describe('unsupported versions are rejected, never reshaped', () => {
  function futureVersionDocument(): string {
    return JSON.stringify({ ...ALPHA, schemaVersion: 999 });
  }

  it('get throws STORE_CORRUPTED for a future-version document', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(MAIN, futureVersionDocument());
    try {
      store.get('alpha');
      throw new Error('expected STORE_CORRUPTED');
    } catch (error) {
      expect((error as { code: string }).code).toBe('STORE_CORRUPTED');
    }
  });

  it('update does not touch the file nor write backups when migration refuses (rollback = keep source)', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(MAIN, futureVersionDocument());
    try {
      store.update('alpha', { runtime: { contextLength: 1 } });
      throw new Error('expected STORE_CORRUPTED');
    } catch (error) {
      expect((error as { code: string }).code).toBe('STORE_CORRUPTED');
    }
    expect(fs.readFileUtf8(MAIN)).toBe(futureVersionDocument());
    expect(fs.paths().filter((path) => path.startsWith(`${BACKUP_DIR}/`))).toHaveLength(0);
  });

  it('import of a future-version document is STORE_IMPORT_FAILED', () => {
    const { store } = createMemStore();
    expect(() => store.importFromJson(futureVersionDocument())).toThrowError(
      expect.objectContaining({ code: 'STORE_IMPORT_FAILED' }),
    );
  });

  it('recover restores a valid backup over a future-version main file', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.update('alpha', { runtime: { contextLength: 4096 } }); // backup of the v1 original
    fs.writeFileUtf8(MAIN, futureVersionDocument());

    const result = store.recover();
    expect(result.restored).toEqual(['alpha']);
    expect(store.get('alpha')).toEqual(ALPHA);
  });
});

describe('export of a migrated document', () => {
  it('export stays on the current contract after a successful v1 migration', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    const text = store.exportJson('alpha');
    expect(JSON.parse(text).schemaVersion).toBe(1);
  });
});