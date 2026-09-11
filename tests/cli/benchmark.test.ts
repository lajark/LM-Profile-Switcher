// M2-003 `lmps benchmark` command tests: show-only vs `--yes` validation stamp,
// exit-code mapping (failed measurement → exit 0, cancel → 2, guards → 4,
// null seam → 6, bounds → 4), machine-envelope shape and the store side effects.
import { describe, expect, it } from 'vitest';
import { BenchmarkError, type BenchmarkService } from '@lmps/core';
import type { BenchmarkResult, CompositeProfile } from '@lmps/domain';

import { runCli } from '../../apps/cli/src/run.ts';
import { makeCliHarness, envelopeOf } from './helpers';

function profile(id = 'rag-prime'): CompositeProfile {
  return {
    schemaVersion: 2,
    id,
    displayName: { 'zh-CN': `测试 ${id}`, en: `Test ${id}` },
    description: { en: 'synthetic benchmark target' },
    model: { modelKey: 'synthetic/test-model', family: 'synthetic', quantization: 'Q4_K_M', fileHash: 'abc123' },
    task: { type: 'RAG assistant', kind: 'rag', concurrency: 1 },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.3 },
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  };
}

function result(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    schemaVersion: 2,
    id: 'bench-1',
    modelKey: 'synthetic/test-model',
    quantization: 'Q4_K_M',
    taskType: 'RAG assistant',
    status: 'completed',
    metrics: {
      samples: 3,
      tokensPerSecond: 12.5,
      latencyP50Ms: null,
      memoryPeakBytes: 6 * 1024 ** 3,
      loadMs: 1000,
      ttftMs: 200,
      prefillTokensPerSecond: 40,
      decodeTokensPerSecond: 12.5,
    },
    hardwareFingerprint: 'fp-123',
    lmStudioVersion: 'v0.3.27',
    runtimeVersion: '0.3.27',
    adapterCapabilityVersion: 'rest-v1',
    startedAt: '2026-09-05T00:00:00.000Z',
    finishedAt: '2026-09-05T00:00:05.000Z',
    errorCode: null,
    modelFileHash: 'abc123',
    promptSuiteId: 'default',
    promptSuiteVersion: '2026.09.1',
    ...overrides,
  };
}

function stubSeam(run: BenchmarkService['run']): { service: BenchmarkService } {
  return { service: { run } };
}

function seed(harness: ReturnType<typeof makeCliHarness>, id = 'rag-prime'): void {
  harness.store.create(profile(id));
}

describe('lmps benchmark (M2-003)', () => {
  it('renders metrics and writes nothing to the profile without --yes', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => result());

    const outcome = await runCli(['benchmark', 'rag-prime'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.text).toContain('Status: completed');
    expect(outcome.text).toContain('Load: 1000 ms');
    expect(outcome.text).toContain('Time to first token: 200 ms');
    expect(outcome.text).toContain('Prefill: 40.0 tok/s');
    expect(outcome.text).toContain('Decode: 12.5 tok/s');
    expect(outcome.text).toContain('Peak VRAM: 6.00 GiB');
    expect(outcome.text).toContain('Samples: 3');
    expect(outcome.text).toContain('Hardware fingerprint: fp-123');
    expect(harness.store.get('rag-prime').validation).toBeUndefined();
  });

  it('--yes stamps the profile validation with the run evidence', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => result());
    harness.deps.now = (): string => '2026-09-05T01:00:00.000Z';

    const outcome = await runCli(['benchmark', 'rag-prime', '--yes'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.text).toContain('marked as benchmarked');
    expect(harness.store.get('rag-prime').validation).toEqual({
      source: 'benchmarked',
      benchmarkId: 'bench-1',
      testedAt: '2026-09-05T01:00:00.000Z',
      hardwareFingerprint: 'fp-123',
      lmStudioVersion: 'v0.3.27',
      runtimeVersion: '0.3.27',
      adapterCapabilityVersion: 'rest-v1',
      // M5-003: the measured peak is persisted so `optimize` can calibrate.
      memoryPeakBytes: 6 * 1024 ** 3,
    });
  });

  it('does not stamp validation for a failed run (still exit 0)', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () =>
      result({ status: 'failed', errorCode: 'BENCHMARK_OOM', metrics: { ...result().metrics, samples: 0 } }),
    );

    const outcome = await runCli(['benchmark', 'rag-prime', '--yes'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.text).toContain('Status: failed (BENCHMARK_OOM)');
    expect(harness.store.get('rag-prime').validation).toBeUndefined();
  });

  it('exits 2 for a canceled result', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () =>
      result({ status: 'canceled', errorCode: 'BENCHMARK_CANCELED', metrics: { ...result().metrics, samples: 1 } }),
    );

    const outcome = await runCli(['benchmark', 'rag-prime'], harness.deps);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.text).toContain('Status: canceled');
  });

  it('maps a battery guard to exit 4 with the localized reason', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => {
      throw new BenchmarkError('BENCHMARK_BATTERY_GUARD', 'refused on battery');
    });

    const outcome = await runCli(['benchmark', 'rag-prime'], harness.deps);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.stderr).toContain('battery');
    expect(outcome.stderr).toContain('--allow-battery');
  });

  it('maps a lock-busy guard to exit 4', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => {
      throw new BenchmarkError('BENCHMARK_LOCK_BUSY', 'lock held');
    });

    const outcome = await runCli(['benchmark', 'rag-prime'], harness.deps);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.stderr).toContain('Another activation');
  });

  it('rejects out-of-range --samples and --max-tokens with exit 4', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => result());

    for (const args of [
      ['--samples', '0'],
      ['--samples', '11'],
      ['--max-tokens', '0'],
      ['--max-tokens', '513'],
    ]) {
      const outcome = await runCli(['benchmark', 'rag-prime', ...args], harness.deps);
      expect(outcome.exitCode, args.join(' ')).toBe(4);
    }
  });

  it('reports CAPABILITY_UNSUPPORTED (exit 6) when the seam is null', async () => {
    const harness = makeCliHarness(); // benchmark: null by default
    seed(harness);

    const outcome = await runCli(['benchmark', 'rag-prime'], harness.deps);
    expect(outcome.exitCode).toBe(6);
    expect(outcome.stderr).toContain('does not support');
  });

  it('propagates STORE_NOT_FOUND for an unknown id (exit 4)', async () => {
    const harness = makeCliHarness();
    harness.deps.benchmark = stubSeam(async () => result());

    const outcome = await runCli(['benchmark', 'missing-profile'], harness.deps);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.stderr).toContain('Profile not found');
  });

  it('--json wraps the result and the validated flag in the machine envelope', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => result());

    const outcome = await runCli(['benchmark', 'rag-prime', '--json'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    const envelope = envelopeOf(outcome.text);
    expect(envelope.command).toBe('benchmark');
    expect(envelope.data).toMatchObject({
      validated: false,
      result: { id: 'bench-1', status: 'completed', modelFileHash: 'abc123', promptSuiteId: 'default' },
    });
  });

  it('--json reports validated=true after a --yes stamp', async () => {
    const harness = makeCliHarness();
    seed(harness);
    harness.deps.benchmark = stubSeam(async () => result());

    const outcome = await runCli(['benchmark', 'rag-prime', '--yes', '--json'], harness.deps);
    expect(outcome.exitCode).toBe(0);
    const envelope = envelopeOf(outcome.text);
    expect(envelope.data).toMatchObject({ validated: true, result: { status: 'completed' } });
  });
});