// M5-003 `lmps benchmark-all` batch orchestration tests: sequential bounded
// run over multiple profiles, cancelable (shared AbortSignal stops the rest and
// skips them), --yes calibration backfill per completed run, guard/exit mapping,
// machine-envelope shape and store side effects.
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkError, type BenchmarkService } from '@lmps/core';
import type { BenchmarkResult, CompositeProfile } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import { makeCliHarness, envelopeOf } from './helpers';

function profile(id: string): CompositeProfile {
  return {
    schemaVersion: 2,
    id,
    displayName: { 'zh-CN': `测试 ${id}`, en: `Test ${id}` },
    description: { en: 'synthetic benchmark target' },
    model: { modelKey: id, family: 'synthetic', quantization: 'Q4_K_M' },
    task: { type: 'RAG assistant', kind: 'rag' },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.3 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  };
}

function result(id: string, overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    schemaVersion: 2,
    id: `bench-${id}`,
    modelKey: id,
    quantization: 'Q4_K_M',
    taskType: 'RAG assistant',
    status: 'completed',
    metrics: {
      samples: 1,
      tokensPerSecond: 10,
      latencyP50Ms: null,
      memoryPeakBytes: 6 * 1024 ** 3,
      loadMs: 1000,
      ttftMs: 200,
      prefillTokensPerSecond: 40,
      decodeTokensPerSecond: 10,
    },
    hardwareFingerprint: 'fp-123',
    lmStudioVersion: 'v0.3.27',
    runtimeVersion: '0.3.27',
    adapterCapabilityVersion: 'rest-v1',
    startedAt: '2026-09-05T00:00:00.000Z',
    finishedAt: '2026-09-05T00:00:05.000Z',
    errorCode: null,
    modelFileHash: null,
    promptSuiteId: 'default',
    promptSuiteVersion: '2026.09.1',
    ...overrides,
  };
}

function stubSeam(run: BenchmarkService['run']): { service: BenchmarkService } {
  return { service: { run } };
}

function seedWithSpy(harness: ReturnType<typeof makeCliHarness>): {
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (p: CompositeProfile) => result(p.id));
  harness.deps.benchmark = stubSeam(run as BenchmarkService['run']);
  return { run };
}

const PA = 'pa';
const PB = 'pb';
const PC = 'pc';

describe('lmps benchmark-all (M5-003)', () => {
  it('runs every profile in sequence and reports per-run results', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.store.create(profile(PB));
    harness.store.create(profile(PC));
    const { run } = seedWithSpy(harness);

    const outcome = await runCli(['benchmark-all', PA, PB, PC], harness.deps);
    expect(outcome.exitCode).toBe(0);
    expect(run).toHaveBeenCalledTimes(3);
    expect(outcome.text).toContain(`[1] ${PA}`);
    expect(outcome.text).toContain(`[2] ${PB}`);
    expect(outcome.text).toContain(`[3] ${PC}`);
    // No --yes → no validation stamp.
    for (const id of [PA, PB, PC]) expect(harness.store.get(id).validation).toBeUndefined();
  });

  it('--yes backfills the measured peak into every completed profile', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.store.create(profile(PB));
    harness.deps.now = (): string => '2026-09-05T01:00:00.000Z';
    seedWithSpy(harness);

    const outcome = await runCli(['benchmark-all', PA, PB, '--yes'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    for (const id of [PA, PB]) {
      expect(harness.store.get(id).validation).toEqual({
        source: 'benchmarked',
        benchmarkId: `bench-${id}`,
        testedAt: '2026-09-05T01:00:00.000Z',
        hardwareFingerprint: 'fp-123',
        lmStudioVersion: 'v0.3.27',
        runtimeVersion: '0.3.27',
        adapterCapabilityVersion: 'rest-v1',
        // M5-003: measured peak persisted so `optimize` can calibrate.
        memoryPeakBytes: 6 * 1024 ** 3,
      });
    }
  });

  it('a canceled run stops the batch and skips the remaining profiles without --yes, exit 2', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.store.create(profile(PB));
    harness.store.create(profile(PC));
    const run = vi.fn(async (p: CompositeProfile) =>
      p.id === PA
        ? result(PA)
        : result(p.id, { status: 'canceled', errorCode: 'BENCHMARK_CANCELED' }),
    );
    harness.deps.benchmark = stubSeam(run as BenchmarkService['run']);

    const outcome = await runCli(['benchmark-all', PA, PB, PC], harness.deps);
    expect(outcome.exitCode).toBe(2);
    // pa completed, pb canceled, pc skipped.
    expect(run).toHaveBeenCalledTimes(2);
    expect(outcome.text).toContain('skipped pc');
  });

  it('a pre-aborted shared signal skips every profile at once, exit 2', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.store.create(profile(PB));
    const run = vi.fn();
    harness.deps.benchmark = stubSeam(run as BenchmarkService['run']);
    const ctrl = new AbortController();
    ctrl.abort();

    const outcome = await runCli(['benchmark-all', PA, PB], harness.deps, ctrl.signal);
    expect(outcome.exitCode).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(outcome.text).toContain('skipped pa');
    expect(outcome.text).toContain('skipped pb');
  });

  it('maps a battery guard onto exit 4', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.deps.benchmark = stubSeam(async () => {
      throw new BenchmarkError('BENCHMARK_BATTERY_GUARD', 'refused on battery');
    });

    const outcome = await runCli(['benchmark-all', PA], harness.deps);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.stderr).toContain('--allow-battery');
  });

  it('propagates STORE_NOT_FOUND for an unknown id (exit 4) before any benchmark', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    const { run } = seedWithSpy(harness);

    const outcome = await runCli(['benchmark-all', PA, 'missing'], harness.deps);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.stderr).toContain('Profile not found');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects zero profile ids with exit 4', async () => {
    const harness = makeCliHarness();
    seedWithSpy(harness);
    const outcome = await runCli(['benchmark-all'], harness.deps);
    expect(outcome.exitCode).toBe(4);
  });

  it('reports CAPABILITY_UNSUPPORTED (exit 6) when the seam is null', async () => {
    const harness = makeCliHarness(); // benchmark: null by default
    harness.store.create(profile(PA));
    const outcome = await runCli(['benchmark-all', PA], harness.deps);
    expect(outcome.exitCode).toBe(6);
    expect(outcome.stderr).toContain('does not support');
  });

  it('--json wraps results and skipped in the machine envelope', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.store.create(profile(PB));
    seedWithSpy(harness);

    const outcome = await runCli(['benchmark-all', PA, PB, '--json'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    const envelope = envelopeOf(outcome.text);
    expect(envelope.command).toBe('benchmark-all');
    expect(envelope.data).toMatchObject({
      canceled: false,
      skipped: [],
      results: [
        { profileId: PA, result: { id: `bench-${PA}`, status: 'completed' } },
        { profileId: PB, result: { id: `bench-${PB}`, status: 'completed' } },
      ],
    });
  });

  it('--json reports a canceled batch', async () => {
    const harness = makeCliHarness();
    harness.store.create(profile(PA));
    harness.store.create(profile(PB));
    const run = vi.fn(async (p: CompositeProfile) =>
      result(p.id, { status: 'canceled', errorCode: 'BENCHMARK_CANCELED' }),
    );
    harness.deps.benchmark = stubSeam(run as BenchmarkService['run']);

    const outcome = await runCli(['benchmark-all', PA, PB, '--json'], harness.deps);
    expect(outcome.exitCode).toBe(2);
    const envelope = envelopeOf(outcome.text);
    expect(envelope.data).toMatchObject({ canceled: true });
  });
});