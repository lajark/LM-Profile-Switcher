/**
 * REST v1 adapter (M0-005): the primary production path — loopback HTTP to the
 * local LM Studio server, which needs no per-command subprocess and no SDK
 * install. Implements the `ActivationRuntime` contract (packages/core ports)
 * plus a model-list surface for discovery. REST v1 does not attribute a loaded
 * model to a profile id or expose last-load timestamps, so `getActiveState`
 * reports the loaded model key with null profile/id timestamps — the runner
 * treats that as "no known active profile" (no silent idempotency).
 */
import type { ActivationRuntime, ActiveState, BenchmarkRuntime, BenchmarkSample } from '@lmps/core';
import type { CompositeProfile } from '@lmps/domain';

import type { LmStudioEnv } from '../env.js';
import { LmStudioError } from '../errors.js';
import type { ModelIdentity } from '../model-names.js';
import { parseModelIdentity } from '../model-names.js';
import { restChatCompletionStream } from './chat.js';
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
    // Find the loaded instance directly so the instance_id (required by the
    // live unload contract) is available; fall back to list+active-state shape.
    const models = await restListModels(env);
    const loaded = models.find((model) => model.loaded);
    if (loaded === undefined) return; // nothing loaded → nothing to unload
    await restUnloadModel(env, loaded.id, loaded.instanceId);
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

/**
 * Benchmark runtime over REST v1 + the chat streaming endpoint (M2-003).
 * Timing is captured client-side on the injected clock: load wall-clock around
 * the REST load call, TTFT at the first content delta, total at stream end and
 * generation tokens from the final `usage.completion_tokens` when present,
 * else the content-delta count.
 */
export function createRestBenchmarkRuntime(env: LmStudioEnv): BenchmarkRuntime {
  const base = createRestV1Adapter(env);

  // Instance ids loaded before this run started; restore unloads only instances
  // the run created, never an instance another activation left loaded. Restore
  // is best-effort and must not depend on load having succeeded.
  let preLoadInstanceIds: ReadonlySet<string> = new Set();

  async function listLoadedInstanceIds(): Promise<ReadonlySet<string>> {
    const models = await restListModels(env);
    const ids = new Set<string>();
    for (const model of models) {
      for (const instanceId of model.loadedInstanceIds) ids.add(instanceId);
    }
    return ids;
  }

  async function load(profile: CompositeProfile): Promise<{ loadConfig: Record<string, unknown>; loadMs: number }> {
    // Snapshot the pre-run loaded set so restore can tell the instance(s) this
    // benchmark created apart from a model another activation already loaded.
    // Live host 2026-09-07: loading the same model with a different context
    // spawns a second instance (`key:2`), and unrestricted unload would evict
    // the first. The snapshot is best-effort — a failed list leaves an empty
    // set and restore then unloads everything it finds (safe fallback).
    try {
      preLoadInstanceIds = await listLoadedInstanceIds();
    } catch {
      preLoadInstanceIds = new Set();
    }
    // Loads against the REST v1 endpoint directly: `base.load` is the
    // activation signature (profile, estimate) and benchmark has no estimate.
    const started = env.nowMs();
    const response = await restLoadModel(env, profileToRestLoadParams(profile));
    return {
      loadConfig: response.loadConfig ?? { model: profile.model.modelKey },
      loadMs: Math.round(env.nowMs() - started),
    };
  }

  async function measure(profile: CompositeProfile, options: { prompt: string; maxTokens: number; signal?: AbortSignal }): Promise<BenchmarkSample> {
    const started = env.nowMs();
    let ttftMs: number | null = null;
    let deltaCount = 0;
    let usageCompletion: number | null = null;
    let finishReason: string | null = null;
    const stream = await restChatCompletionStream(
      env,
      { modelKey: profile.model.modelKey, prompt: options.prompt, maxTokens: options.maxTokens },
      { signal: options.signal },
    );
    for await (const chunk of stream) {
      if (chunk.contentDelta !== '') {
        if (ttftMs === null) ttftMs = Math.round(env.nowMs() - started);
        deltaCount += 1;
      }
      if (chunk.finishReason !== null) finishReason = chunk.finishReason;
      if (chunk.usage !== null) {
        if (chunk.usage.completionTokens !== null) usageCompletion = chunk.usage.completionTokens;
      }
    }
    const totalMs = Math.round(env.nowMs() - started);
    return {
      ttftMs,
      generatedTokens: usageCompletion ?? deltaCount,
      totalMs,
      finishReason,
    };
  }

  async function restore(): Promise<void> {
    // Evict only the instances this run created. The pre-run snapshot makes the
    // restore idempotent and activation-safe: a model another activation left
    // loaded (recorded in the snapshot) is never touched, and re-running a
    // restore after a partial cleanup finds nothing new to do.
    let current: ReadonlySet<string>;
    try {
      current = await listLoadedInstanceIds();
    } catch {
      // A crashed host cannot be listed; nothing to restore.
      return;
    }
    for (const loadedInstanceId of current) {
      if (preLoadInstanceIds.has(loadedInstanceId)) continue;
      // Best-effort; a failed unload leaves a lease the next acquire cleans up.
      try {
        await restUnloadModel(env, loadedInstanceId.split(':')[0] ?? loadedInstanceId, loadedInstanceId);
      } catch {
        // Best-effort restore: a crashed host cannot always unload.
      }
    }
  }

  return {
    getActiveState: () => base.getActiveState(),
    load,
    measure,
    restore,
  };
}