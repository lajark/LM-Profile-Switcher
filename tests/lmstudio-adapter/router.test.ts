import { describe, expect, it } from 'vitest';

import { resolveAdapters } from '@lmps/lmstudio-adapter';
import { makeFakeEnv } from './fixtures.js';

function fakeProbe(overrides: Partial<{ restReachable: boolean; lmsAvailable: boolean; sdkAvailable: boolean }>) {
  return {
    matrices: [],
    ops: {
      restReachable: overrides.restReachable ?? false,
      lmsAvailable: overrides.lmsAvailable ?? false,
      sdkAvailable: overrides.sdkAvailable ?? false,
      restBaseUrl: 'http://127.0.0.1:1234',
      lmStudioVersion: null,
      engineVersion: null,
      observed: [],
      probedAt: '2026-08-22T01:02:03.000Z',
    },
    cached: false,
    expiresAt: '2026-08-22T01:02:43.000Z',
  };
}

describe('resolveAdapters', () => {
  it('never picks mock without the explicit override', async () => {
    const env = makeFakeEnv();
    const bundle = resolveAdapters(env, fakeProbe({ restReachable: true }));
    expect(bundle.writeSource).toBe('rest');
    expect(bundle.readSource).toBe('rest');
    expect(bundle.runtime).toBeDefined();
  });

  it('selects mock only under LMPS_ADAPTER=mock semantics', async () => {
    const env = makeFakeEnv();
    const bundle = resolveAdapters(env, fakeProbe({}), { selection: 'mock' });
    expect(bundle.writeSource).toBe('mock');
    expect(bundle.readSource).toBe('mock');
    await expect(bundle.discovery.listModels()).resolves.toEqual([]);
  });

  it('reads from the CLI adapter when REST is down but lms works', async () => {
    const env = makeFakeEnv({
      runLmsHandler: (args) => ({
        exitCode: 0,
        stdout: args.join(' ') === 'ls --json' ? JSON.stringify([{ id: 'codestral-22b.gguf' }]) : 'Server:  OFF',
        stderr: '',
        timedOut: false,
      }),
    });
    const bundle = resolveAdapters(env, fakeProbe({ lmsAvailable: true }));
    expect(bundle.readSource).toBe('cli');
    const models = await bundle.discovery.listModels();
    expect(models[0]).toMatchObject({ modelKey: 'codestral-22b.gguf' });
    // Writes must fail truthfully — no partial success offline.
    await expect(bundle.runtime.getActiveState()).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('fails cleanly when no source is reachable', async () => {
    const env = makeFakeEnv();
    const bundle = resolveAdapters(env, fakeProbe({}));
    expect(bundle.readSource).toBe('rest');
    await expect(bundle.discovery.listModels()).rejects.toMatchObject({ kind: 'unreachable' });
    await expect(bundle.runtime.unload()).rejects.toMatchObject({ kind: 'unreachable' });
  });
});