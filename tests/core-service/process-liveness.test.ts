// M6-003: the Windows-safe lock-lease liveness probe used by the sidecar's
// activation/benchmark locks. The POSIX branch (ESRCH → dead) is the exact
// path CI failed on before the fix: a dead owner's still-valid lease must be
// reclaimable. Both branches are exercised with the same assertions on any
// platform: the probe always reports the live test process as alive and a
// guaranteed-dead pid (above the platform's pid range) as gone.
import { describe, expect, it } from 'vitest';

import { isOwnerAlive } from '../../apps/core-service/src/process-liveness.ts';

/** A pid that cannot belong to any process on either platform (int32 max). */
const IMPOSSIBLE_PID = 2_147_483_647;

describe('isOwnerAlive (M6-003 lock crash-residue probe)', () => {
  it('reports the running test process as alive', () => {
    expect(isOwnerAlive(String(process.pid))).toBe(true);
  });

  it('reports a guaranteed-dead pid as gone so its lease is reclaimable', () => {
    expect(isOwnerAlive(String(IMPOSSIBLE_PID))).toBe(false);
  });

  it('never steals from unknown non-numeric owners', () => {
    expect(isOwnerAlive('sidecar')).toBe(true);
    expect(isOwnerAlive('')).toBe(true);
  });

  it('never steals from invalid numeric owners', () => {
    expect(isOwnerAlive('0')).toBe(true);
    expect(isOwnerAlive('-1')).toBe(true);
    expect(isOwnerAlive('not-a-number')).toBe(true);
  });
});
