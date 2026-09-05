// Startup recovery tests (M1-002, PRD FR-05): recover() restores valid backups
// over missing/corrupted main files, excludes unrecoverable ones and clears
// stale temp files. Real interruption semantics are simulated by the FakeFs
// fault injection (exercise in atomic.test.ts).
import { describe, expect, it } from 'vitest';

import { ALPHA, BACKUP_DIR, PROFILE_DIR, validProfile } from './fixtures';
import { createMemStore } from './helpers';

const MAIN = `${PROFILE_DIR}/alpha.json`;

describe('recover: corruption and auto-restore', () => {
  it('restores from the newest valid backup when the main file is corrupted', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.update('alpha', { runtime: { contextLength: 4096 } }); // backup of the original
    const backupPath = `${BACKUP_DIR}/alpha/20260822T010204000.json`;
    const backupContent = fs.readFileUtf8(backupPath);

    fs.writeFileUtf8(MAIN, '{corrupted');

    const result = store.recover();
    expect(result.restored).toEqual(['alpha']);
    expect(result.removed).toEqual([]);
    expect(fs.readFileUtf8(MAIN)).toBe(backupContent);
    expect(store.get('alpha')).toEqual(validProfile('alpha')); // the backed-up original
  });

  it('recreates a missing main file from a backup', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.update('alpha', { runtime: { contextLength: 4096 } });
    fs.unlink(MAIN);

    expect(fs.exists(MAIN)).toBe(false);
    const result = store.recover();
    expect(result.restored).toEqual(['alpha']);
    expect(fs.exists(MAIN)).toBe(true);
    expect(JSON.parse(fs.readFileUtf8(MAIN)).runtime.contextLength).toBe(8192);
  });

  it('treats a future-version main as corrupt and restores the valid backup', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.update('alpha', { runtime: { contextLength: 4096 } });
    fs.writeFileUtf8(MAIN, JSON.stringify({ schemaVersion: 999, id: 'alpha' }));

    const result = store.recover();
    expect(result.restored).toEqual(['alpha']);
    expect(store.get('alpha').schemaVersion).toBe(2);
  });

  it('leaves a corrupt main without any backup in place but excludes it from listing', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    fs.writeFileUtf8(MAIN, '{corrupted');

    const result = store.recover();
    expect(result.restored).toEqual([]);
    expect(result.removed).toEqual(['alpha']);
    // Scene preserved: the corrupt file stays on disk for forensics.
    expect(fs.readFileUtf8(MAIN)).toBe('{corrupted');
    expect(store.list().map((profile) => profile.id)).toEqual([]);
  });

  it('skips backup directories and only considers valid main files for a clean store', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.create(validProfile('beta'));
    fs.writeFileUtf8(`${PROFILE_DIR}/beta.json.tmp-9`, 'stale');
    const result = store.recover();
    expect(result.restored).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha', 'beta']);
  });
});

describe('recover: stale temp-file cleanup', () => {
  it('removes leftover .tmp-* files and reports them', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    fs.writeFileUtf8(`${PROFILE_DIR}/alpha.json.tmp-3`, 'half-written');
    fs.writeFileUtf8(`${PROFILE_DIR}/orphan.json.tmp-1`, 'half-written');

    const result = store.recover();
    expect(result.cleanedTemp.sort()).toEqual([
      `${PROFILE_DIR}/alpha.json.tmp-3`,
      `${PROFILE_DIR}/orphan.json.tmp-1`,
    ]);
    expect(fs.hasTemp()).toBe(false);
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha']);
  });
});

describe('recover: failure is isolated', () => {
  it('does not throw when the profile dir does not exist yet (fresh startup)', () => {
    const { store } = createMemStore();
    expect(store.recover()).toEqual({ restored: [], removed: [], cleanedTemp: [] });
  });

  it('an unlink failure during cleanup does not abort the recovery of valid files', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    fs.writeFileUtf8(`${PROFILE_DIR}/alpha.json.tmp-1`, 'half-written');
    fs.faultNext('unlink');
    const result = store.recover();
    expect(result.removed).toEqual([]);
    // Recovery of valid mains still completed; the temp cleanup is best-effort.
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha']);
    expect(fs.exists(`${PROFILE_DIR}/alpha.json.tmp-1`)).toBe(true);
  });
});

describe('recover: per-profile isolation', () => {
  it('one recoverable and one unrecoverable profile are handled separately', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    store.update('alpha', { runtime: { contextLength: 4096 } });
    store.create(validProfile('beta'));
    fs.writeFileUtf8(`${PROFILE_DIR}/alpha.json`, '{corrupted'); // backup exists
    fs.writeFileUtf8(`${PROFILE_DIR}/beta.json`, '{corrupted'); // no backup

    const result = store.recover();
    expect(result.restored).toEqual(['alpha']);
    expect(result.removed).toEqual(['beta']);
    expect(store.list().map((profile) => profile.id)).toEqual(['alpha']);
  });
});