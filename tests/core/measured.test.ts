// Measured-feedback loop plumbing: the tolerant ndjson parser (malformed or
// schema-invalid lines are skipped, valid legacy and config-bearing records
// both pass) and the recommendation service's optional evidence port (matching
// records promote + reorder candidates; a failing port degrades to the pure
// static ranking without throwing).
import { describe, expect, it } from 'vitest';
import {
  createRecommendationService,
  parseBenchmarkLogLines,
  type CapabilityPort,
  type EstimatePort,
  type HardwarePort,
  type MeasuredResultsPort,
  type RecommendationPorts,
} from '@lmps/core';
import { configSnapshotOf } from '@lmps/benchmark';
import { generateCandidateDrafts, SEED_RULE_CATALOG } from '@lmps/optimizer';
import type { BenchmarkResult, CapabilityMatrix, CompositeProfile, HardwareProfile, LoadEstimate, Rule } from '@lmps/domain';
import { StrictRecommendationSchema } from '@lmps/domain';

import { makeContext, makeProfile, NOW } from './fixtures';

const GIB = 1024 ** 3;

describe('parseBenchmarkLogLines', () => {
  it('parses valid records and skips malformed and schema-invalid lines', () => {
    const valid: BenchmarkResult = {
      schemaVersion: 2,
      id: 'bench-1',
      modelKey: 'm',
      taskType: 'RAG assistant',
      status: 'completed',
      metrics: { decodeTokensPerSecond: 9.9, samples: 3 },
      startedAt: NOW,
      finishedAt: NOW,
      config: { profileId: 'p', gpuOffload: 'max' },
    };
    const content = [
      JSON.stringify(valid),
      '', // blank line
      'not-json',
      '{"half":true}',
      JSON.stringify({ ...valid, status: 'bogus' }), // schema-invalid
      JSON.stringify({ ...valid, id: 'bench-2', config: undefined }), // legacy record
    ].join('\n');
    const results = parseBenchmarkLogLines(content);
    expect(results.map((result) => result.id)).toEqual(['bench-1', 'bench-2']);
    expect(results[0]?.config?.gpuOffload).toBe('max');
  });
});

// --- RecommendationService with a measured evidence port ---

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

function makeEstimatePort(): EstimatePort {
  return {
    async estimate(): Promise<LoadEstimate> {
      return {
        schemaVersion: 2,
        provider: 'exact',
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

function ragRule(): Rule {
  const rule = SEED_RULE_CATALOG.rules.find((entry) => entry.taskKind === 'rag');
  if (rule === undefined) throw new Error('rag seed rule missing');
  return rule;
}

/** One completed record per draft's actual config, with a distinct decode value. */
function evidenceFor(profile: CompositeProfile, rule: Rule): MeasuredResultsPort {
  const drafts = generateCandidateDrafts(profile, rule);
  const results: BenchmarkResult[] = drafts.map((draft, index) => ({
    schemaVersion: 2 as const,
    id: `bench-${draft.id}`,
    modelKey: profile.model.modelKey,
    quantization: null,
    taskType: profile.task.type,
    status: 'completed' as const,
    metrics: { decodeTokensPerSecond: index + 1, ttftMs: 200, samples: 3 },
    hardwareFingerprint: 'fp-x',
    startedAt: NOW,
    finishedAt: `2026-08-22T01:02:0${index}.000Z`,
    errorCode: null,
    config: configSnapshotOf(draft.profile),
  }));
  return { list: async () => results };
}

describe('createRecommendationService with measured evidence', () => {
  it('marks matched candidates as measured and ranks the fastest first', async () => {
    const profile = makeRagProfile();
    const rule = ragRule();
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort(),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
      measured: evidenceFor(profile, rule),
    } satisfies RecommendationPorts);

    const recommendation = await service.recommend(profile);
    expect(StrictRecommendationSchema.safeParse(recommendation).success).toBe(true);
    expect(recommendation.candidates.length).toBeGreaterThan(0);
    expect(recommendation.candidates.every((candidate) => candidate.score.measured)).toBe(true);
    expect(recommendation.candidates.every((candidate) => candidate.score.confidence === 'high')).toBe(true);
    expect(recommendation.selectedIndex).toBe(0);
    const head = recommendation.candidates[0];
    expect(head?.score.measuredEvidence?.decodeTokensPerSecond).toBe(generateCandidateDrafts(profile, rule).length);
  });

  it('degrades to the static ranking when the evidence port fails', async () => {
    const profile = makeRagProfile();
    const service = createRecommendationService(makeContext(), {
      estimate: makeEstimatePort(),
      capability: makeCapabilityPort(makeCapability()),
      hardware: makeHardwarePort(makeHardware()),
      measured: {
        list: async () => {
          throw new Error('log unreadable');
        },
      },
    });
    const recommendation = await service.recommend(profile);
    expect(recommendation.candidates.length).toBeGreaterThan(0);
    expect(recommendation.candidates.every((candidate) => candidate.score.measured === false)).toBe(true);
  });
});
