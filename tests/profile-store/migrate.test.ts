// Migration-behavior tests (M1-002, PRD FR-05): every stored document is
// forwarded through the domain migrateProfile before use. Stored v1 documents
// migrate forward into the current v2 contract transparently; unsupported
// future versions are hard-rejected (never silently reshaped), with the file
// and its backups left untouched when migration refuses.
import { describe, expect, it } from 'vitest';

import { ALPHA, BACKUP_DIR, PROFILE_DIR, validProfile } from './fixtures';
import { createMemStore } from './helpers';

const MAIN = `${PROFILE_DIR}/alpha.json`;

/** A v1-shaped profile document exactly as it would have been stored pre-v2. */
function v1ProfileText(id: string): string {
  const base = JSON.parse(JSON.stringify(validProfile(id))) as Record<string, unknown>;
  base.schemaVersion = 1;
  return JSON.stringify(base);
}

describe('stored current-version documents', () => {
  it('load unchanged: id and fields survive a get exactly', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    expect(store.get('alpha')).toEqual(ALPHA);
  });
});

describe('stored v1 documents migrate forward', () => {
  it('get returns the v1 document stamped to the current contract', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(MAIN, v1ProfileText('alpha'));
    const loaded = store.get('alpha');
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.id).toBe('alpha');
    expect(loaded.runtime.contextLength).toBe(ALPHA.runtime.contextLength);
  });

  it('an update persists the migrated document on the current contract', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(MAIN, v1ProfileText('alpha'));
    store.update('alpha', { runtime: { contextLength: 4096 } });
    expect(store.get('alpha').runtime.contextLength).toBe(4096);
    expect(JSON.parse(fs.readFileUtf8(MAIN)).schemaVersion).toBe(2);
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
    store.update('alpha', { runtime: { contextLength: 4096 } }); // backup of the v2 original
    fs.writeFileUtf8(MAIN, futureVersionDocument());

    const result = store.recover();
    expect(result.restored).toEqual(['alpha']);
    expect(store.get('alpha')).toEqual(ALPHA);
  });
});

describe('export of a migrated document', () => {
  it('export stays on the current contract for a freshly created profile', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    const text = store.exportJson('alpha');
    expect(JSON.parse(text).schemaVersion).toBe(2);
  });

  it('export of a stored v1 document stays on the current contract', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(MAIN, v1ProfileText('alpha'));
    const text = store.exportJson('alpha');
    expect(JSON.parse(text).schemaVersion).toBe(2);
  });
});