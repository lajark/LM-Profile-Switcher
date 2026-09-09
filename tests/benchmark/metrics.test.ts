// M2-003 pure aggregation and invalidation: aggregateSamples computes median
// TTFT/prefill/decode from per-sample figures (null phases propagate), peak
// memory is the max across sample points; isBenchmarkValidFor rejects a past
// result when hardware/versions/model identity changed.
import { describe, expect, it } from 'vitest';
import { aggregateSamples, isBenchmarkValidFor, type SampleMetrics } from '@lmps/benchmark';
import type { BenchmarkIdentity, BenchmarkResult } from '@lmps/domain';

function sample(ttftMs: number | null, generatedTokens: number, totalMs: number, promptTokens = 8): SampleMetrics {
  return { ttftMs, generatedTokens, totalMs, promptTokens };
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
      samples: 2,
      tokensPerSecond: 10,
      latencyP50Ms: null,
      memoryPeakBytes: 6 * 1024 ** 3,
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

describe('aggregateSamples', () => {
  it('computes median TTFT, prefill and decode rates across samples', () => {
    const metrics = aggregateSamples(
      [
        sample(100, 50, 600, 8), // decode = 50/(600-100)=0.1
        sample(200, 80, 1000, 8), // decode = 80/(1000-200)=0.1
        sample(150, 60, 750, 8), // decode = 60/(750-150)=0.1
      ],
      { loadMs: 1200, memoryPeaks: [1 * 1024 ** 3, 3 * 1024 ** 3] },
    );
    expect(metrics.samples).toBe(3);
    expect(metrics.ttftMs).toBe(150); // median of [100,150,200]
    // Rates convert ms timings to per-second: prefill = 8/0.150s, decode = 0.5 tokens/ms.
    expect(metrics.prefillTokensPerSecond).toBeCloseTo((8 * 1000) / 150, 6);
    expect(metrics.decodeTokensPerSecond).toBeCloseTo(100, 6);
    expect(metrics.tokensPerSecond).toBe(metrics.decodeTokensPerSecond);
    expect(metrics.memoryPeakBytes).toBe(3 * 1024 ** 3);
    expect(metrics.loadMs).toBe(1200);
    expect(metrics.latencyP50Ms).toBeNull();
  });

  it('uses the even-median average for an even sample count', () => {
    const metrics = aggregateSamples([sample(100, 0, 100, 8), sample(300, 0, 300, 8)]);
    expect(metrics.ttftMs).toBe(200);
  });

  it('propagates null for phases no sample could measure', () => {
    const metrics = aggregateSamples([sample(null, 0, 500, 8), sample(null, 0, 500, 8)]);
    expect(metrics.ttftMs).toBeNull();
    expect(metrics.prefillTokensPerSecond).toBeNull();
    expect(metrics.decodeTokensPerSecond).toBeNull();
    expect(metrics.samples).toBe(2);
    expect(metrics.memoryPeakBytes).toBeNull();
    expect(metrics.loadMs).toBeNull();
  });

  it('skips degenerate samples that would divide by zero', () => {
    const metrics = aggregateSamples([
      sample(0, 0, 0, 0),
      sample(100, 10, 100, 8), // totalMs === ttftMs → decode skipped
    ]);
    expect(metrics.ttftMs).toBe(100);
    expect(metrics.decodeTokensPerSecond).toBeNull();
  });

  it('takes the maximum of the memory-peak sample points', () => {
    const metrics = aggregateSamples([sample(50, 5, 100, 8)], { memoryPeaks: [2 * 1024 ** 3, 1 * 1024 ** 3] });
    expect(metrics.memoryPeakBytes).toBe(2 * 1024 ** 3);
  });
});

describe('isBenchmarkValidFor', () => {
  const identity: BenchmarkIdentity = {
    modelKey: 'synthetic/test-model',
    quantization: 'Q4_K_M',
    hardwareFingerprint: 'fp-123',
    lmStudioVersion: 'v0.3.27',
    runtimeVersion: '0.3.27',
  };

  it('is valid when fingerprint, versions and model identity all match', () => {
    expect(isBenchmarkValidFor(result(), identity)).toEqual({ valid: true, reasons: [] });
  });

  it('invalidates when the hardware fingerprint changed', () => {
    const outcome = isBenchmarkValidFor(result(), { ...identity, hardwareFingerprint: 'fp-999' });
    expect(outcome.valid).toBe(false);
    expect(outcome.reasons).toContain('hardware-fingerprint');
  });

  it('invalidates on LM Studio/runtime version drift', () => {
    const lm = isBenchmarkValidFor(result(), { ...identity, lmStudioVersion: 'v0.4.0' });
    expect(lm.reasons).toContain('lm-studio-version');
    const runtime = isBenchmarkValidFor(result(), { ...identity, runtimeVersion: '0.4.0' });
    expect(runtime.reasons).toContain('runtime-version');
  });

  it('invalidates on model identity mismatch (key or quantization)', () => {
    const key = isBenchmarkValidFor(result(), { ...identity, modelKey: 'synthetic/other' });
    expect(key.reasons).toContain('model-key');
    const q = isBenchmarkValidFor(result(), { ...identity, quantization: 'Q8_0' });
    expect(q.reasons).toContain('quantization');
  });

  it('collects every mismatched reason at once', () => {
    const outcome = isBenchmarkValidFor(result(), {
      modelKey: 'synthetic/other',
      quantization: 'Q8_0',
      hardwareFingerprint: 'fp-999',
      lmStudioVersion: 'v0.4.0',
      runtimeVersion: '0.4.0',
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.reasons).toEqual([
      'hardware-fingerprint',
      'lm-studio-version',
      'runtime-version',
      'model-key',
      'quantization',
    ]);
  });
});