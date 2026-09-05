import { describe, expect, it } from 'vitest';

import { createRestV1Adapter, isLmStudioError } from '@lmps/lmstudio-adapter';
import { makeFakeEnv, loadedModel, restModelsBody } from './fixtures.js';

function makeProfile(modelKey: string, runtime: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: `profile-${modelKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
    displayName: { 'zh-CN': '测试', en: 'test' },
    model: { modelKey },
    task: { type: 'chat' },
    runtime,
    generation: {},
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: '2026-08-22T01:02:03.000Z', updatedAt: '2026-08-22T01:02:03.000Z' },
  };
}

describe('createRestV1Adapter', () => {
  it('lists models with identity fields', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([loadedModel('mistral-7b.Q4_K_M.gguf'), loadedModel('codestral-22b')]),
      }),
    });
    const adapter = createRestV1Adapter(env);
    const models = await adapter.listModels();
    expect(models.map((m) => m.modelKey)).toEqual(['mistral-7b.Q4_K_M.gguf', 'codestral-22b']);
    expect(models[0]).toMatchObject({ family: 'mistral', quantization: 'Q4_K_M', parametersB: 7 });
  });

  it('reports active state from the first loaded model (profile unknown via REST)', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([loadedModel('codestral-22b'), loadedModel('idle-model', null)]),
      }),
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.getActiveState()).resolves.toEqual({
      profileId: null,
      modelKey: 'codestral-22b',
      since: null,
    });
  });

  it('reports null active state when nothing is loaded', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([{ id: 'free-model', loaded: false }]),
      }),
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.getActiveState()).resolves.toEqual({
      profileId: null,
      modelKey: null,
      since: null,
    });
  });

  it('unloads the active model via the unload endpoint', async () => {
    const seen: string[] = [];
    const env = makeFakeEnv({
      httpHandler: (path, init) => {
        seen.push(`${init.method ?? 'GET'} ${path}`);
        if (path === '/api/v1/models') {
          return { status: 200, body: restModelsBody([loadedModel('current-model')]) };
        }
        if (path === '/api/v1/models/unload') return { status: 200, body: { success: true } };
        return { status: 404, rawText: '{"error":"not found"}' };
      },
    });
    const adapter = createRestV1Adapter(env);
    await adapter.unload();
    expect(seen).toContain('POST /api/v1/models/unload');
  });

  it('unload is a no-op when nothing is loaded', async () => {
    let unloadCalled = false;
    const env = makeFakeEnv({
      httpHandler: (path) => {
        if (path === '/api/v1/models') return { status: 200, body: restModelsBody([]) };
        unloadCalled = true;
        return { status: 200, body: { success: true } };
      },
    });
    const adapter = createRestV1Adapter(env);
    await adapter.unload();
    expect(unloadCalled).toBe(false);
  });

  it('loads a profile and returns the echoed load_config', async () => {
    const profile = makeProfile('mistral-7b-instruct.Q4_K_M.gguf', {
      contextLength: 16384,
      flashAttention: true,
      gpuOffload: 0.5,
    });
    const echoConfig = {
      model: profile.model.modelKey,
      context_length: 16384,
      flash_attention: true,
      gpu_offload: 0.5,
    };
    const env = makeFakeEnv({
      httpHandler: (path) =>
        path === '/api/v1/models/load'
          ? { status: 200, body: { instance_id: 'i1', status: 'ok', load_config: echoConfig } }
          : { status: 404, rawText: '{"error":"not found"}' },
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.load(profile)).resolves.toEqual(echoConfig);
  });

  it('fails healthCheck when the target model is not loaded', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([loadedModel('other-model')]),
      }),
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.healthCheck(makeProfile('mistral-7b'))).rejects.toSatisfy(isLmStudioError);
  });

  it('passes healthCheck when the target model is loaded', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([loadedModel('mistral-7b')]),
      }),
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.healthCheck(makeProfile('mistral-7b'))).resolves.toBeUndefined();
  });

  it('returns the loaded model load_config from readEffectiveConfig', async () => {
    const env = makeFakeEnv({
      httpHandler: () => ({
        status: 200,
        body: restModelsBody([loadedModel('mistral-7b', { context_length: 8192 })]),
      }),
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.readEffectiveConfig(makeProfile('mistral-7b'))).resolves.toEqual({
      context_length: 8192,
    });
  });

  it('classifies an offline REST as unreachable', async () => {
    const env = makeFakeEnv({
      httpHandler: () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const adapter = createRestV1Adapter(env);
    await expect(adapter.getActiveState()).rejects.toMatchObject({ kind: 'unreachable', subsystem: 'rest' });
  });
});