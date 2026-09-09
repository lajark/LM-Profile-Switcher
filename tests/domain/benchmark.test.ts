// M2-003 BenchmarkResult contract: the M2-003 fields are nullable-optional
// (forward-compatible, no SCHEMA_VERSION bump), status is a closed enum and the
// strict schema rejects unknown top-level keys so a malformed record can never
// reach the audit log or a validation stamp.
import { describe, expect, it } from 'vitest';
import { StrictBenchmarkResultSchema, type BenchmarkResult } from '@lmps/domain';

function result(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    schemaVersion: 2,
    id: 'bench-1',
    modelKey: 'synthetic/test-model',
    quantization: 'Q4_K_M',
    taskType: 'quick-chat',
    status: 'completed',
    metrics: {
      samples: 3,
      tokensPerSecond: 12.5,
      latencyP50Ms: null,
      memoryPeakBytes: 6 * 1024 ** 3,
      loadMs: 1450,
      ttftMs: 220,
      prefillTokensPerSecond: 36.4,
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

describe('StrictBenchmarkResultSchema (M2-003)', () => {
  it('accepts a complete result with the M2-003 fields', () => {
    expect(StrictBenchmarkResultSchema.safeParse(result()).success).toBe(true);
  });

  it('accepts a result without the M2-003 fields (forward compatible)', () => {
    const legacyResult = result();
    delete legacyResult.modelFileHash;
    delete legacyResult.promptSuiteId;
    delete legacyResult.promptSuiteVersion;
    delete legacyResult.metrics.loadMs;
    delete legacyResult.metrics.ttftMs;
    delete legacyResult.metrics.prefillTokensPerSecond;
    delete legacyResult.metrics.decodeTokensPerSecond;
    expect(StrictBenchmarkResultSchema.safeParse(legacyResult).success).toBe(true);
  });

  it('accepts null metric phases (partial measurement is honest data)', () => {
    const partial = result({
      metrics: {
        samples: 2,
        tokensPerSecond: null,
        latencyP50Ms: null,
        memoryPeakBytes: null,
        loadMs: null,
        ttftMs: null,
        prefillTokensPerSecond: null,
        decodeTokensPerSecond: null,
      },
      modelFileHash: null,
      promptSuiteId: null,
      promptSuiteVersion: null,
    });
    expect(StrictBenchmarkResultSchema.safeParse(partial).success).toBe(true);
  });

  it('rejects a status outside the closed enum', () => {
    const bad = result({ status: 'running' as unknown as BenchmarkResult['status'] });
    const parsed = StrictBenchmarkResultSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown top-level keys (strict)', () => {
    const bad = { ...result(), surprise: true };
    expect(StrictBenchmarkResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a negative timing figure', () => {
    const bad = result({ metrics: { ...result().metrics, loadMs: -10 } });
    expect(StrictBenchmarkResultSchema.safeParse(bad).success).toBe(false);
  });
});