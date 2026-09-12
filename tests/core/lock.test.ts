import { describe, expect, it } from 'vitest';
import { createFileLock, createMemoryLock, isLeaseLive, type LockFs } from '@lmps/core';

import { FakeFs } from '../profile-store/fixtures';

const LOCK_PATH = '/root/activation.lock';

function context() {
  const fs = new FakeFs();
  const lockPath = LOCK_PATH;
  const lock = createFileLock(fs, {
    path: lockPath,
    owner: 'test-owner',
    leaseMs: 60_000,
    now: () => '2026-08-22T01:00:00.000Z',
  });
  return { fs, lock, lockPath };
}

function writeLease(fs: LockFs, path: string, owner: string, acquiredAt: string, leaseMs: number): void {
  fs.writeFileUtf8(path, JSON.stringify({ owner, acquiredAt, leaseMs }));
}

describe('createMemoryLock', () => {
  it('acquire/release/acquire round-trips', async () => {
    const lock = createMemoryLock();
    expect(await lock.acquire()).toBe(true);
    expect(await lock.acquire()).toBe(false);
    await lock.release();
    expect(await lock.acquire()).toBe(true);
  });
});

describe('createFileLock', () => {
  it('writes a lease and rejects a second holder', async () => {
    const { fs, lock, lockPath } = context();
    expect(await lock.acquire()).toBe(true);
    expect(fs.exists(lockPath)).toBe(true);
    expect(JSON.parse(fs.readFileUtf8(lockPath))).toMatchObject({ owner: 'test-owner', leaseMs: 60_000 });

    const second = createFileLock(fs, {
      path: lockPath,
      owner: 'other-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:01.000Z',
    });
    expect(await second.acquire()).toBe(false);
  });

  it('release removes the lease file', async () => {
    const { fs, lock, lockPath } = context();
    await lock.acquire();
    expect(fs.exists(lockPath)).toBe(true);
    await lock.release();
    expect(fs.exists(lockPath)).toBe(false);
  });

  it('reclaims an expired lease (crash residue) without a release', async () => {
    const { fs, lockPath } = context();
    writeLease(fs, lockPath, 'dead-owner', '2026-08-22T00:00:00.000Z', 30_000);
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'new-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
    });
    expect(await lock.acquire()).toBe(true);
    expect(JSON.parse(fs.readFileUtf8(lockPath))).toMatchObject({ owner: 'new-owner' });
  });

  it('reclaims a corrupt lock file as stale residue', async () => {
    const { fs, lockPath } = context();
    fs.writeFileUtf8(lockPath, '{not json');
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'test-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
    });
    expect(await lock.acquire()).toBe(true);
  });

  it('does not steal a live lease from another process', async () => {
    const { fs, lockPath } = context();
    writeLease(fs, lockPath, 'other-owner', '2026-08-22T00:59:30.000Z', 60_000);
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'test-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
    });
    expect(await lock.acquire()).toBe(false);
  });

  it('keeps blocking a live lease whose owner is alive (M6-003: never steal)', async () => {
    const { fs, lockPath } = context();
    writeLease(fs, lockPath, '424242', '2026-08-22T00:59:30.000Z', 60_000);
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'new-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
      isOwnerAlive: (owner) => owner === '424242',
    });
    expect(await lock.acquire()).toBe(false);
  });

  it('reclaims a live lease whose owner is dead (M6-003 crash residue)', async () => {
    const { fs, lockPath } = context();
    writeLease(fs, lockPath, '999999', '2026-08-22T00:59:30.000Z', 60_000);
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'new-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
      isOwnerAlive: (owner) => owner !== '999999',
    });
    expect(await lock.acquire()).toBe(true);
    expect(JSON.parse(fs.readFileUtf8(lockPath))).toMatchObject({ owner: 'new-owner' });
  });

  it('treats an uncertain liveness probe as alive (M6-003: fail closed)', async () => {
    const { fs, lockPath } = context();
    writeLease(fs, lockPath, '424242', '2026-08-22T00:59:30.000Z', 60_000);
    // A probe that throws counts as "unknown": the live lease must block.
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'new-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
      isOwnerAlive: () => {
        throw new Error('probe unavailable');
      },
    });
    expect(await lock.acquire()).toBe(false);
  });

  it('treats a non-numeric owner as alive when a liveness probe exists (never steal)', async () => {
    const { fs, lockPath } = context();
    writeLease(fs, lockPath, 'some-label', '2026-08-22T00:59:30.000Z', 60_000);
    // The lock trusts the probe; a probe that only knows numeric pids must
    // report unknown owners as alive so the live lease keeps blocking.
    const lock = createFileLock(fs, {
      path: lockPath,
      owner: 'new-owner',
      leaseMs: 60_000,
      now: () => '2026-08-22T01:00:00.000Z',
      isOwnerAlive: (owner) => !Number.isInteger(Number(owner)) || Number(owner) > 0,
    });
    expect(await lock.acquire()).toBe(false);
  });
});

describe('isLeaseLive', () => {
  it('is live when the elapsed time is below the lease', () => {
    expect(isLeaseLive({ owner: 'a', acquiredAt: '2026-08-22T00:59:30.000Z', leaseMs: 60_000 }, '2026-08-22T01:00:00.000Z')).toBe(true);
  });

  it('is expired at exactly the lease boundary', () => {
    expect(isLeaseLive({ owner: 'a', acquiredAt: '2026-08-22T00:59:00.000Z', leaseMs: 60_000 }, '2026-08-22T01:00:00.000Z')).toBe(false);
  });

  it('refuses to judge on an unknown clock (never steals)', () => {
    expect(isLeaseLive({ owner: 'a', acquiredAt: 'not-a-date', leaseMs: 60_000 }, '2026-08-22T01:00:00.000Z')).toBe(true);
  });
});