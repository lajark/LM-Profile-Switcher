// Contract-level validation: happy paths, boundary values, required-field and
// type failures for every PRD §6 contract plus the unknown-field policy at the
// schema level (preserve by default, reject via the exported Strict* variant).
import { describe, expect, it } from 'vitest';
import {
  ActivationTransactionSchema,
  BenchmarkResultSchema,
  CapabilityMatrixSchema,
  CompositeProfileSchema,
  GenerationProfileSchema,
  HardwareProfileSchema,
  LoadEstimateSchema,
  ModelProfileSchema,
  RuntimeProfileSchema,
  TaskProfileSchema,
  BehaviorProfileSchema,
} from '@lmps/domain';
import {
  currentSampleComposite,
  minimalActivationTransaction,
  minimalBenchmarkResult,
  minimalCapabilityMatrix,
  minimalHardwareProfile,
  minimalLoadEstimate,
} from './fixtures.js';

describe('ModelProfile', () => {
  it('accepts a minimal valid model and optional null fields', () => {
    expect(ModelProfileSchema.safeParse({ modelKey: 'qwen', fileHash: null, family: null }).success).toBe(true);
    expect(ModelProfileSchema.safeParse({ modelKey: 'qwen' }).success).toBe(true);
  });

  it('rejects a missing or empty modelKey', () => {
    expect(ModelProfileSchema.safeParse({}).success).toBe(false);
    expect(ModelProfileSchema.safeParse({ modelKey: '' }).success).toBe(false);
  });

  it('rejects an unknown architecture instead of guessing', () => {
    expect(ModelProfileSchema.safeParse({ modelKey: 'qwen', architecture: 'quantum' }).success).toBe(false);
  });
});

describe('TaskProfile', () => {
  it('rejects a missing type and negative token counts', () => {
    expect(TaskProfileSchema.safeParse({}).success).toBe(false);
    expect(TaskProfileSchema.safeParse({ type: 'chat', typicalInputTokens: -1 }).success).toBe(false);
    expect(TaskProfileSchema.safeParse({ type: 'chat', concurrency: 0 }).success).toBe(false);
  });

  it('accepts zero token counts (unknown volume) and a valid concurrency', () => {
    expect(TaskProfileSchema.safeParse({ type: 'chat', typicalInputTokens: 0, concurrency: 1 }).success).toBe(true);
  });

  it('accepts every PRD FR-07 task kind as optional only', () => {
    for (const kind of [
      'quick-chat',
      'long-document',
      'rag',
      'investment-due-diligence',
      'meeting-minutes',
      'coding',
      'structured-extraction',
      'agent',
      'creative-writing',
      'vision',
      'custom',
    ]) {
      expect(TaskProfileSchema.safeParse({ type: 'chat', kind }).success).toBe(true);
    }
    // `kind` is optional: an existing v2 task profile without it stays valid.
    expect(TaskProfileSchema.safeParse({ type: 'chat' }).success).toBe(true);
  });

  it('rejects an unknown task kind instead of guessing', () => {
    expect(TaskProfileSchema.safeParse({ type: 'chat', kind: 'transcribe' }).success).toBe(false);
  });
});

describe('RuntimeProfile', () => {
  it('accepts an empty runtime (all parameters optional, engine defaults)', () => {
    expect(RuntimeProfileSchema.safeParse({}).success).toBe(true);
  });

  it('rejects contextLength 0, out-of-range gpuOffload, and negative experts', () => {
    expect(RuntimeProfileSchema.safeParse({ contextLength: 0 }).success).toBe(false);
    expect(RuntimeProfileSchema.safeParse({ gpuOffload: 1.5 }).success).toBe(false);
    expect(RuntimeProfileSchema.safeParse({ gpuOffload: -0.1 }).success).toBe(false);
    expect(RuntimeProfileSchema.safeParse({ numExperts: -2 }).success).toBe(false);
  });

  it('accepts both gpuOffload spellings (enum and ratio)', () => {
    expect(RuntimeProfileSchema.safeParse({ gpuOffload: 'auto' }).success).toBe(true);
    expect(RuntimeProfileSchema.safeParse({ gpuOffload: 0.5 }).success).toBe(true);
  });

  it('accepts null values as deliberate "defer to engine" markers', () => {
    expect(RuntimeProfileSchema.safeParse({ contextLength: null, flashAttention: null }).success).toBe(true);
  });
});

describe('GenerationProfile', () => {
  it('rejects negative temperature and out-of-range topP', () => {
    expect(GenerationProfileSchema.safeParse({ temperature: -0.1 }).success).toBe(false);
    expect(GenerationProfileSchema.safeParse({ topP: 1.5 }).success).toBe(false);
  });

  it('accepts an empty generation profile and null field markers', () => {
    expect(GenerationProfileSchema.safeParse({}).success).toBe(true);
    expect(GenerationProfileSchema.safeParse({ temperature: null, seed: null }).success).toBe(true);
  });

  it('rejects maxTokens below 1', () => {
    expect(GenerationProfileSchema.safeParse({ maxTokens: 0 }).success).toBe(false);
  });
});

describe('BehaviorProfile', () => {
  it('requires the mode', () => {
    expect(BehaviorProfileSchema.safeParse({}).success).toBe(false);
    expect(BehaviorProfileSchema.safeParse({ mode: 'exclusive' }).success).toBe(true);
  });

  it('rejects unknown mode, healthCheck and rollback values', () => {
    expect(BehaviorProfileSchema.safeParse({ mode: 'shared' }).success).toBe(false);
    expect(BehaviorProfileSchema.safeParse({ mode: 'exclusive', healthCheck: 'watchdog' }).success).toBe(false);
    expect(BehaviorProfileSchema.safeParse({ mode: 'exclusive', rollback: 'maybe' }).success).toBe(false);
  });

  it('rejects negative TTL', () => {
    expect(BehaviorProfileSchema.safeParse({ mode: 'coexist', ttlSeconds: -1 }).success).toBe(false);
  });
});

describe('CompositeProfile', () => {
  it('accepts the current sample shape', () => {
    expect(CompositeProfileSchema.safeParse(currentSampleComposite).success).toBe(true);
  });

  it('requires metadata and bilingual displayName', () => {
    const withoutMetadata = { ...currentSampleComposite, metadata: undefined } as typeof currentSampleComposite;
    expect(CompositeProfileSchema.safeParse(withoutMetadata).success).toBe(false);
    expect(
      CompositeProfileSchema.safeParse({ ...currentSampleComposite, displayName: { 'zh-CN': '代码' } }).success,
    ).toBe(false);
  });

  it('enforces the profile id pattern', () => {
    expect(CompositeProfileSchema.safeParse({ ...currentSampleComposite, id: 'Bad ID!' }).success).toBe(false);
    expect(CompositeProfileSchema.safeParse({ ...currentSampleComposite, id: 'abc_123' }).success).toBe(true);
  });

  it('rejects a future schemaVersion put through the schema', () => {
    expect(CompositeProfileSchema.safeParse({ ...currentSampleComposite, schemaVersion: 3 }).success).toBe(false);
  });

  it('preserves unknown fields by default and rejects them in strict mode', () => {
    const extended = { ...currentSampleComposite, futureField: { nested: 1 } };
    const preserved = CompositeProfileSchema.parse(extended);
    expect(preserved.futureField).toEqual({ nested: 1 });

    const strict = CompositeProfileSchema.strict().safeParse(extended);
    expect(strict.success).toBe(false);
  });
});

describe('HardwareProfile', () => {
  it('accepts a minimal snapshot and tolerates null probes (FR-02 no-block)', () => {
    expect(HardwareProfileSchema.safeParse(minimalHardwareProfile).success).toBe(true);
    expect(
      HardwareProfileSchema.safeParse({
        schemaVersion: 2,
        gpus: null,
        power: null,
        probedAt: '2026-08-21T14:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects negative VRAM and a malformed probe timestamp', () => {
    expect(
      HardwareProfileSchema.safeParse({
        ...minimalHardwareProfile,
        gpus: [{ name: 'gpu', vramTotalBytes: -1, vramAvailableBytes: 1 }],
      }).success,
    ).toBe(false);
    expect(HardwareProfileSchema.safeParse({ ...minimalHardwareProfile, probedAt: 'yesterday' }).success).toBe(false);
  });
});

describe('LoadEstimate', () => {
  it('accepts a valid estimate and defaults warnings to []', () => {
    const result = LoadEstimateSchema.safeParse(minimalLoadEstimate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warnings).toEqual([]);
    }
  });

  it('requires provider/modelKey and rejects negative byte counts', () => {
    expect(LoadEstimateSchema.safeParse({ ...minimalLoadEstimate, provider: 'guessed' }).success).toBe(false);
    expect(LoadEstimateSchema.safeParse({ ...minimalLoadEstimate, modelKey: '' }).success).toBe(false);
    expect(LoadEstimateSchema.safeParse({ ...minimalLoadEstimate, vramTotalBytes: -1 }).success).toBe(false);
  });

  it('M5-001: accepts a legacy estimate without totalMemoryBytes (additive)', () => {
    // Old consumers/fixtures keep passing; `totalMemoryBytes` is optional.
    expect(LoadEstimateSchema.safeParse(minimalLoadEstimate).success).toBe(true);
  });

  it('M5-001: keeps totalMemoryBytes distinct from system RAM', () => {
    const parsed = LoadEstimateSchema.safeParse({ ...minimalLoadEstimate, totalMemoryBytes: 7_500_000_000 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.totalMemoryBytes).toBe(7_500_000_000);
      expect(parsed.data.systemRamBytes).toBe(4_096_000);
    }
    expect(LoadEstimateSchema.safeParse({ ...minimalLoadEstimate, totalMemoryBytes: -1 }).success).toBe(false);
  });
});

describe('BenchmarkResult', () => {
  it('accepts a valid result and defaults samples to 0', () => {
    const result = BenchmarkResultSchema.safeParse(minimalBenchmarkResult);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metrics.samples).toBe(5);
    }
  });

  it('rejects an unknown status and missing id', () => {
    expect(BenchmarkResultSchema.safeParse({ ...minimalBenchmarkResult, status: 'pending' }).success).toBe(false);
    expect(BenchmarkResultSchema.safeParse({ ...minimalBenchmarkResult, id: '' }).success).toBe(false);
  });
});

describe('ActivationTransaction', () => {
  it('accepts a valid transaction and defaults stages/errors to []', () => {
    const result = ActivationTransactionSchema.safeParse(minimalActivationTransaction);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stages).toHaveLength(2);
    }
    const bare = ActivationTransactionSchema.safeParse({
      schemaVersion: 2,
      id: 't1',
      targetProfileId: 'p1',
      status: 'idle',
      policy: { mode: 'exclusive', rollback: 'best-effort' },
      startedAt: '2026-08-21T12:00:00Z',
    });
    expect(bare.success).toBe(true);
    if (bare.success) {
      expect(bare.data.stages).toEqual([]);
      expect(bare.data.errors).toEqual([]);
    }
  });

  it('rejects unknown status and a missing restart point for recovery', () => {
    expect(
      ActivationTransactionSchema.safeParse({ ...minimalActivationTransaction, status: 'bouncing' }).success,
    ).toBe(false);
    expect(ActivationTransactionSchema.safeParse({ ...minimalActivationTransaction, targetProfileId: '' }).success)
      .toBe(false);
  });
});

describe('CapabilityMatrix', () => {
  it('accepts a valid matrix and validates enum domains', () => {
    expect(CapabilityMatrixSchema.safeParse(minimalCapabilityMatrix).success).toBe(true);
    expect(CapabilityMatrixSchema.safeParse({ ...minimalCapabilityMatrix, adapter: 'web' }).success).toBe(false);
    expect(
      CapabilityMatrixSchema.safeParse({
        ...minimalCapabilityMatrix,
        capabilities: [{ field: 'runtime.flashAttention', support: 'partially' }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityMatrixSchema.safeParse({ ...minimalCapabilityMatrix, capabilities: [] }).success,
    ).toBe(true);
  });

  it('rejects a zero TTL and an empty field name', () => {
    expect(CapabilityMatrixSchema.safeParse({ ...minimalCapabilityMatrix, cacheTtlSeconds: 0 }).success).toBe(false);
    expect(
      CapabilityMatrixSchema.safeParse({
        ...minimalCapabilityMatrix,
        capabilities: [{ field: '', support: 'exact' }],
      }).success,
    ).toBe(false);
  });
});