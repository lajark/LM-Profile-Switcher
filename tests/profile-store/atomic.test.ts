// Atomicity tests (M1-002, PRD FR-05): temp file + fsync + rename must leave the
// previous target intact on every injected interruption point. The FakeFs fault
// injection simulates a crash between write/fsync/rename without real processes.
import { isProfileStoreError, tempPathFor, writeFileAtomic } from '@lmps/profile-store';
import { describe, expect, it } from 'vitest';

import { PROFILE_DIR, makeFakeFs } from './fixtures';

const TARGET = `${PROFILE_DIR}/alpha.json`;

describe('temp-for-target naming', () => {
  it('tempPathFor derives a same-directory sibling so rename stays atomic', () => {
    expect(tempPathFor(TARGET, 7)).toBe(`${PROFILE_DIR}/alpha.json.tmp-7`);
  });

  it('distinct sequences never collide', () => {
    expect(tempPathFor(TARGET, 1)).not.toBe(tempPathFor(TARGET, 2));
  });
});

describe('writeFileAtomic happy path', () => {
  it('persists data through write → fsync → rename in order and leaves no temp file', () => {
    const fs = makeFakeFs();
    writeFileAtomic(fs, TARGET, '{"ok":1}', 1);
    expect(fs.readFileUtf8(TARGET)).toBe('{"ok":1}');
    expect(fs.hasTemp()).toBe(false);
    const fsync = fs.opLog.indexOf('fsyncFile');
    const rename = fs.opLog.indexOf('rename');
    const write = fs.opLog.indexOf('writeFileUtf8');
    expect(write).toBeGreaterThanOrEqual(0);
    expect(fsync).toBeGreaterThan(write);
    expect(rename).toBeGreaterThan(fsync);
  });

  it('overwrites an existing target in place', () => {
    const fs = makeFakeFs();
    fs.writeFileUtf8(TARGET, 'old');
    writeFileAtomic(fs, TARGET, 'new', 1);
    expect(fs.readFileUtf8(TARGET)).toBe('new');
    expect(fs.hasTemp()).toBe(false);
  });
});

describe('writeFileAtomic fault injection (original file always survives)', () => {
  function storeErrorCode(fn: () => void): string {
    try {
      fn();
    } catch (error) {
      if (isProfileStoreError(error)) return error.code;
      throw error;
    }
    throw new Error('expected the call to throw');
  }

  it('temp write failure throws STORE_IO_FAILED and leaves no file behind', () => {
    const fs = makeFakeFs();
    fs.faultNext('writeFileUtf8');
    expect(storeErrorCode(() => writeFileAtomic(fs, TARGET, 'data', 1))).toBe('STORE_IO_FAILED');
    expect(fs.exists(TARGET)).toBe(false);
    expect(fs.hasTemp()).toBe(false);
  });

  it('fsync failure throws STORE_IO_FAILED, cleans the temp file and leaves the target untouched', () => {
    const fs = makeFakeFs();
    fs.writeFileUtf8(TARGET, 'old');
    fs.faultNext('fsyncFile');
    expect(storeErrorCode(() => writeFileAtomic(fs, TARGET, 'new', 1))).toBe('STORE_IO_FAILED');
    expect(fs.readFileUtf8(TARGET)).toBe('old');
    expect(fs.hasTemp()).toBe(false);
  });

  it('rename failure surfaces STORE_IO_FAILED, cleans the temp file, target keeps old content', () => {
    const fs = makeFakeFs();
    fs.writeFileUtf8(TARGET, 'old');
    fs.faultNext('rename');
    expect(storeErrorCode(() => writeFileAtomic(fs, TARGET, 'new', 1))).toBe('STORE_IO_FAILED');
    expect(fs.readFileUtf8(TARGET)).toBe('old');
    expect(fs.hasTemp()).toBe(false);
  });

  it('a directory fsync failure is best-effort: the call still succeeds', () => {
    const fs = makeFakeFs();
    // FakeFs.fsyncFile only knows files, so fsync of the directory throws — the
    // store must swallow that and still finish the rename.
    writeFileAtomic(fs, TARGET, 'data', 1);
    expect(fs.readFileUtf8(TARGET)).toBe('data');
    expect(fs.hasTemp()).toBe(false);
  });

  it('a later write leaves no stale temp from an earlier crash', () => {
    const fs = makeFakeFs();
    fs.faultNext('fsyncFile');
    expect(() => writeFileAtomic(fs, TARGET, 'v1', 5)).toThrow();
    expect(fs.hasTemp()).toBe(false);
    writeFileAtomic(fs, TARGET, 'v2', 6);
    expect(fs.readFileUtf8(TARGET)).toBe('v2');
  });
});