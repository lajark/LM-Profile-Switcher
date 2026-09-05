// CRUD + failure-path tests for the profile store (M1-002). All files live in
// an in-memory FakeFs; assertions inspect the virtual disk directly.
import { createProfileStore, isProfileStoreError } from '@lmps/profile-store';
import { isDomainError } from '@lmps/domain';
import { describe, expect, it } from 'vitest';

import { ALPHA, BACKUP_DIR, GAMMA, PROFILE_DIR, validProfile } from './fixtures';
import { createMemStore } from './helpers';

function storeErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (!isProfileStoreError(error)) throw error;
    return error.code;
  }
  throw new Error('expected the call to throw');
}

describe('profile store: create/get/list', () => {
  it('create persists the profile and get returns a deep-equal copy', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    expect(fs.exists(`${PROFILE_DIR}/alpha.json`)).toBe(true);
    expect(store.get('alpha')).toEqual(ALPHA);
  });

  it('create rejects a duplicate id with STORE_ALREADY_EXISTS', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    expect(storeErrorCode(() => store.create(ALPHA))).toBe('STORE_ALREADY_EXISTS');
  });

  it('get on a missing id throws STORE_NOT_FOUND', () => {
    const { store } = createMemStore();
    expect(storeErrorCode(() => store.get('nope'))).toBe('STORE_NOT_FOUND');
  });

  it('get on a corrupted main file throws STORE_CORRUPTED without leaking the path', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(`${PROFILE_DIR}/alpha.json`, '{ not json !!!');
    expect(storeErrorCode(() => store.get('alpha'))).toBe('STORE_CORRUPTED');
    try {
      store.get('alpha');
      throw new Error('unreachable');
    } catch (error) {
      expect(String(error)).not.toContain('alpha.json');
    }
  });

  it('list returns every profile sorted by id and skips corrupt entries', () => {
    const { store, fs } = createMemStore();
    store.create(GAMMA);
    store.create(ALPHA);
    store.create(validProfile('beta'));
    fs.writeFileUtf8(`${PROFILE_DIR}/broken.json`, 'garbage{');
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns defensive copies: mutating a result never touches the file', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    const read = store.get('alpha');
    read.runtime.contextLength = 12345;
    expect(store.get('alpha').runtime.contextLength).toBe(8192);
  });
});

describe('profile store: update', () => {
  it('update applies patch, keeps id, writes a backup and stamps a fresh updatedAt', () => {
    const { store, fs } = createMemStore();
    const created = store.create(ALPHA);
    const updated = store.update('alpha', { runtime: { contextLength: 16384 } });
    expect(updated.runtime.contextLength).toBe(16384);
    expect(updated.id).toBe('alpha');
    expect(updated.metadata.updatedAt).not.toBe(created.metadata.updatedAt);
    expect(updated.metadata.updatedAt > created.metadata.updatedAt).toBe(true);
    // The pre-update version was copied to the backup dir before replacement.
    expect(fs.paths().filter((path) => path.startsWith(`${BACKUP_DIR}/alpha/`))).toHaveLength(1);
    const [backupPath] = fs.paths().filter((path) => path.startsWith(`${BACKUP_DIR}/alpha/`));
    const backedUp = JSON.parse(fs.readFileUtf8(backupPath as string)) as {
      runtime: { contextLength: number };
    };
    expect(backedUp.runtime.contextLength).toBe(8192);
  });

  it('update refuses to change the id (STORE_INVALID_ID)', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    expect(storeErrorCode(() => store.update('alpha', { id: 'reborn' } as never))).toBe('STORE_INVALID_ID');
  });

  it('update on a missing profile throws STORE_NOT_FOUND', () => {
    const { store } = createMemStore();
    expect(storeErrorCode(() => store.update('ghost', { runtime: { contextLength: 1 } }))).toBe(
      'STORE_NOT_FOUND',
    );
  });

  it('update on a corrupted file throws STORE_CORRUPTED and leaves file + backup dir untouched', () => {
    const { store, fs } = createMemStore();
    fs.writeFileUtf8(`${PROFILE_DIR}/alpha.json`, '{ not json');
    expect(storeErrorCode(() => store.update('alpha', { runtime: { contextLength: 1 } }))).toBe(
      'STORE_CORRUPTED',
    );
    expect(fs.readFileUtf8(`${PROFILE_DIR}/alpha.json`)).toBe('{ not json');
    expect(fs.paths().some((path) => path.startsWith(`${BACKUP_DIR}/`))).toBe(false);
  });

  it('update validation rejects an invalid patch (bad scope is never silently dropped)', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    let caught: unknown;
    try {
      store.update('alpha', { behavior: { mode: 'not-a-mode' } as never });
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught)).toBe(true);
  });
});

describe('profile store: delete', () => {
  it('delete removes the main file but keeps backups', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.update('alpha', { runtime: { contextLength: 4096 } });
    store.delete('alpha');
    expect(fs.exists(`${PROFILE_DIR}/alpha.json`)).toBe(false);
    expect(storeErrorCode(() => store.get('alpha'))).toBe('STORE_NOT_FOUND');
    expect(fs.paths().some((path) => path.startsWith(`${BACKUP_DIR}/alpha/`))).toBe(true);
  });

  it('delete on a missing id throws STORE_NOT_FOUND', () => {
    const { store } = createMemStore();
    expect(storeErrorCode(() => store.delete('ghost'))).toBe('STORE_NOT_FOUND');
  });
});

describe('profile store: input validation and path safety', () => {
  it('create validates the profile through the domain contract (DomainError propagates)', () => {
    const { store } = createMemStore();
    const invalid = { ...ALPHA, runtime: { contextLength: -1 } };
    let caught: unknown;
    try {
      store.create(invalid as never);
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught)).toBe(true);
  });

  it('create rejects ids that dodge or break the id regex', () => {
    const { store } = createMemStore();
    for (const hostile of ['../escape', 'a/../../b', 'a\\b', 'a:b', 'Alpha']) {
      const probe = validProfile('victim', { id: hostile });
      expect(() => store.create(probe as never)).toThrow();
    }
  });

  it('get rejects a traversal id before touching the filesystem', () => {
    const { store, fs } = createMemStore();
    expect(storeErrorCode(() => store.get('../escape'))).toBe('STORE_INVALID_ID');
    expect(fs.opLog).toHaveLength(0);
  });

  it('create with overwrite replaces an existing profile', () => {
    const { store } = createMemStore();
    store.create(ALPHA);
    const replacement = validProfile('alpha', { runtime: { contextLength: 2048 } });
    const stored = store.create(replacement, { overwrite: true });
    expect(stored.runtime.contextLength).toBe(2048);
    expect(store.get('alpha').runtime.contextLength).toBe(2048);
  });

  it('rejects an invalid backupCount with a plain RangeError (config error, not a runtime code)', () => {
    const { fs } = createMemStore();
    for (const bad of [0, 201, -3]) {
      expect(() =>
        createProfileStore({
          fs,
          now: () => 't',
          profileDir: PROFILE_DIR,
          backupDir: BACKUP_DIR,
          backupCount: bad,
        }),
      ).toThrow(RangeError);
    }
  });
});

describe('profile store: stable machine error codes', () => {
  it('an atomic-write rename failure surfaces as STORE_IO_FAILED', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    fs.faultNext('rename');
    expect(storeErrorCode(() => store.update('alpha', { runtime: { contextLength: 1 } }))).toBe(
      'STORE_IO_FAILED',
    );
  });

  it('the code list is closed: every exported code is in PROFILE_STORE_ERROR_CODES', async () => {
    const { PROFILE_STORE_ERROR_CODES } = await import('@lmps/profile-store');
    const seen = new Set<string>();
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    fs.faultNext('rename');
    expect(storeErrorCode(() => store.update('alpha', { runtime: { contextLength: 1 } }))).toBe(
      'STORE_IO_FAILED',
    );
    for (const id of ['nope', '../x']) seen.add(storeErrorCode(() => store.get(id)));
    fs.writeFileUtf8(`${PROFILE_DIR}/broken.json`, '{nope');
    seen.add(storeErrorCode(() => store.get('broken')));
    for (const code of seen) expect(PROFILE_STORE_ERROR_CODES).toContain(code);
  });
});