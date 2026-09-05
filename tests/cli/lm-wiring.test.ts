/**
 * M1-003 CLI wiring tests: `createLmStudioCliPorts` (deps.ts) threaded through
 * the real adapter router against a scripted fake host. Covers the online REST
 * path (discovery + active state + snapshot with profile-id backfill), the
 * offline path (LM_UNREACHABLE → exit 4 on every read port), the CLI-only
 * fallback (models ride on `lms ls --json`, current/snapshot stay honest), and
 * the reachability mapping gate. No sockets, no child processes, no real store.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearProbeCache,
  isLmStudioError,
  LmStudioError,
  type LmStudioEnv,
} from '@lmps/lmstudio-adapter';
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';

import { createLmStudioCliPorts, mapLmStudioReachability } from '../../apps/cli/src/deps.ts';
import { CliError, isCliError } from '../../apps/cli/src/errors.ts';
import { runCli } from '../../apps/cli/src/run.ts';
import { makeCliHarness, envelopeOf } from './helpers';
import { makeFakeEnv, restModelsBody, loadedModel } from '../lmstudio-adapter/fixtures';
import { BACKUP_DIR, FakeFs, PROFILE_DIR, makeClock } from '../profile-store/fixtures';
import { makeProfile } from '../core/fixtures';

const QWEN_KEY = 'qwen2.5-7b-instruct-q4_k_m.gguf';
const LLAMA_KEY = 'llama-3.2-3b-q8_0.gguf';

const REST_MODELS = () =>
  restModelsBody([
    loadedModel(QWEN_KEY, { context_length: 8192 }),
    { id: LLAMA_KEY, loaded: false, load_config: null },
  ]);

/** Store seeded with a profile that maps to the loaded REST model. */
function storeWithProfile(profileId = 'alpha'): ProfileStore {
  const fs = new FakeFs();
  const store = createProfileStore({ fs, now: makeClock(), profileDir: PROFILE_DIR, backupDir: BACKUP_DIR });
  store.create(makeProfile(profileId, { model: { modelKey: QWEN_KEY, family: 'qwen2' } }));
  return store;
}

function unreachableHttp(): LmStudioEnv['http'] {
  return async () => {
    throw new TypeError('fetch failed');
  };
}

describe('LM Studio CLI wiring (M1-003)', () => {
  beforeEach(() => clearProbeCache());

  it('serves models/current/snapshot from a reachable REST host and backfills profile ids', async () => {
    const store = storeWithProfile();
    const lmEnv = makeFakeEnv({
      baseUrl: 'http://127.0.0.1:3301',
      httpHandler: (path) =>
        path === '/api/v1/models'
          ? { status: 200, body: REST_MODELS() }
          : { status: 404, rawText: '{"error":"not found"}' },
    });
    const ports = createLmStudioCliPorts(store, { lmEnv });

    const summaries = await ports.discovery.listModels();
    expect(summaries).toEqual([
      { key: QWEN_KEY, family: 'qwen2', quantization: 'Q4_K_M', parametersB: 7 },
      { key: LLAMA_KEY, family: 'llama', quantization: 'Q8_0', parametersB: 3 },
    ]);

    const active = await ports.state.getActive();
    expect(active).toEqual({ profileId: 'alpha', modelKey: QWEN_KEY, since: null });

    const snap = await ports.snapshot.capture();
    expect(snap.profileId).toBe('alpha');
    expect(snap.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The raw capture still reflects REST (no profile identity downstream).
    expect((snap.captured.active as { modelKey: string }).modelKey).toBe(QWEN_KEY);
  });

  it('wires the three ports through the full CLI (human + --json)', async () => {
    const store = storeWithProfile();
    const lmEnv = makeFakeEnv({
      baseUrl: 'http://127.0.0.1:3302',
      httpHandler: (path) =>
        path === '/api/v1/models'
          ? { status: 200, body: REST_MODELS() }
          : { status: 404, rawText: '{"error":"not found"}' },
    });
    const ports = createLmStudioCliPorts(store, { lmEnv });
    const { deps } = makeCliHarness({
      discovery: ports.discovery,
      state: ports.state,
      snapshot: ports.snapshot,
    });

    const human = await runCli(['models'], deps);
    expect(human.exitCode).toBe(0);
    expect(human.text).toContain(QWEN_KEY);
    expect(human.text).toContain('Q4_K_M');

    const json = await runCli(['--json', 'models'], deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({
      models: [
        { key: QWEN_KEY, family: 'qwen2', quantization: 'Q4_K_M', parametersB: 7 },
        { key: LLAMA_KEY, family: 'llama', quantization: 'Q8_0', parametersB: 3 },
      ],
    });

    const current = await runCli(['current'], deps);
    expect(current.exitCode).toBe(0);
    expect(current.text).toContain('alpha');

    const snapJson = await runCli(['--json', 'snapshot'], deps);
    expect(snapJson.exitCode).toBe(0);
    const snapEnvelope = envelopeOf(snapJson.text);
    const snapshotData = (snapEnvelope.data as { snapshot: { profileId: string } }).snapshot;
    expect(snapshotData.profileId).toBe('alpha');
  });

  it('maps an unreachable host to LM_UNREACHABLE (exit 4) on every read port', async () => {
    const store = storeWithProfile();
    const lmEnv = makeFakeEnv({ baseUrl: 'http://127.0.0.1:3303', httpHandler: unreachableHttp() });
    const ports = createLmStudioCliPorts(store, { lmEnv });
    const { deps } = makeCliHarness({
      discovery: ports.discovery,
      state: ports.state,
      snapshot: ports.snapshot,
    });

    for (const command of ['models', 'current', 'snapshot']) {
      const result = await runCli([command], deps);
      expect(result.exitCode).toBe(4);
      expect(result.stderr).toContain('Cannot reach LM Studio');
    }

    const json = await runCli(['--json', 'models'], deps);
    const envelope = envelopeOf(json.text);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('LM_UNREACHABLE');
  });

  it('reads models via the lms CLI when REST is down, but current/snapshot stay honest', async () => {
    const store = storeWithProfile();
    const lmEnv = makeFakeEnv({
      baseUrl: 'http://127.0.0.1:3304',
      httpHandler: unreachableHttp(),
      runLmsHandler: (args) => {
        if (args[0] === 'status') return { exitCode: 0, stdout: 'Server:  OFF', stderr: '', timedOut: false };
        if (args[0] === 'ls' && args[1] === '--json') {
          return { exitCode: 0, stdout: JSON.stringify([{ id: QWEN_KEY }]), stderr: '', timedOut: false };
        }
        return { exitCode: 2, stdout: '', stderr: 'unknown', timedOut: false };
      },
    });
    const ports = createLmStudioCliPorts(store, { lmEnv });
    const { deps } = makeCliHarness({
      discovery: ports.discovery,
      state: ports.state,
      snapshot: ports.snapshot,
    });

    const models = await runCli(['models'], deps);
    expect(models.exitCode).toBe(0);
    expect(models.text).toContain(QWEN_KEY);

    // Discovery is readable via `lms`, but the active-state/snapshot write path
    // still needs REST; it must fail truthfully, not pretend.
    const current = await runCli(['current'], deps);
    expect(current.exitCode).toBe(4);
    expect(current.stderr).toContain('Cannot reach LM Studio');
  });

  it('lets a CLI-only value map to LM_UNREACHABLE without leaking LmStudioError details', async () => {
    const store = storeWithProfile();
    const lmEnv = makeFakeEnv({ baseUrl: 'http://127.0.0.1:3305', httpHandler: unreachableHttp() });
    const ports = createLmStudioCliPorts(store, { lmEnv });

    await expect(ports.state.getActive()).rejects.toBeInstanceOf(CliError);
    await expect(ports.state.getActive()).rejects.toMatchObject({ code: 'LM_UNREACHABLE' });
  });
});

describe('mapLmStudioReachability', () => {
  it('maps unreachable/timeout/auth kinds to LM_UNREACHABLE CliError', () => {
    for (const kind of ['unreachable', 'timeout', 'auth']) {
      const error = new LmStudioError(`rest ${kind}`, { subsystem: 'rest', kind });
      const mapped = mapLmStudioReachability(error);
      expect(isCliError(mapped)).toBe(true);
      expect((mapped as CliError).code).toBe('LM_UNREACHABLE');
      // The CliError must not carry the adapter error object.
      expect(isLmStudioError(mapped)).toBe(false);
    }
  });

  it('passes non-reachability kinds and plain errors through unchanged', () => {
    for (const kind of ['parse', 'process', 'unsupported', 'health', 'internal']) {
      const error = new LmStudioError(`rest ${kind}`, { subsystem: 'rest', kind });
      expect(mapLmStudioReachability(error)).toBe(error);
    }
    const plain = new Error('plain failure');
    expect(mapLmStudioReachability(plain)).toBe(plain);
  });
});