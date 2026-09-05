import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearProbeCache,
  probeCapabilities,
  type CapabilityMatrix,
} from '@lmps/lmstudio-adapter';
import { loadedModel, makeFakeEnv, restModelsBody } from './fixtures.js';

function matrixFor(result: { matrices: CapabilityMatrix[] }, adapter: string): CapabilityMatrix {
  const matrix = result.matrices.find((entry) => entry.adapter === adapter);
  if (matrix === undefined) throw new Error(`missing ${adapter} matrix`);
  return matrix;
}

function expectSupport(matrix: CapabilityMatrix, field: string): string {
  const entry = matrix.capabilities.find((item) => item.field === field);
  if (entry === undefined) throw new Error(`missing field ${field}`);
  return entry.support;
}

beforeEach(() => {
  clearProbeCache();
});

describe('probeCapabilities', () => {
  it('records everything unavailable when no source answers', async () => {
    const env = makeFakeEnv({
      httpHandler: () => {
        throw new Error('ECONNREFUSED');
      },
      runLmsHandler: () => ({ exitCode: 127, stdout: '', stderr: 'spawn ENOENT', timedOut: false }),
    });
    const result = await probeCapabilities(env, { force: true });
    expect(result.ops.restReachable).toBe(false);
    expect(result.ops.lmsAvailable).toBe(false);
    expect(result.ops.sdkAvailable).toBe(false);
    expect(result.matrices).toHaveLength(3);

    const rest = matrixFor(result, 'rest');
    expect(expectSupport(rest, 'ops.load')).toBe('unavailable');
    expect(expectSupport(rest, 'runtime.flashAttention')).toBe('unknown');
    expect(rest.capabilities.every((entry) => entry.support !== 'exact')).toBe(true);
  });

  it('marks REST operations exact when the host answers', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([loadedModel('mistral-7b.Q4_K_M.gguf')]),
      }),
    });
    const result = await probeCapabilities(env, { force: true });

    expect(result.ops.restReachable).toBe(true);
    expect(result.ops.observed.map((call) => call.endpoint)).toContain('/api/v1/models');

    const rest = matrixFor(result, 'rest');
    for (const field of ['ops.discoverModels', 'ops.load', 'ops.unload', 'ops.healthCheck', 'ops.restore', 'ops.readEffectiveConfig']) {
      expect(expectSupport(rest, field)).toBe('exact');
    }
    // Not yet evidenced by the host → unknown, never silently claimed exact.
    expect(expectSupport(rest, 'runtime.gpuOffload')).toBe('unknown');

    const cli = matrixFor(result, 'cli');
    expect(expectSupport(cli, 'ops.load')).toBe('unavailable');
  });

  it('reports the CLI usable when lms status parses (no human-visible version)', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({ status: 200, body: restModelsBody([]) }),
      runLmsHandler: (args) => ({
        exitCode: 0,
        stdout: args.join(' ') === 'status' ? 'Server:  ON' : '[]',
        stderr: '',
        timedOut: false,
      }),
    });
    const result = await probeCapabilities(env, { force: true });
    expect(result.ops.lmsAvailable).toBe(true);
    expect(result.ops.lmStudioVersion).toBeNull();
    const cli = matrixFor(result, 'cli');
    expect(expectSupport(cli, 'ops.discoverModels')).toBe('exact');
  });

  it('serves cached results within the TTL and re-probes on force', async () => {
    let restCalls = 0;
    const env = makeFakeEnv({
      httpHandler: () => {
        restCalls += 1;
        return { status: 200, body: restModelsBody([]) };
      },
    });

    const first = await probeCapabilities(env);
    expect(first.cached).toBe(false);
    expect(restCalls).toBe(1);

    const cached = await probeCapabilities(env);
    expect(cached.cached).toBe(true);
    expect(restCalls).toBe(1);
    expect(cached).toMatchObject({ matrices: first.matrices, ops: first.ops });

    const forced = await probeCapabilities(env, { force: true });
    expect(forced.cached).toBe(false);
    expect(restCalls).toBe(2);
  });

  it('emits domain-contract matrices (schema version, ttl, per-source)', async () => {
    const env = makeFakeEnv();
    const result = await probeCapabilities(env, { force: true, ttlSeconds: 42 });
    for (const matrix of result.matrices) {
      expect(matrix.schemaVersion).toBe(2);
      expect(matrix.cacheTtlSeconds).toBe(42);
      expect(['rest', 'cli', 'sdk']).toContain(matrix.adapter);
      expect(matrix.probedAt).toBe('2026-08-22T01:02:03.000Z');
    }
    expect(result.expiresAt).toBe('2026-08-22T01:02:45.000Z');
  });
});