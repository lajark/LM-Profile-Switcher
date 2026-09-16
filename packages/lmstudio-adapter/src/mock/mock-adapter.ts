/**
 * Programmable in-memory Mock adapter (M0-005): a fake runtime for unit tests
 * and the explicit `LMPS_ADAPTER=mock` demo path. It mirrors the tests/core
 * `FakeRuntime` pattern so the switch between "fixture" and "real" stays a
 * one-line option — and it is never selected silently (the router requires the
 * explicit override).
 */
import type { ActivationRuntime, ActiveState, BenchmarkRuntime, BenchmarkSample } from '@lmps/core';
import type { CompositeProfile } from '@lmps/domain';

import type { ModelIdentity } from '../model-names.js';
import { parseModelIdentity } from '../model-names.js';
import type { ChatChunk, ChatUsage } from '../rest/chat.js';

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
  /** Optional model-specific health failure for deterministic integration tests. */
  healthCheckFaultModel?: string;
  /** Keep enough state for the activation runner to restore a prior model. */
  restorePrevious?: boolean;
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
  const rollbackStack: MockModelInstance[] = [];

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
      const current = instances.pop();
      if (options.restorePrevious === true && current !== undefined) rollbackStack.push(current);
    },

    async restore(): Promise<void> {
      if (options.restorePrevious !== true) {
        await runtime.unload();
        return;
      }
      // The activation runner first unloads the failed target, then asks the
      // runtime to restore. Discard the failed target and re-add the prior one.
      rollbackStack.pop();
      const previous = rollbackStack.pop();
      if (previous !== undefined) instances.push(previous);
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
      if (options.healthCheckFaultModel === profile.model.modelKey) {
        throw new Error(`mock health fault: ${profile.model.modelKey}`);
      }
      if (!instances.some((instance) => instance.key === profile.model.modelKey)) {
        throw new Error(`mock health: ${profile.model.modelKey} not loaded`);
      }
      if (options.restorePrevious === true) rollbackStack.length = 0;
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

export interface MockBenchmarkScript {
  /** Content deltas the stream yields, in order. */
  deltas: string[];
  /** Simulated gap before each delta, ms (default 0 → deterministic). */
  gapMs?: number;
  finishReason?: string | null;
  usage?: { completionTokens?: number; promptTokens?: number } | null;
}

export interface MockBenchmarkFaults {
  load?: Error;
  restore?: Error;
  getActiveState?: Error;
  measure?: Error;
}

export interface MockBenchmarkOptions {
  /** Single script or a per-sample list (rotated). */
  scripts?: MockBenchmarkScript | MockBenchmarkScript[];
  /** Scripted load wall-clock, ms (default 0). */
  loadMs?: number;
  nowMs?: () => number;
  faults?: MockBenchmarkFaults;
  /** Optional model key whose measure phase fails deterministically. */
  measureFaultModel?: string;
}

export type MockBenchmarkRuntime = BenchmarkRuntime;

/**
 * Programmable in-memory BenchmarkRuntime (M2-003). Streams yield scripted
 * deltas on an injected clock so TTFT / generated-token / total-Ms assertions
 * are exact; faults inject load/measure failures. Used by core and CLI tests
 * plus the explicit `LMPS_ADAPTER=mock` demo path.
 */
export function createMockBenchmarkRuntime(options: MockBenchmarkOptions = {}): MockBenchmarkRuntime {
  const scripts: MockBenchmarkScript[] =
    options.scripts === undefined
      ? [{ deltas: ['hello', ' '] }]
      : Array.isArray(options.scripts)
        ? options.scripts
        : [options.scripts];
  const faults = options.faults ?? {};
  const nowMs = options.nowMs ?? (() => Date.now());
  const loadMs = options.loadMs ?? 0;
  let measureCount = 0;

  async function measure(profile: CompositeProfile): Promise<BenchmarkSample> {
    const fault = faults.measure;
    if (fault !== undefined) throw fault;
    if (options.measureFaultModel === profile.model.modelKey) {
      throw new Error(`mock benchmark fault: ${profile.model.modelKey}`);
    }
    const script = scripts[measureCount % scripts.length] ?? { deltas: [] };
    const started = nowMs();
    let ttftMs: number | null = null;
    let deltaCount = 0;
    for (const delta of script.deltas) {
      if ((script.gapMs ?? 0) > 0) await delay(script.gapMs ?? 0);
      if (delta !== '') {
        if (ttftMs === null) ttftMs = Math.round(nowMs() - started);
        deltaCount += 1;
      }
    }
    const finishReason = script.finishReason ?? (script.deltas.length > 0 ? 'stop' : null);
    const usageCompletion = script.usage?.completionTokens ?? null;
    measureCount += 1;
    return {
      ttftMs,
      generatedTokens: usageCompletion ?? deltaCount,
      totalMs: Math.round(nowMs() - started),
      finishReason,
    };
  }

  return {
    async getActiveState() {
      const fault = faults.getActiveState;
      if (fault !== undefined) throw fault;
      return { profileId: null, modelKey: null, since: null };
    },
    async load(profile: CompositeProfile) {
      const fault = faults.load;
      if (fault !== undefined) throw fault;
      return { loadConfig: { model: profile.model.modelKey }, loadMs };
    },
    measure,
    async restore() {
      const fault = faults.restore;
      if (fault !== undefined) throw fault;
    },
  };
}

export interface MockChatUpstreamScript {
  /** Content deltas the stream yields, in order. */
  deltas: string[];
  /** Finish reason on the terminal chunk (default 'stop' when deltas exist). */
  finishReason?: string | null;
  usage?: ChatUsage | null;
}

export interface MockChatUpstreamOptions {
  /** Single script (rotated). */
  scripts?: MockChatUpstreamScript | MockChatUpstreamScript[];
  faults?: { open?: Error };
}

/**
 * Programmable OpenAI-compatible chat upstream (M4-002): `open(body, signal)`
 * becomes an `AsyncIterable<ChatChunk>` mirroring what `parseSseChatStream`
 * yields off the real REST wire, so the proxy seam's offline `LMPS_ADAPTER=mock`
 * path is deterministic end-to-end. The request body is captured (callers may
 * assert the injected generation fields) and never interpreted.
 */
export function createMockChatUpstream(
  options: MockChatUpstreamOptions = {},
): {
  open(body: Record<string, unknown>, signal?: AbortSignal): Promise<AsyncIterable<ChatChunk>>;
} {
  const scripts: MockChatUpstreamScript[] =
    options.scripts === undefined
      ? [{ deltas: ['hello'] }]
      : Array.isArray(options.scripts)
        ? options.scripts
        : [options.scripts];
  const openFault = options.faults?.open;
  let callCount = 0;
  return {
    open: async (body, signal) => {
      if (openFault !== undefined) throw openFault;
      const script = scripts[callCount % scripts.length] ?? { deltas: [] };
      callCount += 1;
      return (async function* () {
        for (const delta of script.deltas) {
          if (signal?.aborted) return;
          yield { contentDelta: delta, finishReason: null, usage: null };
        }
        if (signal?.aborted) return;
        yield {
          contentDelta: '',
          finishReason: script.finishReason ?? (script.deltas.length > 0 ? 'stop' : null),
          usage: script.usage ?? null,
        };
      })();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolveResult) => setTimeout(resolveResult, ms));
}