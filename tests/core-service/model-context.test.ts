import { describe, expect, it, vi } from 'vitest';

import type { ActivationRunResult, BenchmarkResult, CompositeProfile, ModelDiscoveryRecord, ReadinessSnapshot } from '@lmps/core';
import { createProfileStore, type ProfileStore } from '@lmps/profile-store';
import type { SidecarActivationSeam, SidecarModelContextSeam, SidecarOptimizationSeam } from '../../apps/core-service/src/wiring.ts';
import { createHandlers } from '../../apps/core-service/src/handlers.ts';
import { Dispatcher, type DispatchResult } from '../../apps/core-service/src/protocol.ts';
import { FakeFs, FAKE_NOW, validProfile } from '../profile-store/fixtures.ts';

const NOW = FAKE_NOW;


function createStore(fs: FakeFs): ProfileStore {
  return createProfileStore({
    fs,
    now: () => NOW,
    profileDir: '/store/profiles',
    backupDir: '/store/backups',
  });
}

function store(): ProfileStore {
  return createStore(new FakeFs());
}
function source(overrides: Partial<Awaited<ReturnType<SidecarModelContextSeam['read']>>> = {}): SidecarModelContextSeam {
  const readiness: ReadinessSnapshot = {
    hardware: { status: 'ready', fingerprint: 'hw-1' },
    lmStudio: { status: 'ready', version: '0.3.0' },
    discovery: { status: 'ready', observedAt: NOW },
    runtime: { status: 'idle', active: null },
  };
  const models: ModelDiscoveryRecord[] = [
    { modelKey: 'synthetic/test-model', family: 'synthetic', quantization: 'Q4_K_M', parametersB: 7 },
  ];
  return {
    read: async () => ({ models, benchmarks: [], readiness, ...overrides }),
  };
}

function dispatch(handlers: ReturnType<typeof createHandlers>, method: string, params: Record<string, unknown> = {}): Promise<DispatchResult> {
  return new Dispatcher(handlers).dispatch(
    { jsonrpc: '2.0', id: 1, method, params },
    new AbortController().signal,
  );
}

describe('models.context RPC', () => {
  it('returns structured model/scenario/profile/benchmark context and keeps legacy entries visible', async () => {
    const fs = new FakeFs();
    const profiles = createStore(fs);
    profiles.create(validProfile('alpha', { task: { type: 'chat' } }));
    profiles.create(validProfile('beta', { task: { type: 'rag' } }));
    const benchmark: BenchmarkResult = {
      schemaVersion: 2,
      id: 'bench-chat',
      modelKey: 'synthetic/test-model',
      taskType: 'chat',
      status: 'completed',
      metrics: { samples: 1 },
      startedAt: NOW,
      finishedAt: NOW,
    };
    fs.writeFileUtf8(
      '/store/profiles/legacy.json',
      JSON.stringify({ schemaVersion: 1, id: 'legacy', displayName: { en: 'Legacy', 'zh-CN': '旧' } }),
    );
    const result = await dispatch(
      createHandlers({
        lmBaseUrl: undefined,
        lmToken: null,
        lmsBin: undefined,
        store: profiles,
        modelContext: source({ benchmarks: [benchmark] }),
        now: () => NOW,
      }),
      'models.context',
    );

    expect(result.error).toBeUndefined();
    const body = result.result as {
      models: Array<{ model: { modelKey: string }; scenarios: Array<Record<string, unknown>> }>;
      needsOrganization: Array<Record<string, unknown>>;
    };
    expect(body.models[0]?.model.modelKey).toBe('synthetic/test-model');
    expect(body.models[0]?.scenarios.map((scenario) => scenario.type)).toEqual(['chat', 'rag']);
    expect(body.models[0]?.scenarios[0]).toMatchObject({ defaultProfileId: null, defaultState: 'none', benchmarkCount: 1 });
    expect(body.needsOrganization).toEqual([
      { id: 'legacy', reason: 'unclassifiable-model-or-scenario' },
    ]);
  });

  it('reports an unoptimized model explicitly when discovery says it is missing', async () => {
    const profiles = store();
    profiles.create(
      validProfile('missing', {
        model: { modelKey: 'missing-model', family: 'old' },
        validation: {
          source: 'benchmarked',
          testedAt: '2026-08-01T00:00:00.000Z',
          hardwareFingerprint: 'old-hw',
          lmStudioVersion: '0.2.0',
        },
      }),
    );
    const result = await dispatch(
      createHandlers({
        lmBaseUrl: undefined,
        lmToken: null,
        lmsBin: undefined,
        store: profiles,
        modelContext: source({ models: [] }),
        now: () => NOW,
      }),
      'models.context',
    );
    expect(result.error).toBeUndefined();
    const model = (result.result as { models: Array<Record<string, unknown>> }).models[0];
    expect(model).toMatchObject({ availability: 'missing', profileState: 'available' });
    expect((model?.scenarios as Array<Record<string, unknown>>)[0]).toMatchObject({ evidence: 'changed-environment' });
  });

  it('persists an explicit default for the selected model and scenario', async () => {
    const fs = new FakeFs();
    const profiles = createStore(fs);
    profiles.create(validProfile('alpha', { task: { type: 'chat' } }));
    const handlers = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      rootDir: '/store',
      fs,
      store: profiles,
      modelContext: source(),
      now: () => NOW,
    });

    const result = await dispatch(handlers, 'defaults.set', { profileId: 'alpha' });
    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      default: { modelKey: 'synthetic/test-model', taskType: 'chat', profileId: 'alpha', updatedAt: NOW },
    });
    expect(JSON.parse(fs.readFileUtf8('/store/profile-defaults.json'))).toMatchObject({
      schemaVersion: 1,
      entries: [{ modelKey: 'synthetic/test-model', taskType: 'chat', profileId: 'alpha', updatedAt: NOW }],
    });
  });

  it('routes the model-first optimization preparation and explicit save', async () => {
    const profiles = store();
    profiles.create(validProfile('alpha', { task: { type: 'chat' } }));
    const preparation = {
      baselineProfile: validProfile('alpha', { task: { type: 'chat' } }),
      baselineBenchmark: { decision: 'skip' as const, result: null },
      recommendation: null,
      selectedCandidate: null,
      candidateBenchmark: { decision: 'not-run' as const, result: null },
      candidateEvidence: 'not-run' as const,
      status: 'no-candidate' as const,
    };
    const seam: SidecarOptimizationSeam = {
      service: {
        prepare: vi.fn(async () => preparation),
        save: vi.fn(() => ({ profile: validProfile('saved'), isDefault: true })),
        setDefault: vi.fn(() => validProfile('saved')),
        getDefault: vi.fn(() => null),
      },
    };
    const handlers = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      rootDir: '/store',
      fs: new FakeFs(),
      store: profiles,
      optimization: seam,
      now: () => NOW,
    });
    const prepared = await dispatch(handlers, 'optimization.prepare', {
      profileId: 'alpha',
      baselineBenchmark: 'skip',
      candidateBenchmark: 'skip',
    });
    expect(prepared.error).toBeUndefined();
    const preparationId = (prepared.result as { preparationId: string }).preparationId;
    const saved = await dispatch(handlers, 'optimization.save', { preparationId, id: 'saved' });
    expect(saved.error).toBeUndefined();
    expect(saved.result).toEqual({ profileId: 'saved', isDefault: true });
    expect(seam.service.save).toHaveBeenCalledWith(preparation, { id: 'saved', setDefault: false });
  });
  it('prepares an unsaved safe baseline for a discovered model without profiles', async () => {
    const profiles = store();
    const preparation = {
      baselineProfile: validProfile('draft-synthetic-test-model-quick-chat'),
      baselineBenchmark: { decision: 'skip' as const, result: null },
      recommendation: null,
      selectedCandidate: null,
      candidateBenchmark: { decision: 'not-run' as const, result: null },
      candidateEvidence: 'not-run' as const,
      status: 'no-candidate' as const,
    };
    const seam: SidecarOptimizationSeam = {
      service: {
        prepare: vi.fn(async (baseline) => ({ ...preparation, baselineProfile: baseline })),
        save: vi.fn(() => ({ profile: validProfile('saved'), isDefault: true })),
        setDefault: vi.fn(() => validProfile('saved')),
        getDefault: vi.fn(() => null),
      },
    };
    const handlers = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      rootDir: '/store',
      fs: new FakeFs(),
      store: profiles,
      modelContext: source(),
      optimization: seam,
      now: () => NOW,
    });

    const result = await dispatch(handlers, 'optimization.prepareModel', {
      modelKey: 'synthetic/test-model',
      taskType: 'quick-chat',
      baselineBenchmark: 'skip',
      candidateBenchmark: 'skip',
    });

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ baselinePersistence: 'unsaved' });
    const baseline = (result.result as { preparation: typeof preparation & { baselineProfile: ReturnType<typeof validProfile> } }).preparation.baselineProfile;
    expect(baseline.model.modelKey).toBe('synthetic/test-model');
    expect(baseline.task.type).toBe('quick-chat');
    expect(baseline.id).toMatch(/^draft-/);
    expect(seam.service.prepare).toHaveBeenCalledWith(expect.objectContaining({ model: baseline.model, task: baseline.task }), expect.objectContaining({ baselineBenchmark: 'skip', candidateBenchmark: 'skip' }));
    expect(profiles.list()).toHaveLength(0);
  });
  it('starts a discovered model with an ephemeral safe baseline without saving a profile', async () => {
    const profiles = store();
    const runnerResult = (profile: CompositeProfile): ActivationRunResult => ({
      outcome: { status: 'active', alreadyActive: false },
      transaction: {
        schemaVersion: 2,
        id: 'tx-safe',
        targetProfileId: profile.id,
        previousProfileId: null,
        status: 'active',
        policy: { mode: 'exclusive', rollback: 'best-effort' },
        stages: [],
        startedAt: NOW,
        finishedAt: NOW,
        errors: [],
      },
    });
    const run = vi.fn(async (profile: CompositeProfile) => runnerResult(profile));
    const activation: SidecarActivationSeam = {
      runtime: { getActiveState: vi.fn(async () => ({ profileId: null, modelKey: null, since: null })) } as SidecarActivationSeam['runtime'],
      runner: { run } as SidecarActivationSeam['runner'],
      lock: {} as SidecarActivationSeam['lock'],
      estimate: {} as SidecarActivationSeam['estimate'],
      log: {} as SidecarActivationSeam['log'],
      context: {} as SidecarActivationSeam['context'],
      auditUnload: vi.fn(),
    };
    const handlers = createHandlers({
      lmBaseUrl: undefined,
      lmToken: null,
      lmsBin: undefined,
      store: profiles,
      modelContext: source(),
      activation,
      now: () => NOW,
    });

    const result = await dispatch(handlers, 'activation.startSafe', {
      modelKey: 'synthetic/test-model',
      taskType: 'quick-chat',
    });

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ outcome: 'active', transaction: { targetProfileId: 'draft-synthetic-test-model-quick-chat' } });
    expect(activation.runtime.getActiveState).toHaveBeenCalledTimes(1);
    const [profile, options] = run.mock.calls[0] ?? [];
    expect(profile).toMatchObject({ id: 'draft-synthetic-test-model-quick-chat', model: { modelKey: 'synthetic/test-model' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(profiles.list()).toHaveLength(0);
  });
  it('is unsupported when the model context seam is not wired', async () => {
    const result = await dispatch(
      createHandlers({ lmBaseUrl: undefined, lmToken: null, lmsBin: undefined, store: store() }),
      'models.context',
    );
    expect(result.error?.code).toBe('METHOD_UNSUPPORTED');
  });
});
