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
    expect(harness.store.list().length).toBe(1); // nothing saved
    expect(seam.audit).not.toHaveBeenCalled();
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