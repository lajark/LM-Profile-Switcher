/**
 * Activation locks (M1-005 deliverable). `createMemoryLock` serves tests and
 * single-process embeddings; `createFileLock` guards concurrent CLI/desktop
 * processes via a lease-bearing `activation.lock` file. A stale lease (crash
 * residue) is overwritten on acquire — crash cleanup on the next run.
 *
 * Known constraint, recorded honestly: existence-check plus write is not an
 * atomic compare-and-swap across processes, so strict multi-process mutual
 * exclusion has a TOCTOU window. The carrier/lease contract is validated by the
 * M0-006 sidecar spike once the Rust toolchain is available (TODO §5.3).
 */
import type { ActivationLock } from './ports.js';

/** Minimal file-system surface the file lock needs (injected, never Node). */
export interface LockFs {
  exists(path: string): boolean;
  readFileUtf8(path: string): string;
  writeFileUtf8(path: string, data: string): void;
  unlink(path: string): void;
}

export interface LockLease {
  owner: string;
  acquiredAt: string;
  leaseMs: number;
}

export interface FileLockOptions {
  path: string;
  owner: string;
  leaseMs: number;
  now(): string;
}

export function isLeaseLive(lease: LockLease, nowIso: string): boolean {
  const acquired = Date.parse(lease.acquiredAt);
  const at = Date.parse(nowIso);
  if (!Number.isFinite(acquired) || !Number.isFinite(at)) return true; // unknown clock → do not steal
  return at - acquired < lease.leaseMs;
}

export function createMemoryLock(): ActivationLock {
  let held = false;
  return {
    acquire: async (): Promise<boolean> => {
      if (held) return false;
      held = true;
      return true;
    },
    release: async () => {
      held = false;
    },
  };
}

export function createFileLock(fs: LockFs, options: FileLockOptions): ActivationLock {
  return {
    acquire: async (): Promise<boolean> => {
      const payload: LockLease = {
        owner: options.owner,
        acquiredAt: options.now(),
        leaseMs: options.leaseMs,
      };
      if (fs.exists(options.path)) {
        let lease: LockLease | undefined;
        try {
          const parsed = JSON.parse(fs.readFileUtf8(options.path)) as unknown;
          if (typeof parsed === 'object' && parsed !== null) lease = parsed as LockLease;
        } catch {
          // Corrupt lock file counts as stale residue; overwrite below.
        }
        if (lease !== undefined && isLeaseLive(lease, payload.acquiredAt)) {
          return false;
        }
      }
      // Crash residue (stale or corrupt) from a dead process is reclaimed here.
      fs.writeFileUtf8(
        options.path,
        JSON.stringify(payload, null, 2),
      );
      return true;
    },
    release: async () => {
      if (fs.exists(options.path)) fs.unlink(options.path);
    },
  };
}