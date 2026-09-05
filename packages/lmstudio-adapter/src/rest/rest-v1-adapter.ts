/**
 * REST v1 adapter (M0-005): the primary production path — loopback HTTP to the
 * local LM Studio server, which needs no per-command subprocess and no SDK
 * install. Implements the `ActivationRuntime` contract (packages/core ports)
 * plus a model-list surface for discovery. REST v1 does not attribute a loaded
 * model to a profile id or expose last-load timestamps, so `getActiveState`
 * reports the loaded model key with null profile/id timestamps — the runner
 * treats that as "no known active profile" (no silent idempotency).
 */
import type { ActivationRuntime, ActiveState } from '@lmps/core';
import type { CompositeProfile } from '@lmps/domain';

import type { LmStudioEnv } from '../env.js';
import { LmStudioError } from '../errors.js';
import type { ModelIdentity } from '../model-names.js';
import { parseModelIdentity } from '../model-names.js';
import {
  profileToRestLoadParams,
  restListModels,
  restLoadModel,
  restUnloadModel,
} from './v1.js';

export interface RestV1Discovery {
  listModels(): Promise<ModelIdentity[]>;
}

function isLoaded(profile: CompositeProfile, models: ReadonlyArray<{ id: string; loaded: boolean }>): boolean {
  return models.some((model) => model.id === profile.model.modelKey && model.loaded);
}

export function createRestV1Adapter(env: LmStudioEnv): ActivationRuntime & RestV1Discovery {
  async function getActiveState(): Promise<ActiveState> {
    const models = await restListModels(env);
    const loaded = models.find((model) => model.loaded);
    if (loaded === undefined) return { profileId: null, modelKey: null, since: null };
    return { profileId: null, modelKey: loaded.id, since: null };
  }

  async function unload(): Promise<void> {
    const state = await getActiveState();
    if (state.modelKey === null) return; // nothing loaded → nothing to unload
    await restUnloadModel(env, state.modelKey);
  }

  /** REST has no snapshot/restore model; a restore is a clean unload + re-load of the same key. */
  async function restore(): Promise<void> {
    await unload();
  }

  async function load(profile: CompositeProfile): Promise<Record<string, unknown>> {
    const response = await restLoadModel(env, profileToRestLoadParams(profile));
    // The echo (`echo_load_config`) is the closest the v1 API has to "the
    // configuration the server actually applied"; survive a missing echo.
    return response.loadConfig ?? { model: profile.model.modelKey };
  }

  async function healthCheck(profile: CompositeProfile): Promise<void> {
    const models = await restListModels(env);
    if (!isLoaded(profile, models)) {
      throw new LmStudioError(`model ${profile.model.modelKey} is not loaded`, {
        subsystem: 'rest',
        kind: 'health',
        detail: profile.model.modelKey,
      });
    }
  }

  async function readEffectiveConfig(profile: CompositeProfile): Promise<Record<string, unknown>> {
    const models = await restListModels(env);
    const loaded = models.find((model) => model.id === profile.model.modelKey);
    return loaded?.loadConfig ?? {};
  }

  async function listModels(): Promise<ModelIdentity[]> {
    const models = await restListModels(env);
    return models.map((model) => parseModelIdentity(model.id));
  }

  return { getActiveState, unload, restore, load, healthCheck, readEffectiveConfig, listModels };
}