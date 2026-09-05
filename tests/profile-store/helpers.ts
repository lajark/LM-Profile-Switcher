// Shared factory for a store bound to an in-memory FakeFs (M1-002).
import { createProfileStore } from '@lmps/profile-store';
import type { ProfileStore } from '@lmps/profile-store';

import { BACKUP_DIR, PROFILE_DIR, FakeFs, makeClock } from './fixtures';

export interface MemStoreOptions {
  backupCount?: number;
  maxImportBytes?: number;
  /** When set, `now()` returns the same value on every call. */
  frozenNow?: string;
}

/**
 * Creates an in-memory store with a deterministic advancing clock. Tests inspect
 * the FakeFs directly (files, opLog, faults) to assert durability semantics.
 */
export function createMemStore(opts: MemStoreOptions = {}): { store: ProfileStore; fs: FakeFs } {
  const fs = new FakeFs();
  const store = createProfileStore({
    fs,
    now: makeClock(opts.frozenNow),
    profileDir: PROFILE_DIR,
    backupDir: BACKUP_DIR,
    backupCount: opts.backupCount,
    maxImportBytes: opts.maxImportBytes,
  });
  return { store, fs };
}