/**
 * Session locks (M4-002): in-process latch that pins the profile served to a
 * (virtualModel, sessionId) pair so one conversation never flips models
 * mid-stream when the alias document is re-mapped. Pure module: entries live
 * only in memory and the clock is injected (same pattern as `createFileLock`),
 * so expiry and eviction are fully deterministic in tests. Cross-restart
 * persistence is deliberately out of scope — a latched session survives only
 * as long as the sidecar host.
 */
export interface SessionLockEntry {
  profileId: string;
  resolvedAt: string;
}

export interface SessionLockOptions {
  /**
   * Lease duration; an entry older than this is treated as absent. A thunk lets
   * the caller re-read a dynamic configuration (an aliases document's
   * `sessionTtlMs`) without rebuilding the lock.
   */
  ttlMs: number | (() => number);
  /** Clock returning an ISO timestamp (injected; unknown clock never evicts). */
  now(): string;
}

export interface SessionLock {
  /**
   * Bind (or re-bind) a key to a profile. An existing live binding wins — the
   * first resolution of a session is authoritative; later re-maps do NOT
   * overwrite it. Expired entries are evicted then replaced.
   */
  latch(key: string, profileId: string): SessionLockEntry;
  /** Live binding for a key, or null when absent/expired. */
  get(key: string): SessionLockEntry | null;
  /** Explicitly un-latch a key (client X-Session-Release, TTL on the caller). */
  release(key: string): void;
  /** Drop every expired entry; used to bound memory between requests. */
  sweep(): void;
  /** Number of live entries (0 = no session is being held). */
  size(): number;
}

function ttlOf(ttlMs: number | (() => number)): number {
  return typeof ttlMs === 'function' ? ttlMs() : ttlMs;
}

function isEntryLive(entry: SessionLockEntry, nowIso: string, ttlMs: number): boolean {
  const acquired = Date.parse(entry.resolvedAt);
  const at = Date.parse(nowIso);
  // Unknown clock (unparseable either side): treat as live, never evict.
  if (!Number.isFinite(acquired) || !Number.isFinite(at)) return true;
  return at - acquired < ttlMs;
}

export function createSessionLock(options: SessionLockOptions): SessionLock {
  const entries = new Map<string, SessionLockEntry>();
  return {
    latch: (key, profileId) => {
      const existing = entries.get(key);
      if (existing !== undefined && isEntryLive(existing, options.now(), ttlOf(options.ttlMs))) {
        return existing;
      }
      const entry: SessionLockEntry = { profileId, resolvedAt: options.now() };
      entries.set(key, entry);
      return entry;
    },
    get: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (!isEntryLive(entry, options.now(), ttlOf(options.ttlMs))) {
        entries.delete(key);
        return null;
      }
      return entry;
    },
    release: (key) => {
      entries.delete(key);
    },
    sweep: () => {
      const nowIso = options.now();
      for (const [key, entry] of entries) {
        if (!isEntryLive(entry, nowIso, ttlOf(options.ttlMs))) entries.delete(key);
      }
    },
    size: () => entries.size,
  };
}