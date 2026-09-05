import { describe, expect, it } from 'vitest';
import { captureSnapshot } from '@lmps/core';

import { ALPHA, NOW, makeContext, makeRuntime } from './fixtures';

describe('captureSnapshot', () => {
  it('captures the active state with a timestamp and redacts secrets', async () => {
    const runtime = makeRuntime({
      active: { profileId: 'alpha', modelKey: 'synthetic/test-model', since: NOW },
      readback: { runtime: { contextLength: 8192 }, credentials: { token: 'sk-live-secret' } },
    });
    const snapshot = await captureSnapshot(makeContext(), runtime, ALPHA);

    expect(snapshot.profileId).toBe('alpha');
    expect(snapshot.at).toBe(NOW);
    expect(snapshot.captured.active).toEqual({
      profileId: 'alpha',
      modelKey: 'synthetic/test-model',
      since: NOW,
    });
    // secret-valued keys never survive the capture.
    expect(JSON.stringify(snapshot.captured)).not.toContain('sk-live-secret');
    expect(snapshot.captured.effective).toEqual({
      runtime: { contextLength: 8192 },
      credentials: { token: '[redacted]' },
    });
  });

  it('captures with a fallback id when no profile and nothing is active', async () => {
    const runtime = makeRuntime();
    const snapshot = await captureSnapshot(makeContext(), runtime);
    expect(snapshot.profileId).toBe('none');
    expect(snapshot.captured.effective).toBeNull();
  });

  it('tolerates a failing readback (best-effort effective config)', async () => {
    const runtime = makeRuntime({
      active: { profileId: 'alpha', modelKey: 'm', since: NOW },
      faults: { readback: new Error('offline') },
    });
    const snapshot = await captureSnapshot(makeContext(), runtime, ALPHA);
    expect(snapshot.captured.effective).toBeNull();
    expect(snapshot.profileId).toBe('alpha');
  });

  it('redacts private paths even inside diagnostics-shaped records', async () => {
    const runtime = makeRuntime({
      active: { profileId: 'alpha', modelKey: 'm', since: NOW },
      readback: { paths: { log: 'C:\\Users\\alice\\.lmps\\logs' }, family: 'test' },
    });
    const snapshot = await captureSnapshot(makeContext(), runtime, ALPHA);
    expect(JSON.stringify(snapshot.captured)).not.toContain('alice');
    expect(snapshot.captured.effective.paths.log).toBe('<private>');
  });
});