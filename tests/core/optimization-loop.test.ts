import { describe, expect, it } from 'vitest';
import type { BenchmarkResult, Candidate, CompositeProfile, Recommendation } from '@lmps/domain';
import {
  ActivationError,
  createOptimizationLoopService,
  OptimizationLoopError,
  type OptimizationLoopPorts,
} from '@lmps/core';

import { makeProfile, NOW } from './fixtures';

function benchmarkResult(id: string, status: BenchmarkResult['status'] = 'completed'): BenchmarkResult {
  return {
    schemaVersion: 2,
    id,
    modelKey: 'synthetic/test-model',
    taskType: 'quick-chat',
    status,
    metrics: {
      samples: status === 'completed' ? 3 : 0,
      loadMs: status === 'completed' ? 120 : null,
      decodeTokensPerSecond: status === 'completed' ? 31 : null,
      memoryPeakBytes: null,
    },
    hardwareFingerprint: 'offline-fixture',
    startedAt: NOW,
    finishedAt: NOW,
    errorCode: status === 'completed' ? null : status === 'canceled' ? 'BENCHMARK_CANCELED' : 'BENCHMARK_OOM',
    config: { profileId: 'baseline' },
  };
}

function candidate(profile: CompositeProfile, id: string): Candidate {
  return {
    schemaVersion: 2,
    id,
    profile,
    baselineProfileId: 'baseline',
    estimate: {
      schemaVersion: 2,
      provider: 'exact',
      modelKey: profile.model.modelKey,
      vramTotalBytes: 1_000_000,
      systemRamBytes: 1_000_000,
      estimatedAt: NOW,
      warnings: [],
    },
    safety: {
      safe: true,
      reason: null,
      vramUsedBytes: 1_000_000,
      vramAvailableBytes: 2_000_000,
      headroomBytes: 1_000_000,
      resourceFit: 'gpu-resident',
      recommendable: true,
      vramReserveBytes: 100_000,
      ramUsedBytes: 1_000_000,
      ramAvailableBytes: 2_000_000,
      ramReserveBytes: 100_000,
      ramHeadroomBytes: 900_000,
    },
    score: {
      total: 0.9,
      breakdown: { vramEfficiency: 0.9, latency: 0.9, throughput: 0.9, quality: 0.9 },
      confidence: 'high',
      measured: false,
      adjustedTotal: 0.9,
    },
    diff: [],
    rationale: { 'zh-CN': '测试候选', en: 'test candidate' },
  };
}

function recommendation(base: CompositeProfile, entries: Candidate[]): Recommendation {
  return {
    schemaVersion: 2,
    baselineProfileId: base.id,
    taskKind: 'quick-chat',
    ruleVersion: 'test.1',
    candidates: entries,
    selectedIndex: entries.length === 0 ? null : 0,
    generatedAt: NOW,
    warnings: [],
  };
}

function makeHarness(resultQueue: BenchmarkResult[]): { ports: OptimizationLoopPorts; runs: string[]; preflights: string[]; saved: CompositeProfile[]; defaults: Map<string, string>; defaultId: (modelKey: string, taskType: string) => string | undefined } {
  const base = makeProfile('baseline');
  const alternate = makeProfile('candidate', { runtime: { contextLength: 4096 } });
  const head = candidate(alternate, 'candidate-head');
  const runs: string[] = [];
  const preflights: string[] = [];
  const saved: CompositeProfile[] = [];
  const defaults = new Map<string, string>();
  const key = (modelKey: string, taskType: string) => `${modelKey}|${taskType}`;
  const ports: OptimizationLoopPorts = {
    recommendation: {
      recommend: async () => recommendation(base, [head]),
    },
    preflight: {
      check: async (profile) => {
        preflights.push(profile.id);
      },
    },
    benchmark: {
      run: async (profile) => {
        runs.push(profile.id);
        const result = resultQueue.shift();
        if (result === undefined) throw new Error('benchmark queue exhausted');
        return result;
      },
    },
    profiles: {
      get: (id) => {
        const found = saved.find((profile) => profile.id === id);
        if (found === undefined) throw new Error('missing profile');
        return found;
      },
      create: (profile) => {
        saved.push(profile);
        return profile;
      },
    },
    defaults: {
      get: (modelKey, taskType) => defaults.get(key(modelKey, taskType)) ?? null,
      set: (modelKey, taskType, profileId) => void defaults.set(key(modelKey, taskType), profileId),
    },
    now: () => NOW,
  };
  return { ports, runs, preflights, saved, defaults, defaultId: (modelKey, taskType) => defaults.get(key(modelKey, taskType)) };
}

describe('OptimizationLoopService', () => {
  it('runs baseline then candidate, saves measured evidence, and keeps save separate', async () => {
    const harness = makeHarness([benchmarkResult('baseline-run'), benchmarkResult('candidate-run')]);
    const service = createOptimizationLoopService(harness.ports);
    const preparation = await service.prepare(makeProfile('baseline'));

    expect(harness.preflights).toEqual(['baseline']);
    expect(harness.runs).toEqual(['baseline', 'candidate']);
    expect(preparation.status).toBe('ready-to-save');
    expect(preparation.baselineBenchmark.decision).toBe('run');
    expect(preparation.candidateBenchmark.result?.id).toBe('candidate-run');

    const saved = service.save(preparation, { id: 'profile-one' });
    expect(saved.profile.id).toBe('profile-one');
    expect(saved.profile.validation).toMatchObject({ source: 'benchmarked', benchmarkId: 'candidate-run' });
    expect(saved.isDefault).toBe(true);
    expect(harness.defaultId('synthetic/test-model', 'quick-chat')).toBe('profile-one');
  });

  it('allows explicit skips and marks the saved profile unmeasured', async () => {
    const harness = makeHarness([]);
    const service = createOptimizationLoopService(harness.ports);
    const preparation = await service.prepare(makeProfile('baseline'), {
      baselineBenchmark: 'skip',
      candidateBenchmark: 'skip',
    });

    expect(harness.preflights).toEqual(['baseline']);
    expect(harness.runs).toEqual([]);
    expect(preparation.status).toBe('baseline-skipped');
    expect(preparation.baselineBenchmark.result).toBeNull();
    expect(preparation.candidateEvidence).toBe('unmeasured');
    const saved = service.save(preparation, { id: 'profile-unmeasured' });
    expect(saved.profile.validation).toBeUndefined();
  });

  it('stops after a canceled or failed baseline and never recommends a candidate', async () => {
    for (const status of ['canceled', 'failed'] as const) {
      const harness = makeHarness([benchmarkResult(`baseline-${status}`, status)]);
      const service = createOptimizationLoopService(harness.ports);
      const preparation = await service.prepare(makeProfile('baseline'));
      expect(preparation.recommendation).toBeNull();
      expect(preparation.selectedCandidate).toBeNull();
      expect(preparation.status).toBe(status === 'canceled' ? 'canceled' : 'baseline-failed');
      expect(harness.runs).toEqual(['baseline']);
      expect(() => service.save(preparation, { id: `cannot-save-${status}` })).toThrow(OptimizationLoopError);
    }
  });

  it('turns recommendation cancellation into an explicit canceled preparation', async () => {
    const harness = makeHarness([]);
    harness.ports.recommendation = {
      recommend: async () => {
        throw new ActivationError('ACTIVATION_CANCELED', 'canceled');
      },
    };
    const service = createOptimizationLoopService(harness.ports);
    const preparation = await service.prepare(makeProfile('baseline'), { baselineBenchmark: 'skip' });
    expect(preparation.status).toBe('canceled');
    expect(preparation.candidateEvidence).toBe('canceled');
    expect(preparation.candidateBenchmark.decision).toBe('not-run');
  });
  it('records candidate failure and refuses to save it', async () => {
    const harness = makeHarness([benchmarkResult('baseline-run'), benchmarkResult('candidate-oom', 'failed')]);
    const service = createOptimizationLoopService(harness.ports);
    const preparation = await service.prepare(makeProfile('baseline'));
    expect(preparation.status).toBe('candidate-failed');
    expect(preparation.candidateEvidence).toBe('failed');
    expect(() => service.save(preparation, { id: 'failed-profile' })).toThrowError(
      expect.objectContaining({ code: 'OPTIMIZATION_CANDIDATE_NOT_MEASURED' }),
    );
    expect(harness.saved).toHaveLength(0);
  });

  it('keeps later saves from replacing the default and supports explicit selection', async () => {
    const harness = makeHarness([benchmarkResult('b1'), benchmarkResult('c1'), benchmarkResult('b2'), benchmarkResult('c2')]);
    const service = createOptimizationLoopService(harness.ports);
    const first = service.save(await service.prepare(makeProfile('baseline')), { id: 'profile-one' });
    const second = service.save(await service.prepare(makeProfile('baseline')), { id: 'profile-two' });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    expect(harness.defaultId('synthetic/test-model', 'quick-chat')).toBe('profile-one');

    service.setDefault('profile-two');
    expect(service.getDefault('synthetic/test-model', 'quick-chat')?.id).toBe('profile-two');
  });

  it('does not guess a missing default and reports stale or mismatched entries', () => {
    const harness = makeHarness([]);
    const service = createOptimizationLoopService(harness.ports);
    expect(service.getDefault('synthetic/test-model', 'quick-chat')).toBeNull();
    harness.defaults.set('synthetic/test-model|quick-chat', 'missing');
    expect(() => service.getDefault('synthetic/test-model', 'quick-chat')).toThrowError(
      expect.objectContaining({ code: 'OPTIMIZATION_DEFAULT_STALE' }),
    );
    harness.saved.push(makeProfile('wrong-model', { model: { modelKey: 'other/model' } }));
    harness.defaults.set('synthetic/test-model|quick-chat', 'wrong-model');
    expect(() => service.getDefault('synthetic/test-model', 'quick-chat')).toThrowError(
      expect.objectContaining({ code: 'OPTIMIZATION_PROFILE_MISMATCH' }),
    );
  });
});
