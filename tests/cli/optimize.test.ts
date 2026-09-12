// M2-002 `lmps optimize` command tests: show-only vs explicit --yes save, exit
// code mapping (USAGE exit 4 on low confidence / no safe candidate, exit 6 on a
// null seam), machine-envelope shape and the store.write side effect.
import { describe, expect, it, vi } from 'vitest';
import type { Candidate, CompositeProfile, Recommendation } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import { makeCliHarness, envelopeOf } from './helpers';
import { NOW } from '../optimizer/fixtures';

const RULE_VERSION = '2026.09.1';

function baselineProfile(): CompositeProfile {
  return {
    schemaVersion: 2,
    id: 'rag-prime',
    displayName: { 'zh-CN': 'RAG 基准', en: 'RAG baseline' },
    description: { en: 'synthetic RAG baseline' },
    model: { modelKey: 'synthetic/rag-model', family: 'synthetic', architecture: 'dense' },
    task: { type: 'RAG assistant', kind: 'rag', concurrency: 1 },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.3 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: NOW, updatedAt: NOW },
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    schemaVersion: 2,
    id: 'rag-prime-max',
    profile: { ...baselineProfile(), id: 'rag-prime-max', runtime: { contextLength: 131072, gpuOffload: 'max', evalBatchSize: 32, flashAttention: true }, generation: { temperature: 0.3 } },
    baselineProfileId: 'rag-prime',
    estimate: {
      schemaVersion: 2,
      provider: 'exact',
      modelKey: 'synthetic/rag-model',
      vramTotalBytes: 6 * 1024 ** 3,
      systemRamBytes: 2 * 1024 ** 3,
      estimatedAt: NOW,
      warnings: [],
    },
    safety: {
      safe: true,
      reason: null,
      vramUsedBytes: 6 * 1024 ** 3,
      vramAvailableBytes: 12 * 1024 ** 3,
      headroomBytes: 6 * 1024 ** 3,
      resourceFit: 'gpu-resident',
      recommendable: true,
      vramReserveBytes: Math.round(0.8 * 1024 ** 3),
      ramUsedBytes: 2 * 1024 ** 3,
      ramAvailableBytes: 28 * 1024 ** 3,
      ramReserveBytes: Math.round(3.2 * 1024 ** 3),
      ramHeadroomBytes: 28 * 1024 ** 3 - Math.round(3.2 * 1024 ** 3) - 2 * 1024 ** 3,
    },
    score: {
      total: 0.409,
      breakdown: { vramEfficiency: 0.5, latency: 0.25, throughput: 0.0625, quality: 0.9 },
      confidence: 'high',
      measured: false,
    },
    diff: [
      { path: 'runtime.contextLength', baseline: 8192, candidate: 131072 },
      { path: 'runtime.evalBatchSize', baseline: null, candidate: 32 },
    ],
    rationale: { 'zh-CN': '候选配置', en: 'candidate configuration' },
    ...overrides,
  };
}

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    schemaVersion: 2,
    baselineProfileId: 'rag-prime',
    taskKind: 'rag',
    ruleVersion: RULE_VERSION,
    candidates: [candidate()],
    selectedIndex: 0,
    generatedAt: NOW,
    warnings: [],
    ...overrides,
  };
}

function stubSeam(rec: Recommendation): {
  seam: NonNullable<ReturnType<typeof makeCliHarness>['deps']['recommendation']>;
  audit: ReturnType<typeof vi.fn>;
} {
  const audit = vi.fn();
  return { seam: { service: { recommend: async () => rec }, audit }, audit };
}

describe('lmps optimize (M2-002)', () => {
  it('renders candidates and writes nothing without --yes', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const { seam } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Optimization for rag-prime');
    expect(result.text).toContain('rules 2026.09.1');
    expect(result.text).toContain('rag-prime-max');
    // M5-001: the candidate line shows the resource-fit class, not just VRAM.
    expect(result.text).toContain('GPU-resident');
    // M5-003: the line also carries the GPU estimate and RAM budget.
    expect(result.text).toContain('GPU 6.0 GiB');
    expect(result.text).toContain('RAM reserve 3.2 GiB');
    expect(result.text).toContain('RAM headroom 22.8 GiB');
    expect(harness.store.list().length).toBe(1); // nothing saved
    expect(seam.audit).not.toHaveBeenCalled();
  });

  it('renders a hybrid candidate without calling it not-runnable', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const hybrid = candidate({ safety: { ...candidate().safety, safe: false, reason: 'over-vram', headroomBytes: -3 * 1024 ** 3, resourceFit: 'hybrid-memory', recommendable: true } });
    const { seam } = stubSeam(recommendation({ candidates: [hybrid] }));
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Hybrid-memory');
    expect(result.text).not.toContain('Resource insufficient');
  });

  it('calibrates candidates against the baseline measured peak and surfaces degradation (M5-003)', async () => {
    const harness = makeCliHarness();
    const baseline = {
      ...baselineProfile(),
      validation: {
        source: 'benchmarked',
        benchmarkId: 'b1',
        testedAt: NOW,
        memoryPeakBytes: 10 * 1024 ** 3,
        resourceUsage: {
          schemaVersion: 1,
          method: 'host-snapshot-delta',
          sampleCount: 3,
          completeness: 'complete',
          peakDelta: { vramBytes: 6 * 1024 ** 3, systemRamBytes: 4 * 1024 ** 3, totalBytes: 10 * 1024 ** 3 },
        },
      },
    };
    harness.store.create(baseline);
    const { seam } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('measured peak 10.0 GiB');
    // Candidate estimate (VRAM 6 + RAM 2 = 8 GiB) is exceeded by the measured peak.
    expect(result.text).toContain('degraded');
    expect(harness.store.list().length).toBe(1);
  });

  it('warns when the baseline only has legacy absolute-VRAM evidence', async () => {
    const harness = makeCliHarness();
    harness.store.create({
      ...baselineProfile(),
      validation: { source: 'benchmarked', testedAt: NOW, memoryPeakBytes: 10 * 1024 ** 3 },
    });
    const { seam } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('calibration evidence is stale; run Benchmark again');
  });

  it('renders measured evidence for feedback-matched candidates', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const measured = candidate({
      score: {
        total: 0.409,
        breakdown: { vramEfficiency: 0.5, latency: 0.25, throughput: 0.0625, quality: 0.9 },
        confidence: 'high',
        measured: true,
        adjustedTotal: 0.85,
        measuredEvidence: { decodeTokensPerSecond: 9.9, ttftMs: 1700, samples: 3, recordedAt: NOW },
      },
    });
    const { seam } = stubSeam(recommendation({ candidates: [measured] }));
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('measured 9.9 tok/s · 3 samples');
    expect(harness.store.list().length).toBe(1);
  });

  it('--yes saves the head candidate as a rule-recommended profile and audits', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const { seam, audit } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime', '--yes'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Saved rag-prime-2026.09.1 (not activated)');

    const saved = harness.store.get('rag-prime-2026.09.1');
    expect(saved.validation).toEqual({ source: 'rule-recommended', testedAt: harness.deps.now() });
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry.appliedProfileId).toBe('rag-prime-2026.09.1');
    expect(entry.baselineProfileId).toBe('rag-prime');
    expect(entry.ruleVersion).toBe(RULE_VERSION);
    expect(entry.confidence).toBe('high');
    expect(entry.candidateId).toBe('rag-prime-max');
  });

  it('--yes audits the calibration verdict when the baseline is measured (M5-009)', async () => {
    const harness = makeCliHarness();
    const baseline = {
      ...baselineProfile(),
      validation: {
        source: 'benchmarked',
        testedAt: NOW,
        memoryPeakBytes: 10 * 1024 ** 3,
        resourceUsage: {
          schemaVersion: 1,
          method: 'host-snapshot-delta',
          sampleCount: 3,
          completeness: 'complete',
          peakDelta: { vramBytes: 6 * 1024 ** 3, systemRamBytes: 4 * 1024 ** 3, totalBytes: 10 * 1024 ** 3 },
        },
      },
    };
    harness.store.create(baseline);
    const { seam, audit } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime', '--yes'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0]?.[0] as Record<string, unknown>;
    // Estimate (VRAM 6 + RAM 2 = 8 GiB) is exceeded by the measured peak → degraded.
    expect(entry.calibration).toMatchObject({
      applied: true,
      degraded: true,
      note: 'degraded',
      estimatedTotalBytes: 8 * 1024 ** 3,
      overrunBytes: 2 * 1024 ** 3,
      confidence: 'low',
    });
  });

  it('--json wraps the recommendation without the saved id', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const rec = recommendation();
    const { seam } = stubSeam(rec);
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime', '--json'], harness.deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.command).toBe('optimize');
    expect(envelope.data).toMatchObject({ recommendation: { baselineProfileId: 'rag-prime', taskKind: 'rag', ruleVersion: RULE_VERSION } });
  });

  it('--json reports the saved profile id after a save', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const { seam } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime', '--yes', '--json'], harness.deps);
    expect(result.exitCode).toBe(0);
    const envelope = envelopeOf(result.text);
    expect(envelope.data).toMatchObject({ savedProfileId: 'rag-prime-2026.09.1' });
  });

  it('refuses to save a low-confidence head candidate (exit 4)', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const low = candidate({ score: { total: 0.4, breakdown: { vramEfficiency: 0.5, latency: 0.25, throughput: 0.06, quality: 0.9 }, confidence: 'low', measured: false } });
    const { seam } = stubSeam(recommendation({ candidates: [low] }));
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime', '--yes'], harness.deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('low');
    expect(harness.store.list().length).toBe(1);
  });

  it('refuses to save when no candidate is safe (exit 4)', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const { seam } = stubSeam(
      recommendation({
        candidates: [],
        selectedIndex: null,
        warnings: ['unsafe-drop:rough-estimate'],
      }),
    );
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime', '--yes'], harness.deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('no safe candidate');
    expect(harness.store.list().length).toBe(1);
  });

  it('renders noSafeCandidate and exits 0 for an empty recommendation without --yes', async () => {
    const harness = makeCliHarness();
    harness.store.create(baselineProfile());
    const { seam } = stubSeam(
      recommendation({
        candidates: [],
        selectedIndex: null,
        warnings: ['unsafe-drop:rough-estimate'],
      }),
    );
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('No safe candidate');
  });

  it('reports CAPABILITY_UNSUPPORTED (exit 6) when the seam is null', async () => {
    const harness = makeCliHarness(); // recommendation: null by default
    harness.store.create(baselineProfile());

    const result = await runCli(['optimize', 'rag-prime'], harness.deps);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toContain('does not support');
  });

  it('propagates STORE_NOT_FOUND for an unknown id (exit 4)', async () => {
    const harness = makeCliHarness();
    const { seam } = stubSeam(recommendation());
    harness.deps.recommendation = seam;

    const result = await runCli(['optimize', 'missing-profile'], harness.deps);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('not found');
  });
});
