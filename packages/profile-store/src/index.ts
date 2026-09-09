/**
 * Wiring module for the profile store (M1-002). This is the ONLY file in the
 * package allowed to import Node built-ins: every other module stays pure and
 * receives its filesystem through the {@link Fsys} seam (see architecture.test.ts).
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { createProfileStore, type ProfileStore, type StoreContext } from './store.js';
import type { Fsys } from './fsys.js';

export * from './errors.js';
export * from './fsys.js';
export * from './atomic.js';
export * from './backup.js';
export * from './sanitize.js';
export * from './index-types.js';
export type {
  ProfileStore,
  StoreContext,
  ImportOptions,
} from './store.js';
export { createProfileStore } from './store.js';

/** Node-backed {@link Fsys} with open+fsync+close durability. */
export function createDefaultFsys(): Fsys {
  return {
    exists: (path) => existsSync(path),
    readFileUtf8: (path) => readFileSync(path, 'utf8'),
    writeFileUtf8: (path, data) => writeFileSync(path, data, 'utf8'),
    mkdirRecursive: (path) => mkdirSync(path, { recursive: true }),
    readdirNames: (path) => {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);
      } catch (error) {
        // Documented contract: a missing directory reads as empty (first
        // update of a fresh profile has no `backups/<id>/` yet).
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    rename: (from, to) => renameSync(from, to),
    unlink: (path) => unlinkSync(path),
    fsyncFile: (path) => {
      // Directories refuse open-+fsync on some platforms (EISDIR/EINVAL/EPERM on
      // Windows). The store only relies on the file-fsync path for durability;
      // directory sync is best-effort and must never be fatal.
      try {
        const fd = openSync(path, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'EISDIR' || code === 'EINVAL' || code === 'EPERM') return;
        throw error;
      }
    },
  };
}

export interface DefaultStoreOptions {
  profileDir?: string;
  backupDir?: string;
  backupCount?: number;
  maxImportBytes?: number;
}

/**
 * Store rooted at `rootDir` with `profiles/` + `backups/` subdirectories,
 * a wall-clock timestamp and Node file operations. Directories are created on
 * construction; a second store on the same root shares (and stays consistent
 * with) the same files.
 */
export function createDefaultProfileStore(rootDir: string, options: DefaultStoreOptions = {}): ProfileStore {
  const profileDir = options.profileDir ?? join(rootDir, 'profiles');
  const backupDir = options.backupDir ?? join(rootDir, 'backups');
  const fs = createDefaultFsys();
  const store = createProfileStore({
    fs,
    now: () => new Date().toISOString(),
    profileDir,
    backupDir,
    backupCount: options.backupCount,
    maxImportBytes: options.maxImportBytes,
  } satisfies StoreContext);
  fs.mkdirRecursive(profileDir);
  fs.mkdirRecursive(backupDir);
  return store;
}