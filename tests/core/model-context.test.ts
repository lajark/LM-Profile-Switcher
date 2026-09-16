import { describe, expect, it } from 'vitest';

import { buildModelContext, type ModelContextInput } from '@lmps/core';
import type { BenchmarkResult, CompositeProfile } from '@lmps/domain';

const NOW = '2026-09-13T00:00:00.000Z';

function profile(id: string, modelKey: string, taskType = 'chat', validation?: CompositeProfile['validation']): CompositeProfile {
  return {
    schemaVersion: 2,
    id,
    displayName: { 'zh-CN': id, en: id },
    model: { modelKey, family: 'test' },
    task: { type: taskType },
    runtime: {},
    generation: {},
    behavior: { mode: 'exclusive' },
    ...(validation === undefined ? {} : { validation }),
    metadata: { createdAt: NOW, updatedAt: NOW },
  };
}

function benchmark(id: string, modelKey: string, taskType: string, overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    schemaVersion: 2,
    id,
    modelKey,
    taskType,
    status: 'completed',
    metrics: { samples: 1, tokensPerSecond: 10 },
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  };
}

function input(overrides: Partial<ModelContextInput> = {}): ModelContextInput {
  return {
    now: NOW,
    evidenceTtlMs: 7 * 24 * 60 * 60 * 1000,
    models: [{ modelKey: 'alpha', family: 'alpha', quantization: 'Q4_K_M', parametersB: 7 }],
    profiles: [profile('alpha-chat', 'alpha')],
    benchmarks: [],
    legacy: [],
    readiness: {
      hardware: { status: 'ready', fingerprint: 'hw-1' },
      lmStudio: { status: 'ready', version: '0.3.0' },
      discovery: { status: 'ready', observedAt: NOW },
      runtime: { status: 'idle', active: null },
    },
    ...overrides,
  };
}

describe('buildModelContext', () => {
  it('groups model, scenario, profiles and benchmark history with explicit no-default state', () => {
    const result = buildModelContext(
      input({
        profiles: [profile('alpha-chat', 'alpha'), profile('alpha-rag', 'alpha', 'rag')],
        benchmarks: [benchmark('bench-1', 'alpha', 'chat')],
      }),
    );

    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.model).toMatchObject({ modelKey: 'alpha', family: 'alpha', loaded: false });
    expect(result.models[0]?.scenarios.map((scenario) => scenario.type)).toEqual(['chat', 'rag']);
    expect(result.models[0]?.scenarios[0]).toMatchObject({
      type: 'chat',
      profileState: 'available',
      defaultProfileId: null,
      defaultState: 'none',
      benchmarkCount: 1,
    });
  });

  it('makes missing models, no profiles, changed environment and stale evidence explicit', () => {
    const old = '2026-08-01T00:00:00.000Z';
    const result = buildModelContext(
      input({
        now: NOW,
        models: [],
        profiles: [
          profile('missing', 'missing-model', 'chat', {
            source: 'benchmarked',
            testedAt: old,
            hardwareFingerprint: 'old-hw',
            lmStudioVersion: '0.2.0',
          }),
        ],
        readiness: {
          hardware: { status: 'ready', fingerprint: 'hw-2' },
          lmStudio: { status: 'ready', version: '0.3.0' },
          discovery: { status: 'ready', observedAt: NOW },
          runtime: { status: 'idle', active: null },
        },
      }),
    );

    expect(result.models[0]?.availability).toBe('missing');
    expect(result.models[0]?.scenarios[0]).toMatchObject({
      profileState: 'available',
      evidence: 'changed-environment',
      hasProfiles: true,
      benchmarkCount: 0,
    });

    const stale = buildModelContext(
      input({
        profiles: [profile('stale', 'stale-model', 'chat', {
          source: 'benchmarked',
          testedAt: old,
          hardwareFingerprint: 'hw-1',
          lmStudioVersion: '0.3.0',
        })],
        models: [{ modelKey: 'stale-model', family: null, quantization: null, parametersB: null }],
      }),
    );
    expect(stale.models[0]?.scenarios[0]?.evidence).toBe('stale');

    const partial = buildModelContext(
      input({
        profiles: [profile('partial', 'partial-model', 'chat', { source: 'benchmarked', testedAt: NOW })],
        models: [{ modelKey: 'partial-model', family: null, quantization: null, parametersB: null }],
      }),
    );
    expect(partial.models[0]?.scenarios[0]?.evidence).toBe('partial');

    const noProfile = buildModelContext(input({ models: [{ modelKey: 'empty', family: null, quantization: null, parametersB: null }], profiles: [] }));
    expect(noProfile.models[0]?.scenarios).toEqual([]);
    expect(noProfile.models[0]?.profileState).toBe('none');
  });

  it('keeps legacy entries in needs-organization without inferring a model or scenario', () => {
    const result = buildModelContext(
      input({
        legacy: [{ id: 'legacy-1', reason: 'unclassifiable-model-or-scenario' }],
      }),
    );
    expect(result.needsOrganization).toEqual([
      { id: 'legacy-1', reason: 'unclassifiable-model-or-scenario' },
    ]);
  });

  it('reports offline and partial readiness separately from runtime state', () => {
    const result = buildModelContext(
      input({
        readiness: {
          hardware: { status: 'unavailable', fingerprint: null },
          lmStudio: { status: 'offline', version: null },
          discovery: { status: 'partial', observedAt: null },
          runtime: { status: 'unknown', active: null },
        },
      }),
    );
    expect(result.readiness).toEqual(expect.objectContaining({
      hardware: { status: 'unavailable', fingerprint: null },
      lmStudio: { status: 'offline', version: null },
      discovery: { status: 'partial', observedAt: null },
      runtime: { status: 'unknown', active: null },
    }));
  });

  it('exposes an explicit available default and marks the profile', () => {
    const result = buildModelContext(
      input({
        defaults: [{ modelKey: 'alpha', taskType: 'chat', profileId: 'alpha-chat' }],
      }),
    );

    expect(result.models[0]?.scenarios[0]).toMatchObject({
      defaultProfileId: 'alpha-chat',
      defaultState: 'available',
    });
    expect(result.models[0]?.scenarios[0]?.profiles[0]).toMatchObject({ isDefault: true });
  });
});
