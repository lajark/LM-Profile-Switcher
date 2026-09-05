// M2-002 RecommendationService orchestration: inject fake capability/hardware/
// estimate ports and a scriptable clock, assert the assembled Recommendation.
import { describe, expect, it } from 'vitest';
import {
  ActivationError,
  createRecommendationService,
  type CapabilityPort,
  type EstimatePort,
  type HardwarePort,
} from '@lmps/core';
import type { CapabilityMatrix, CompositeProfile, HardwareProfile, LoadEstimate } from '@lmps/domain';
import { StrictRecommendationSchema } from '@lmps/domain';

import { makeContext, makeProfile, NOW } from './fixtures';

const GIB = 1024 ** 3;

function makeCapability(): CapabilityMatrix {
  return {
    schemaVersion: 2,
    adapter: 'rest',
    probedAt: NOW,
    cacheTtlSeconds: 300,
    capabilities: [
      { field: 'runtime.contextLength', support: 'exact' },
      { field: 'runtime.flashAttention', support: 'exact' },
    ],
  };
}

function makeHardware(): HardwareProfile {
  return {
    schemaVersion: 2,
    os: 'Windows 11',
    gpus: [{ name: 'RTX 5060 Ti', vramTotalBytes: 16 * GIB, vramAvailableBytes: 12 * GIB }],
    probedAt: NOW,
  };
}

type EstimateBehavior = 'exact' | 'rough' | 'throw';

function makeEstimatePort(behavior: EstimateBehavior): EstimatePort {
  return {
    async estimate(): Promise<LoadEstimate> {
      if (behavior === 'throw') throw new Error('estimate unavailable');
      return {
        schemaVersion: 2,
        provider: behavior === 'exact' ? 'exact' : 'rough',
        modelKey: 'synthetic/test-model',
        vramTotalBytes: 6 * GIB,
        systemRamBytes: 2 * GIB,
        estimatedAt: NOW,
        warnings: [],
      };
    },
  };
}

function makeCapabilityPort(matrix: CapabilityMatrix): CapabilityPort {
  return { probe: async (): Promise<CapabilityMatrix> => matrix };
}

function makeHardwarePort(profile: HardwareProfile): HardwarePort {
  return { profile: async (): Promise<HardwareProfile> => profile };
}

function makeRagProfile(): CompositeProfile {
  return makeProfile('rag-prime', {
    model: { modelKey: 'synthetic/test-model', family: 'test', architecture: 'dense' },
    task: { type: 'RAG assistant', kind: 'rag', concurrency: 1 },
    runtime: { contextLength: 8192, gpuOffload: 'max' },
    generation: { temperature: 0.3 },
  });
}

describe('createRecommendationService', () => {
  it('assembles safe, high-confidence candidates with the runner clock stamp', async () => {
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort('exact'),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
    });
    const recommendation = await service.recommend(makeRagProfile());
    expect(StrictRecommendationSchema.safeParse(recommendation).success).toBe(true);
    expect(recommendation.baselineProfileId).toBe('rag-prime');
    expect(recommendation.taskKind).toBe('rag');
    expect(recommendation.generatedAt).toBe(NOW); // ctx.now()
    expect(recommendation.selectedIndex).toBe(0);
    expect(recommendation.candidates.length).toBeGreaterThanOrEqual(3);
    expect(recommendation.candidates.every((candidate) => candidate.score.confidence === 'high')).toBe(true);
    expect(recommendation.warnings).toEqual([]);
  });

  it('fails closed to an empty candidate set on rough estimates', async () => {
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort('rough'),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
    });
    const recommendation = await service.recommend(makeRagProfile());
    expect(recommendation.candidates).toEqual([]);
    expect(recommendation.selectedIndex).toBeNull();
    expect(recommendation.warnings).toContain('unsafe-drop:rough-estimate');
  });

  it('drops candidates whose estimate throws and warns by id', async () => {
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort('throw'),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
    });
    const recommendation = await service.recommend(makeRagProfile());
    expect(recommendation.candidates).toEqual([]);
    expect(recommendation.warnings.some((warning) => warning.startsWith('estimate-failed:rag-prime-'))).toBe(true);
  });

  it('reports no-rule for a kind without a matching seed rule', async () => {
    const kindless = makeProfile('odd'); // task.kind undefined
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort('exact'),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
    });
    const recommendation = await service.recommend(kindless);
    expect(recommendation.candidates).toEqual([]);
    expect(recommendation.selectedIndex).toBeNull();
    expect(recommendation.warnings).toEqual(['no-rule']);
  });

  it('honours an injected rule catalog', async () => {
    const catalog = { schemaVersion: 2, version: 'test.1', rules: [] };
    const service = createRecommendationService(
      makeContext(),
      {
        estimate: makeEstimatePort('exact'),
        capability: makeCapabilityPort(makeCapability()),
        hardware: makeHardwarePort(makeHardware()),
      },
      catalog,
    );
    const recommendation = await service.recommend(makeRagProfile());
    expect(recommendation.warnings).toEqual(['no-rule']);
    expect(recommendation.ruleVersion).toBe('test.1');
  });

  it('throws ACTIVATION_CANCELED when the signal aborts before work', async () => {
    const controller = new AbortController();
    controller.abort();
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort('exact'),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
    });
    await expect(service.recommend(makeRagProfile(), { signal: controller.signal })).rejects.toBeInstanceOf(ActivationError);
  });
});