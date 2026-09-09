// policy-scan:fixture — FAKE credential strings ('sk-test-secret') drive redaction assertions; exemption in scripts/lib/policy-scan-exemptions.json
// M3-002 sidecar data plane tests. The 9 profile/optimize/benchmark RPC
// handlers run over a REAL profile store on the memory FakeFs, with the
// recommendation/benchmark seams injected: the benchmark seam is a REAL
// createBenchmarkService fed deterministic ports (so core bounds/clamps and
// guard codes are genuinely exercised), the optimize seam is a stub that shapes
// a valid Recommendation. Every call goes through the real Dispatcher so the
// wire contract (result vs {code,message} error) is what is asserted.
import { describe, expect, it, vi } from 'vitest';

import {
  createBenchmarkService,
  type ActivationLock,
  type BenchmarkLogSink,
  type BenchmarkRuntime,
  type HardwarePort,
  type RunnerContext,
} from '@lmps/core';
import type { Candidate, CompositeProfile, Recommendation } from '@lmps/domain';
import { LmStudioError } from '@lmps/lmstudio-adapter';
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';

import type { SidecarBenchmarkSeam, SidecarRecommendationSeam } from '../../apps/core-service/src/wiring.ts';
import { createHandlers, type SidecarHandlerOptions } from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type DispatchResult } from '../../apps/core-service/src/protocol.ts';
import { FakeFs, FAKE_NOW, validProfile } from '../profile-store/fixtures.ts';

const RULE_VERSION = '2026.09.1';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    schemaVersion: 2,
    id: 'alpha-max',
    profile: {
      ...validProfile('alpha-max'),
      runtime: { contextLength: 16384, gpuOffload: 'max', flashAttention: true },
    },
    baselineProfileId: 'alpha',
    estimate: {
      schemaVersion: 2,
      provider: 'exact',
      modelKey: 'synthetic/test-model',
      vramTotalBytes: 6 * 1024 ** 3,
      systemRamBytes: 2 * 1024 ** 3,
      estimatedAt: FAKE_NOW,
      warnings: [],
    },
    safety: {
      safe: true,
      reason: null,
      vramUsedBytes: 6 * 1024 ** 3,
      vramAvailableBytes: 12 * 1024 ** 3,
      headroomBytes: 6 * 1024 ** 3,
    },
    score: {
      total: 0.55,
      breakdown: { vramEfficiency: 0.5, latency: 0.25, throughput: 0.0625, quality: 0.9 },
      confidence: 'high',
      measured: false,
    },
    diff: [{ path: 'runtime.contextLength', baseline: 8192, candidate: 16384 }],
    rationale: { 'zh-CN': '候选配置', en: 'candidate configuration' },
    ...overrides,
  };
}

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    schemaVersion: 2,
    baselineProfileId: 'alpha',
    taskKind: 'quick-chat',
    ruleVersion: RULE_VERSION,
    candidates: [candidate()],
    selectedIndex: 0,
    generatedAt: FAKE_NOW,
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Plane harness
// ---------------------------------------------------------------------------

function makeStore(): ProfileStore {
  return createProfileStore({
    fs: new FakeFs(),
    now: () => FAKE_NOW,
    profileDir: '/store/profiles',
    backupDir: '/store/backups',
  });
}

function stubRecommendation(rec: Recommendation): SidecarRecommendationSeam {
  return { service: { recommend: async () => rec }, audit: vi.fn() };
}

interface PlaneOptions {
  store?: ProfileStore;
  recommendation?: SidecarRecommendationSeam | null;
  benchmark?: SidecarBenchmarkSeam | null;
}

function makePlane(options: PlaneOptions = {}): Dispatcher {
  const handlerOptions: SidecarHandlerOptions = {
    lmBaseUrl: undefined,
    lmToken: null,
    lmsBin: undefined,
    store: options.store ?? makeStore(),
    recommendation: options.recommendation ?? null,
    benchmark: options.benchmark ?? null,
    now: () => FAKE_NOW,
  };
  return new Dispatcher(createHandlers(handlerOptions));
}

function dispatch(plane: Dispatcher, method: string, params: Record<string, unknown> = {}): Promise<DispatchResult> {
  return plane.dispatch({ jsonrpc: '2.0', id: 1, method, params }, new AbortController().signal);
}

async function createProfile(plane: Dispatcher, profile: CompositeProfile): Promise<void> {
  const res = await dispatch(plane, 'profiles.create', { profile });
  expect(res.error).toBeUndefined();
}

// ---------------------------------------------------------------------------
// Benchmark seam: real service, deterministic ports
// ---------------------------------------------------------------------------

interface BenchmarkFakes {
  runtime: BenchmarkRuntime;
  hardware: HardwarePort;
  lock: ActivationLock;
  log: BenchmarkLogSink;
}

function benchmarkSeam(fakes: Partial<BenchmarkFakes> = {}): SidecarBenchmarkSeam {
  const runtime: BenchmarkRuntime = fakes.runtime ?? {
    getActiveState: async () => ({ profileId: null, modelKey: null, since: null }),
    load: async () => ({ loadConfig: {}, loadMs: 40 }),
    measure: vi.fn(async () => ({ ttftMs: 5, generatedTokens: 32, totalMs: 12, finishReason: 'stop' })),
    restore: async () => {},
  };
  const hardware: HardwarePort = fakes.hardware ?? { profile: async () => ({}) };
  const lock: ActivationLock = fakes.lock ?? { acquire: async () => true, release: async () => {} };
  const log: BenchmarkLogSink = fakes.log ?? { write: vi.fn(async () => {}) };
  // defaultStageTimeoutMs 0: the per-sample timeout guard is skipped in tests,
  // so no real 60s timer is left behind.
  const ctx: RunnerContext = {
    now: () => FAKE_NOW,
    wait: async () => {},
    defaultStageTimeoutMs: 0,
    createTxId: () => 'tx-test',
  };
  return { service: createBenchmarkService(ctx, { runtime, hardware, lock, log }) };
}

// ---------------------------------------------------------------------------
// profiles.*
// ---------------------------------------------------------------------------

describe('profiles data plane (M3-002)', () => {
  it('meta reports the seed task kinds', async () => {
    const res = await dispatch(makePlane(), 'profiles.meta');
    expect(res.error).toBeUndefined();
    const kinds = (res.result as { taskKinds: string[] }).taskKinds;
    expect(kinds).toContain('quick-chat');
    expect(kinds).toContain('custom');
    expect(kinds.length).toBeGreaterThanOrEqual(11);
  });

  it('list returns projected cards without secrets or store metadata', async () => {
    const plane = makePlane();
    await createProfile(plane, validProfile('beta', { runtime: { contextLength: 4096 } }));
    await createProfile(plane, { ...validProfile('zeta'), apiKey: 'sk-test-secret' });

    const res = await dispatch(plane, 'profiles.list');
    expect(res.error).toBeUndefined();
    const cards = (res.result as { profiles: Record<string, unknown>[] }).profiles;
    // sorted by id
    expect(cards.map((c) => c.id)).toEqual(['beta', 'zeta']);
    const zeta = cards[1] as Record<string, unknown>;
    expect(zeta['apiKey']).toBeUndefined();
    expect(zeta['metadata']).toBeUndefined();
    expect(zeta['model']).toEqual({ modelKey: 'synthetic/test-model', family: 'gpt-test', quantization: null });
    expect(zeta['task']).toEqual({ type: 'quick-chat', kind: null });
    expect(zeta['updatedAt']).toBe(FAKE_NOW);
  });

  it('show exports the sanitized document (apiKey → null, domain fields intact)', async () => {
    const plane = makePlane();
    await createProfile(plane, { ...validProfile('alpha'), apiKey: 'sk-test-secret' });

    const res = await dispatch(plane, 'profiles.show', { id: 'alpha' });
    expect(res.error).toBeUndefined();
    const shown = res.result as { profile: Record<string, unknown> };
    expect(shown.profile['apiKey']).toBeNull();
    expect(shown.profile['id']).toBe('alpha');
    expect(shown.profile['model']).toMatchObject({ modelKey: 'synthetic/test-model' });
  });

  it('show maps missing and invalid ids to stable store codes', async () => {
    const plane = makePlane();
    const missing = await dispatch(plane, 'profiles.show', { id: 'nope' });
    expect(missing.error).toEqual({ code: 'STORE_NOT_FOUND', message: 'profile does not exist' });
    const badId = await dispatch(plane, 'profiles.show', { id: 'Bad Id!' });
    expect(badId.error?.code).toBe('STORE_INVALID_ID');
  });

  it('create rejects non-object bodies, invalid ids and duplicates', async () => {
    const plane = makePlane();
    const notObject = await dispatch(plane, 'profiles.create', { profile: 'nope' });
    expect(notObject.error?.code).toBe('PROFILE_INVALID');

    // create validates the WHOLE document through the domain schema first, so
    // id-shape violations surface as PROFILE_INVALID here (raw-id guarding with
    // STORE_INVALID_ID applies to get/update/delete).
    const invalidId = await dispatch(plane, 'profiles.create', { profile: validProfile('Bad Id!') });
    expect(invalidId.error?.code).toBe('PROFILE_INVALID');

    await createProfile(plane, validProfile('alpha'));
    const dup = await dispatch(plane, 'profiles.create', { profile: validProfile('alpha') });
    expect(dup.error?.code).toBe('STORE_ALREADY_EXISTS');

    // Domain contract violations collapse to PROFILE_INVALID.
    const incomplete = await dispatch(plane, 'profiles.create', { profile: { id: 'broken' } });
    expect(incomplete.error?.code).toBe('PROFILE_INVALID');
  });

  it('update deep-merges, keeps the id immutable and stamps updatedAt', async () => {
    const plane = makePlane();
    await createProfile(plane, validProfile('alpha'));

    const res = await dispatch(plane, 'profiles.update', {
      id: 'alpha',
      patch: { runtime: { gpuOffload: 0.4 } },
    });
    expect(res.error).toBeUndefined();
    expect((res.result as { id: string }).id).toBe('alpha');

    const doc = await dispatch(plane, 'profiles.show', { id: 'alpha' });
    const shown = (doc.result as { profile: CompositeProfile }).profile;
    // deep merge: contextLength survives, gpuOffload replaced
    expect(shown.runtime).toEqual({ contextLength: 8192, gpuOffload: 0.4 });
    expect(shown.metadata.updatedAt).toBe(FAKE_NOW);

    const immutable = await dispatch(plane, 'profiles.update', { id: 'alpha', patch: { id: 'other' } });
    expect(immutable.error?.code).toBe('STORE_INVALID_ID');

    const notObject = await dispatch(plane, 'profiles.update', { id: 'alpha', patch: [] });
    expect(notObject.error?.code).toBe('PROFILE_INVALID');

    const missing = await dispatch(plane, 'profiles.update', { id: 'nope', patch: { runtime: {} } });
    expect(missing.error?.code).toBe('STORE_NOT_FOUND');
  });

  it('delete removes and a second delete reports STORE_NOT_FOUND', async () => {
    const plane = makePlane();
    await createProfile(plane, validProfile('alpha'));

    const res = await dispatch(plane, 'profiles.delete', { id: 'alpha' });
    expect(res.error).toBeUndefined();
    expect((res.result as { id: string }).id).toBe('alpha');

    const again = await dispatch(plane, 'profiles.delete', { id: 'alpha' });
    expect(again.error?.code).toBe('STORE_NOT_FOUND');
  });

  it('profiles.* report METHOD_UNSUPPORTED when no store is wired', async () => {
    const plane = new Dispatcher(
      createHandlers({ lmBaseUrl: undefined, lmToken: null, lmsBin: undefined }),
    );
    const res = await dispatch(plane, 'profiles.list');
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// optimize.*
// ---------------------------------------------------------------------------

describe('optimize data plane (M3-002)', () => {
  it('preview returns the recommendation and writes nothing', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const rec = recommendation();
    const seam = stubRecommendation(rec);
    const plane = makePlane({ store, recommendation: seam });

    const res = await dispatch(plane, 'optimize.preview', { profileId: 'alpha' });
    expect(res.error).toBeUndefined();
    expect((res.result as { recommendation: Recommendation }).recommendation).toEqual(rec);
    expect(seam.audit).not.toHaveBeenCalled();
    expect(store.list().length).toBe(1);
  });

  it('save applies the head candidate, persists a rule-recommended profile and audits', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const seam = stubRecommendation(recommendation());
    const plane = makePlane({ store, recommendation: seam });

    const res = await dispatch(plane, 'optimize.save', { profileId: 'alpha' });
    expect(res.error).toBeUndefined();
    const body = res.result as { appliedProfileId: string };
    expect(body.appliedProfileId).toBe('alpha-2026.09.1');

    const saved = store.get('alpha-2026.09.1');
    expect(saved.validation).toEqual({ source: 'rule-recommended', testedAt: FAKE_NOW });
    expect(saved.metadata.createdAt).toBe(FAKE_NOW);
    expect(saved.id).toBe('alpha-2026.09.1');

    expect(seam.audit).toHaveBeenCalledTimes(1);
    const entry = (seam.audit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      at: FAKE_NOW,
      baselineProfileId: 'alpha',
      appliedProfileId: 'alpha-2026.09.1',
      taskKind: 'quick-chat',
      ruleVersion: RULE_VERSION,
      confidence: 'high',
      candidateId: 'alpha-max',
    });
  });

  it('save refuses when nothing is safe', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const rec = recommendation({ candidates: [], selectedIndex: null });
    const plane = makePlane({ store, recommendation: stubRecommendation(rec) });

    const res = await dispatch(plane, 'optimize.save', { profileId: 'alpha' });
    expect(res.error?.code).toBe('OPTIMIZE_REFUSED');
    expect(res.error?.message).toBe('no-safe-candidate');
  });

  it('save refuses when the head candidate is only low-confidence', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const rec = recommendation({ candidates: [candidate({ score: { ...candidate().score, confidence: 'low' } })] });
    const plane = makePlane({ store, recommendation: stubRecommendation(rec) });

    const res = await dispatch(plane, 'optimize.save', { profileId: 'alpha' });
    expect(res.error?.code).toBe('OPTIMIZE_REFUSED');
    expect(res.error?.message).toBe('low-confidence');
  });

  it('saving the same head twice surfaces STORE_ALREADY_EXISTS without rollback', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const seam = stubRecommendation(recommendation());
    const plane = makePlane({ store, recommendation: seam });

    const first = await dispatch(plane, 'optimize.save', { profileId: 'alpha' });
    expect(first.error).toBeUndefined();
    const second = await dispatch(plane, 'optimize.save', { profileId: 'alpha' });
    expect(second.error?.code).toBe('STORE_ALREADY_EXISTS');
    expect(seam.audit).toHaveBeenCalledTimes(1);
  });

  it('optimize maps a missing or non-string profileId to STORE_INVALID_ID', async () => {
    const plane = makePlane({ recommendation: stubRecommendation(recommendation()) });
    const missing = await dispatch(plane, 'optimize.preview', {});
    expect(missing.error?.code).toBe('STORE_INVALID_ID');
    const nonString = await dispatch(plane, 'optimize.preview', { profileId: 7 });
    expect(nonString.error?.code).toBe('STORE_INVALID_ID');
  });

  it('optimize reports METHOD_UNSUPPORTED when the seam is absent', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const plane = makePlane({ store });
    const res = await dispatch(plane, 'optimize.preview', { profileId: 'alpha' });
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// benchmark.*
// ---------------------------------------------------------------------------

describe('benchmark data plane (M3-002)', () => {
  it('run clamps sample counts to the core bound and returns validated:false', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const measure = vi.fn(
      async () => ({ ttftMs: 5, generatedTokens: 32, totalMs: 12, finishReason: 'stop' as const }),
    );
    const runtime: BenchmarkRuntime = {
      getActiveState: async () => ({ profileId: null, modelKey: null, since: null }),
      load: async () => ({ loadConfig: {}, loadMs: 40 }),
      measure,
      restore: async () => {},
    };
    const plane = makePlane({ store, benchmark: benchmarkSeam({ runtime }) });

    const res = await dispatch(plane, 'benchmark.run', {
      profileId: 'alpha',
      samples: 99,
      maxTokens: 99,
    });
    expect(res.error).toBeUndefined();
    const body = res.result as { result: { status: string; errorCode: string | null }; validated: boolean };
    expect(body.validated).toBe(false);
    expect(body.result.status).toBe('completed');
    // samples 99 → clamped to the core bound (10), so exactly 10 measures ran.
    expect(measure).toHaveBeenCalledTimes(10);
  });

  it('battery guard throws BENCHMARK_BATTERY_GUARD unless allowBattery', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const onBattery = { profile: async () => ({ power: { onBattery: true } }) } as HardwarePort;
    const plane = makePlane({ store, benchmark: benchmarkSeam({ hardware: onBattery }) });

    const refused = await dispatch(plane, 'benchmark.run', { profileId: 'alpha' });
    expect(refused.error?.code).toBe('BENCHMARK_BATTERY_GUARD');

    const allowed = await dispatch(plane, 'benchmark.run', { profileId: 'alpha', allowBattery: true });
    expect(allowed.error).toBeUndefined();
  });

  it('a held lock reports BENCHMARK_LOCK_BUSY', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const busy = { acquire: async () => false, release: async () => {} };
    const plane = makePlane({ store, benchmark: benchmarkSeam({ lock: busy }) });

    const res = await dispatch(plane, 'benchmark.run', { profileId: 'alpha' });
    expect(res.error?.code).toBe('BENCHMARK_LOCK_BUSY');
  });

  it('an adapter time-out is a failed RESULT (classified), not an RPC error', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const log = { write: vi.fn(async () => {}) };
    const seam = benchmarkSeam({
      runtime: {
        getActiveState: async () => ({ profileId: null, modelKey: null, since: null }),
        load: async () => ({ loadConfig: {}, loadMs: 40 }),
        // An adapter-shaped sample failure (REST timeout classification); core
        // classifies measurement failures by the error's kind/code field.
        measure: async () => {
          throw new LmStudioError('sample timed out', { subsystem: 'rest', kind: 'timeout' });
        },
        restore: async () => {},
      },
      log,
    });
    const plane = makePlane({ store, benchmark: seam });

    const res = await dispatch(plane, 'benchmark.run', { profileId: 'alpha', samples: 2 });
    expect(res.error).toBeUndefined();
    const body = res.result as { result: { status: string; errorCode: string | null } };
    expect(body.result.status).toBe('failed');
    expect(body.result.errorCode).toBe('BENCHMARK_TIMEOUT');
    expect(log.write).toHaveBeenCalledTimes(1);
  });

  it('host unreachability surfaces as LM_UNREACHABLE', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const seam = benchmarkSeam({
      runtime: {
        getActiveState: async () => ({ profileId: null, modelKey: null, since: null }),
        load: async () => {
          throw new LmStudioError('LM Studio unreachable', { subsystem: 'rest', kind: 'unreachable' });
        },
        measure: async () => ({ ttftMs: 5, generatedTokens: 32, totalMs: 12, finishReason: 'stop' }),
        restore: async () => {},
      },
    });
    const plane = makePlane({ store, benchmark: seam });

    const res = await dispatch(plane, 'benchmark.run', { profileId: 'alpha' });
    expect(res.error?.code).toBe('LM_UNREACHABLE');
  });

  it('benchmark reports METHOD_UNSUPPORTED when the seam is absent', async () => {
    const store = makeStore();
    store.create(validProfile('alpha'));
    const plane = makePlane({ store });
    const res = await dispatch(plane, 'benchmark.run', { profileId: 'alpha' });
    expect(res.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});