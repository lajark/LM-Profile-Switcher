/**
 * Programmable in-memory Mock adapter (M0-005): a fake runtime for unit tests
 * and the explicit `LMPS_ADAPTER=mock` demo path. It mirrors the tests/core
 * `FakeRuntime` pattern so the switch between "fixture" and "real" stays a
 * one-line option — and it is never selected silently (the router requires the
 * explicit override).
 */
import type { ActivationRuntime, ActiveState } from '@lmps/core';
import type { CompositeProfile } from '@lmps/domain';

import type { ModelIdentity } from '../model-names.js';
import { parseModelIdentity } from '../model-names.js';

export interface MockModelInstance {
  key: string;
  loadConfig: Record<string, unknown>;
}

export interface MockAdapterFaults {
  unload?: Error;
  load?: Error;
  healthCheck?: Error;
  getActiveState?: Error;
  readEffectiveConfig?: Error;
}

export interface MockAdapterOptions {
  instances?: MockModelInstance[];
  faults?: MockAdapterFaults;
  now?: () => string;
}

export interface MockStateView {
  /** Instances in load order; the last one is the active model. */
  instances: MockModelInstance[];
  loadCount: number;
}

export function createMockAdapter(options: MockAdapterOptions = {}): ActivationRuntime & {
  listModels(): Promise<ModelIdentity[]>;
  state(): MockStateView;
} {
  const instances: MockModelInstance[] = [...(options.instances ?? [])];
  const faults = options.faults ?? {};
  const now = options.now ?? (() => new Date().toISOString());
  let loadCount = 0;

  function rejectIfFaulted(fault: Error | undefined): Error | null {
    return fault ?? null;
  }

  async function currentInstance(): Promise<MockModelInstance | null> {
    const fault = rejectIfFaulted(faults.getActiveState);
    if (fault !== null) throw fault;
    const current = instances[instances.length - 1];
    return current ?? null;
  }

  const runtime: ActivationRuntime = {
    async getActiveState(): Promise<ActiveState> {
      const current = await currentInstance();
      if (current === null) return { profileId: null, modelKey: null, since: null };
      return { profileId: null, modelKey: current.key, since: now() };
    },

    async unload(): Promise<void> {
      const fault = rejectIfFaulted(faults.unload);
      if (fault !== null) throw fault;
      instances.pop();
    },

    async restore(): Promise<void> {
      await runtime.unload();
    },

    async load(profile: CompositeProfile): Promise<Record<string, unknown>> {
      const fault = rejectIfFaulted(faults.load);
      if (fault !== null) throw fault;
      loadCount += 1;
      const existing = instances.find((instance) => instance.key === profile.model.modelKey);
      const instance =
        existing ?? { key: profile.model.modelKey, loadConfig: { model: profile.model.modelKey } };
      if (existing === undefined) instances.push(instance);
      return { ...instance.loadConfig, model: profile.model.modelKey };
    },

    async healthCheck(profile: CompositeProfile): Promise<void> {
      const fault = rejectIfFaulted(faults.healthCheck);
      if (fault !== null) throw fault;
      if (!instances.some((instance) => instance.key === profile.model.modelKey)) {
        throw new Error(`mock health: ${profile.model.modelKey} not loaded`);
      }
    },

    async readEffectiveConfig(profile: CompositeProfile): Promise<Record<string, unknown>> {
      const fault = rejectIfFaulted(faults.readEffectiveConfig);
      if (fault !== null) throw fault;
      const current = instances[instances.length - 1];
      if (current !== undefined && current.key === profile.model.modelKey) return current.loadConfig;
      return {};
    },
  };

  return {
    ...runtime,
    async listModels(): Promise<ModelIdentity[]> {
      return [...instances].map((instance) => parseModelIdentity(instance.key));
    },
    state(): MockStateView {
      return { instances: [...instances], loadCount };
    },
  };
}

export type MockAdapter = ReturnType<typeof createMockAdapter>;