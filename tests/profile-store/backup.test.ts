// Write-ahead backup + rotation tests (M1-002, PRD FR-05): updates are backed
// up before the atomic replace, rotation keeps only the newest N versions, and
// restore returns the newest *valid* backup.
import { CompositeProfileSchema, parseJsonDocument } from '@lmps/domain';
import {
  readBackupNames,
  restoreNewestValidBackup,
  writeBackup,
} from '@lmps/profile-store';
import { describe, expect, it } from 'vitest';

import { ALPHA, BACKUP_DIR, profileJson, validProfile } from './fixtures';
import { createMemStore } from './helpers';

const ID = 'alpha';

/** Deterministic ISO timestamps with distinct second fields. */
const at = (seconds: string): string => `2026-08-22T01:02:${seconds}.000Z`;

/** Domain-aware parse; throws on any contract violation. */
const domainParse = (text: string) => parseJsonDocument(text, CompositeProfileSchema);

describe('writeBackup', () => {
  it('writes a deterministic sibling file under <backupDir>/<id>/', () => {
    const { fs } = createMemStore();
    writeBackup(fs, BACKUP_DIR, ID, at('03'), ALPHA);
    expect(readBackupNames(fs, BACKUP_DIR, ID)).toEqual(['20260822T010203000.json']);
  });

  it('suffixed on same-timestamp collision without overwriting', () => {
    const { fs } = createMemStore();
    writeBackup(fs, BACKUP_DIR, ID, at('03'), ALPHA);
    writeBackup(fs, BACKUP_DIR, ID, at('03'), ALPHA);
    expect(readBackupNames(fs, BACKUP_DIR, ID)).toEqual([
      '20260822T010203000.json',
      '20260822T010203000_1.json',
    ]);
  });

  it('serializes the given content verbatim', () => {
    const { fs } = createMemStore();
    const custom = validProfile(ID, { runtime: { contextLength: 12345 } });
    writeBackup(fs, BACKUP_DIR, ID, at('04'), custom);
    expect(fs.readFileUtf8(`${BACKUP_DIR}/alpha/20260822T010204000.json`)).toBe(profileJson(custom));
  });
});

describe('rotation (backupCount)', () => {
  it('store keeps only the newest backupCount backups across updates', () => {
    const { store, fs } = createMemStore({ backupCount: 3 });
    store.create(ALPHA); // first create: nothing to back up yet
    for (let i = 1; i <= 5; i += 1) {
      store.update(ID, { runtime: { contextLength: 1000 * i } });
    }
    const names = readBackupNames(fs, BACKUP_DIR, ID);
    expect(names).toHaveLength(3);
    // Updates ran at 01:02:04..08; the oldest two (04, 05) got rotated out.
    expect(names[2] as string).toBe('20260822T010208000.json');
  });

  it('backupCount=1 collapses the history to a single entry', () => {
    const { store, fs } = createMemStore({ backupCount: 1 });
    store.create(ALPHA);
    store.update(ID, { runtime: { contextLength: 1 } });
    store.update(ID, { runtime: { contextLength: 2 } });
    expect(readBackupNames(fs, BACKUP_DIR, ID)).toHaveLength(1);
  });
});

describe('store-level trigger', () => {
  it('create does not write a backup; the first update does', () => {
    const { store, fs } = createMemStore();
    store.create(ALPHA);
    expect(readBackupNames(fs, BACKUP_DIR, ID)).toEqual([]);
    store.update(ID, { runtime: { contextLength: 4096 } });
    expect(readBackupNames(fs, BACKUP_DIR, ID)).toHaveLength(1);
  });
});

describe('restoreNewestValidBackup', () => {
  it('returns the newest backup when it is valid', () => {
    const { fs } = createMemStore();
    writeBackup(fs, BACKUP_DIR, ID, at('03'), validProfile(ID, { runtime: { contextLength: 100 } }));
    writeBackup(fs, BACKUP_DIR, ID, at('04'), validProfile(ID, { runtime: { contextLength: 200 } }));
    expect(restoreNewestValidBackup(fs, BACKUP_DIR, ID, domainParse)?.runtime.contextLength).toBe(200);
  });

  it('skips a corrupted newest backup and falls back to the previous valid one', () => {
    const { fs } = createMemStore();
    writeBackup(fs, BACKUP_DIR, ID, at('03'), validProfile(ID, { runtime: { contextLength: 100 } }));
    writeBackup(fs, BACKUP_DIR, ID, at('04'), validProfile(ID, { runtime: { contextLength: 200 } }));
    fs.writeFileUtf8(`${BACKUP_DIR}/alpha/20260822T010204000.json`, '{corrupt');
    expect(restoreNewestValidBackup(fs, BACKUP_DIR, ID, domainParse)?.runtime.contextLength).toBe(100);
  });

  it('skips a contract-invalid (but JSON-parseable) newest backup', () => {
    const { fs } = createMemStore();
    writeBackup(fs, BACKUP_DIR, ID, at('03'), validProfile(ID, { runtime: { contextLength: 100 } }));
    writeBackup(fs, BACKUP_DIR, ID, at('04'), { schemaVersion: 1, id: ID, json: 'valid but not a profile' });
    const restored = restoreNewestValidBackup(fs, BACKUP_DIR, ID, domainParse);
    expect(restored?.runtime.contextLength).toBe(100);
  });

  it('returns null when every backup is invalid', () => {
    const { fs } = createMemStore();
    writeBackup(fs, BACKUP_DIR, ID, at('03'), validProfile(ID));
    writeBackup(fs, BACKUP_DIR, ID, at('04'), validProfile(ID));
    fs.writeFileUtf8(`${BACKUP_DIR}/alpha/20260822T010203000.json`, '{}');
    fs.writeFileUtf8(`${BACKUP_DIR}/alpha/20260822T010204000.json`, '{');
    expect(restoreNewestValidBackup(fs, BACKUP_DIR, ID, domainParse)).toBeNull();
  });

  it('returns null when no backups exist', () => {
    const { fs } = createMemStore();
    expect(restoreNewestValidBackup(fs, BACKUP_DIR, ID, domainParse)).toBeNull();
  });
});