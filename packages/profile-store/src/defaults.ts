/**
 * Durable default-profile index (M7-004).
 *
 * Defaults are deliberately kept outside CompositeProfile documents: one
 * model/scenario can own several profiles, while the selected default is a
 * separate, explicit choice. The file is versioned and written through the
 * same atomic path as profile documents. A missing or stale entry never gets
 * resolved by name or timestamp.
 */
import { writeFileAtomic } from './atomic.js';
import { ProfileStoreError } from './errors.js';
import type { Fsys } from './fsys.js';

export interface ProfileDefaultEntry {
  modelKey: string;
  taskType: string;
  profileId: string;
  updatedAt: string;
}

export interface ProfileDefaultsDocument {
  schemaVersion: 1;
  entries: ProfileDefaultEntry[];
}

function isEntry(value: unknown): value is ProfileDefaultEntry {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.modelKey === 'string' && item.modelKey.length > 0 &&
    typeof item.taskType === 'string' && item.taskType.length > 0 &&
    typeof item.profileId === 'string' && item.profileId.length > 0 &&
    typeof item.updatedAt === 'string' && item.updatedAt.length > 0
  );
}

function parseDocument(value: unknown): ProfileDefaultsDocument | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || !Array.isArray(item.entries) || !item.entries.every(isEntry)) return null;
  const entries = item.entries.map((entry) => ({ ...entry }));
  const keys = new Set(entries.map((entry) => `${entry.modelKey}\u0000${entry.taskType}`));
  if (keys.size !== entries.length) return null;
  return { schemaVersion: 1, entries };
}

export interface ProfileDefaultStoreContext {
  fs: Fsys;
  path: string;
  now(): string;
  /** Optional guard used by production wiring to reject missing/mismatched profiles. */
  profileExists?(profileId: string, modelKey: string, taskType: string): boolean;
}

export interface ProfileDefaultStore {
  /** Returns all explicit defaults in stable key order. */
  list(): ProfileDefaultEntry[];
  /** Returns the selected profile id, or null when no default was chosen. */
  get(modelKey: string, taskType: string): string | null;
  /** Replaces the default for one model/scenario key and persists it atomically. */
  set(modelKey: string, taskType: string, profileId: string): ProfileDefaultEntry;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function keyOf(entry: Pick<ProfileDefaultEntry, 'modelKey' | 'taskType'>): string {
  return `${entry.modelKey}\u0000${entry.taskType}`;
}

function validateKey(modelKey: string, taskType: string, profileId?: string): void {
  if (
    typeof modelKey !== 'string' ||
    modelKey.trim() === '' ||
    typeof taskType !== 'string' ||
    taskType.trim() === ''
  ) {
    throw new ProfileStoreError('STORE_INVALID_ID', 'default key is invalid');
  }
  if (profileId !== undefined && (typeof profileId !== 'string' || profileId.trim() === '')) {
    throw new ProfileStoreError('STORE_INVALID_ID', 'default profile id is invalid');
  }
}

function parentDir(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index <= 0 ? '.' : path.slice(0, index);
}

function readDocument(ctx: ProfileDefaultStoreContext): ProfileDefaultsDocument {
  if (!ctx.fs.exists(ctx.path)) return { schemaVersion: 1, entries: [] };
  try {
    const parsed: unknown = JSON.parse(ctx.fs.readFileUtf8(ctx.path));
    const checked = parseDocument(parsed);
    if (checked === null) throw new Error('invalid defaults document');
    return checked;
  } catch (cause) {
    throw new ProfileStoreError('STORE_CORRUPTED', 'default profile index is corrupted or unsupported', { cause });
  }
}

function sortEntries(entries: ProfileDefaultEntry[]): ProfileDefaultEntry[] {
  return entries.sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function createProfileDefaultStore(ctx: ProfileDefaultStoreContext): ProfileDefaultStore {
  const read = (): ProfileDefaultEntry[] => sortEntries(readDocument(ctx).entries.map((entry) => ({ ...entry })));

  const persist = (entries: ProfileDefaultEntry[]): void => {
    ctx.fs.mkdirRecursive(parentDir(ctx.path));
    const document: ProfileDefaultsDocument = {
      schemaVersion: 1,
      entries: sortEntries(entries.map((entry) => ({ ...entry }))),
    };
    writeFileAtomic(ctx.fs, ctx.path, JSON.stringify(document, null, 2), 1);
  };

  return {
    list() {
      return read().map((entry) => clone(entry));
    },

    get(modelKey, taskType) {
      validateKey(modelKey, taskType);
      return read().find((entry) => entry.modelKey === modelKey && entry.taskType === taskType)?.profileId ?? null;
    },

    set(modelKey, taskType, profileId) {
      validateKey(modelKey, taskType, profileId);
      if (ctx.profileExists !== undefined && !ctx.profileExists(profileId, modelKey, taskType)) {
        throw new ProfileStoreError('STORE_INVALID_ID', 'default profile does not match the model and scenario');
      }
      const entry: ProfileDefaultEntry = { modelKey, taskType, profileId, updatedAt: ctx.now() };
      const entries = read().filter((item) => keyOf(item) !== keyOf(entry));
      entries.push(entry);
      persist(entries);
      return clone(entry);
    },
  };
}
