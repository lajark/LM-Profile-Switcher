/**
 * Profile store orchestration (M1-002, PRD FR-05).
 *
 * Profile files under `profileDir/<id>.json` are the only source of truth;
 * `backupDir` holds write-ahead copies, not authority. Every stored document is
 * forwarded through the domain `migrateProfile` before use, so future/unsupported
 * versions are hard-rejected instead of silently reshaped. All writes go through
 * temp+fsync+atomic-rename. Runtime failures map to the stable `STORE_*` machine
 * codes; configuration mistakes (invalid backupCount, zero import limit) throw
 * plain RangeErrors, matching the "config vs runtime" split in the other packages.
 *
 * The module stays free of Node built-ins: filesystem access flows through the
 * injected {@link Fsys} (see `fsys.ts`), the clock through `ctx.now`.
 */
import {
  CompositeProfileSchema,
  deserializeJsonDocument,
  deserializeYamlDocument,
  migrateProfile,
  stringifyJsonDocument,
  zodErrorToDomainError,
  type CompositeProfile,
} from '@lmps/domain';

import { writeFileAtomic } from './atomic.js';
import {
  BACKUP_COUNT_MAX,
  BACKUP_COUNT_MIN,
  DEFAULT_BACKUP_COUNT,
  restoreNewestValidBackup,
  writeBackup,
} from './backup.js';
import { ProfileStoreError } from './errors.js';
import type { Fsys } from './fsys.js';
import { exportSanitizedJson, exportSanitizedYaml } from './sanitize.js';

export interface StoreContext {
  fs: Fsys;
  now(): string;
  profileDir: string;
  backupDir: string;
  /** 1–200; default 20 (PRD FR-05). Out-of-range → RangeError at construction. */
  backupCount?: number;
  /** Import text-length limit in characters; default 1 MiB. */
  maxImportBytes?: number;
}

export interface ImportOptions {
  /** Reject unknown fields (default true). Unknown fields are preserved otherwise. */
  strict?: boolean;
  /** When the id collides, import under `<id>-copy[-n]` instead of failing. */
  allowRename?: boolean;
}

export interface ProfileStore {
  /** Validates through the domain contract; duplicate id → STORE_ALREADY_EXISTS unless overwrite. */
  create(profile: CompositeProfile, options?: { overwrite?: boolean }): CompositeProfile;
  /** Missing → STORE_NOT_FOUND; unreadable/unsupported document → STORE_CORRUPTED. */
  get(id: string): CompositeProfile;
  /** All valid profiles, migrated, sorted by id; corrupt entries are skipped. */
  list(): CompositeProfile[];
  /** Deep-merged patch; id is immutable; updatedAt is stamped; write-ahead backup. */
  update(id: string, patch: Partial<CompositeProfile> & { id?: never }): CompositeProfile;
  /** Removes the main file; backups stay (M1-004 `backup list|restore`). */
  delete(id: string): void;
  importFromJson(text: string, options?: ImportOptions): CompositeProfile;
  importFromYaml(text: string, options?: ImportOptions): CompositeProfile;
  /** Sanitized export (tokens/secret keys → null, absolute private paths → `<private>`). */
  exportJson(id: string): string;
  exportYaml(id: string): string;
  /** Startup repair: restore over corrupt/missing mains, exclude unrecoverable, clear temps. */
  recover(): { restored: string[]; removed: string[]; cleanedTemp: string[] };
}

const DEFAULT_MAX_IMPORT_BYTES = 1024 * 1024;

/**
 * Mirrors `packages/domain/src/profile.ts` `PROFILE_ID_RE` (not exported from
 * the package; kept local so get/update/delete can guard raw ids before any
 * filesystem access without changing the public domain contract).
 */
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergePatchObject(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? mergePatchObject(existing, value) : value;
  }
  return out;
}

function parseProfile(value: unknown): CompositeProfile {
  const result = CompositeProfileSchema.safeParse(value);
  if (!result.success) throw zodErrorToDomainError(result.error);
  return result.data;
}

/** Defensive path containment: collapses `..`/`.` and normalizes separators. */
function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return `/${out.join('/')}`;
}

function assertInside(rootDir: string, candidate: string): void {
  const root = normalizePosix(rootDir);
  const target = normalizePosix(candidate);
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new ProfileStoreError('STORE_INVALID_ID', 'id escapes the profile directory');
  }
}

export function createProfileStore(ctx: StoreContext): ProfileStore {
  const backupCount = ctx.backupCount ?? DEFAULT_BACKUP_COUNT;
  if (
    !Number.isInteger(backupCount) ||
    backupCount < BACKUP_COUNT_MIN ||
    backupCount > BACKUP_COUNT_MAX
  ) {
    throw new RangeError(`backupCount must be an integer in [${BACKUP_COUNT_MIN}, ${BACKUP_COUNT_MAX}]`);
  }
  const maxImportBytes = ctx.maxImportBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  if (!Number.isInteger(maxImportBytes) || maxImportBytes < 1) {
    throw new RangeError('maxImportBytes must be a positive integer');
  }

  const { fs, profileDir, backupDir } = ctx;
  const now = () => ctx.now();

  const filePath = (id: string): string => `${profileDir}/${id}.json`;

  const assertId = (id: string): void => {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new ProfileStoreError('STORE_INVALID_ID', 'id must match ^[a-z0-9][a-z0-9._-]{1,63}$');
    }
    assertInside(profileDir, filePath(id));
  };

  const parseStored = (text: string): CompositeProfile => {
    try {
      return migrateProfile(JSON.parse(text)).profile;
    } catch (cause) {
      throw new ProfileStoreError('STORE_CORRUPTED', 'stored document is corrupted or unsupported', {
        cause,
      });
    }
  };

  const loadOrThrow = (id: string): CompositeProfile => {
    if (!fs.exists(filePath(id))) {
      throw new ProfileStoreError('STORE_NOT_FOUND', 'profile does not exist');
    }
    return parseStored(fs.readFileUtf8(filePath(id)));
  };

  const parseImport = (text: string, deserialize: (t: string) => unknown, options: ImportOptions): CompositeProfile => {
    if (text.length > maxImportBytes) {
      throw new ProfileStoreError('STORE_LIMIT_EXCEEDED', 'import document exceeds the size limit');
    }
    try {
      // Older documents (schemaVersion 1) are forwarded through the domain
      // migration before the current-contract validation; unsupported future
      // versions are rejected by `migrateProfile` (never silently reshaped).
      const record = migrateProfile(deserialize(text), { strict: options.strict ?? true });
      return record.profile;
    } catch (cause) {
      throw new ProfileStoreError('STORE_IMPORT_FAILED', 'import document failed validation', { cause });
    }
  };

  const store: ProfileStore = {
    create(profile, options = {}) {
      const validated = parseProfile(profile); // throws DomainError on contract violations
      assertId(validated.id);
      if (fs.exists(filePath(validated.id)) && !options.overwrite) {
        throw new ProfileStoreError('STORE_ALREADY_EXISTS', 'a profile with this id already exists', {
          detail: 'pass overwrite:true to replace it',
        });
      }
      writeFileAtomic(fs, filePath(validated.id), stringifyJsonDocument(validated), 1);
      return clone(validated);
    },

    get(id) {
      assertId(id);
      return clone(loadOrThrow(id));
    },

    list() {
      const profiles: CompositeProfile[] = [];
      for (const name of fs.readdirNames(profileDir)) {
        if (!name.endsWith('.json') || name.includes('.tmp-')) continue;
        const id = name.slice(0, -'.json'.length);
        try {
          profiles.push(loadOrThrow(id));
        } catch {
          // corrupt entry: excluded from listing, kept on disk for recovery
        }
      }
      profiles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return profiles;
    },

    update(id, patch) {
      assertId(id);
      if (patch.id !== undefined) {
        throw new ProfileStoreError('STORE_INVALID_ID', 'profile id is immutable');
      }
      const current = loadOrThrow(id); // STORE_NOT_FOUND / STORE_CORRUPTED propagate before any write
      const merged = mergePatchObject(clone(current) as Record<string, unknown>, patch as Record<string, unknown>);
      const validated = parseProfile(merged); // throws DomainError on invalid patches
      const stamp = now();
      const finalized: CompositeProfile = {
        ...validated,
        metadata: { ...validated.metadata, updatedAt: stamp },
      };
      writeBackup(fs, backupDir, id, stamp, current, backupCount);
      writeFileAtomic(fs, filePath(id), stringifyJsonDocument(finalized), 1);
      return clone(finalized);
    },

    delete(id) {
      assertId(id);
      if (!fs.exists(filePath(id))) {
        throw new ProfileStoreError('STORE_NOT_FOUND', 'profile does not exist');
      }
      fs.unlink(filePath(id));
    },

    importFromJson(text, options = {}) {
      return importText(text, 'json', options);
    },

    importFromYaml(text, options = {}) {
      return importText(text, 'yaml', options);
    },

    exportJson(id) {
      assertId(id);
      return exportSanitizedJson(loadOrThrow(id));
    },

    exportYaml(id) {
      assertId(id);
      return exportSanitizedYaml(loadOrThrow(id));
    },

    recover() {
      const restored: string[] = [];
      const removed: string[] = [];
      const cleanedTemp: string[] = [];
      const names = fs.readdirNames(profileDir);

      for (const name of names) {
        if (!name.endsWith('.json') || name.includes('.tmp-')) continue;
        const id = name.slice(0, -'.json'.length);
        let healthy = false;
        try {
          loadOrThrow(id);
          healthy = true;
        } catch {
          // not healthy: try backup
        }
        if (healthy) continue;

        const backup = restoreNewestValidBackup(fs, backupDir, id, parseStored);
        if (backup === null) {
          // Unrecoverable: excluded from listing; file left in place for forensics.
          removed.push(id);
        } else {
          try {
            writeFileAtomic(fs, filePath(id), stringifyJsonDocument(backup), 1);
            restored.push(id);
          } catch {
            // restore failed: leave everything as-is, still listed as removed
            removed.push(id);
          }
        }
      }

      // Main files that vanished entirely (e.g. interrupted rename) are not
      // discoverable from the profile dir; re-create them from their backups.
      for (const id of fs.readdirNames(backupDir)) {
        if (fs.exists(filePath(id))) continue;
        const backup = restoreNewestValidBackup(fs, backupDir, id, parseStored);
        if (backup === null) continue;
        try {
          writeFileAtomic(fs, filePath(id), stringifyJsonDocument(backup), 1);
          if (!restored.includes(id)) restored.push(id);
        } catch {
          // best-effort resurrection; a later startup tries again
        }
      }

      for (const name of names) {
        if (!name.includes('.tmp-')) continue;
        const file = `${profileDir}/${name}`;
        try {
          fs.unlink(file);
          cleanedTemp.push(file);
        } catch {
          // best-effort: a leftover temp is harmless, retried next startup
        }
      }

      return { restored, removed, cleanedTemp };
    },
  };

  function importText(text: string, format: 'json' | 'yaml', options: ImportOptions): CompositeProfile {
    const parsed = parseImport(text, format === 'json' ? deserializeJsonDocument : deserializeYamlDocument, options);
    if (fs.exists(filePath(parsed.id))) {
      if (!options.allowRename) {
        throw new ProfileStoreError('STORE_ALREADY_EXISTS', 'a profile with this id already exists');
      }
      let candidate = '';
      for (let suffix = 1; suffix <= 1000; suffix += 1) {
        candidate = suffix === 1 ? `${parsed.id}-copy` : `${parsed.id}-copy-${suffix}`;
        if (!fs.exists(filePath(candidate))) break;
        candidate = '';
      }
      if (candidate === '') {
        throw new ProfileStoreError('STORE_ALREADY_EXISTS', 'no free copy id is available');
      }
      return store.create({ ...parsed, id: candidate });
    }
    return store.create(parsed);
  }

  return store;
}