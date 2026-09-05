// Synthetic fixtures for the profile store (M1-002). Everything is kept in
// memory: the fake Fsys is a Map-backed virtual filesystem with per-operation
// fault injection, so interruption/atomicity tests never touch the real disk.
import type { CompositeProfile } from '@lmps/domain';

// ---------------------------------------------------------------------------
// Synthetic profiles
// ---------------------------------------------------------------------------

export const BASE_DIR = '/store';
export const PROFILE_DIR = `${BASE_DIR}/profiles`;
export const BACKUP_DIR = `${BASE_DIR}/backups`;

export const FAKE_NOW = '2026-08-22T01:02:03.000Z';

export function validProfile(id: string, overrides: Partial<CompositeProfile> = {}): CompositeProfile {
  return {
    schemaVersion: 1,
    id,
    displayName: { 'zh-CN': `中文名 ${id}`, en: `Profile ${id}` },
    description: { en: `synthetic profile ${id}` },
    model: { modelKey: 'synthetic/test-model', family: 'gpt-test' },
    task: { type: 'quick-chat', typicalInputTokens: 1000 },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.7 },
    behavior: { mode: 'exclusive', rollback: 'best-effort' },
    validation: { source: 'manual' },
    metadata: { createdAt: FAKE_NOW, updatedAt: FAKE_NOW, tags: ['fixture'] },
    ...overrides,
  };
}

export const ALPHA = validProfile('alpha');
export const BETA = validProfile('beta', { runtime: { contextLength: 4096 } });
export const GAMMA = validProfile('gamma', {
  model: { modelKey: 'synthetic/other-model', family: 'openai-test' },
});

export function profileJson(profile: CompositeProfile): string {
  return JSON.stringify(profile, null, 2);
}

// ---------------------------------------------------------------------------
// Memory Fsys with fault injection
// ---------------------------------------------------------------------------

export type FsOp =
  | 'exists'
  | 'readFileUtf8'
  | 'writeFileUtf8'
  | 'mkdirRecursive'
  | 'readdirNames'
  | 'rename'
  | 'unlink'
  | 'fsyncFile';

/** Minimal file-system capability surface consumed by the store (mirrors `src/fsys.ts`). */
export interface Fsys {
  exists(path: string): boolean;
  readFileUtf8(path: string): string;
  writeFileUtf8(path: string, data: string): void;
  mkdirRecursive(path: string): void;
  readdirNames(path: string): string[];
  rename(from: string, to: string): void;
  unlink(path: string): void;
  fsyncFile(path: string): void;
}

export class FakeFs implements Fsys {
  /** Canonical key = forward-slash normalized absolute path. */
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  /** Operation call log, in order, for asserting that fsync/rename really ran. */
  readonly opLog: FsOp[] = [];
  private readonly faultsRemaining = new Map<FsOp, number>();

  /** Makes the next `op` calls throw an injected error `times` times. */
  faultNext(op: FsOp, times = 1): void {
    this.faultsRemaining.set(op, (this.faultsRemaining.get(op) ?? 0) + times);
  }

  private norm(p: string): string {
    return p.replace(/\\/g, '/');
  }

  private guard(op: FsOp): void {
    this.opLog.push(op);
    const remaining = this.faultsRemaining.get(op) ?? 0;
    if (remaining > 0) {
      this.faultsRemaining.set(op, remaining - 1);
      throw new Error(`injected fault: ${op}`);
    }
  }

  private ensureParents(path: string): void {
    const segments = this.norm(path).split('/');
    let dir = segments[0] === '' ? '/' : '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      dir = segments[i] === '' ? '/' : `${dir}/${segments[i]}`;
      this.dirs.add(this.norm(dir));
    }
    this.dirs.add('/');
  }

  exists(path: string): boolean {
    this.guard('exists');
    return this.files.has(this.norm(path));
  }

  readFileUtf8(path: string): string {
    this.guard('readFileUtf8');
    const key = this.norm(path);
    const value = this.files.get(key);
    if (value === undefined) throw new Error(`ENOENT: ${key}`);
    return value;
  }

  writeFileUtf8(path: string, data: string): void {
    this.guard('writeFileUtf8');
    this.ensureParents(path);
    this.files.set(this.norm(path), data);
  }

  mkdirRecursive(path: string): void {
    this.guard('mkdirRecursive');
    this.ensureParents(path);
  }

  readdirNames(path: string): string[] {
    this.guard('readdirNames');
    const prefix = `${this.norm(path)}/`;
    const names = new Set<string>();
    const addEntries = (key: string): void => {
      if (!key.startsWith(prefix)) return;
      const rest = key.slice(prefix.length);
      const next = rest.split('/')[0];
      if (next !== '') names.add(next);
    };
    for (const key of this.files.keys()) addEntries(key);
    for (const key of this.dirs.keys()) addEntries(key);
    return [...names].sort();
  }

  rename(from: string, to: string): void {
    this.guard('rename');
    const key = this.norm(from);
    const value = this.files.get(key);
    if (value === undefined) throw new Error(`ENOENT: ${key}`);
    this.files.delete(key);
    this.ensureParents(to);
    this.files.set(this.norm(to), value);
  }

  unlink(path: string): void {
    this.guard('unlink');
    this.files.delete(this.norm(path));
  }

  fsyncFile(path: string): void {
    this.guard('fsyncFile');
    if (!this.files.has(this.norm(path))) {
      throw new Error(`ENOENT: ${this.norm(path)}`);
    }
  }

  /** Sorted snapshot of every stored file path (for atomicity assertions). */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  hasTemp(): boolean {
    return [...this.files.keys()].some((key) => key.includes('.tmp-'));
  }
}

// ---------------------------------------------------------------------------
// Store context helpers
// ---------------------------------------------------------------------------

export interface StoreOptions {
  backupCount?: number;
  maxImportBytes?: number;
  /** Fixed clock for deterministic backup filenames. */
  frozenNow?: string;
}

/** A clock that advances one second per call unless frozen. */
export function makeClock(frozen?: string): () => string {
  // First call returns 2026-08-22T01:02:04.000Z (matches the fixture date and
  // mirrors "create happened, then the first update stamps 01:02:04").
  let ticks = 1;
  const epoch = Date.UTC(2026, 7, 22, 1, 2, 3, 0); // 2026-08-22T01:02:03.000Z
  return () => {
    if (frozen !== undefined) return frozen;
    const iso = new Date(epoch + ticks * 1000).toISOString();
    ticks += 1;
    return iso;
  };
}

export function makeFakeFs(): FakeFs {
  return new FakeFs();
}

// store context factory is defined in the store module; fixtures stay structural.