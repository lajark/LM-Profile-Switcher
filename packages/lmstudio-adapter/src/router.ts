/**
 * Adapter router (M0-005): picks the adapter for each read/write surface from
 * the capability probe plus an explicit override. Mock is never selected
 * silently — it requires `LMPS_ADAPTER=mock` from the user (demo/testing).
 */

import type { ActivationRuntime } from '@lmps/core';

import type { CapabilityProbeResult } from './capability.js';
import { createCliAdapter, type CliLms } from './cli/cli-adapter.js';
import type { LmStudioEnv } from './env.js';
import { LmStudioError } from './errors.js';
import type { ModelIdentity } from './model-names.js';
import { createMockAdapter } from './mock/mock-adapter.js';
import { createRestV1Adapter, type RestV1Discovery } from './rest/rest-v1-adapter.js';

export type AdapterSelection = 'auto' | 'mock';

export interface RouterOptions {
  selection?: AdapterSelection;
}

export interface ReadModels {
  listModels(): Promise<ModelIdentity[]>;
}

export interface AdapterBundle {
  /** Write-capable activation runtime (REST is the production source). */
  runtime: ActivationRuntime;
  /** Read/discovery surface (may differ from `runtime` when REST is down). */
  discovery: ReadModels;
  writeSource: 'rest' | 'mock';
  readSource: 'rest' | 'cli' | 'mock';
}

/** A clean `ActivationRuntime` for when nothing write-capable is reachable. */
function unreachableRuntime(): ActivationRuntime {
  return {
    getActiveState: () => Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
    unload: () => Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
    restore: () => Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
    load: () => Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
    healthCheck: () => Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
    readEffectiveConfig: () => Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
  };
}

export function resolveAdapters(
  env: LmStudioEnv,
  probe: CapabilityProbeResult,
  options: RouterOptions = {},
): AdapterBundle {
  if (options.selection === 'mock') {
    const mock = createMockAdapter();
    return { runtime: mock, discovery: mock, writeSource: 'mock', readSource: 'mock' };
  }

  if (probe.ops.restReachable) {
    const rest: ActivationRuntime & RestV1Discovery = createRestV1Adapter(env);
    return { runtime: rest, discovery: rest, writeSource: 'rest', readSource: 'rest' };
  }

  // REST is down. Discovery can still ride on `lms` when the binary works;
  // writes stay on the REST adapter so any activation fails with a truthful
  // `unreachable` instead of a misleading partial success.
  if (probe.ops.lmsAvailable) {
    const cli: CliLms = createCliAdapter(env);
    return {
      runtime: unreachableRuntime(),
      discovery: cli,
      writeSource: 'rest',
      readSource: 'cli',
    };
  }

  return {
    runtime: unreachableRuntime(),
    discovery: unreachableDiscovery(),
    writeSource: 'rest',
    readSource: 'rest',
  };
}

function unreachableDiscovery(): ReadModels {
  return {
    listModels: () =>
      Promise.reject(new LmStudioError('no reachable LM Studio adapter', { subsystem: 'probe', kind: 'unreachable' })),
  };
}