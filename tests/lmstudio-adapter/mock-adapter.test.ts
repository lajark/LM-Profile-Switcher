import { describe, expect, it } from 'vitest';

import { createMockAdapter, type MockAdapter } from '@lmps/lmstudio-adapter';
import { NOW } from './fixtures.js';

function makeProfile(modelKey: string) {
  return {
    schemaVersion: 2,
    id: `p-${modelKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
    displayName: { 'zh-CN': '测试', en: 'test' },
    model: { modelKey },
    task: { type: 'chat' },
    runtime: {},
    generation: {},
    behavior: { mode: 'exclusive' },
    metadata: { createdAt: NOW, updatedAt: NOW },
  };
}

describe('createMockAdapter', () => {
  it('starts empty, loads, healths and unloads', async () => {
    const adapter: MockAdapter = createMockAdapter({ now: () => NOW });
    await expect(adapter.getActiveState()).resolves.toEqual({ profileId: null, modelKey: null, since: null });

    const echo = await adapter.load(makeProfile('mistral-7b.Q4_K_M.gguf'));
    expect(echo).toMatchObject({ model: 'mistral-7b.Q4_K_M.gguf' });
    await expect(adapter.healthCheck(makeProfile('mistral-7b.Q4_K_M.gguf'))).resolves.toBeUndefined();
    await expect(adapter.getActiveState()).resolves.toEqual({
      profileId: null,
      modelKey: 'mistral-7b.Q4_K_M.gguf',
      since: NOW,
    });
    await expect(adapter.readEffectiveConfig(makeProfile('mistral-7b.Q4_K_M.gguf'))).resolves.toMatchObject({
      model: 'mistral-7b.Q4_K_M.gguf',
    });

    await adapter.unload();
    await expect(adapter.getActiveState()).resolves.toEqual({ profileId: null, modelKey: null, since: null });
  });

  it('pre-seeded instances are discoverable and active', async () => {
    const adapter: MockAdapter = createMockAdapter({
      instances: [{ key: 'codestral-22b.Q8_0.gguf', loadConfig: { context_length: 4096 } }],
    });
    const models = await adapter.listModels();
    expect(models[0]).toMatchObject({ family: 'codestral', parametersB: 22 });
    await expect(adapter.getActiveState()).resolves.toMatchObject({ modelKey: 'codestral-22b.Q8_0.gguf' });
  });

  it('injects per-operation faults', async () => {
    const adapter: MockAdapter = createMockAdapter({
      faults: {
        load: new Error('boom'),
        getActiveState: new Error('gone'),
      },
    });
    await expect(adapter.load(makeProfile('x'))).rejects.toThrow('boom');
    await expect(adapter.getActiveState()).rejects.toThrow('gone');
    await expect(adapter.listModels()).resolves.toEqual([]);
  });

  it('restores by unloading the current model', async () => {
    const adapter: MockAdapter = createMockAdapter({
      instances: [{ key: 'a', loadConfig: {} }],
    });
    await adapter.restore();
    await expect(adapter.getActiveState()).resolves.toMatchObject({ modelKey: null });
  });

  it('mirrors the load count for the state view', async () => {
    const adapter: MockAdapter = createMockAdapter();
    await adapter.load(makeProfile('a'));
    await adapter.load(makeProfile('b'));
    expect(adapter.state().loadCount).toBe(2);
    expect(adapter.state().instances).toHaveLength(2);
  });
});