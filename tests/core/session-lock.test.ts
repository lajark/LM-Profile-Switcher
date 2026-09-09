// Session lock (M4-002): latch-then-reuse semantics (first resolution wins),
// TTL expiry, explicit release, sweep, and injected-clock failure handling —
// mirroring the lease policy of lock.ts (createFileLock / isLeaseLive).
import { describe, expect, it } from 'vitest';
import { createSessionLock } from '@lmps/core';

const T0 = '2026-09-08T10:00:00Z';
let nowIso = T0;

function makeLock(ttlMs = 60_000) {
  nowIso = T0;
  return createSessionLock({ ttlMs, now: () => nowIso });
}

/** Advance the fake clock by `ms`; returns nothing (mutation on purpose). */
function advance(ms: number): void {
  nowIso = new Date(Date.parse(nowIso) + ms).toISOString();
}

describe('createSessionLock', () => {
  it('latches a binding and get returns it while live', () => {
    const lock = makeLock();
    const entry = lock.latch('lmps://coder::sess-1', 'coding-9b');
    expect(entry.profileId).toBe('coding-9b');
    expect(lock.get('lmps://coder::sess-1')?.profileId).toBe('coding-9b');
    expect(lock.size()).toBe(1);
  });

  it('does not overwrite a live binding (first resolution wins)', () => {
    const lock = makeLock();
    lock.latch('lmps://coder::sess-1', 'coding-9b');
    const second = lock.latch('lmps://coder::sess-1', 'notes-7b');
    expect(second.profileId).toBe('coding-9b');
    expect(lock.get('lmps://coder::sess-1')?.profileId).toBe('coding-9b');
  });

  it('expired entries are treated as absent and can be re-latched', () => {
    const lock = makeLock(60_000);
    lock.latch('lmps://coder::sess-1', 'coding-9b');
    advance(61_000);
    expect(lock.get('lmps://coder::sess-1')).toBeNull();
    const reLatched = lock.latch('lmps://coder::sess-1', 'notes-7b');
    expect(reLatched.profileId).toBe('notes-7b');
    expect(lock.size()).toBe(1);
  });

  it('release explicitly unlatches', () => {
    const lock = makeLock();
    lock.latch('lmps://coder::sess-1', 'coding-9b');
    lock.release('lmps://coder::sess-1');
    expect(lock.get('lmps://coder::sess-1')).toBeNull();
    expect(lock.size()).toBe(0);
  });

  it('sweep evicts only expired entries', () => {
    const lock = makeLock(60_000);
    lock.latch('a::s1', 'p1');
    advance(30_000);
    lock.latch('b::s2', 'p2');
    advance(40_000); // a::s1 now 70s old (expired), b::s2 40s (live)
    lock.sweep();
    expect(lock.size()).toBe(1);
    expect(lock.get('b::s2')?.profileId).toBe('p2');
  });

  it('keys are namespaced per virtualModel::sessionId pair', () => {
    const lock = makeLock();
    lock.latch('lmps://coder::sess-1', 'coding-9b');
    lock.latch('lmps://notes::sess-1', 'notes-7b');
    lock.latch('lmps://coder::sess-2', 'notes-7b');
    expect(lock.size()).toBe(3);
  });

  it('an unparseable clock never evicts (unknown clock policy)', () => {
    nowIso = T0;
    const lock = createSessionLock({ ttlMs: 60_000, now: () => 'not-a-date' });
    lock.latch('a::s1', 'p1');
    expect(lock.get('a::s1')?.profileId).toBe('p1');
    expect(lock.size()).toBe(1);
  });
});